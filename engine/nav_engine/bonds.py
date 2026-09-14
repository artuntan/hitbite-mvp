"""Fixed-coupon bond analytics (FIXTURE.md conventions 2-5).

Money (accrued interest, dirty price, market value) is ``Decimal``; yields and risk measures are
floats. Street convention: semi-annual compounding by default, fractional first period on
30/360 US (NASD, February end-of-month rules included - see ``nav_engine.daycount``).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from nav_engine.daycount import add_months, days_30_360_us
from nav_engine.errors import BondMaturedError, DataError
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
        """Nominal 30/360 days in one coupon period (180 for semi-annual).

        Exact for every schedule whose coupon day is the 1st-28th. End-of-month schedules have
        legs of 178-182 days, so accrued interest uses ``coupon_period_days`` (the 30/360 length
        of the live period) instead; this constant only scales cash-flow times and is the
        fallback once the bond has matured.
        """
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


@dataclass(frozen=True)
class YieldSolution:
    """Outcome of :func:`solve_ytm`, including how the root was reached."""

    y: float
    iterations: int
    bisection_steps: int
    """Safeguarded steps taken because Newton left the bracket or stalled."""
    residual: float
    """``price_from_yield(y) - dirty`` at the returned yield."""


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


def coupon_period_days(bond: Bond, on: date) -> int:
    """30/360 length of the coupon period containing ``on``.

    Exactly ``days_per_period`` for a 1st-of-month schedule; 178-182 for an end-of-month one
    (a 31 August maturity steps back to 28 February). Dividing accrued interest by this - not by
    the constant - is what keeps accrued inside one coupon, so NAV cannot fall on a coupon date.
    After maturity there is no live period and the nominal length is used.
    """
    if on >= bond.maturity:
        return bond.days_per_period
    return days_30_360_us(prev_coupon_date(bond, on), next_coupon_date(bond, on))


def accrued_interest(bond: Bond, on: date) -> Decimal:
    """``coupon x days(prev_coupon, on)/days(prev_coupon, next_coupon)`` (convention 3)."""
    return (
        bond.coupon_per_period
        * Decimal(accrued_days(bond, on))
        / Decimal(coupon_period_days(bond, on))
    )


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


def discount_base(y: float, frequency: int) -> float:
    """``1 + y/frequency``, the per-period discount base; raises ``DataError`` unless positive.

    A negative base raised to a fractional power is a complex number in Python (or an
    ``OverflowError``), so every yield the engine discounts with has to sit above ``-frequency``.
    """
    base = 1.0 + y / frequency
    if not math.isfinite(base) or base <= 0.0:
        raise DataError(
            f"yield {y:.6g} is outside the discounting domain: "
            f"1 + y/{frequency} = {base:.6g} must be positive"
        )
    return base


def price_from_yield(flows: list[CashFlow], y: float, frequency: int = 2) -> float:
    """Dirty price per 100 face: ``sum CF_k / (1 + y/f)^t_k``.

    A discount factor that overflows contributes zero (its exact limit); a yield outside the
    discounting domain, or a price too large for a float, raises ``DataError`` rather than
    ``OverflowError`` or a complex number.
    """
    discount_base(y, frequency)  # domain check; raises DataError with the offending yield
    price = _price_or_inf(flows, y, frequency)
    if not math.isfinite(price):
        raise DataError(
            f"price is not representable at yield {y:.6g}: "
            "the cash flows discount to more than a float can hold"
        )
    return price


def price_derivative(flows: list[CashFlow], y: float, frequency: int = 2) -> float:
    """dP/dy for Newton's method, with the same domain and overflow guarantees as the price."""
    base = discount_base(y, frequency)
    total = 0.0
    for cf in flows:
        factor = _discount_factor(base, cf.t_periods + 1.0, y)
        total += -cf.t_periods / frequency * cf.amount_per_100 / factor
    return total


_MAX_YIELD = 1.0e6
"""Bracket cap. A price implying a yield above 100,000,000% a year is a typo, not a price."""

_MAX_BRACKET_STEPS = 2048
_PRICE_ATOL = 1e-12
_PRICE_RTOL = 1e-14
_FALLBACK_RTOL = 1e-10
"""Residual (relative to the price) still accepted from the best iterate after ``max_iter``."""


def _discount_factor(base: float, t: float, y: float) -> float:
    """``base ** t``, mapping an overflow to ``+inf`` (the flow is then worth exactly nothing).

    An underflow to zero would make the flow worth infinitely much, which no caller can use, so
    it raises ``DataError`` rather than dividing by zero.
    """
    try:
        factor = base**t
    except OverflowError:
        return math.inf
    if factor == 0.0:
        raise DataError(
            f"cash flow value is not representable at yield {y:.6g}: "
            "the discount factor underflows to zero"
        )
    return factor


def _price_or_inf(flows: list[CashFlow], y: float, frequency: int) -> float:
    """``price_from_yield`` that saturates to ``+inf`` off-domain instead of raising.

    The solver probes yields on its way to a bracket, so it needs a total function: outside
    ``1 + y/f > 0`` and on overflow/underflow of the discount factor the price is ``+inf``, which
    is the correct limit as the base approaches zero from above.
    """
    base = 1.0 + y / frequency
    if not math.isfinite(base) or base <= 0.0:
        return math.inf
    total = 0.0
    for cf in flows:
        try:
            factor = _discount_factor(base, cf.t_periods, y)
        except DataError:
            return math.inf
        total += cf.amount_per_100 / factor
    return total if math.isfinite(total) else math.inf


def _derivative_or_zero(flows: list[CashFlow], y: float, frequency: int) -> float:
    """``price_derivative`` that returns 0.0 whenever it is not usable, forcing a bisection step."""
    try:
        slope = price_derivative(flows, y, frequency)
    except DataError:
        return 0.0
    return slope if math.isfinite(slope) else 0.0


def _bracket(flows: list[CashFlow], dirty: float, y0: float, frequency: int) -> tuple[float, float]:
    """``(lo, hi)`` with ``price(lo) >= dirty >= price(hi)``; price is decreasing in ``y``."""
    limit = -float(frequency)
    start = y0 if math.isfinite(y0) and y0 > limit else 0.0
    residual = _price_or_inf(flows, start, frequency) - dirty
    if residual > 0.0:
        lo = hi = start
        for _ in range(_MAX_BRACKET_STEPS):
            lo = hi
            hi = min(max(hi * 2.0, hi + 1.0), _MAX_YIELD)
            if _price_or_inf(flows, hi, frequency) - dirty <= 0.0:
                return lo, hi
            if hi >= _MAX_YIELD:
                break
        raise DataError(
            f"yield solver: price {dirty:.6f} per 100 face implies a yield above "
            f"{_MAX_YIELD * 100:.0f}% a year; check the clean price"
        )
    if residual == 0.0:
        return start, start
    hi = start
    gap = start - limit
    for _ in range(_MAX_BRACKET_STEPS):
        gap *= 0.5
        lo = limit + gap
        if lo <= limit:
            return limit, hi
        if _price_or_inf(flows, lo, frequency) - dirty >= 0.0:
            return lo, hi
        hi = lo
    raise DataError(  # pragma: no cover - the price diverges as the base approaches zero
        f"yield solver: price {dirty:.6f} per 100 face cannot be bracketed above -{frequency * 100}%"
    )


def solve_ytm(
    flows: list[CashFlow],
    dirty: float,
    y0: float,
    frequency: int = 2,
    tol: float = 1e-12,
    max_iter: int = 100,
) -> YieldSolution:
    """Solve ``price_from_yield(y) == dirty`` by Newton safeguarded with bisection.

    The root is bracketed first (the price is strictly decreasing in ``y`` and runs from ``+inf``
    at ``y -> -frequency`` down to the flows due today as ``y -> +inf``), then refined by Newton
    from ``y0``. Any step that leaves the bracket, stalls, or hits a zero/degenerate derivative is
    replaced by a bisection step, so convergence is guaranteed. Iteration stops on the price
    residual - ``max(atol, rtol x |dirty|)``, meaningful at every scale, unlike an absolute step
    tolerance that can sit below the float noise floor of a near-maturity bond - or on a relative
    yield step ``tol x max(1, |y|)``; whichever comes first. The best iterate is never discarded.

    Raises ``DataError`` (an ``EngineError``, so the CLI reports it) when the input has no
    solution: a non-positive price, flows that are all due today, or a price so far from par that
    no real yield reaches it. Never returns a complex number, a NaN or an off-domain yield.
    """
    if not flows:
        raise DataError("yield solver: cannot solve a yield without cash flows")
    if not math.isfinite(dirty) or dirty <= 0.0:
        raise DataError(f"yield solver: dirty price must be positive and finite, got {dirty!r}")
    immediate = math.fsum(cf.amount_per_100 for cf in flows if cf.t_periods <= 0.0)
    if all(cf.t_periods <= 0.0 for cf in flows):
        raise DataError(
            f"yield solver: every remaining cash flow ({immediate:.6f} per 100 face) falls on the "
            f"valuation date on the 30/360 clock, so no yield is defined for price {dirty:.6f}"
        )
    if dirty <= immediate:
        raise DataError(
            f"yield solver: price {dirty:.6f} per 100 face is at or below the {immediate:.6f} "
            f"payable today, so no finite yield solves it; check the clean price"
        )

    price_tol = max(_PRICE_ATOL, _PRICE_RTOL * abs(dirty))
    loose_tol = _FALLBACK_RTOL * max(abs(dirty), 1.0)
    lo, hi = _bracket(flows, dirty, y0, frequency)
    y = min(max(y0 if math.isfinite(y0) else 0.0, lo), hi)
    f = _price_or_inf(flows, y, frequency) - dirty
    dfdy = _derivative_or_zero(flows, y, frequency)
    dx_old = hi - lo
    dx = dx_old
    best_y, best_f = y, f
    bisections = 0
    iterations = 0

    for iterations in range(1, max_iter + 1):
        if abs(f) <= price_tol:
            return YieldSolution(y, iterations, bisections, f)
        newton_leaves_bracket = dfdy == 0.0 or ((y - hi) * dfdy - f) * ((y - lo) * dfdy - f) > 0.0
        newton_too_slow = abs(2.0 * f) > abs(dx_old * dfdy)
        if newton_leaves_bracket or newton_too_slow:
            dx_old, dx = dx, 0.5 * (hi - lo)
            y_next = lo + dx
            bisections += 1
            stalled = y_next in (lo, hi)
        else:
            dx_old, dx = dx, f / dfdy
            y_next = y - dx
            stalled = y_next == y
        if stalled:
            break
        y = y_next
        f = _price_or_inf(flows, y, frequency) - dirty
        dfdy = _derivative_or_zero(flows, y, frequency)
        if abs(f) < abs(best_f):
            best_y, best_f = y, f
        if f > 0.0:
            lo = y
        elif f < 0.0:
            hi = y
        else:
            return YieldSolution(y, iterations, bisections, f)
        if abs(dx) <= tol * max(1.0, abs(y)):
            # A tiny step only means convergence if the price it prices back is right: near the
            # domain limit the price moves by thousands over a step of 1e-13, so the residual
            # decides. If it is still wrong the bracket has hit the float floor - fall through
            # and report, never return a yield that does not reprice.
            if abs(f) <= loose_tol:
                return YieldSolution(y, iterations, bisections, f)
            break

    if math.isfinite(best_y) and 1.0 + best_y / frequency > 0.0 and abs(best_f) <= loose_tol:
        return YieldSolution(best_y, iterations, bisections, best_f)
    raise DataError(
        f"yield solver: no representable yield reproduces price {dirty:.6f} per 100 face "
        f"(closest {best_y:.6g}, off by {best_f:.3e} after {iterations} iterations); the price is "
        f"too far from par for the remaining cash flows - check the clean price"
    )


def ytm_from_price(
    flows: list[CashFlow],
    dirty: float,
    y0: float,
    frequency: int = 2,
    tol: float = 1e-12,
    max_iter: int = 100,
) -> float:
    """Yield solving ``price_from_yield(y) == dirty``; see :func:`solve_ytm`."""
    return solve_ytm(flows, dirty, y0, frequency, tol, max_iter).y


def risk_measures(flows: list[CashFlow], y: float, frequency: int = 2) -> RiskMeasures:
    """Macaulay (years), modified duration (years) and convexity (years^2) per convention 5."""
    base = discount_base(y, frequency)
    price = price_from_yield(flows, y, frequency)
    if price == 0.0:
        raise DataError(f"risk measures are undefined at yield {y:.6g}: the price rounds to zero")
    pv = [
        (cf.t_periods, cf.amount_per_100 / _discount_factor(base, cf.t_periods, y)) for cf in flows
    ]
    macaulay = sum(t / frequency * v for t, v in pv) / price
    modified = macaulay / base
    try:
        convexity = sum(t * (t + 1) * v for t, v in pv) / (price * frequency**2 * base**2)
    except OverflowError as exc:  # base**2 overflows above y ~ 1e154
        raise DataError(
            f"risk measures are not representable at yield {y:.6g}: check the clean price"
        ) from exc
    return RiskMeasures(macaulay_duration=macaulay, modified_duration=modified, convexity=convexity)
