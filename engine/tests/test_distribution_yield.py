from datetime import date, timedelta
from decimal import Decimal
from statistics import mean

import pytest

from nav_engine.money import ZERO
from nav_engine.nav import DayValuation, NavPath, distribution_yield
from nav_engine.pipeline import ComputeResult
from tests.conftest import FIXTURES_DIR, read_csv


def test_fixture_window_is_too_short_to_annualise(fixture_result: ComputeResult) -> None:
    dy = fixture_result.dist_yield
    rows = read_csv(FIXTURES_DIR / "nav_fixture.csv")
    assert dy.window_days == 8
    assert dy.months_available == 0
    assert dy.trailing_per_unit == Decimal("0.008000")
    expected_avg = sum(Decimal(r["nav_per_unit"]) for r in rows) / len(rows)
    assert dy.average_nav_per_unit == expected_avg
    assert dy.raw_pct == pytest.approx(float(Decimal("0.008") / expected_avg * 100), abs=1e-9)
    assert dy.annualized_pct is None
    assert "withheld" in dy.note
    assert "8 day" in dy.note


def _day(on: date, nav_per_unit: str, dist: str = "0") -> DayValuation:
    npu = Decimal(nav_per_unit)
    return DayValuation(
        date=on,
        positions=[],
        sum_market_value=ZERO,
        cash=ZERO,
        fees_payable=ZERO,
        fee_accrued=ZERO,
        coupon_receipts=ZERO,
        distribution_per_unit=Decimal(dist),
        nav_total=npu,
        reference_units=Decimal(1),
        nav_per_unit=npu,
        nav_usdc_6dec=int(npu * 1_000_000),
        weighted_ytm=0.0,
        weighted_modified_duration=0.0,
        weighted_convexity=0.0,
        distributions_per_unit_cum=ZERO,
    )


def _path(n_days: int, distributions: dict[int, str], navs: list[str] | None = None) -> NavPath:
    start = date(2026, 1, 1)
    days = [
        _day(start + timedelta(days=i), navs[i] if navs else "1.000000", distributions.get(i, "0"))
        for i in range(n_days)
    ]
    return NavPath(
        inception_date=start,
        as_of=days[-1].date,
        reference_units=Decimal(1),
        days=days,
        distributions_applied=[],
        distributions_ignored=[],
    )


def test_annualised_once_window_reaches_30_days() -> None:
    dy = distribution_yield(_path(30, {10: "0.01"}))
    assert dy.window_days == 30
    assert dy.months_available == 1
    assert dy.raw_pct == pytest.approx(1.0)
    assert dy.annualized_pct == pytest.approx(1.0 * 365 / 30)
    assert "annualised" in dy.note
    assert "1 of 12 months" in dy.note

    short = distribution_yield(_path(29, {10: "0.01"}))
    assert short.annualized_pct is None
    assert short.months_available == 0


def test_window_caps_at_365_days_and_drops_older_distributions() -> None:
    dy = distribution_yield(_path(400, {5: "0.5", 100: "0.02", 399: "0.01"}))
    assert dy.window_days == 365
    assert dy.months_available == 12
    assert dy.trailing_per_unit == Decimal("0.03")
    assert dy.annualized_pct == pytest.approx(dy.raw_pct)


def test_average_nav_uses_only_the_window() -> None:
    navs = ["2.000000"] * 5 + ["1.000000"] * 365
    dy = distribution_yield(_path(370, {369: "0.02"}, navs))
    assert dy.average_nav_per_unit == Decimal("1.000000")
    assert dy.raw_pct == pytest.approx(2.0)
    assert dy.average_nav_per_unit != Decimal(str(mean(Decimal(n) for n in navs)))
