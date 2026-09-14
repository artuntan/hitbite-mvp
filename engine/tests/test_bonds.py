from datetime import date
from decimal import Decimal

import pytest

from nav_engine.bonds import (
    Bond,
    accrued_interest,
    cash_flows,
    coupon_schedule,
    dirty_price,
    is_coupon_date,
    market_value,
    next_coupon_date,
    prev_coupon_date,
    price_from_yield,
    risk_measures,
    ytm_from_price,
)
from nav_engine.errors import BondMaturedError
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
