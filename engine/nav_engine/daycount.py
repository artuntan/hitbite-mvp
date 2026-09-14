"""Day-count and calendar helpers.

**Variant decision.** The engine implements **30/360 US (NASD / SIA "Bond Basis")** *in full*,
including the February end-of-month rules, and nothing else. The four rules, applied in order
(same order and semantics as QuantLib's ``Thirty360::USA``):

1. if ``d1`` is the last day of February **and** ``d2`` is the last day of February, ``D2 = 30``;
2. if ``d1`` is the last day of February, ``D1 = 30``;
3. if ``D2 == 31`` and ``D1 >= 30``, ``D2 = 30``;
4. if ``D1 == 31``, ``D1 = 30``.

Rules 1-2 are what keeps an end-of-month coupon schedule (a 31 August maturity steps back to
28 February) from measuring a 183-day "semi-annual" period, which used to let accrued interest
exceed a whole coupon. The European variant (30E/360, both days capped at 30, no February rule)
is deliberately *not* implemented: the bonds are USD sovereigns quoted on bond basis, and
``days_30_360_us`` is the only day count in the engine.

This is a deliberate deviation from ``tests/fixtures/FIXTURE.md`` convention 1, which said "no
February end-of-month adjustments (all coupon dates are the 1st)". Nothing validates that
precondition, so the rule is implemented rather than assumed. Every coupon date in the shipped
book is the 1st of a month, so no published number moves.
"""

from __future__ import annotations

import calendar
from datetime import date


def is_last_of_february(d: date) -> bool:
    """True when ``d`` is 28 February (29 in a leap year)."""
    return d.month == 2 and d.day == calendar.monthrange(d.year, 2)[1]


def days_30_360_us(d1: date, d2: date) -> int:
    """30/360 US (NASD / SIA Bond Basis) day count from ``d1`` to ``d2``, February rules included.

    ``days = 360 * (Y2 - Y1) + 30 * (M2 - M1) + (D2 - D1)`` after the four adjustments listed in
    the module docstring. Negative when ``d2 < d1``; never negative when ``d1 <= d2``.
    """
    dd1, dd2 = d1.day, d2.day
    if is_last_of_february(d1):
        if is_last_of_february(d2):
            dd2 = 30
        dd1 = 30
    if dd2 == 31 and dd1 >= 30:
        dd2 = 30
    if dd1 == 31:
        dd1 = 30
    return 360 * (d2.year - d1.year) + 30 * (d2.month - d1.month) + (dd2 - dd1)


def add_months(d: date, months: int) -> date:
    """Shift ``d`` by ``months`` (may be negative), clamping the day to the target month's length.

    Coupon schedules call this with multiples of the period from the maturity date, so the
    clamp never drifts (31 Mar - 6 months = 30 Sep, 31 Mar - 12 months = 31 Mar).
    """
    total = d.year * 12 + (d.month - 1) + months
    year, month0 = divmod(total, 12)
    month = month0 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)
