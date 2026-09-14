from datetime import date

import pytest

from nav_engine.daycount import add_months, days_30_360_us


@pytest.mark.parametrize(
    ("d1", "d2", "expected"),
    [
        (date(2026, 9, 1), date(2026, 9, 8), 7),  # fixture: 7 accrued days on inception
        (date(2026, 9, 1), date(2026, 9, 15), 14),
        (date(2026, 3, 1), date(2026, 9, 1), 180),  # one semi-annual period
        (date(2026, 3, 1), date(2027, 3, 1), 360),
        (date(2026, 1, 30), date(2026, 3, 31), 60),  # D1 == 30 and D2 == 31 -> D2 = 30
        (date(2026, 1, 31), date(2026, 3, 31), 60),  # D1 = min(31, 30) then the 31 rule
        (date(2026, 1, 15), date(2026, 3, 31), 76),  # D2 == 31 stays when D1 < 30
        (date(2026, 1, 31), date(2026, 2, 28), 28),  # no February end-of-month adjustment
        (date(2026, 2, 28), date(2026, 3, 1), 3),
        (date(2026, 9, 8), date(2026, 9, 8), 0),
        (date(2026, 9, 15), date(2026, 9, 1), -14),  # negative when reversed
        (date(2025, 12, 31), date(2026, 1, 31), 30),
    ],
)
def test_days_30_360_us(d1: date, d2: date, expected: int) -> None:
    assert days_30_360_us(d1, d2) == expected


def test_semi_annual_periods_are_180_days_each_way() -> None:
    assert days_30_360_us(date(2026, 9, 1), date(2027, 3, 1)) == 180
    assert days_30_360_us(date(2027, 3, 1), date(2027, 9, 1)) == 180


@pytest.mark.parametrize(
    ("start", "months", "expected"),
    [
        (date(2029, 3, 1), -6, date(2028, 9, 1)),
        (date(2029, 3, 1), -30, date(2026, 9, 1)),
        (date(2026, 9, 1), 6, date(2027, 3, 1)),
        (date(2026, 1, 31), 1, date(2026, 2, 28)),  # clamped to month length
        (date(2026, 3, 31), -6, date(2025, 9, 30)),
        (date(2026, 12, 15), 1, date(2027, 1, 15)),
        (date(2026, 1, 15), -1, date(2025, 12, 15)),
        (date(2026, 5, 5), 0, date(2026, 5, 5)),
    ],
)
def test_add_months(start: date, months: int, expected: date) -> None:
    assert add_months(start, months) == expected
