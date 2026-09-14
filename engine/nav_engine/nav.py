"""Day-by-day NAV path from inception to ``as_of`` (FIXTURE.md; PLAN.md D19, D22, D26).

Per calendar day, in this order:

1. fees accrue on the previous day's ``NAV_total`` (nothing on inception day);
2. coupon receipts add cash on coupon dates;
3. positions are valued at the (carried-forward) clean price plus accrued;
4. distributions dated that day reduce reference cash by ``usdc_per_token x reference_units``
   (the on-chain contract lowers ``nav`` by the same per-token amount, D26, so nothing else moves);
5. ``NAV_total = sum(mv) + cash - fees_payable``; ``reference_units`` is fixed at inception
   ``NAV_total`` (D19); ``nav_per_unit`` is quantised HALF_UP to 6 decimals; ``nav_usdc_6dec`` is the
   matching integer (D22).
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from nav_engine.errors import DataError
from nav_engine.fees import daily_fee_accrual
from nav_engine.money import ZERO, money_context, quantize_unit, usdc_6dec
from nav_engine.portfolio import (
    PositionValuation,
    PriceTable,
    coupon_receipts,
    portfolio_risk,
    value_positions,
)
from nav_engine.schemas import DistributionRow, EngineConfig, Portfolio

MAX_YIELD_WINDOW_DAYS = 365
MIN_ANNUALISE_DAYS = 30


@dataclass(frozen=True)
class DayValuation:
    """Everything the engine knows about one calendar day. Money is Decimal, unrounded."""

    date: date
    positions: list[PositionValuation]
    sum_market_value: Decimal
    cash: Decimal
    fees_payable: Decimal
    fee_accrued: Decimal
    coupon_receipts: Decimal
    distribution_per_unit: Decimal
    nav_total: Decimal
    reference_units: Decimal
    nav_per_unit: Decimal
    """Quantised HALF_UP to 6 decimals (the published unit NAV)."""
    nav_usdc_6dec: int
    weighted_ytm: float
    """Decimal fraction."""
    weighted_modified_duration: float
    weighted_convexity: float
    distributions_per_unit_cum: Decimal

    @property
    def weighted_ytm_pct(self) -> float:
        return self.weighted_ytm * 100.0


@dataclass(frozen=True)
class NavPath:
    inception_date: date
    as_of: date
    reference_units: Decimal
    days: list[DayValuation]
    distributions_applied: list[DistributionRow]
    distributions_ignored: list[DistributionRow]
    """Rows dated on or before inception (no units exist yet) - reported as warnings."""

    @property
    def last(self) -> DayValuation:
        return self.days[-1]

    def on(self, when: date) -> DayValuation:
        for day in self.days:
            if day.date == when:
                return day
        raise KeyError(f"{when} is outside the computed path {self.inception_date}..{self.as_of}")


def compute_nav_path(
    portfolio: Portfolio,
    prices: PriceTable,
    config: EngineConfig,
    distributions: Iterable[DistributionRow],
    as_of: date,
) -> NavPath:
    """Run the daily path from ``portfolio.inception_date`` to ``as_of`` inclusive."""
    inception = portfolio.inception_date
    if as_of < inception:
        raise DataError(f"as_of {as_of} is before inception_date {inception}")

    per_day: dict[date, Decimal] = {}
    applied: list[DistributionRow] = []
    ignored: list[DistributionRow] = []
    for row in sorted(distributions, key=lambda r: (r.date, r.distribution_id)):
        if row.date <= inception:
            ignored.append(row)
        elif row.date <= as_of:
            applied.append(row)
            per_day[row.date] = per_day.get(row.date, ZERO) + row.usdc_per_token

    fund = config.fund
    days: list[DayValuation] = []
    with money_context():
        cash = portfolio.cash_usd
        fees_payable = portfolio.fees_payable_usd
        nav_prev: Decimal | None = None
        reference_units: Decimal | None = None
        dist_cum = ZERO
        current = inception
        while current <= as_of:
            fee_today = ZERO
            if nav_prev is not None:
                fee_today = daily_fee_accrual(
                    nav_prev,
                    fund.management_fee_pct_pa,
                    fund.fund_expenses_pct_pa,
                    fund.fee_day_count_basis,
                )
            fees_payable += fee_today

            receipts = coupon_receipts(portfolio, current)
            cash += receipts

            valuations = value_positions(portfolio, prices, current)
            risk = portfolio_risk(valuations)

            dist_today = ZERO
            if reference_units is not None and current in per_day:
                dist_today = per_day[current]
                cash -= dist_today * reference_units
                dist_cum += dist_today

            nav_total = risk.sum_market_value + cash - fees_payable
            if reference_units is None:
                if nav_total <= 0:
                    raise DataError(f"NAV_total on inception day {current} is not positive")
                reference_units = nav_total
            nav_per_unit = quantize_unit(nav_total / reference_units)

            days.append(
                DayValuation(
                    date=current,
                    positions=valuations,
                    sum_market_value=risk.sum_market_value,
                    cash=cash,
                    fees_payable=fees_payable,
                    fee_accrued=fee_today,
                    coupon_receipts=receipts,
                    distribution_per_unit=dist_today,
                    nav_total=nav_total,
                    reference_units=reference_units,
                    nav_per_unit=nav_per_unit,
                    nav_usdc_6dec=usdc_6dec(nav_total / reference_units),
                    weighted_ytm=risk.weighted_ytm,
                    weighted_modified_duration=risk.weighted_modified_duration,
                    weighted_convexity=risk.weighted_convexity,
                    distributions_per_unit_cum=dist_cum,
                )
            )
            nav_prev = nav_total
            current += timedelta(days=1)

    assert reference_units is not None
    return NavPath(
        inception_date=inception,
        as_of=as_of,
        reference_units=reference_units,
        days=days,
        distributions_applied=applied,
        distributions_ignored=ignored,
    )


@dataclass(frozen=True)
class DistributionYield:
    """FIXTURE.md convention 13."""

    trailing_per_unit: Decimal
    window_days: int
    months_available: int
    average_nav_per_unit: Decimal
    raw_pct: float
    annualized_pct: float | None
    note: str


def distribution_yield(
    path: NavPath,
    trailing_months: int = 12,
    max_window_days: int = MAX_YIELD_WINDOW_DAYS,
    min_annualise_days: int = MIN_ANNUALISE_DAYS,
) -> DistributionYield:
    """Trailing distributions per unit over the available window divided by the average unit NAV.

    ``window_days = min(365, days since inception + 1)``. Annualised (x 365 / window_days) only when
    the window is at least 30 days long; otherwise ``annualized_pct`` is ``None`` and the note says why.
    """
    days_since = (path.as_of - path.inception_date).days
    window_days = min(max_window_days, days_since + 1)
    window_start = path.as_of - timedelta(days=window_days - 1)
    in_window = [d for d in path.days if window_start <= d.date <= path.as_of]
    if not in_window:
        raise DataError("distribution yield window is empty")
    months_available = window_days // 30
    with money_context():
        trailing = sum((d.distribution_per_unit for d in in_window), ZERO)
        average = sum((d.nav_per_unit for d in in_window), ZERO) / Decimal(len(in_window))
        raw = trailing / average
        raw_pct = float(raw * 100)
        if window_days >= min_annualise_days:
            annualized: float | None = float(raw * Decimal(365) / Decimal(window_days) * 100)
            note = (
                f"Trailing {window_days}-day window ({months_available} of {trailing_months} months "
                f"available), annualised as raw x 365/{window_days}. Simulated distributions (testnet)."
            )
        else:
            annualized = None
            note = (
                f"Only {window_days} day(s) since inception; the annualised yield is withheld until the "
                f"window reaches {min_annualise_days} days. Raw trailing yield shown. "
                "Simulated distributions (testnet)."
            )
    return DistributionYield(
        trailing_per_unit=trailing,
        window_days=window_days,
        months_available=months_available,
        average_nav_per_unit=average,
        raw_pct=raw_pct,
        annualized_pct=annualized,
        note=note,
    )
