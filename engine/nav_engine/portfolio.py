"""Portfolio and price loading, position valuation, coupon receipts and weighted risk."""

from __future__ import annotations

import bisect
import csv
import datetime as dt
import json
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path

from pydantic import ValidationError

from nav_engine.bonds import (
    Bond,
    accrued_days,
    accrued_interest,
    cash_flows,
    dirty_price,
    is_coupon_date,
    next_coupon_date,
    prev_coupon_date,
    risk_measures,
    ytm_from_price,
)
from nav_engine.errors import DataError, PriceNotFoundError
from nav_engine.money import ONE_HUNDRED, ZERO
from nav_engine.schemas import Portfolio, Position, PriceRow


def _validation_message(path: Path, exc: ValidationError) -> str:
    lines = [f"{path}: invalid data"]
    for err in exc.errors():
        loc = ".".join(str(p) for p in err["loc"]) or "<root>"
        lines.append(f"  - {loc}: {err['msg']}")
    return "\n".join(lines)


def load_portfolio(path: Path) -> Portfolio:
    if not path.is_file():
        raise DataError(f"portfolio file not found: {path}")
    try:
        raw = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise DataError(f"{path}: not valid JSON ({exc})") from exc
    try:
        return Portfolio.model_validate(raw)
    except ValidationError as exc:
        raise DataError(_validation_message(path, exc)) from exc


class PriceTable:
    """Clean prices by (name, date) with carry-forward (FIXTURE.md convention 7)."""

    def __init__(self, rows: Iterable[PriceRow], *, source: Path | None = None) -> None:
        by_name: dict[str, dict[date, Decimal]] = {}
        seen: dict[tuple[str, date], int] = {}
        where = f"{source} " if source is not None else ""
        for lineno, row in enumerate(rows, start=2):
            first = seen.get((row.name, row.date))
            if first is not None:
                # prices.csv is maintained by hand, so a copy-pasted row is a realistic input.
                # Last-write-wins would make the NAV depend on line order; reject it instead, the
                # way load_distributions rejects a duplicate distribution_id.
                raise DataError(
                    f"{where}line {lineno}: duplicate price row for {row.name!r} on {row.date} "
                    f"(already given on line {first} as {by_name[row.name][row.date]}); "
                    "one row per bond per pricing day"
                )
            seen[(row.name, row.date)] = lineno
            by_name.setdefault(row.name, {})[row.date] = row.clean_price
        self._dates: dict[str, list[date]] = {}
        self._prices: dict[str, list[Decimal]] = {}
        for name, series in by_name.items():
            dates = sorted(series)
            self._dates[name] = dates
            self._prices[name] = [series[d] for d in dates]

    @classmethod
    def from_csv(cls, path: Path) -> PriceTable:
        if not path.is_file():
            raise DataError(f"prices file not found: {path}")
        rows: list[PriceRow] = []
        with path.open(newline="") as handle:
            reader = csv.DictReader(handle)
            for lineno, raw in enumerate(reader, start=2):
                try:
                    rows.append(PriceRow.model_validate(raw))
                except ValidationError as exc:
                    raise DataError(
                        f"{path} line {lineno}: {_validation_message(path, exc)}"
                    ) from exc
        return cls(rows, source=path)

    @property
    def names(self) -> set[str]:
        return set(self._dates)

    def clean_price(self, name: str, on: date) -> Decimal:
        """Last known clean price on or before ``on``; raises ``PriceNotFoundError`` if none."""
        dates = self._dates.get(name)
        if not dates:
            raise PriceNotFoundError(f"no price rows at all for {name!r}")
        idx = bisect.bisect_right(dates, on)
        if idx == 0:
            raise PriceNotFoundError(
                f"no clean price for {name!r} on or before {on} (first price row is {dates[0]})"
            )
        return self._prices[name][idx - 1]

    def has_price_on(self, name: str, on: date) -> bool:
        dates = self._dates.get(name, [])
        idx = bisect.bisect_left(dates, on)
        return idx < len(dates) and dates[idx] == on


def load_prices(path: Path) -> PriceTable:
    return PriceTable.from_csv(path)


def to_bond(position: Position) -> Bond:
    return Bond(
        name=position.name,
        coupon_pct=position.coupon_pct,
        maturity=position.maturity,
        face_usd=position.face_usd,
        frequency=position.frequency,
    )


@dataclass(frozen=True)
class PositionValuation:
    """One position on one date. Money in Decimal; yield/risk in float."""

    position: Position
    bond: Bond
    date: dt.date
    clean_price: Decimal
    accrued: Decimal
    dirty_price: Decimal
    market_value: Decimal
    days_accrued: int
    prev_coupon_date: dt.date
    next_coupon_date: dt.date
    ytm: float
    """Decimal fraction (0.06 = 6%)."""
    modified_duration: float
    convexity: float
    matured: bool = False
    """``on >= maturity``: the line has redeemed into cash and carries no market value or risk."""

    @property
    def ytm_pct(self) -> float:
        return self.ytm * 100.0


def matured_valuation(position: Position, on: date) -> PositionValuation:
    """A position on or after its maturity date.

    The face and the final coupon are paid into cash on the maturity date (``coupon_receipts`` and
    ``redemption_receipts``), so from that day the line itself is worth nothing: no price, no
    accrual, no market value, and no yield, duration or convexity to weight. Valuing it instead
    would ask ``bonds.cash_flows`` for a schedule that is already empty and raise
    ``BondMaturedError`` for every remaining day of the path.
    """
    bond = to_bond(position)
    return PositionValuation(
        position=position,
        bond=bond,
        date=on,
        clean_price=ZERO,
        accrued=ZERO,
        dirty_price=ZERO,
        market_value=ZERO,
        days_accrued=0,
        prev_coupon_date=bond.maturity,
        next_coupon_date=bond.maturity,
        ytm=0.0,
        modified_duration=0.0,
        convexity=0.0,
        matured=True,
    )


def value_position(position: Position, clean_price: Decimal, on: date) -> PositionValuation:
    if on >= position.maturity:
        return matured_valuation(position, on)
    bond = to_bond(position)
    accrued = accrued_interest(bond, on)
    dirty = dirty_price(bond, clean_price, on)
    mv = bond.face_usd * dirty / ONE_HUNDRED
    flows = cash_flows(bond, on)
    y = ytm_from_price(flows, float(dirty), float(bond.coupon_pct) / 100.0, bond.frequency)
    risk = risk_measures(flows, y, bond.frequency)
    return PositionValuation(
        position=position,
        bond=bond,
        date=on,
        clean_price=clean_price,
        accrued=accrued,
        dirty_price=dirty,
        market_value=mv,
        days_accrued=accrued_days(bond, on),
        prev_coupon_date=prev_coupon_date(bond, on),
        next_coupon_date=next_coupon_date(bond, on),
        ytm=y,
        modified_duration=risk.modified_duration,
        convexity=risk.convexity,
    )


def value_positions(portfolio: Portfolio, prices: PriceTable, on: date) -> list[PositionValuation]:
    return [
        matured_valuation(p, on)
        if on >= p.maturity
        else value_position(p, prices.clean_price(p.name, on), on)
        for p in portfolio.positions
    ]


def coupon_receipts(portfolio: Portfolio, on: date) -> Decimal:
    """Cash received on ``on`` (convention 8): ``face x coupon/frequency`` for every bond whose
    coupon date it is. Nothing is received on inception day itself."""
    if on <= portfolio.inception_date:
        return ZERO
    total = ZERO
    for position in portfolio.positions:
        bond = to_bond(position)
        if is_coupon_date(bond, on):
            total += bond.coupon_per_period
    return total


def redemption_receipts(portfolio: Portfolio, on: date) -> Decimal:
    """Principal repaid on ``on``: ``face_usd`` for every bond maturing that day.

    The final coupon is paid by ``coupon_receipts`` (the maturity date is a coupon date); this is
    the other half of the redemption, so the position rolls into cash instead of vanishing from the
    book. Buy-and-hold only: there is no sale or reinvestment rule.
    """
    total = ZERO
    for position in portfolio.positions:
        if position.maturity == on:
            total += position.face_usd
    return total


@dataclass(frozen=True)
class PortfolioRisk:
    sum_market_value: Decimal
    weighted_ytm: float
    """Decimal fraction."""
    weighted_modified_duration: float
    weighted_convexity: float

    @property
    def weighted_ytm_pct(self) -> float:
        return self.weighted_ytm * 100.0


def market_value_weights(valuations: list[PositionValuation]) -> list[Decimal]:
    total = sum((v.market_value for v in valuations), ZERO)
    if total == 0:
        # A fully redeemed book holds no bonds at all: every weight is zero and the weighted risk
        # figures come out at zero, which is the truth. Any other way of reaching a zero market
        # value is a broken book (clean prices and faces are validated positive), so keep failing.
        if all(v.matured for v in valuations):
            return [ZERO for _ in valuations]
        raise DataError("portfolio market value is zero; weights are undefined")
    return [v.market_value / total for v in valuations]


def portfolio_risk(valuations: list[PositionValuation]) -> PortfolioRisk:
    """Market-value weighted YTM, modified duration and convexity (convention 5)."""
    weights = market_value_weights(valuations)
    total = sum((v.market_value for v in valuations), ZERO)
    ytm = sum(float(w) * v.ytm for w, v in zip(weights, valuations, strict=True))
    dur = sum(float(w) * v.modified_duration for w, v in zip(weights, valuations, strict=True))
    conv = sum(float(w) * v.convexity for w, v in zip(weights, valuations, strict=True))
    return PortfolioRisk(
        sum_market_value=total,
        weighted_ytm=ytm,
        weighted_modified_duration=dur,
        weighted_convexity=conv,
    )
