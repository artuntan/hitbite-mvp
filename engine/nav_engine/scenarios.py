"""Yield-shift scenarios on the as-of date (FIXTURE.md convention 12).

Every bond is repriced at its own yield plus the shift; cash and fees payable are unchanged.
A CDS spread shock is mapped to a parallel yield shift with ``beta_to_yield`` (1.0: 1:1 pass-through).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from nav_engine.bonds import cash_flows, price_from_yield
from nav_engine.money import ONE_HUNDRED, ZERO, money_context, quantize_unit
from nav_engine.nav import DayValuation, NavPath
from nav_engine.schemas import ScenariosConfig


@dataclass(frozen=True)
class ShockResult:
    shift_bp: float
    nav_total: Decimal
    nav_per_unit: Decimal
    """Quantised HALF_UP to 6 decimals."""
    delta_usd: Decimal
    delta_pct: float


@dataclass(frozen=True)
class CdsShockResult(ShockResult):
    shock_bp: float
    beta: float


@dataclass(frozen=True)
class ScenarioSet:
    as_of: date
    base_nav_total: Decimal
    base_nav_per_unit: Decimal
    parallel: list[ShockResult]
    cds: list[CdsShockResult]
    assumptions: str


def assumptions_text(beta: float) -> str:
    return (
        "Parallel shifts reprice every bond at its own yield to maturity plus the shift on the as-of "
        "date (street convention, semi-annual, 30/360), holding cash and fees payable unchanged. "
        f"CDS shocks pass 1:1 into yields (beta = {beta:g}): a spread shock of s bp is treated as a "
        "parallel +s x beta bp yield shift. Real pass-through varies with tenor and basis; "
        "illustrative only. Simulated data (testnet)."
    )


def nav_after_shift(day: DayValuation, shift_bp: float) -> Decimal:
    """``NAV_total`` after repricing each bond at ``y_i + shift`` with cash and fees unchanged."""
    with money_context():
        total = ZERO
        for valuation in day.positions:
            flows = cash_flows(valuation.bond, day.date)
            y = valuation.ytm + shift_bp / 10_000.0
            dirty = price_from_yield(flows, y, valuation.bond.frequency)
            total += valuation.bond.face_usd * Decimal(repr(dirty)) / ONE_HUNDRED
        return total + day.cash - day.fees_payable


def shock(day: DayValuation, shift_bp: float) -> ShockResult:
    with money_context():
        nav_total = nav_after_shift(day, shift_bp)
        delta = nav_total - day.nav_total
        return ShockResult(
            shift_bp=shift_bp,
            nav_total=nav_total,
            nav_per_unit=quantize_unit(nav_total / day.reference_units),
            delta_usd=delta,
            delta_pct=float(delta / day.nav_total) * 100.0,
        )


def run_scenarios(path: NavPath, config: ScenariosConfig) -> ScenarioSet:
    day = path.last
    parallel = [shock(day, float(s)) for s in config.parallel_shifts_bp]
    beta = config.cds.beta_to_yield
    cds: list[CdsShockResult] = []
    for s in config.cds.shocks_bp:
        base = shock(day, s * beta)
        cds.append(
            CdsShockResult(
                shift_bp=base.shift_bp,
                nav_total=base.nav_total,
                nav_per_unit=base.nav_per_unit,
                delta_usd=base.delta_usd,
                delta_pct=base.delta_pct,
                shock_bp=s,
                beta=beta,
            )
        )
    return ScenarioSet(
        as_of=day.date,
        base_nav_total=day.nav_total,
        base_nav_per_unit=day.nav_per_unit,
        parallel=parallel,
        cds=cds,
        assumptions=assumptions_text(beta),
    )
