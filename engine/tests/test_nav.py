"""Tie-out of the day-by-day NAV path to the hand-built fixture (FIXTURE.md tolerances)."""

from datetime import date, timedelta
from decimal import Decimal
from itertools import pairwise

import pytest

from nav_engine.errors import DataError, PriceNotFoundError
from nav_engine.money import fmt_fixed, fmt_unit, fmt_usd, money_context
from nav_engine.nav import compute_nav_path
from nav_engine.pipeline import ComputeResult, load_config
from nav_engine.portfolio import PriceTable, load_portfolio, load_prices
from nav_engine.schemas import DistributionRow, PriceRow
from tests.conftest import DATA_DIR, FIXTURE_AS_OF, FIXTURE_INCEPTION, FIXTURES_DIR, read_csv

MONEY_COLUMNS = {
    "sum_market_value_usd": "sum_market_value",
    "cash_usd": "cash",
    "fees_payable_usd": "fees_payable",
    "nav_total_usd": "nav_total",
}
FLOAT_COLUMNS = {
    "weighted_ytm_pct": "weighted_ytm_pct",
    "modified_duration": "weighted_modified_duration",
    "convexity": "weighted_convexity",
}


def test_path_covers_every_day_from_inception(fixture_result: ComputeResult) -> None:
    path = fixture_result.path
    assert path.inception_date == FIXTURE_INCEPTION
    assert path.as_of == FIXTURE_AS_OF
    assert [d.date for d in path.days] == [FIXTURE_INCEPTION + timedelta(days=i) for i in range(8)]
    assert path.days[0].nav_per_unit == Decimal("1.000000")
    assert path.days[0].nav_usdc_6dec == 1_000_000
    assert path.reference_units == path.days[0].nav_total


def test_every_nav_fixture_row_ties_out(fixture_result: ComputeResult) -> None:
    rows = read_csv(FIXTURES_DIR / "nav_fixture.csv")
    assert len(rows) == len(fixture_result.path.days)
    for row, day in zip(rows, fixture_result.path.days, strict=True):
        assert day.date.isoformat() == row["date"]
        for column, attr in MONEY_COLUMNS.items():
            assert fmt_usd(getattr(day, attr)) == row[column], (row["date"], column)
        assert fmt_fixed(day.reference_units, 10) == row["reference_units"]
        assert fmt_unit(day.nav_per_unit) == row["nav_per_unit"]
        assert day.nav_usdc_6dec == int(row["nav_usdc_6dec"])
        assert fmt_unit(day.distributions_per_unit_cum) == row["distributions_per_unit_cum"]
        for column, attr in FLOAT_COLUMNS.items():
            assert getattr(day, attr) == pytest.approx(float(row[column]), abs=1e-6), column


def test_horizon_nav_is_994658(fixture_result: ComputeResult) -> None:
    last = fixture_result.path.last
    assert last.nav_usdc_6dec == 994658
    assert fmt_usd(last.nav_total) == "1008341.99"


def test_every_bonds_fixture_row_ties_out(fixture_result: ComputeResult) -> None:
    by_key = {
        (day.date.isoformat(), v.position.name): v
        for day in fixture_result.path.days
        for v in day.positions
    }
    rows = read_csv(FIXTURES_DIR / "bonds_fixture.csv")
    assert len(rows) == len(by_key)
    for row in rows:
        v = by_key[(row["date"], row["name"])]
        assert fmt_fixed(v.clean_price, 4) == row["clean_price"]
        assert v.prev_coupon_date.isoformat() == row["prev_coupon_date"]
        assert v.next_coupon_date.isoformat() == row["next_coupon_date"]
        assert v.days_accrued == int(row["days_accrued_30_360"])
        assert fmt_usd(v.accrued) == row["accrued_usd"]
        assert abs(v.dirty_price - Decimal(row["dirty_price"])) <= Decimal("0.5e-8")
        assert fmt_usd(v.market_value) == row["market_value_usd"]
        assert v.ytm_pct == pytest.approx(float(row["ytm_pct"]), abs=1e-6)
        assert v.modified_duration == pytest.approx(float(row["modified_duration"]), abs=1e-6)
        assert v.convexity == pytest.approx(float(row["convexity"]), abs=1e-6)


def test_distribution_reduces_reference_cash_pro_rata(fixture_result: ComputeResult) -> None:
    path = fixture_result.path
    before = path.on(date(2026, 9, 10))
    on = path.on(date(2026, 9, 11))
    assert on.distribution_per_unit == Decimal("0.008000")
    assert before.cash - on.cash == Decimal("0.008000") * path.reference_units
    assert fmt_usd(on.cash) == "4389.94"
    assert [r.distribution_id for r in path.distributions_applied] == [1]
    assert path.distributions_ignored == []


def test_weekend_prices_are_carried_forward(fixture_result: ComputeResult) -> None:
    friday = fixture_result.path.on(date(2026, 9, 11))
    sunday = fixture_result.path.on(date(2026, 9, 13))
    assert [v.clean_price for v in friday.positions] == [v.clean_price for v in sunday.positions]
    assert not fixture_result.prices.has_price_on(
        friday.positions[0].position.name, date(2026, 9, 13)
    )


def test_fees_accrue_on_previous_nav_total_only_after_inception(
    fixture_result: ComputeResult,
) -> None:
    days = fixture_result.path.days
    assert days[0].fee_accrued == 0
    assert days[0].fees_payable == 0
    with money_context():
        rate = (Decimal("0.75") + Decimal("0.30")) / 100 / 365
        for prev, day in pairwise(days):
            assert abs(day.fee_accrued - prev.nav_total * rate) < Decimal("1e-30")
            assert day.fees_payable == prev.fees_payable + day.fee_accrued


def test_all_money_fields_are_decimal(fixture_result: ComputeResult) -> None:
    day = fixture_result.path.last
    for value in (
        day.cash,
        day.fees_payable,
        day.nav_total,
        day.sum_market_value,
        day.nav_per_unit,
    ):
        assert isinstance(value, Decimal)
    for v in day.positions:
        assert isinstance(v.market_value, Decimal)
        assert isinstance(v.accrued, Decimal)
        assert isinstance(v.ytm, float)


def _inputs() -> tuple:
    return (
        load_portfolio(DATA_DIR / "portfolio.json"),
        load_prices(DATA_DIR / "prices.csv"),
        load_config(DATA_DIR / "config.yaml"),
    )


def test_coupon_receipt_rule_is_pinned() -> None:
    """On a coupon date cash rises by face x coupon/2 and accrued restarts from zero (convention 8)."""
    portfolio, _, config = _inputs()
    # Give every bond a price from inception through the first coupon date so the path can be run.
    prices = PriceTable(
        [
            PriceRow(date=FIXTURE_INCEPTION, name=p.name, clean_price=Decimal(100))
            for p in portfolio.positions
        ]
    )
    coupon_day = date(2027, 3, 1)
    path = compute_nav_path(portfolio, prices, config, [], coupon_day)
    day = path.on(coupon_day)
    expected = sum(p.face_usd * p.coupon_pct / 100 / p.frequency for p in portfolio.positions)
    assert day.coupon_receipts == expected
    assert day.cash == path.on(coupon_day - timedelta(days=1)).cash + expected
    assert all(v.accrued == 0 for v in day.positions)
    assert all(v.days_accrued == 0 for v in day.positions)
    assert path.on(coupon_day - timedelta(days=1)).coupon_receipts == 0
    assert path.days[0].coupon_receipts == 0


def test_distributions_before_or_on_inception_are_ignored_with_a_note() -> None:
    portfolio, prices, config = _inputs()
    rows = [
        DistributionRow(date=FIXTURE_INCEPTION, distribution_id=7, usdc_per_token=Decimal("0.5")),
        DistributionRow(date=date(2026, 9, 9), distribution_id=8, usdc_per_token=Decimal("0.001")),
        DistributionRow(date=date(2026, 9, 30), distribution_id=9, usdc_per_token=Decimal("0.001")),
    ]
    path = compute_nav_path(portfolio, prices, config, rows, date(2026, 9, 10))
    assert [r.distribution_id for r in path.distributions_ignored] == [7]
    assert [r.distribution_id for r in path.distributions_applied] == [8]
    assert path.last.distributions_per_unit_cum == Decimal("0.001")


def test_missing_price_before_first_row_is_a_clear_error() -> None:
    portfolio, prices, _config = _inputs()
    with pytest.raises(PriceNotFoundError, match="on or before"):
        prices.clean_price(portfolio.positions[0].name, date(2026, 9, 7))
    with pytest.raises(PriceNotFoundError, match="no price rows"):
        prices.clean_price("UNKNOWN BOND", date(2026, 9, 8))


def test_as_of_before_inception_is_rejected() -> None:
    portfolio, prices, config = _inputs()
    with pytest.raises(DataError, match="before inception"):
        compute_nav_path(portfolio, prices, config, [], date(2026, 9, 7))
