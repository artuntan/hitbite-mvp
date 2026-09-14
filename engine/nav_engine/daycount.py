"""Day-count and calendar helpers.

Implements FIXTURE.md convention 1: 30/360 US (Bond Basis) without February end-of-month
adjustments, which is all the illustrative sovereign bonds (coupon dates on the 1st) need.
"""

from __future__ import annotations

import calendar
from datetime import date


def days_30_360_us(d1: date, d2: date) -> int:
    """30/360 US (Bond Basis) day count from ``d1`` to ``d2``.

    ``D1 = min(D1, 30)``; if ``D1 == 30`` and ``D2 == 31`` then ``D2 = 30``;
    ``days = 360 * (Y2 - Y1) + 30 * (M2 - M1) + (D2 - D1)``. Negative when ``d2 < d1``.
    """
    dd1 = min(d1.day, 30)
    dd2 = d2.day
    if dd1 == 30 and dd2 == 31:
        dd2 = 30
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
