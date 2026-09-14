from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from statistics import mean

import pytest

from nav_engine.distributions import load_distributions, merge_distributions
from nav_engine.errors import DataError
from nav_engine.money import ZERO
from nav_engine.nav import DayValuation, NavPath, distribution_yield
from nav_engine.pipeline import ComputeResult
from nav_engine.schemas import DistributionRow
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


# --------------------------------------------------------------------------- distributions.csv
# The loader's duplicate-id guard is the only thing standing between a repeated distribution_id and
# a double-counted distribution: compute_nav_path keys distributions by date, not by id, and
# merge_distributions only runs when a chain reader returned events.


def _write(path: Path, body: str) -> Path:
    path.write_text(body)
    return path


def test_load_distributions_rejects_a_duplicate_id(tmp_path: Path) -> None:
    path = _write(
        tmp_path / "distributions.csv",
        "date,distribution_id,usdc_per_token\n2026-09-11,1,0.008000\n2026-09-12,1,0.008000\n",
    )
    with pytest.raises(DataError, match=r"duplicate distribution_id \[1\]"):
        load_distributions(path)


def test_load_distributions_requires_its_key_columns(tmp_path: Path) -> None:
    path = _write(tmp_path / "distributions.csv", "date,distribution_id\n2026-09-11,1\n")
    with pytest.raises(DataError, match=r"missing columns \['usdc_per_token'\]"):
        load_distributions(path)


def test_load_distributions_skips_blank_rows_and_names_a_bad_value(tmp_path: Path) -> None:
    path = _write(
        tmp_path / "distributions.csv",
        "date,distribution_id,usdc_per_token\n2026-09-12,2,0.002000\n,,\n2026-09-11,1,0.008000\n",
    )
    rows = load_distributions(path)
    assert [(r.date, r.distribution_id, r.usdc_per_token) for r in rows] == [
        (date(2026, 9, 11), 1, Decimal("0.008000")),
        (date(2026, 9, 12), 2, Decimal("0.002000")),
    ]

    bad = _write(
        tmp_path / "bad.csv",
        "date,distribution_id,usdc_per_token\n2026-09-11,1,not-a-number\n",
    )
    with pytest.raises(DataError, match="line 2: usdc_per_token"):
        load_distributions(bad)


def test_load_distributions_reports_a_missing_file_unless_allowed(tmp_path: Path) -> None:
    missing = tmp_path / "absent.csv"
    assert load_distributions(missing, missing_ok=True) == []
    with pytest.raises(DataError, match="distributions file not found"):
        load_distributions(missing)


def test_merge_distributions_overwrites_a_manual_row_with_the_chain_row() -> None:
    """D26: the chain's floored per-token amount is authoritative, so the upsert must overwrite."""
    existing = [
        DistributionRow(
            date=date(2026, 9, 11), distribution_id=1, usdc_per_token=Decimal("0.010000")
        ),
        DistributionRow(
            date=date(2026, 9, 12), distribution_id=2, usdc_per_token=Decimal("0.002000")
        ),
    ]
    incoming = [
        DistributionRow(
            date=date(2026, 9, 11),
            distribution_id=1,
            usdc_per_token=Decimal("0.008000"),
            tx_hash="0xabc",
            source="chain",
        )
    ]
    merged = merge_distributions(existing, incoming)
    assert [r.distribution_id for r in merged] == [1, 2]
    assert merged[0].usdc_per_token == Decimal("0.008000")
    assert merged[0].source == "chain"
    assert merged[0].tx_hash == "0xabc"
    assert merged[1] == existing[1]
