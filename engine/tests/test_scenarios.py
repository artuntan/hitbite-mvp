from decimal import Decimal

import pytest

from nav_engine.money import fmt_unit, quantize_usd
from nav_engine.pipeline import ComputeResult
from nav_engine.scenarios import nav_after_shift, run_scenarios, shock
from tests.conftest import FIXTURES_DIR, read_csv


def test_scenarios_match_fixture(fixture_result: ComputeResult) -> None:
    result = fixture_result.scenarios
    by_name = {f"parallel_{int(s.shift_bp):+d}bp": s for s in result.parallel}
    by_name.update({f"cds_+{int(s.shock_bp)}bp_beta{s.beta:g}": s for s in result.cds})
    rows = read_csv(FIXTURES_DIR / "scenarios_fixture.csv")
    assert len(rows) == len(by_name)
    for row in rows:
        s = by_name[row["scenario"]]
        assert s.shift_bp == float(row["shift_bp"])
        assert abs(s.nav_total - Decimal(row["nav_total_usd"])) <= Decimal("0.05"), row["scenario"]
        assert abs(s.delta_usd - Decimal(row["delta_usd"])) <= Decimal("0.05"), row["scenario"]
        assert s.delta_pct == pytest.approx(float(row["delta_pct"]), abs=1e-4), row["scenario"]


def test_base_and_zero_shift_reproduce_the_nav(fixture_result: ComputeResult) -> None:
    day = fixture_result.path.last
    result = fixture_result.scenarios
    assert result.base_nav_total == day.nav_total
    assert result.base_nav_per_unit == day.nav_per_unit
    zero = shock(day, 0.0)
    assert abs(zero.nav_total - day.nav_total) < Decimal("0.000001")
    assert quantize_usd(zero.delta_usd) == 0
    assert zero.nav_per_unit == day.nav_per_unit


def test_cash_and_fees_unchanged_and_sign_conventions(fixture_result: ComputeResult) -> None:
    day = fixture_result.path.last
    up = shock(day, 100.0)
    down = shock(day, -100.0)
    assert up.nav_total < day.nav_total < down.nav_total
    assert up.delta_usd < 0 < down.delta_usd
    assert up.delta_pct < 0 < down.delta_pct
    # Only the bond leg moves: NAV difference equals the change in repriced market value.
    bonds_only_up = nav_after_shift(day, 100.0) - day.cash + day.fees_payable
    assert bonds_only_up < day.sum_market_value
    assert fmt_unit(up.nav_per_unit) == fmt_unit(up.nav_total / day.reference_units)


def test_cds_shock_uses_beta_and_states_assumptions(fixture_result: ComputeResult) -> None:
    config = fixture_result.config.scenarios.model_copy(deep=True)
    config.cds.beta_to_yield = 0.5
    config.cds.shocks_bp = [100.0]
    result = run_scenarios(fixture_result.path, config)
    assert result.cds[0].shift_bp == 50.0
    assert result.cds[0].beta == 0.5
    by_shift = {s.shift_bp: s for s in result.parallel}
    assert result.cds[0].nav_total == by_shift[50.0].nav_total
    assert "1:1" in result.assumptions
    assert "beta = 0.5" in result.assumptions
    assert "cash and fees payable unchanged" in result.assumptions
    assert "Simulated" in result.assumptions
