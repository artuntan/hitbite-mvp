"""Build and write ``nav.json``, ``holdings.json``, ``nav_history.json`` and ``scenarios.json``.

Every document carries ``generated_at`` (UTC, injectable), ``as_of`` where applicable,
``simulated: true`` and a ``source_note`` (portfolio note plus a one-line engine note).
``nav_history.json`` is upserted by date: the full path from inception is regenerated and merged
with any entries already on disk, so repeated runs are idempotent.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

from pydantic import BaseModel, ValidationError

from nav_engine import __version__
from nav_engine.chain import ChainSnapshot
from nav_engine.errors import DataError
from nav_engine.money import ONE_HUNDRED, TOKEN_UNIT, money_context
from nav_engine.nav import DistributionYield, NavPath
from nav_engine.scenarios import ScenarioSet
from nav_engine.schemas import (
    CdsScenario,
    ChainInfo,
    ComparisonBlock,
    DistributionYieldBlock,
    EngineConfig,
    FeesBlock,
    HoldingPosition,
    HoldingsDocument,
    NavBlock,
    NavDocument,
    NavHistoryDocument,
    NavHistoryEntry,
    ParallelScenario,
    Portfolio,
    PortfolioBlock,
    ScenarioBase,
    ScenariosDocument,
    TBillReference,
)

ENGINE_NOTE = (
    f"Computed by nav-engine {__version__}: reference-unit NAV (PLAN.md D19), 30/360 US accrual, "
    "ACT/365F daily fee accrual, Decimal money rounded HALF_UP only at output; "
    "all figures simulated (testnet)."
)

OUTPUT_FILENAMES = {
    "nav": "nav.json",
    "holdings": "holdings.json",
    "nav_history": "nav_history.json",
    "scenarios": "scenarios.json",
}


def source_note_for(portfolio: Portfolio) -> str:
    return f"{portfolio.source_note.strip()} {ENGINE_NOTE}"


def format_generated_at(when: datetime | None = None) -> str:
    """UTC ISO 8601 with a ``Z`` suffix and second precision."""
    stamp = when or datetime.now(UTC)
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=UTC)
    return stamp.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_generated_at(text: str) -> datetime:
    try:
        stamp = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise DataError(f"--generated-at must be ISO 8601 (got {text!r})") from exc
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=UTC)


@dataclass(frozen=True)
class OutputDocuments:
    nav: NavDocument
    holdings: HoldingsDocument
    nav_history: NavHistoryDocument
    scenarios: ScenariosDocument

    def as_dict(self) -> dict[str, BaseModel]:
        return {
            "nav": self.nav,
            "holdings": self.holdings,
            "nav_history": self.nav_history,
            "scenarios": self.scenarios,
        }


def build_nav_document(
    path: NavPath,
    dist_yield: DistributionYield,
    chain: ChainSnapshot,
    config: EngineConfig,
    portfolio: Portfolio,
    generated_at: str,
) -> NavDocument:
    last = path.last
    supply_tokens = chain.total_supply_tokens
    with money_context():
        reported_aum: Decimal | None = None
        reported_aum_6dec: int | None = None
        if supply_tokens is not None and chain.total_supply_wei is not None:
            reported_aum = last.nav_per_unit * supply_tokens
            reported_aum_6dec = last.nav_usdc_6dec * chain.total_supply_wei // 10**18
    tbill = config.comparison.tokenized_tbill_reference
    return NavDocument(
        generated_at=generated_at,
        as_of=path.as_of,
        source_note=source_note_for(portfolio),
        chain=ChainInfo(
            chain_id=chain.chain_id,
            token_address=chain.token_address,
            total_supply_tokens=supply_tokens,
            total_supply_wei=str(chain.total_supply_wei)
            if chain.total_supply_wei is not None
            else None,
            onchain_nav_usdc_6dec=chain.onchain_nav_usdc_6dec,
            supply_source=chain.supply_source,
            warning=chain.warning,
        ),
        nav=NavBlock(
            per_token_usd=last.nav_per_unit,
            usdc_6dec=last.nav_usdc_6dec,
            total_usd=last.nav_total,
            reference_units=path.reference_units,
            reported_aum_usd=reported_aum,
            reported_aum_usdc_6dec=reported_aum_6dec,
        ),
        portfolio=PortfolioBlock(
            sum_market_value_usd=last.sum_market_value,
            cash_usd=last.cash,
            fees_payable_usd=last.fees_payable,
            weighted_ytm_pct=last.weighted_ytm_pct,
            modified_duration=last.weighted_modified_duration,
            convexity=last.weighted_convexity,
            positions_count=len(last.positions),
        ),
        distribution_yield=DistributionYieldBlock(
            trailing_per_unit_usd=dist_yield.trailing_per_unit,
            window_days=dist_yield.window_days,
            months_available=dist_yield.months_available,
            average_nav_per_unit=dist_yield.average_nav_per_unit,
            raw_pct=dist_yield.raw_pct,
            annualized_pct=dist_yield.annualized_pct,
            note=dist_yield.note,
        ),
        fees=FeesBlock(
            management_fee_pct_pa=float(config.fund.management_fee_pct_pa),
            fund_expenses_pct_pa=float(config.fund.fund_expenses_pct_pa),
        ),
        comparison=ComparisonBlock(
            tokenized_tbill_reference=TBillReference(
                label=tbill.label, yield_pct=tbill.yield_pct, source_note=tbill.source_note
            )
        ),
    )


def build_holdings_document(
    path: NavPath, chain: ChainSnapshot, portfolio: Portfolio, generated_at: str
) -> HoldingsDocument:
    last = path.last
    supply_tokens = chain.total_supply_tokens
    with money_context():
        scaled_by = supply_tokens / path.reference_units if supply_tokens is not None else None
        positions: list[HoldingPosition] = []
        for v in last.positions:
            positions.append(
                HoldingPosition(
                    name=v.position.name,
                    isin=v.position.isin,
                    coupon_pct=float(v.position.coupon_pct),
                    maturity=v.position.maturity,
                    face_usd=v.bond.face_usd,
                    scaled_face_usd=v.bond.face_usd * scaled_by if scaled_by is not None else None,
                    clean_price=v.clean_price,
                    accrued_usd=v.accrued,
                    dirty_price=v.dirty_price,
                    market_value_usd=v.market_value,
                    weight_pct=float(v.market_value / last.sum_market_value * ONE_HUNDRED),
                    ytm_pct=v.ytm_pct,
                    modified_duration=v.modified_duration,
                    convexity=v.convexity,
                    prev_coupon_date=v.prev_coupon_date,
                    next_coupon_date=v.next_coupon_date,
                    day_count=v.position.day_count,
                    frequency=v.position.frequency,
                )
            )
    return HoldingsDocument(
        generated_at=generated_at,
        as_of=path.as_of,
        source_note=source_note_for(portfolio),
        scaled_by=scaled_by,
        positions=positions,
        cash_usd=last.cash,
        fees_payable_usd=last.fees_payable,
        nav_total_usd=last.nav_total,
    )


def history_entries(path: NavPath) -> list[NavHistoryEntry]:
    return [
        NavHistoryEntry(
            date=day.date,
            nav_per_token_usd=day.nav_per_unit,
            usdc_6dec=day.nav_usdc_6dec,
            nav_total_usd=day.nav_total,
            weighted_ytm_pct=day.weighted_ytm_pct,
            modified_duration=day.weighted_modified_duration,
            distributions_per_unit_cum=day.distributions_per_unit_cum,
        )
        for day in path.days
    ]


def load_existing_history(file: Path) -> list[NavHistoryEntry]:
    if not file.is_file():
        return []
    try:
        return NavHistoryDocument.model_validate_json(file.read_text()).entries
    except (ValidationError, ValueError) as exc:
        raise DataError(f"existing {file} is not a valid nav_history document: {exc}") from exc


def merge_history(
    existing: list[NavHistoryEntry], fresh: list[NavHistoryEntry]
) -> list[NavHistoryEntry]:
    """Upsert by date: regenerated entries replace stale ones; other dates are kept."""
    by_date = {entry.date: entry for entry in existing}
    for entry in fresh:
        by_date[entry.date] = entry
    return [by_date[d] for d in sorted(by_date)]


def build_nav_history_document(
    path: NavPath,
    portfolio: Portfolio,
    generated_at: str,
    existing: list[NavHistoryEntry] | None = None,
) -> NavHistoryDocument:
    entries = merge_history(existing or [], history_entries(path))
    return NavHistoryDocument(
        generated_at=generated_at, source_note=source_note_for(portfolio), entries=entries
    )


def build_scenarios_document(
    scenarios: ScenarioSet, portfolio: Portfolio, generated_at: str
) -> ScenariosDocument:
    return ScenariosDocument(
        generated_at=generated_at,
        as_of=scenarios.as_of,
        source_note=source_note_for(portfolio),
        assumptions=scenarios.assumptions,
        base=ScenarioBase(
            nav_total_usd=scenarios.base_nav_total, nav_per_token_usd=scenarios.base_nav_per_unit
        ),
        parallel=[
            ParallelScenario(
                shift_bp=int(s.shift_bp),
                nav_total_usd=s.nav_total,
                nav_per_token_usd=s.nav_per_unit,
                delta_usd=s.delta_usd,
                delta_pct=s.delta_pct,
            )
            for s in scenarios.parallel
        ],
        cds=[
            CdsScenario(
                shock_bp=s.shock_bp,
                beta=s.beta,
                shift_bp=s.shift_bp,
                nav_total_usd=s.nav_total,
                nav_per_token_usd=s.nav_per_unit,
                delta_usd=s.delta_usd,
                delta_pct=s.delta_pct,
            )
            for s in scenarios.cds
        ],
    )


def build_documents(
    path: NavPath,
    dist_yield: DistributionYield,
    scenarios: ScenarioSet,
    chain: ChainSnapshot,
    config: EngineConfig,
    portfolio: Portfolio,
    generated_at: str,
    existing_history: list[NavHistoryEntry] | None = None,
) -> OutputDocuments:
    return OutputDocuments(
        nav=build_nav_document(path, dist_yield, chain, config, portfolio, generated_at),
        holdings=build_holdings_document(path, chain, portfolio, generated_at),
        nav_history=build_nav_history_document(path, portfolio, generated_at, existing_history),
        scenarios=build_scenarios_document(scenarios, portfolio, generated_at),
    )


def write_documents(out_dir: Path, documents: OutputDocuments) -> dict[str, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written: dict[str, Path] = {}
    for name, model in documents.as_dict().items():
        target = out_dir / OUTPUT_FILENAMES[name]
        target.write_text(model.model_dump_json(indent=2) + "\n")
        written[name] = target
    return written


def scaled_supply_note(chain: ChainSnapshot) -> str | None:
    """Human-readable supply line for CLI summaries."""
    if chain.total_supply_wei is None:
        return None
    return f"{Decimal(chain.total_supply_wei) / TOKEN_UNIT} tokens ({chain.supply_source})"
