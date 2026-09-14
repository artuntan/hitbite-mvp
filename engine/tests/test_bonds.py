import math
from datetime import date, timedelta
from decimal import Decimal

import pytest

from nav_engine.bonds import (
    Bond,
    CashFlow,
    accrued_days,
    accrued_interest,
    cash_flows,
    coupon_period_days,
    coupon_schedule,
    dirty_price,
    is_coupon_date,
    market_value,
    next_coupon_date,
    prev_coupon_date,
    price_derivative,
    price_from_yield,
    risk_measures,
    solve_ytm,
    ytm_from_price,
)
from nav_engine.daycount import days_30_360_us
from nav_engine.errors import BondMaturedError, DataError, EngineError
from nav_engine.money import quantize_usd
from tests.conftest import FIXTURES_DIR, read_csv

B2029 = Bond(
    "TURKEY USD 6.00% 2029 (illustrative)", Decimal("6.0"), date(2029, 3, 1), Decimal(400000)
)
B2034 = Bond(
    "TURKEY USD 6.65% 2034 (illustrative)", Decimal("6.65"), date(2034, 3, 1), Decimal(400000)
)
B2036 = Bond(
    "TURKEY USD 7.04% 2036 (illustrative)", Decimal("7.04"), date(2036, 3, 1), Decimal(200000)
)
BONDS = {b.name: b for b in (B2029, B2034, B2036)}
ON = date(2026, 9, 8)


@pytest.mark.parametrize(
    ("bond", "expected"),
    [(B2029, "466.67"), (B2034, "517.22"), (B2036, "273.78")],
)
def test_accrued_interest_on_inception(bond: Bond, expected: str) -> None:
    assert quantize_usd(accrued_interest(bond, ON)) == Decimal(expected)


def test_accrued_is_exact_decimal_not_float() -> None:
    accrued = accrued_interest(B2029, ON)
    assert isinstance(accrued, Decimal)
    assert accrued == Decimal(400000) * Decimal("0.06") / 2 * 7 / 180


def test_schedule_and_coupon_dates() -> None:
    assert coupon_schedule(B2029, ON)[:2] == [date(2027, 3, 1), date(2027, 9, 1)]
    assert coupon_schedule(B2029, ON)[-1] == B2029.maturity
    assert len(coupon_schedule(B2029, ON)) == 5
    assert prev_coupon_date(B2029, ON) == date(2026, 9, 1)
    assert next_coupon_date(B2029, ON) == date(2027, 3, 1)
    assert prev_coupon_date(B2029, date(2026, 9, 1)) == date(2026, 9, 1)
    assert is_coupon_date(B2029, date(2026, 9, 1))
    assert not is_coupon_date(B2029, ON)
    assert is_coupon_date(B2029, B2029.maturity)
    assert not is_coupon_date(B2029, date(2029, 9, 1))


def test_dirty_and_market_value_identity() -> None:
    on = date(2026, 9, 11)
    clean = Decimal("99.98")
    dirty = dirty_price(B2029, clean, on)
    assert dirty == clean + Decimal("0.06") / 2 * 10 / 180 * 100
    mv = market_value(B2029, clean, on)
    assert mv == B2029.face_usd * dirty / 100
    assert quantize_usd(mv) == quantize_usd(
        B2029.face_usd * clean / 100 + accrued_interest(B2029, on)
    )
    assert quantize_usd(mv) == Decimal("400586.67")


def test_matured_bond_raises_clear_error() -> None:
    with pytest.raises(BondMaturedError):
        cash_flows(B2029, B2029.maturity)
    with pytest.raises(BondMaturedError):
        next_coupon_date(B2029, date(2030, 1, 1))


def test_par_bond_on_coupon_date_yields_its_coupon() -> None:
    for bond in BONDS.values():
        on = date(2026, 9, 1)
        flows = cash_flows(bond, on)
        y = ytm_from_price(flows, 100.0, 0.05)
        assert y == pytest.approx(float(bond.coupon_pct) / 100, abs=1e-12)


@pytest.mark.parametrize("bond", list(BONDS.values()))
@pytest.mark.parametrize("y", [0.02, 0.0599, 0.065, 0.09, 0.12])
def test_ytm_round_trip(bond: Bond, y: float) -> None:
    flows = cash_flows(bond, ON)
    price = price_from_yield(flows, y)
    solved = ytm_from_price(flows, price, float(bond.coupon_pct) / 100)
    assert solved == pytest.approx(y, abs=1e-12)
    assert price_from_yield(flows, solved) == pytest.approx(price, abs=1e-10)


def test_risk_measures_are_positive_and_ordered_by_maturity() -> None:
    durations = [risk_measures(cash_flows(b, ON), 0.065).modified_duration for b in BONDS.values()]
    assert durations == sorted(durations)
    assert all(d > 0 for d in durations)


def test_per_bond_figures_match_bonds_fixture() -> None:
    for row in read_csv(FIXTURES_DIR / "bonds_fixture.csv"):
        bond = BONDS[row["name"]]
        on = date.fromisoformat(row["date"])
        clean = Decimal(row["clean_price"])
        assert prev_coupon_date(bond, on).isoformat() == row["prev_coupon_date"]
        assert next_coupon_date(bond, on).isoformat() == row["next_coupon_date"]
        assert quantize_usd(accrued_interest(bond, on)) == Decimal(row["accrued_usd"])
        dirty = dirty_price(bond, clean, on)
        assert abs(dirty - Decimal(row["dirty_price"])) <= Decimal("0.5e-8")
        assert quantize_usd(market_value(bond, clean, on)) == Decimal(row["market_value_usd"])
        flows = cash_flows(bond, on)
        y = ytm_from_price(flows, float(dirty), float(bond.coupon_pct) / 100)
        risk = risk_measures(flows, y)
        assert y * 100 == pytest.approx(float(row["ytm_pct"]), abs=1e-6)
        assert risk.modified_duration == pytest.approx(float(row["modified_duration"]), abs=1e-6)
        assert risk.convexity == pytest.approx(float(row["convexity"]), abs=1e-6)


# --- day count, accrual and the coupon-date reset --------------------------------------------

EOM = Bond("EOM 6.00% 2033 (31 Aug)", Decimal("6.0"), date(2033, 8, 31), Decimal(400000))
"""End-of-month schedule: add_months clamps 31 August back to 28 February, so the legs are not
180 days. Exactly the shape the review's accrued-exceeds-coupon finding used."""


def test_coupon_period_days_is_180_for_the_shipped_first_of_month_bonds() -> None:
    """The fixture tie-out depends on this: every published accrued still divides by 180."""
    for bond in BONDS.values():
        for on in (ON, date(2026, 9, 1), date(2027, 2, 28), date(2027, 3, 1), date(2028, 8, 31)):
            assert coupon_period_days(bond, on) == 180
            assert bond.days_per_period == 180


def test_coupon_period_days_follows_an_end_of_month_schedule() -> None:
    assert prev_coupon_date(EOM, date(2029, 8, 30)) == date(2029, 2, 28)
    assert next_coupon_date(EOM, date(2029, 8, 30)) == date(2029, 8, 31)
    assert coupon_period_days(EOM, date(2029, 8, 30)) == 180  # 28 Feb -> 31 Aug
    assert coupon_period_days(EOM, date(2030, 2, 27)) == 178  # 31 Aug -> 28 Feb
    # the denominator is the day count of the live period, never the nominal 180
    assert coupon_period_days(EOM, date(2030, 2, 27)) == days_30_360_us(
        date(2029, 8, 31), date(2030, 2, 28)
    )
    assert EOM.days_per_period == 180
    assert accrued_days(EOM, date(2029, 8, 30)) == 180
    assert accrued_days(EOM, date(2030, 2, 27)) == 177


@pytest.mark.parametrize("bond", [B2029, B2034, B2036, EOM])
def test_accrued_stays_inside_one_coupon_every_day_of_three_years(bond: Bond) -> None:
    """Accrued is in [0, coupon] on every calendar day. It can only reach a whole coupon on the
    last calendar day of a period, where the 30/360 clock saturates (the 30th and the 31st of a
    month are the same day); before the fix it climbed to 182/180 of a coupon."""
    coupon = bond.coupon_per_period
    day = bond.maturity - timedelta(days=3 * 365)
    while day < bond.maturity:
        accrued = accrued_interest(bond, day)
        assert Decimal(0) <= accrued <= coupon, (bond.name, day, accrued, coupon)
        if accrued == coupon:
            assert day + timedelta(days=1) == next_coupon_date(bond, day), (bond.name, day)
        if is_coupon_date(bond, day):
            assert accrued == 0
        day += timedelta(days=1)
    assert accrued_interest(bond, bond.maturity) == 0


@pytest.mark.parametrize("bond", [B2029, B2034, B2036, EOM])
def test_nav_never_falls_across_a_coupon_date(bond: Bond) -> None:
    """Holding the clean price flat, market value + the coupon just paid can only rise."""
    clean = Decimal("100.00")
    day = bond.maturity - timedelta(days=3 * 365)
    while day < bond.maturity:
        if is_coupon_date(bond, day):
            before = market_value(bond, clean, day - timedelta(days=1))
            after = market_value(bond, clean, day) + bond.coupon_per_period
            assert after >= before, (bond.name, day, before, after)
        day += timedelta(days=1)


def test_accrued_before_the_fix_would_have_exceeded_the_coupon() -> None:
    """Pins the defect: 28 Feb -> 30 Aug is 180/180 of a period, not the old 182/180."""
    on = date(2029, 8, 30)
    assert accrued_interest(EOM, on) == EOM.coupon_per_period == Decimal(12000)
    assert EOM.coupon_per_period * Decimal(182) / Decimal(180) > EOM.coupon_per_period


# --- yield solver: robustness ------------------------------------------------------------------

GRID_BONDS = [
    Bond("1y semi-annual", Decimal("6.0"), date(2027, 9, 15), Decimal(400000), 2),
    Bond("10y semi-annual", Decimal("6.0"), date(2036, 9, 1), Decimal(400000), 2),
    Bond("annual", Decimal("4.25"), date(2031, 6, 30), Decimal(100000), 1),
    Bond("quarterly", Decimal("9.0"), date(2030, 5, 15), Decimal(250000), 4),
    Bond("monthly", Decimal("2.5"), date(2029, 12, 15), Decimal(50000), 12),
    Bond("zero coupon", Decimal("0.0"), date(2032, 3, 1), Decimal(100000), 2),
]
DAYS_BEFORE_MATURITY = [1, 5, 45, 200, 365, 3650]
"""One day from maturity out to ten years; 45 and 200 land mid-coupon-period."""
GRID_YIELDS = [-0.5, -0.1, -0.02, 0.0, 0.02, 0.06, 0.125, 0.25, 0.6, 1.5]
"""Deep premium (a -50% yield prices a 10y bond above 110,000) to deep discount (1.5 prices it
under 0.01 per 100 face)."""


@pytest.mark.parametrize("bond", GRID_BONDS, ids=lambda b: b.name)
@pytest.mark.parametrize("days_before", DAYS_BEFORE_MATURITY)
def test_ytm_round_trip_over_a_wide_grid(bond: Bond, days_before: int) -> None:
    on = bond.maturity - timedelta(days=days_before)
    flows = cash_flows(bond, on)
    y0 = float(bond.coupon_pct) / 100.0
    for y in GRID_YIELDS:
        if 1.0 + y / bond.frequency <= 0.0:
            continue
        price = price_from_yield(flows, y, bond.frequency)
        assert price > 0.0
        solved = ytm_from_price(flows, price, y0, bond.frequency)
        assert isinstance(solved, float)
        assert math.isfinite(solved)
        assert solved == pytest.approx(y, rel=1e-9, abs=1e-10), (bond.name, days_before, y)
        assert price_from_yield(flows, solved, bond.frequency) == pytest.approx(
            price, rel=1e-12, abs=1e-10
        )


@pytest.mark.parametrize("bond", GRID_BONDS, ids=lambda b: b.name)
def test_par_price_on_a_coupon_date_yields_exactly_the_coupon(bond: Bond) -> None:
    on = prev_coupon_date(bond, bond.maturity - timedelta(days=400))
    assert is_coupon_date(bond, on)
    assert accrued_interest(bond, on) == 0
    flows = cash_flows(bond, on)
    solved = ytm_from_price(flows, 100.0, 0.05, bond.frequency)
    assert solved == pytest.approx(float(bond.coupon_pct) / 100.0, abs=1e-12)


@pytest.mark.parametrize(
    ("clean", "expected_sign"),
    [("20.00", 1), ("50.00", 1), ("80.00", 1), ("99.50", 1), ("100.50", 1), ("120.00", 1)],
)
def test_round_trip_from_a_quoted_clean_price(clean: str, expected_sign: int) -> None:
    """Price -> ytm -> price for prices quoted by hand into prices.csv, deep discount to premium."""
    bond = B2034
    on = date(2026, 11, 20)  # mid coupon period
    dirty = float(dirty_price(bond, Decimal(clean), on))
    flows = cash_flows(bond, on)
    solved = ytm_from_price(flows, dirty, float(bond.coupon_pct) / 100.0)
    assert math.isfinite(solved)
    assert 1.0 + solved / 2 > 0.0
    assert price_from_yield(flows, solved) == pytest.approx(dirty, rel=1e-12, abs=1e-10)
    assert (solved > 0) is (expected_sign > 0)


def test_yields_decrease_as_the_price_rises() -> None:
    bond = B2034
    on = date(2026, 11, 20)
    flows = cash_flows(bond, on)
    solved = [
        ytm_from_price(flows, float(dirty_price(bond, Decimal(p), on)), 0.0665)
        for p in ("20", "50", "80", "100", "130", "200", "300")
    ]
    assert solved == sorted(solved, reverse=True)


# --- yield solver: the regressions the review found --------------------------------------------


@pytest.mark.parametrize("on", [date(2029, 2, 26), date(2029, 2, 27), date(2029, 2, 28)])
def test_shipped_2029_position_solves_in_its_final_coupon_period(on: date) -> None:
    """The exact days the review's solver failed on: 2029-02-27 raised 'did not converge' and
    2029-02-28 returned a yield from a day count that ignored the February rule.

    One flow remains, so the root has a closed form: ``y = 2 * ((A/P)^(1/t) - 1)``.
    """
    clean = Decimal("100.08")  # the last price row in data/prices.csv, carried forward
    dirty = float(dirty_price(B2029, clean, on))
    flows = cash_flows(B2029, on)
    assert len(flows) == 1
    closed_form = 2.0 * ((flows[0].amount_per_100 / dirty) ** (1.0 / flows[0].t_periods) - 1.0)
    solved = ytm_from_price(flows, dirty, 0.06)
    assert isinstance(solved, float)
    assert math.isfinite(solved)
    assert solved == pytest.approx(closed_form, rel=1e-9)
    assert price_from_yield(flows, solved) == pytest.approx(dirty, rel=1e-13, abs=1e-10)
    risk = risk_measures(flows, solved)
    assert 0.0 < risk.modified_duration < 0.05


def test_shipped_2029_position_solves_every_day_of_its_last_month() -> None:
    """The review swept clean prices near maturity and found 61.5% failing one day out."""
    for days_before in range(1, 31):
        on = B2029.maturity - timedelta(days=days_before)
        flows = cash_flows(B2029, on)
        for clean in ("95.00", "98.50", "100.08", "101.75", "105.00"):
            dirty = float(dirty_price(B2029, Decimal(clean), on))
            solved = ytm_from_price(flows, dirty, 0.06)
            assert math.isfinite(solved)
            assert price_from_yield(flows, solved) == pytest.approx(dirty, rel=1e-12, abs=1e-9)


def test_solver_converges_at_the_float_noise_floor_instead_of_raising() -> None:
    """The old absolute 1e-14 step tolerance sat below one ulp of the price / |dP/dy| here, so
    Newton limit-cycled between two adjacent doubles and raised after 100 iterations."""
    on = date(2029, 2, 27)
    flows = cash_flows(B2029, on)
    dirty = float(dirty_price(B2029, Decimal("100.08"), on))
    smallest_step = math.ulp(dirty) / abs(price_derivative(flows, -0.0116))
    assert smallest_step > 1e-14  # no Newton step below the old tolerance is even representable
    solution = solve_ytm(flows, dirty, 0.06)
    assert solution.iterations < 10
    assert abs(solution.residual) <= 1e-12


def test_a_mistyped_clean_price_does_not_produce_a_complex_number_or_an_overflow() -> None:
    """clean 1000.80 for 100.08 - a missing decimal point - used to raise OverflowError."""
    on = date(2026, 9, 15)
    flows = cash_flows(B2029, on)
    dirty = float(dirty_price(B2029, Decimal("1000.80"), on))
    solution = solve_ytm(flows, dirty, 0.06)
    assert isinstance(solution.y, float)
    assert math.isfinite(solution.y)
    assert 1.0 + solution.y / 2 > 0.0  # never left the discounting domain
    assert price_from_yield(flows, solution.y) == pytest.approx(dirty, rel=1e-12, abs=1e-9)


def test_deep_premium_reaches_the_bisection_fallback() -> None:
    """A price of 300 for a one-year bond makes the first Newton step overshoot past y = -2,
    where the discount base turns negative. The safeguard must catch it, not the complex plane."""
    bond = Bond("1y", Decimal("6.0"), date(2027, 9, 15), Decimal(400000))
    on = date(2026, 9, 8)
    flows = cash_flows(bond, on)
    dirty = float(dirty_price(bond, Decimal("300.00"), on))
    solution = solve_ytm(flows, dirty, 0.06)
    assert solution.bisection_steps >= 1, "the bracketing fallback must be live, not dead code"
    assert math.isfinite(solution.y)
    assert price_from_yield(flows, solution.y) == pytest.approx(dirty, rel=1e-12, abs=1e-9)
    # ... and it agrees with a plain bisection run independently of the engine's solver.
    lo, hi = -1.999, 1.0
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if price_from_yield(flows, mid) > dirty:
            lo = mid
        else:
            hi = mid
    assert solution.y == pytest.approx(0.5 * (lo + hi), rel=1e-9)


def test_newton_never_leaves_the_discounting_domain() -> None:
    """Sweeps the regime the review's randomised scan found complex yields in: every outcome is
    a real, finite, in-domain yield that reprices, or a DataError - never a complex number."""
    bond = Bond("1y", Decimal("6.0"), date(2027, 9, 15), Decimal(400000))
    on = date(2026, 9, 8)
    flows = cash_flows(bond, on)
    for clean_cents in range(2000, 40001, 250):
        dirty = float(dirty_price(bond, Decimal(clean_cents) / 100, on))
        try:
            solved = ytm_from_price(flows, dirty, 0.06)
        except DataError:
            continue
        assert isinstance(solved, float) and not isinstance(solved, complex)
        assert math.isfinite(solved)
        assert 1.0 + solved / 2 > 0.0
        assert price_from_yield(flows, solved) == pytest.approx(dirty, rel=1e-11, abs=1e-8)


# --- yield solver: inputs with no solution ------------------------------------------------------


@pytest.mark.parametrize("dirty", [0.0, -1.0, -103.0, float("nan"), float("inf")])
def test_non_positive_price_raises_a_data_error(dirty: float) -> None:
    flows = cash_flows(B2029, ON)
    with pytest.raises(DataError, match="must be positive and finite"):
        ytm_from_price(flows, dirty, 0.06)


def test_price_far_below_the_remaining_flows_raises_an_actionable_data_error() -> None:
    """A price of 1.00 the week before a coupon implies a yield of 3.6e12; that is a typo."""
    on = date(2026, 9, 8)
    flows = cash_flows(Bond("1y", Decimal("6.0"), date(2027, 9, 15), Decimal(400000)), on)
    with pytest.raises(DataError, match="implies a yield above"):
        ytm_from_price(flows, 1.0, 0.06)


def test_price_above_everything_the_bond_can_pay_raises_a_data_error() -> None:
    """One day from maturity at 150 per 100 face the root is below -100%: not representable."""
    on = date(2029, 2, 28)
    flows = cash_flows(B2029, on)
    with pytest.raises(DataError, match="too far from par"):
        ytm_from_price(flows, 150.0, 0.06)


def test_flows_that_all_fall_today_raise_a_data_error_not_a_zero_derivative() -> None:
    """30 August and 31 August are the same day on the 30/360 clock, so dP/dy is exactly zero."""
    bond = Bond("EOM 2029", Decimal("6.0"), date(2029, 8, 31), Decimal(400000))
    on = date(2029, 8, 30)
    flows = cash_flows(bond, on)
    assert [cf.t_periods for cf in flows] == [0.0]
    with pytest.raises(DataError, match="no yield is defined"):
        ytm_from_price(flows, float(dirty_price(bond, Decimal("100"), on)), 0.06)


def test_solver_errors_are_engine_errors_so_the_cli_reports_them() -> None:
    assert issubclass(DataError, EngineError)
    with pytest.raises(EngineError):
        ytm_from_price([], 100.0, 0.06)


@pytest.mark.parametrize("y", [-2.0, -2.5, -100.0, float("-inf"), float("nan")])
def test_pricing_outside_the_discounting_domain_raises_instead_of_going_complex(y: float) -> None:
    flows = cash_flows(B2029, ON)
    with pytest.raises(DataError, match="discounting domain"):
        price_from_yield(flows, y, 2)
    with pytest.raises(DataError, match="discounting domain"):
        price_derivative(flows, y, 2)


def test_pricing_at_an_extreme_but_valid_yield_does_not_overflow() -> None:
    """base ** t overflows for a 10-year bond above ~y = 1e5; the flow is worth zero, not a crash."""
    flows = cash_flows(B2036, ON)
    price = price_from_yield(flows, 1.0e6)
    slope = price_derivative(flows, 1.0e6)
    assert 0.0 < price < 1e-3 and math.isfinite(price)
    assert -1e-3 < slope < 0.0 and math.isfinite(slope)


# --- risk measures, checked independently of the closed forms -----------------------------------


@pytest.mark.parametrize("bond", GRID_BONDS, ids=lambda b: b.name)
@pytest.mark.parametrize("y", [0.0, 0.03, 0.08])
def test_duration_and_convexity_match_finite_differences(bond: Bond, y: float) -> None:
    """build_fixture.py re-types the same closed forms, so it cannot catch a formula error;
    numerical differentiation of price_from_yield can."""
    on = bond.maturity - timedelta(days=400)
    flows = cash_flows(bond, on)
    freq = bond.frequency
    h = 1e-6
    price = price_from_yield(flows, y, freq)
    up = price_from_yield(flows, y + h, freq)
    down = price_from_yield(flows, y - h, freq)
    risk = risk_measures(flows, y, freq)
    assert risk.modified_duration == pytest.approx(-(up - down) / (2 * h) / price, rel=1e-6)
    assert risk.convexity == pytest.approx((up - 2 * price + down) / h**2 / price, rel=1e-3)


def test_risk_measures_survive_an_extreme_yield_and_report_a_zero_price() -> None:
    """The discount factor overflows long before the yield does; that must not be a crash."""
    flows = cash_flows(B2036, ON)
    risk = risk_measures(flows, 1.0e6)
    assert math.isfinite(risk.modified_duration)
    assert math.isfinite(risk.convexity)
    with pytest.raises(DataError, match="not representable"):
        risk_measures(flows, 1.0e250)
    # every discount factor overflows, so the whole schedule prices to exactly zero
    with pytest.raises(DataError, match="price rounds to zero"):
        risk_measures([CashFlow(date(2036, 3, 1), 2.0, 100.0)], 1.0e250)
