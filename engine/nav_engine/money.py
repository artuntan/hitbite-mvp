"""Decimal money helpers (PLAN.md D22).

All money arithmetic happens in ``decimal.Decimal`` with a 40-digit context; rounding (HALF_UP)
happens only when a value is written out. Floats are used for yields and risk measures only.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from decimal import ROUND_HALF_UP, Context, Decimal, localcontext

MONEY_PRECISION = 40
"""Working precision for the NAV path; matches the hand-built fixture (FIXTURE.md convention 11)."""

CENT = Decimal("0.01")
MICRO = Decimal("0.000001")
TEN_DP = Decimal("1E-10")
USDC_UNIT = Decimal(10**6)
TOKEN_UNIT = Decimal(10**18)
ZERO = Decimal(0)
ONE_HUNDRED = Decimal(100)


@contextmanager
def money_context() -> Iterator[Context]:
    """Run a block of money arithmetic at ``MONEY_PRECISION`` digits."""
    with localcontext() as ctx:
        ctx.prec = MONEY_PRECISION
        yield ctx


def to_decimal(value: Decimal | int | float | str) -> Decimal:
    """Convert via ``str`` so binary floats such as 6.65 become the intended decimal."""
    if isinstance(value, Decimal):
        return value
    if isinstance(value, bool):
        raise TypeError("bool is not a money amount")
    return Decimal(str(value))


def quantize(value: Decimal, exponent: Decimal) -> Decimal:
    """HALF_UP quantisation, normalising negative zero to zero."""
    q = value.quantize(exponent, rounding=ROUND_HALF_UP)
    return abs(q) if q == 0 else q


def quantize_usd(value: Decimal) -> Decimal:
    return quantize(value, CENT)


def quantize_unit(value: Decimal) -> Decimal:
    """Per-unit NAV to 6 decimals (USDC units)."""
    return quantize(value, MICRO)


def usdc_6dec(value: Decimal) -> int:
    """Integer USDC (6 decimals) of a per-unit amount, after HALF_UP quantisation."""
    return int(quantize_unit(value) * USDC_UNIT)


def fmt_fixed(value: Decimal, places: int) -> str:
    """Fixed-scale decimal string, HALF_UP, plain notation."""
    return format(quantize(value, Decimal(1).scaleb(-places)), "f")


def fmt_usd(value: Decimal) -> str:
    return fmt_fixed(value, 2)


def fmt_unit(value: Decimal) -> str:
    return fmt_fixed(value, 6)


def fmt_plain(value: Decimal) -> str:
    """Exact decimal in plain (non-scientific) notation."""
    return format(value, "f")
