"""Fee accrual (FIXTURE.md convention 6).

Management fee and simulated fund expenses accrue every calendar day after inception on the
previous day's ``NAV_total`` (ACT/365F). Nothing accrues on inception day. Fees are a liability
(``fees_payable``) and are never paid out by this engine.
"""

from __future__ import annotations

from decimal import Decimal

from nav_engine.money import ONE_HUNDRED


def daily_fee_rate(
    management_fee_pct_pa: Decimal, fund_expenses_pct_pa: Decimal, basis: int = 365
) -> Decimal:
    """Fraction of NAV accrued per calendar day: ``(mgmt% + expenses%) / 100 / basis``."""
    if basis <= 0:
        raise ValueError("fee day-count basis must be positive")
    return (management_fee_pct_pa + fund_expenses_pct_pa) / ONE_HUNDRED / Decimal(basis)


def daily_fee_accrual(
    nav_total_prev: Decimal,
    management_fee_pct_pa: Decimal,
    fund_expenses_pct_pa: Decimal,
    basis: int = 365,
) -> Decimal:
    """Fee amount added to ``fees_payable`` for one day: ``NAV_total(d-1) x daily rate``."""
    return nav_total_prev * daily_fee_rate(management_fee_pct_pa, fund_expenses_pct_pa, basis)
