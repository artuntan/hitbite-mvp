"""Pydantic v2 models for engine inputs and every output document.

Input models validate ``portfolio.json``, ``prices.csv`` rows, ``config.yaml`` and distribution rows.
Output models are the contract with the web app: Decimals serialise as fixed-scale strings
(USD to 2 dp, per-unit NAV to 6 dp) next to integer ``usdc_6dec`` fields (PLAN.md D22).
``export_json_schemas`` writes the serialisation-mode JSON schema of each output document.
"""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PlainSerializer,
    field_validator,
    model_validator,
)

from nav_engine.money import fmt_fixed, fmt_unit, fmt_usd

# --------------------------------------------------------------------------- serialised scalar types
Usd2 = Annotated[Decimal, PlainSerializer(fmt_usd, return_type=str, when_used="always")]
"""USD amount written with exactly 2 decimals (HALF_UP at output only)."""

Unit6 = Annotated[Decimal, PlainSerializer(fmt_unit, return_type=str, when_used="always")]
"""Per-unit / per-token amount written with exactly 6 decimals (USDC units)."""

Fixed4 = Annotated[
    Decimal, PlainSerializer(lambda v: fmt_fixed(v, 4), return_type=str, when_used="always")
]
Fixed8 = Annotated[
    Decimal, PlainSerializer(lambda v: fmt_fixed(v, 8), return_type=str, when_used="always")
]
Fixed10 = Annotated[
    Decimal, PlainSerializer(lambda v: fmt_fixed(v, 10), return_type=str, when_used="always")
]
Tokens18 = Annotated[
    Decimal, PlainSerializer(lambda v: fmt_fixed(v, 18), return_type=str, when_used="always")
]
Float6 = Annotated[float, PlainSerializer(lambda v: round(v, 6), return_type=float)]
"""Yield / risk figure (not money) rounded to 6 decimals when written."""

SupplySource = Literal["rpc", "cache", "none"]


# --------------------------------------------------------------------------- inputs
class Position(BaseModel):
    """One bond line of the simulated reference book (BUILD_PROMPT.md 6.1 / 16.2)."""

    name: str = Field(min_length=1)
    isin: str = "TBD"
    coupon_pct: Decimal = Field(ge=0)
    maturity: date
    face_usd: Decimal = Field(gt=0)
    clean_price: Decimal = Field(gt=0)
    purchase_date: date | None = None
    day_count: Literal["30/360"] = "30/360"
    frequency: Literal[1, 2, 4, 12] = 2


class Portfolio(BaseModel):
    """``portfolio.json``: a simulated reference book (PLAN.md D19)."""

    as_of: date
    inception_date: date
    simulated: bool = True
    source_note: str = Field(min_length=1)
    cash_usd: Decimal
    fees_payable_usd: Decimal = Decimal(0)
    positions: list[Position] = Field(min_length=1)

    @field_validator("simulated")
    @classmethod
    def _must_be_simulated(cls, v: bool) -> bool:
        if not v:
            raise ValueError(
                "portfolio.simulated must be true: this testnet engine only handles simulated books"
            )
        return v

    @model_validator(mode="after")
    def _unique_names(self) -> Portfolio:
        names = [p.name for p in self.positions]
        dupes = sorted({n for n in names if names.count(n) > 1})
        if dupes:
            raise ValueError(f"duplicate position names: {dupes}")
        return self


class PriceRow(BaseModel):
    """One row of ``prices.csv``."""

    date: date
    name: str = Field(min_length=1)
    clean_price: Decimal = Field(gt=0)
    ytm_pct: Decimal | None = None
    source: str = ""

    @field_validator("ytm_pct", mode="before")
    @classmethod
    def _blank_is_none(cls, v: object) -> object:
        if isinstance(v, str) and v.strip() == "":
            return None
        return v


class DistributionRow(BaseModel):
    """One distribution: a CSV row or a converted ``CouponDistributed`` event."""

    date: date
    distribution_id: int = Field(ge=0)
    usdc_per_token: Decimal = Field(ge=0)
    usdc_amount: Decimal | None = None
    total_supply_tokens: Decimal | None = None
    tx_hash: str | None = None
    source: str = "manual"

    @field_validator("usdc_amount", "total_supply_tokens", "tx_hash", mode="before")
    @classmethod
    def _blank_is_none(cls, v: object) -> object:
        if isinstance(v, str) and v.strip() == "":
            return None
        return v

    @field_validator("source", mode="before")
    @classmethod
    def _blank_source(cls, v: object) -> object:
        if v is None or (isinstance(v, str) and v.strip() == ""):
            return "manual"
        return v


class FundConfig(BaseModel):
    name: str
    currency: str = "USD"
    management_fee_pct_pa: Decimal = Field(ge=0)
    fund_expenses_pct_pa: Decimal = Field(ge=0)
    fee_day_count_basis: int = Field(default=365, gt=0)


class NavConfig(BaseModel):
    rounding: Literal["ROUND_HALF_UP"] = "ROUND_HALF_UP"
    decimals: Literal[6] = 6
    price_carry_forward: bool = True
    update_policy: str = ""


class OracleConfig(BaseModel):
    max_move_bps: int = 500
    force_requires_reason: bool = True


class DistributionYieldConfig(BaseModel):
    trailing_months: int = Field(default=12, gt=0)


class CdsConfig(BaseModel):
    beta_to_yield: float = 1.0
    shocks_bp: list[float] = Field(default_factory=lambda: [50.0, 100.0, 200.0])
    reference_5y_cds_bp: float | None = None


class ScenariosConfig(BaseModel):
    parallel_shifts_bp: list[int] = Field(default_factory=lambda: [-200, -100, -50, 50, 100, 200])
    cds: CdsConfig = Field(default_factory=CdsConfig)


class TBillReferenceConfig(BaseModel):
    label: str
    yield_pct: float
    source_note: str


class ComparisonConfig(BaseModel):
    tokenized_tbill_reference: TBillReferenceConfig


class EngineConfig(BaseModel):
    """``config.yaml``. Unknown sections are kept for later phases (oracle push, attestation)."""

    model_config = ConfigDict(extra="allow")

    fund: FundConfig
    nav: NavConfig = Field(default_factory=NavConfig)
    oracle: OracleConfig = Field(default_factory=OracleConfig)
    distribution_yield: DistributionYieldConfig = Field(default_factory=DistributionYieldConfig)
    scenarios: ScenariosConfig = Field(default_factory=ScenariosConfig)
    comparison: ComparisonConfig


# --------------------------------------------------------------------------- outputs
class OutputModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ChainInfo(OutputModel):
    chain_id: int | None
    token_address: str | None
    total_supply_tokens: Tokens18 | None
    total_supply_wei: str | None
    onchain_nav_usdc_6dec: int | None
    supply_source: SupplySource
    warning: str | None


class NavBlock(OutputModel):
    per_token_usd: Unit6
    usdc_6dec: int
    total_usd: Usd2
    reference_units: Fixed10
    reported_aum_usd: Usd2 | None
    reported_aum_usdc_6dec: int | None


class PortfolioBlock(OutputModel):
    sum_market_value_usd: Usd2
    cash_usd: Usd2
    fees_payable_usd: Usd2
    weighted_ytm_pct: Float6
    modified_duration: Float6
    convexity: Float6
    positions_count: int


class DistributionYieldBlock(OutputModel):
    trailing_per_unit_usd: Unit6
    window_days: int
    months_available: int
    average_nav_per_unit: Unit6
    raw_pct: Float6
    annualized_pct: Float6 | None
    note: str


class FeesBlock(OutputModel):
    management_fee_pct_pa: float
    fund_expenses_pct_pa: float


class TBillReference(OutputModel):
    label: str
    yield_pct: float
    source_note: str
    illustrative: Literal[True] = True


class ComparisonBlock(OutputModel):
    tokenized_tbill_reference: TBillReference


class NavDocument(OutputModel):
    """``nav.json``."""

    generated_at: str
    as_of: date
    simulated: Literal[True] = True
    source_note: str
    chain: ChainInfo
    nav: NavBlock
    portfolio: PortfolioBlock
    distribution_yield: DistributionYieldBlock
    fees: FeesBlock
    comparison: ComparisonBlock


class HoldingPosition(OutputModel):
    name: str
    isin: str
    illustrative: Literal[True] = True
    coupon_pct: float
    maturity: date
    face_usd: Usd2
    scaled_face_usd: Usd2 | None
    clean_price: Fixed4
    accrued_usd: Usd2
    dirty_price: Fixed8
    market_value_usd: Usd2
    weight_pct: Float6
    ytm_pct: Float6
    modified_duration: Float6
    convexity: Float6
    prev_coupon_date: date
    next_coupon_date: date
    day_count: str
    frequency: int


class HoldingsDocument(OutputModel):
    """``holdings.json``."""

    generated_at: str
    as_of: date
    simulated: Literal[True] = True
    source_note: str
    scaled_by: Fixed10 | None
    positions: list[HoldingPosition]
    cash_usd: Usd2
    fees_payable_usd: Usd2
    nav_total_usd: Usd2


class NavHistoryEntry(OutputModel):
    date: date
    nav_per_token_usd: Unit6
    usdc_6dec: int
    nav_total_usd: Usd2
    weighted_ytm_pct: Float6
    modified_duration: Float6
    distributions_per_unit_cum: Unit6


class NavHistoryDocument(OutputModel):
    """``nav_history.json`` (one entry per calendar day, upserted by date)."""

    generated_at: str
    simulated: Literal[True] = True
    source_note: str
    entries: list[NavHistoryEntry]


class ScenarioBase(OutputModel):
    nav_total_usd: Usd2
    nav_per_token_usd: Unit6


class ParallelScenario(OutputModel):
    shift_bp: int
    nav_total_usd: Usd2
    nav_per_token_usd: Unit6
    delta_usd: Usd2
    delta_pct: Float6


class CdsScenario(OutputModel):
    shock_bp: float
    beta: float
    shift_bp: float
    nav_total_usd: Usd2
    nav_per_token_usd: Unit6
    delta_usd: Usd2
    delta_pct: Float6


class ScenariosDocument(OutputModel):
    """``scenarios.json``."""

    generated_at: str
    as_of: date
    simulated: Literal[True] = True
    source_note: str
    assumptions: str
    base: ScenarioBase
    parallel: list[ParallelScenario]
    cds: list[CdsScenario]


OUTPUT_DOCUMENTS: dict[str, type[BaseModel]] = {
    "nav": NavDocument,
    "holdings": HoldingsDocument,
    "nav_history": NavHistoryDocument,
    "scenarios": ScenariosDocument,
}


def export_json_schemas(out_dir: Path) -> list[Path]:
    """Write ``<name>.schema.json`` for every output document (serialisation mode)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for name, model in OUTPUT_DOCUMENTS.items():
        schema = model.model_json_schema(mode="serialization")
        schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
        schema["$id"] = f"https://hitbite.example/schemas/{name}.schema.json"
        path = out_dir / f"{name}.schema.json"
        path.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")
        written.append(path)
    return written
