"""Decimal money helpers (PLAN.md D22).

All money arithmetic happens in ``decimal.Decimal`` with a 40-digit context; rounding (HALF_UP)
happens only when a value is written out. Floats are used for yields and risk measures only.

Rounding is ``ROUND_HALF_UP`` everywhere, as stated by ``config.yaml`` (``nav.rounding``) and
FIXTURE.md convention 11; ``tests/test_money.py`` pins it with tie cases in both signs so the mode
cannot be changed silently.

``quantize`` sizes its own local context to the value instead of trusting whatever context happens
to be active. Serialisation (``schemas.Tokens18`` -> ``fmt_fixed(v, 18)``) runs outside
``money_context`` inside pydantic, and under the interpreter default of 28 digits a legitimate
uint128 token supply (D28 bounds every on-chain amount by ``type(uint128).max``) would raise an
uncaught ``InvalidOperation`` rather than produce a number.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from decimal import ROUND_HALF_UP, Context, Decimal, localcontext

MONEY_PRECISION = 40
"""Working precision for the NAV path; matches the hand-built fixture (FIXTURE.md convention 11)."""

MAX_UINT128 = 2**128 - 1
"""D28 input bound. ``MAX_UINT128`` wei is 39 digits, which is why ``MONEY_PRECISION`` is 40."""

CENT = Decimal("0.01")
MICRO = Decimal("0.000001")
TEN_DP = Decimal("1E-10")
USDC_UNIT = Decimal(10**6)
TOKEN_UNIT = Decimal(10**18)
ZERO = Decimal(0)
ONE_HUNDRED = Decimal(100)


@contextmanager
def money_context(precision: int = MONEY_PRECISION) -> Iterator[Context]:
    """Run a block of money arithmetic at ``precision`` digits (``MONEY_PRECISION`` by default)."""
    with localcontext() as ctx:
        ctx.prec = max(precision, MONEY_PRECISION)
        yield ctx


def to_decimal(value: Decimal | int | float | str) -> Decimal:
    """Convert via ``str`` so binary floats such as 6.65 become the intended decimal."""
    if isinstance(value, Decimal):
        return value
    if isinstance(value, bool):
        raise TypeError("bool is not a money amount")
    return Decimal(str(value))


def from_units(value: int, decimals: int) -> Decimal:
    """Exact fixed-point value of an integer in ``decimals``-scaled units (wei, 6-dec USDC, ...).

    Built from a string so the result never depends on the active context: ``Decimal(w) / 10**18``
    silently rounds a 39-digit uint128 (the D28 bound) to the ambient 28 digits, losing the low wei.
    Trailing fractional zeros are dropped, which makes the result identical to the exact division it
    replaces for every value that division could represent.
    """
    if decimals < 0:
        raise ValueError("decimals must not be negative")
    if value == 0:
        return ZERO
    sign, digits, _ = Decimal(value).as_tuple()
    keep = len(digits)
    exponent = -decimals
    while keep > 1 and exponent < 0 and digits[keep - 1] == 0:
        keep -= 1
        exponent += 1
    return Decimal((sign, digits[:keep], exponent))


def _scale_of(exponent: Decimal) -> int:
    """Decimal places implied by a quantiser such as ``CENT`` (2) or ``TEN_DP`` (10)."""
    exp = exponent.as_tuple().exponent
    return -exp if isinstance(exp, int) else 0


def _quantize_precision(value: Decimal, exponent: Decimal) -> int:
    """Context precision that lets ``value.quantize(exponent)`` always produce a result.

    ``Decimal.quantize`` raises ``InvalidOperation`` when the result needs more digits than the
    context allows, so the context has to cover the value's integer digits plus the target scale
    (plus one, because rounding 9.999 to 2 dp carries into a new digit).
    """
    if not value.is_finite():
        return MONEY_PRECISION
    integer_digits = value.adjusted() + 1 if value else 1
    return max(MONEY_PRECISION, integer_digits + _scale_of(exponent) + 1)


def quantize(value: Decimal, exponent: Decimal) -> Decimal:
    """HALF_UP quantisation, normalising negative zero to zero.

    Runs in a local context sized to ``value`` so the caller's ambient precision cannot turn a
    large-but-legal amount into ``InvalidOperation``.
    """
    with localcontext() as ctx:
        ctx.prec = _quantize_precision(value, exponent)
        q = value.quantize(exponent, rounding=ROUND_HALF_UP)
    return abs(q) if q == 0 else q


def quantize_usd(value: Decimal) -> Decimal:
    return quantize(value, CENT)


def quantize_unit(value: Decimal) -> Decimal:
    """Per-unit NAV to 6 decimals (USDC units)."""
    return quantize(value, MICRO)


def usdc_6dec(value: Decimal) -> int:
    """Integer USDC (6 decimals) of a per-unit amount, after HALF_UP quantisation."""
    q = quantize_unit(value)
    with money_context(len(q.as_tuple().digits) + 7):
        return int(q * USDC_UNIT)


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
