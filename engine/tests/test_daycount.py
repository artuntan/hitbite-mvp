from datetime import date, timedelta

import pytest

from nav_engine.daycount import add_months, days_30_360_us, is_last_of_february


@pytest.mark.parametrize(
    ("d1", "d2", "expected"),
    [
        (date(2026, 9, 1), date(2026, 9, 8), 7),  # fixture: 7 accrued days on inception
        (date(2026, 9, 1), date(2026, 9, 15), 14),
        (date(2026, 3, 1), date(2026, 9, 1), 180),  # one semi-annual period
        (date(2026, 3, 1), date(2027, 3, 1), 360),
        (date(2026, 1, 30), date(2026, 3, 31), 60),  # rule 3: D2 == 31 and D1 >= 30 -> D2 = 30
        (date(2026, 1, 31), date(2026, 3, 31), 60),  # rules 3 and 4 together
        (date(2026, 1, 15), date(2026, 3, 31), 76),  # D2 == 31 stays when D1 < 30
        (date(2026, 1, 31), date(2026, 2, 28), 28),  # D2 is last of February, D1 is not: no rule 1
        (date(2026, 9, 8), date(2026, 9, 8), 0),
        (date(2026, 9, 15), date(2026, 9, 1), -14),  # negative when reversed
        (date(2025, 12, 31), date(2026, 1, 31), 30),
    ],
)
def test_days_30_360_us(d1: date, d2: date, expected: int) -> None:
    assert days_30_360_us(d1, d2) == expected


@pytest.mark.parametrize(
    ("d1", "d2", "expected"),
    [
        # Rule 2: D1 is the last day of February -> D1 = 30. 28 Feb -> 1 Mar is one day, not three.
        (date(2026, 2, 28), date(2026, 3, 1), 1),
        (date(2024, 2, 29), date(2024, 3, 1), 1),  # leap year: the 29th is the last day
        (date(2024, 2, 28), date(2024, 3, 1), 3),  # leap year: the 28th is NOT, so no adjustment
        (date(2026, 2, 27), date(2026, 3, 1), 4),  # not the last day: no adjustment
        # Rule 1: both ends are the last day of February -> a whole 360-day year.
        (date(2026, 2, 28), date(2027, 2, 28), 360),
        (date(2024, 2, 29), date(2025, 2, 28), 360),
        (date(2025, 2, 28), date(2026, 2, 28), 360),
        # ... and exactly half a year to the paired end-of-month leg.
        (date(2026, 2, 28), date(2026, 8, 31), 180),
        (date(2024, 2, 29), date(2024, 8, 31), 180),
        # The Aug -> Feb leg of the same schedule is 178: 30/360 US is not symmetric, which is
        # why accrued interest divides by the real period length (bonds.coupon_period_days).
        (date(2026, 8, 31), date(2027, 2, 28), 178),
        (date(2026, 2, 28), date(2026, 8, 30), 180),  # the 30th and the 31st are the same day here
        (date(2026, 2, 28), date(2026, 8, 29), 179),
    ],
)
def test_days_30_360_us_february_end_of_month(d1: date, d2: date, expected: int) -> None:
    assert days_30_360_us(d1, d2) == expected


def test_variant_is_us_nasd_not_european() -> None:
    """30E/360 caps D2 at 30 unconditionally; the US/NASD variant only does so when D1 >= 30."""
    assert days_30_360_us(date(2026, 1, 15), date(2026, 3, 31)) == 76  # 30E/360 would say 75
    assert days_30_360_us(date(2026, 1, 15), date(2026, 3, 30)) == 75


@pytest.mark.parametrize(
    ("d", "expected"),
    [
        (date(2026, 2, 28), True),
        (date(2024, 2, 29), True),
        (date(2024, 2, 28), False),
        (date(2026, 2, 27), False),
        (date(2026, 1, 31), False),
        (date(2026, 8, 31), False),
    ],
)
def test_is_last_of_february(d: date, expected: bool) -> None:
    assert is_last_of_february(d) is expected


def test_semi_annual_periods_are_180_days_each_way() -> None:
    assert days_30_360_us(date(2026, 9, 1), date(2027, 3, 1)) == 180
    assert days_30_360_us(date(2027, 3, 1), date(2027, 9, 1)) == 180


def test_count_is_monotone_and_never_negative_forwards() -> None:
    """Every calendar day of four years, including both February ends and every 31st."""
    start = date(2024, 1, 1)
    previous = 0
    day = start
    while day <= date(2027, 12, 31):
        count = days_30_360_us(start, day)
        assert count >= 0
        assert count >= previous  # never goes backwards as the second date advances
        previous = count
        day += timedelta(days=1)


def test_no_date_pair_counts_backwards() -> None:
    """d1 <= d2 must never produce a negative count, whatever the February/31st adjustments do."""
    for offset in range(0, 800):
        d1 = date(2024, 1, 1) + timedelta(days=offset)
        for span in (1, 2, 3, 28, 29, 30, 31, 59, 180, 181, 365):
            assert days_30_360_us(d1, d1 + timedelta(days=span)) >= 0


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
