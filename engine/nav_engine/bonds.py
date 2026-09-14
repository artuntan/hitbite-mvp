"""Fixed-coupon bond analytics (FIXTURE.md conventions 2-5).

Money (accrued interest, dirty price, market value) is ``Decimal``; yields and risk measures are
floats. Street convention: semi-annual compounding by default, fractional first period on 30/360.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from nav_engine.daycount import add_months, days_30_360_us
from nav_engine.errors import BondMaturedError
from nav_engine.money import ONE_HUNDRED


@dataclass(frozen=True)
class Bond:
    """Plain-vanilla fixed-coupon bond on 30/360 US with ``frequency`` coupons a year."""

    name: str
    coupon_pct: Decimal
    maturity: date
    face_usd: Decimal
    frequency: int = 2

    def __post_init__(self) -> None:
        if self.frequency not in (1, 2, 4, 12):
            raise ValueError(f"{self.name}: unsupported coupon frequency {self.frequency}")
        if self.face_usd <= 0:
            raise ValueError(f"{self.name}: face must be positive")

    @property
    def months_per_period(self) -> int:
        return 12 // self.frequency

    @property
    def days_per_period(self) -> int:
        """30/360 days in one coupon period (180 for semi-annual)."""
        return 360 // self.frequency

    @property
    def coupon_per_period(self) -> Decimal:
        """Cash received per coupon date: ``face x coupon_pct/100 / frequency``."""
        return self.face_usd * self.coupon_pct / ONE_HUNDRED / Decimal(self.frequency)


@dataclass(frozen=True)
class CashFlow:
    pay_date: date
    t_periods: float
    """Time to the flow in coupon periods on 30/360 (``days / days_per_period``)."""
    amount_per_100: float
    """Coupon per 100 face, plus 100 at maturity."""


@dataclass(frozen=True)
class RiskMeasures:
    macaulay_duration: float
    modified_duration: float
    convexity: float


def coupon_schedule(bond: Bond, after: date) -> list[date]:
    """Coupon dates strictly after ``after`` up to maturity, ascending, built backwards from maturity."""
    dates: list[date] = []
    k = 0
    d = bond.maturity
    while d > after:
        dates.append(d)
        k += 1
        d = add_months(bond.maturity, -k * bond.months_per_period)
    dates.reverse()
    return dates


def prev_coupon_date(bond: Bond, on: date) -> date:
    """Latest schedule date <= ``on`` (for ``on`` after maturity this is the maturity date)."""
    k = 0
    d = bond.maturity
    while d > on:
        k += 1
        d = add_months(bond.maturity, -k * bond.months_per_period)
    return d


def next_coupon_date(bond: Bond, on: date) -> date:
    """Earliest schedule date > ``on``; raises ``BondMaturedError`` if none remains."""
    schedule = coupon_schedule(bond, on)
    if not schedule:
        raise BondMaturedError(f"{bond.name}: no coupon dates after {on} (matured {bond.maturity})")
    return schedule[0]


def is_coupon_date(bond: Bond, on: date) -> bool:
    return on <= bond.maturity and prev_coupon_date(bond, on) == on


def accrued_days(bond: Bond, on: date) -> int:
    return days_30_360_us(prev_coupon_date(bond, on), on)


def accrued_interest(bond: Bond, on: date) -> Decimal:
    """``face x (coupon_pct/100)/frequency x days(prev_coupon, on)/days_per_period`` (convention 3)."""
    return bond.coupon_per_period * Decimal(accrued_days(bond, on)) / Decimal(bond.days_per_period)


def dirty_price(bond: Bond, clean_price: Decimal, on: date) -> Decimal:
    """Per 100 face: ``clean + accrued / face x 100``."""
    return clean_price + accrued_interest(bond, on) / bond.face_usd * ONE_HUNDRED


def market_value(bond: Bond, clean_price: Decimal, on: date) -> Decimal:
    """``face x dirty/100`` (algebraically ``face x clean/100 + accrued``)."""
    return bond.face_usd * dirty_price(bond, clean_price, on) / ONE_HUNDRED


def cash_flows(bond: Bond, on: date) -> list[CashFlow]:
    """Remaining flows after ``on`` per 100 face, with times in periods (convention 4)."""
    schedule = coupon_schedule(bond, on)
    if not schedule:
        raise BondMaturedError(f"{bond.name}: no cash flows after {on} (matured {bond.maturity})")
    coupon = float(bond.coupon_pct) / bond.frequency
    flows: list[CashFlow] = []
    for pay_date in schedule:
        t = days_30_360_us(on, pay_date) / bond.days_per_period
        amount = coupon + (100.0 if pay_date == bond.maturity else 0.0)
        flows.append(CashFlow(pay_date=pay_date, t_periods=t, amount_per_100=amount))
    return flows


def price_from_yield(flows: list[CashFlow], y: float, frequency: int = 2) -> float:
    """Dirty price per 100 face: ``sum CF_k / (1 + y/f)^t_k``."""
    base = 1.0 + y / frequency
    return sum(cf.amount_per_100 / base**cf.t_periods for cf in flows)


def price_derivative(flows: list[CashFlow], y: float, frequency: int = 2) -> float:
    """dP/dy for Newton's method."""
    base = 1.0 + y / frequency
    return sum(
        -cf.t_periods / frequency * cf.amount_per_100 / base ** (cf.t_periods + 1) for cf in flows
    )


def ytm_from_price(
    flows: list[CashFlow],
    dirty: float,
    y0: float,
    frequency: int = 2,
    tol: float = 1e-14,
    max_iter: int = 100,
) -> float:
    """Yield solving ``price_from_yield(y) == dirty`` by Newton from ``y0``; stops when |step| < tol."""
    if not flows:
        raise ValueError("cannot solve a yield without cash flows")
    y = y0
    for _ in range(max_iter):
        f = price_from_yield(flows, y, frequency) - dirty
        dfdy = price_derivative(flows, y, frequency)
        if dfdy == 0.0:
            raise ValueError("yield solver: zero derivative")
        step = f / dfdy
        y -= step
        if abs(step) < tol:
            return y
    raise ValueError(f"yield solver did not converge in {max_iter} iterations")


def risk_measures(flows: list[CashFlow], y: float, frequency: int = 2) -> RiskMeasures:
    """Macaulay (years), modified duration (years) and convexity (years^2) per convention 5."""
    base = 1.0 + y / frequency
    price = price_from_yield(flows, y, frequency)
    if price == 0.0:
        raise ValueError("risk measures undefined at zero price")
    pv = [(cf.t_periods, cf.amount_per_100 / base**cf.t_periods) for cf in flows]
    macaulay = sum(t / frequency * v for t, v in pv) / price
    modified = macaulay / base
    convexity = sum(t * (t + 1) * v for t, v in pv) / (price * frequency**2 * base**2)
    return RiskMeasures(macaulay_duration=macaulay, modified_duration=modified, convexity=convexity)
