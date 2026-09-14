"""Tie-out of the day-by-day NAV path to the hand-built fixture (FIXTURE.md tolerances)."""

import json
import shutil
from datetime import date, timedelta
from decimal import Decimal
from itertools import pairwise
from pathlib import Path

import pytest

from nav_engine.errors import DataError, PriceNotFoundError
from nav_engine.money import fmt_fixed, fmt_unit, fmt_usd, money_context, usdc_6dec
from nav_engine.nav import compute_nav_path
from nav_engine.pipeline import ComputeOptions, ComputeResult, load_config, run_compute
from nav_engine.portfolio import PriceTable, load_portfolio, load_prices
from nav_engine.schemas import DistributionRow, Portfolio, Position, PriceRow
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


# --------------------------------------------------------------------------- maturity
# BUILD_PROMPT 6.2 and FIXTURE.md are both silent on what happens when a bond in the book reaches
# its maturity date. The rule pinned here: the book is held to maturity, the face and the final
# coupon are paid into cash on the maturity date, and from that date the line carries no market
# value and no yield, duration or convexity. Before this the daily loop asked bonds.cash_flows for
# an already-empty schedule and raised BondMaturedError on the maturity date and every day after,
# so the engine could never publish a NAV again.

SHORT_MATURITY = date(2026, 9, 12)


def _short_book(maturity: date = SHORT_MATURITY) -> tuple:
    """One 6.00% 400k line maturing inside the window, priced flat at par."""
    portfolio = Portfolio(
        as_of=FIXTURE_INCEPTION,
        inception_date=FIXTURE_INCEPTION,
        source_note="synthetic short-dated book for the maturity rule",
        cash_usd=Decimal("12500"),
        positions=[
            Position(
                name="SHORT",
                coupon_pct=Decimal("6.00"),
                maturity=maturity,
                face_usd=Decimal("400000"),
                clean_price=Decimal("100"),
            )
        ],
    )
    prices = PriceTable([PriceRow(date=FIXTURE_INCEPTION, name="SHORT", clean_price=Decimal(100))])
    return portfolio, prices, load_config(DATA_DIR / "config.yaml")


def test_maturity_pays_face_plus_final_coupon_into_cash() -> None:
    portfolio, prices, config = _short_book()
    path = compute_nav_path(portfolio, prices, config, [], SHORT_MATURITY + timedelta(days=1))

    before = path.on(SHORT_MATURITY - timedelta(days=1))
    on = path.on(SHORT_MATURITY)
    after = path.on(SHORT_MATURITY + timedelta(days=1))

    # The day before maturity the line is still a bond: 179/180 of a 12,000 coupon accrued at par.
    assert before.positions[0].matured is False
    assert fmt_usd(before.sum_market_value) == "411933.33"
    with money_context():
        expected_mv = Decimal("400000") + Decimal("12000") * 179 / 180
        assert abs(before.sum_market_value - expected_mv) < Decimal("1e-30")
    assert before.redemptions == 0

    # On the maturity date face + final coupon become cash and the line is worth nothing.
    assert on.coupon_receipts == Decimal("12000")
    assert on.redemptions == Decimal("400000")
    assert on.cash == before.cash + Decimal("412000")
    assert on.sum_market_value == 0
    assert on.positions == []  # nothing is held any more; it is all cash
    assert [v.position.name for v in on.matured_positions] == ["SHORT"]
    assert on.matured_positions[0].matured is True
    assert on.matured_positions[0].market_value == 0
    assert on.matured_positions[0].accrued == 0
    assert (on.weighted_ytm, on.weighted_modified_duration, on.weighted_convexity) == (
        0.0,
        0.0,
        0.0,
    )

    # NAV moves only by the last day of accrual (12,000/180) less that day's fee - nothing is lost.
    with money_context():
        continuous = (
            before.nav_total
            + Decimal("412000")
            - before.sum_market_value
            - (on.fees_payable - before.fees_payable)
        )
        assert abs(on.nav_total - continuous) < Decimal("1e-25")
        # ... and the path keeps going past maturity instead of raising BondMaturedError.
        assert after.redemptions == 0
        assert after.coupon_receipts == 0
        assert after.cash == on.cash
        carried = on.nav_total - (after.fees_payable - on.fees_payable)
        assert abs(after.nav_total - carried) < Decimal("1e-25")


def test_a_fully_matured_book_still_produces_a_nav() -> None:
    portfolio, prices, config = _short_book()
    path = compute_nav_path(portfolio, prices, config, [], SHORT_MATURITY + timedelta(days=30))
    last = path.last
    assert last.sum_market_value == 0
    assert last.positions == []
    assert [v.position.name for v in last.matured_positions] == ["SHORT"]
    assert last.cash == Decimal("424500")
    with money_context():
        assert abs(last.nav_total - (Decimal("424500") - last.fees_payable)) < Decimal("1e-25")
        assert last.nav_usdc_6dec == usdc_6dec(last.nav_total / path.reference_units)
    assert last.nav_usdc_6dec > 0


def test_shipped_book_survives_its_first_maturity() -> None:
    """The 2029-03-01 line in data/portfolio.json used to stop the engine for good on that date."""
    portfolio, _, config = _inputs()
    start = date(2029, 2, 20)
    portfolio = portfolio.model_copy(update={"inception_date": start, "as_of": start})
    prices = PriceTable(
        [PriceRow(date=start, name=p.name, clean_price=Decimal(100)) for p in portfolio.positions]
    )
    maturity = date(2029, 3, 1)
    path = compute_nav_path(portfolio, prices, config, [], maturity + timedelta(days=1))

    before = path.on(maturity - timedelta(days=1))
    on = path.on(maturity)
    assert [v.position.name for v in on.matured_positions] == [
        "TURKEY USD 6.00% 2029 (illustrative)"
    ]
    assert len(before.positions) == 3
    assert len(on.positions) == 2
    # 400,000 face redeemed plus the three coupons paid on 1 March (12,000 + 13,300 + 7,040).
    assert on.redemptions == Decimal("400000")
    assert on.coupon_receipts == Decimal("32340")
    assert on.cash == before.cash + Decimal("432340")
    assert on.sum_market_value == Decimal("600000")  # the two survivors, at par with zero accrued
    assert on.nav_usdc_6dec > 0
    assert path.last.nav_usdc_6dec > 0


def test_position_matured_on_or_before_inception_is_rejected() -> None:
    portfolio, prices, config = _short_book(maturity=FIXTURE_INCEPTION)
    with pytest.raises(DataError, match="matures 2026-09-08, on or before the inception date"):
        compute_nav_path(portfolio, prices, config, [], FIXTURE_INCEPTION + timedelta(days=1))


# --------------------------------------------------------------------------- price duplicates


def test_duplicate_price_rows_are_rejected() -> None:
    """Last-write-wins made the NAV depend on the order of a hand-maintained CSV."""
    name = "TURKEY USD 6.00% 2029 (illustrative)"
    rows = [
        PriceRow(date=date(2026, 9, 14), name=name, clean_price=Decimal("100.10")),
        PriceRow(date=date(2026, 9, 14), name=name, clean_price=Decimal("50.00")),
    ]
    with pytest.raises(DataError, match="duplicate price row"):
        PriceTable(rows)
    # A different date for the same bond, or the same date for a different bond, is fine.
    PriceTable(
        [
            rows[0],
            PriceRow(date=date(2026, 9, 15), name=name, clean_price=Decimal("50.00")),
            PriceRow(date=date(2026, 9, 14), name="OTHER", clean_price=Decimal("50.00")),
        ]
    )


def test_duplicate_price_rows_in_the_csv_name_both_lines(tmp_path: Path) -> None:
    name = "TURKEY USD 6.00% 2029 (illustrative)"
    path = tmp_path / "prices.csv"
    path.write_text(
        "date,name,clean_price,ytm_pct,source\n"
        f"2026-09-14,{name},100.10,,illustrative\n"
        f"2026-09-15,{name},100.08,,illustrative\n"
        f"2026-09-14,{name},50.00,,typo\n"
    )
    with pytest.raises(DataError) as excinfo:
        load_prices(path)
    message = str(excinfo.value)
    assert "line 4" in message and "line 2" in message
    assert name in message and "2026-09-14" in message


# --------------------------------------------------------------------------- distributions


def test_distribution_larger_than_the_nav_it_is_deducted_from_is_rejected() -> None:
    """HBToken.distributeCoupon reverts with DistributionExceedsNav; the engine must not publish it."""
    portfolio, prices, config = _inputs()
    oversized = [
        DistributionRow(date=date(2026, 9, 11), distribution_id=1, usdc_per_token=Decimal("2.0"))
    ]
    with pytest.raises(DataError, match="DistributionExceedsNav"):
        compute_nav_path(portfolio, prices, config, oversized, FIXTURE_AS_OF)

    # The contract's test is `perToken >= nav`, so a distribution of exactly the unit NAV is out too.
    undistributed = compute_nav_path(portfolio, prices, config, [], date(2026, 9, 11))
    exactly_nav = undistributed.last.nav_total / undistributed.reference_units
    rows = [DistributionRow(date=date(2026, 9, 11), distribution_id=1, usdc_per_token=exactly_nav)]
    with pytest.raises(DataError, match="not below the unit NAV"):
        compute_nav_path(portfolio, prices, config, rows, date(2026, 9, 11))


def test_two_distributions_on_one_day_are_summed() -> None:
    portfolio, prices, config = _inputs()
    rows = [
        DistributionRow(date=date(2026, 9, 11), distribution_id=1, usdc_per_token=Decimal("0.008")),
        DistributionRow(date=date(2026, 9, 11), distribution_id=2, usdc_per_token=Decimal("0.002")),
    ]
    path = compute_nav_path(portfolio, prices, config, rows, date(2026, 9, 11))
    day = path.last
    assert [r.distribution_id for r in path.distributions_applied] == [1, 2]
    assert day.distribution_per_unit == Decimal("0.010")
    assert day.distributions_per_unit_cum == Decimal("0.010")
    # Reference cash falls by the sum: 12,500.00 - 0.010 x 1,013,757.6666666667.
    with money_context():
        assert day.cash == Decimal("12500") - Decimal("0.010") * path.reference_units
    assert fmt_usd(day.cash) == "2362.42"
    # The fixture day pays 0.008 and prints 991676; another 0.002 per unit is exactly 2,000 less.
    assert day.nav_usdc_6dec == 991676 - 2000


def test_distributions_accumulate_across_days() -> None:
    portfolio, prices, config = _inputs()
    rows = [
        DistributionRow(date=date(2026, 9, 11), distribution_id=1, usdc_per_token=Decimal("0.008")),
        DistributionRow(date=date(2026, 9, 14), distribution_id=2, usdc_per_token=Decimal("0.002")),
    ]
    path = compute_nav_path(portfolio, prices, config, rows, FIXTURE_AS_OF)
    cum = {d.date: d.distributions_per_unit_cum for d in path.days}
    assert cum[date(2026, 9, 10)] == Decimal("0.000")
    assert cum[date(2026, 9, 11)] == Decimal("0.008")
    assert cum[date(2026, 9, 13)] == Decimal("0.008")
    assert cum[date(2026, 9, 14)] == Decimal("0.010")
    assert cum[FIXTURE_AS_OF] == Decimal("0.010")
    assert path.on(date(2026, 9, 14)).distribution_per_unit == Decimal("0.002")
    # 994658 in the fixture, less 0.002 per unit and one day of fees on the 2,027.52 taken out.
    assert path.last.nav_usdc_6dec == 992658


def test_inception_on_a_coupon_date_receives_no_coupon() -> None:
    """Inception NAV_total is frozen as reference_units, so a phantom day-0 receipt is permanent."""
    portfolio, _, config = _inputs()
    coupon_day = date(2026, 9, 1)
    portfolio = portfolio.model_copy(update={"inception_date": coupon_day, "as_of": coupon_day})
    prices = PriceTable(
        [
            PriceRow(date=coupon_day, name=p.name, clean_price=Decimal(100))
            for p in portfolio.positions
        ]
    )
    path = compute_nav_path(portfolio, prices, config, [], FIXTURE_INCEPTION)
    assert all(v.days_accrued == 0 for v in path.days[0].positions)  # it really is a coupon date
    assert path.days[0].coupon_receipts == 0
    # 1,000,000 of face at par plus 12,500 cash - not 1,044,840 with the three coupons double-paid.
    assert path.reference_units == Decimal("1012500")
    assert path.days[0].nav_usdc_6dec == 1_000_000
    assert path.last.nav_usdc_6dec == 1_001_041


def test_the_whole_pipeline_survives_a_maturity_date(tmp_path: Path) -> None:
    """compute -> scenarios -> documents on the day a line redeems, end to end.

    ``scenarios.nav_after_shift`` reprices every position in ``DayValuation.positions``, so a
    redeemed line left in that list would stop the run there instead of in the day loop.
    """
    data_dir = tmp_path / "data"
    shutil.copytree(DATA_DIR, data_dir)
    book = json.loads((data_dir / "portfolio.json").read_text())
    book["inception_date"] = book["as_of"] = "2029-02-20"
    (data_dir / "portfolio.json").write_text(json.dumps(book))
    (data_dir / "prices.csv").write_text(
        "date,name,clean_price,ytm_pct,source\n"
        + "".join(f"2029-02-20,{p['name']},100.00,,illustrative\n" for p in book["positions"])
    )
    out_dir = tmp_path / "out"
    result = run_compute(
        ComputeOptions(
            as_of=date(2029, 3, 1),
            data_dir=data_dir,
            out_dir=out_dir,
            reader=None,
            cache_path=tmp_path / "chain_cache.json",
        )
    )
    assert result.path.last.redemptions == Decimal("400000")

    holdings = json.loads((out_dir / "holdings.json").read_text())
    names = [p["name"] for p in holdings["positions"]]
    assert names == [
        "TURKEY USD 6.65% 2034 (illustrative)",
        "TURKEY USD 7.04% 2036 (illustrative)",
    ]
    nav = json.loads((out_dir / "nav.json").read_text())
    assert nav["as_of"] == "2029-03-01"
    assert nav["nav"]["usdc_6dec"] > 0
    assert json.loads((out_dir / "scenarios.json").read_text())["parallel"]
