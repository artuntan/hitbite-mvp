"""Pins the two properties of the money layer that nothing else tests.

1. The rounding mode. ``config.yaml`` says ``nav.rounding: ROUND_HALF_UP``, D22 and FIXTURE.md
   convention 11 repeat it, yet the fixture's eight days contain no half-way case, so every other
   suite stays green if the mode is flipped to HALF_EVEN. The ties below are chosen so the two
   modes disagree, in both signs and at both scales.
2. The precision. Quantisation must not depend on the caller's ambient decimal context: pydantic
   serialises ``Tokens18`` outside ``money_context()``, so anything up to the D28 input bound
   (``type(uint128).max`` wei) has to format rather than raise ``InvalidOperation``.
"""

from __future__ import annotations

from decimal import ROUND_HALF_EVEN, ROUND_HALF_UP, Decimal, getcontext, localcontext

import pytest

from nav_engine.money import (
    CENT,
    MAX_UINT128,
    MICRO,
    MONEY_PRECISION,
    TEN_DP,
    fmt_fixed,
    fmt_plain,
    fmt_unit,
    fmt_usd,
    from_units,
    money_context,
    quantize,
    quantize_unit,
    quantize_usd,
    to_decimal,
    usdc_6dec,
)
from nav_engine.pipeline import load_config
from tests.conftest import DATA_DIR

# Ties whose two roundings differ: HALF_UP always goes away from zero, HALF_EVEN to the even digit.
CENT_TIES = [
    ("0.005", "0.01", "0.00"),
    ("0.025", "0.03", "0.02"),
    ("2.345", "2.35", "2.34"),
    ("-0.005", "-0.01", "0.00"),  # HALF_EVEN yields -0.00, which quantize normalises to 0.00
    ("-2.345", "-2.35", "-2.34"),
    ("1000000.005", "1000000.01", "1000000.00"),
]

MICRO_TIES = [
    ("1.0000005", "1.000001", "1.000000"),
    ("0.9999985", "0.999999", "0.999998"),
    ("-1.0000005", "-1.000001", "-1.000000"),
    ("0.0000005", "0.000001", "0.000000"),
    ("-0.0000005", "-0.000001", "0.000000"),
]


def test_config_states_half_up() -> None:
    """The mode this file pins is the mode the shipped config declares."""
    assert load_config(DATA_DIR / "config.yaml").nav.rounding == "ROUND_HALF_UP"


@pytest.mark.parametrize(("raw", "half_up", "half_even"), CENT_TIES)
def test_cent_ties_round_half_up(raw: str, half_up: str, half_even: str) -> None:
    value = Decimal(raw)
    assert half_up != half_even, "the case must distinguish the two modes"
    assert quantize_usd(value) == Decimal(half_up)
    assert fmt_usd(value) == half_up
    assert quantize_usd(value) != Decimal(half_even)


@pytest.mark.parametrize(("raw", "half_up", "half_even"), MICRO_TIES)
def test_micro_ties_round_half_up(raw: str, half_up: str, half_even: str) -> None:
    value = Decimal(raw)
    assert half_up != half_even, "the case must distinguish the two modes"
    assert quantize_unit(value) == Decimal(half_up)
    assert fmt_unit(value) == half_up
    assert usdc_6dec(value) == int(Decimal(half_up).scaleb(6))
    assert usdc_6dec(value) != int(Decimal(half_even).scaleb(6))


@pytest.mark.parametrize(("raw", "_half_up", "_half_even"), CENT_TIES + MICRO_TIES)
def test_quantize_agrees_with_half_up_and_not_half_even(
    raw: str, _half_up: str, _half_even: str
) -> None:
    """Direct comparison against the two stdlib modes, at every scale the engine quantises to."""
    value = Decimal(raw)
    for exponent in (CENT, MICRO, TEN_DP):
        reference = value.quantize(exponent, rounding=ROUND_HALF_UP)
        assert quantize(value, exponent) == reference
    # At the scale where the value is a tie, HALF_EVEN must give a different answer.
    tie_exponent = CENT if len(raw.split(".")[1]) == 3 else MICRO
    assert quantize(value, tie_exponent) != value.quantize(tie_exponent, rounding=ROUND_HALF_EVEN)


def test_usdc_6dec_agrees_with_the_display_string_on_ties() -> None:
    """D22: the integer pushed on chain and the string shown to investors are the same number."""
    adversarial = [
        "1.0000005",
        "-1.0000005",
        "0.0000005",
        "0.9999995",
        "1.00000049999",
        "1.00000050001",
        "12345.6789015",
        "-12345.6789015",
        "0",
        "-0.0000001",
    ]
    for raw in adversarial:
        value = Decimal(raw)
        assert usdc_6dec(value) == int(Decimal(fmt_unit(value)).scaleb(6)), raw


def test_negative_zero_is_normalised() -> None:
    assert quantize_usd(Decimal("-0.001")) == Decimal("0.00")
    assert fmt_usd(Decimal("-0.001")) == "0.00"
    assert fmt_unit(Decimal("-0.0000001")) == "0.000000"
    assert usdc_6dec(Decimal("-0.0000001")) == 0


# --------------------------------------------------------------------------- precision / D28
def test_fmt_fixed_handles_the_uint128_bound_under_the_default_context() -> None:
    """The serialisation path runs at the interpreter default (28 digits), not in money_context."""
    assert getcontext().prec == 28, "this test is meaningless if the ambient context is wide"
    tokens = from_units(MAX_UINT128, 18)
    assert fmt_fixed(tokens, 18) == "340282366920938463463.374607431768211455"
    assert fmt_usd(tokens) == "340282366920938463463.37"
    assert fmt_unit(tokens) == "340282366920938463463.374607"
    assert usdc_6dec(tokens) == 340282366920938463463374607


def test_quantize_is_independent_of_the_ambient_context() -> None:
    value = Decimal("12345678901.1234565")
    with localcontext() as ctx:
        ctx.prec = 5
        assert fmt_unit(value) == "12345678901.123457"
        assert quantize_usd(value) == Decimal("12345678901.12")
    with money_context():
        assert fmt_unit(value) == "12345678901.123457"
    assert MONEY_PRECISION == 40


def test_quantize_carry_does_not_overflow_the_context() -> None:
    """Rounding 9.99... up adds an integer digit; the sized context must leave room for it."""
    assert fmt_usd(Decimal("9.999")) == "10.00"
    assert fmt_unit(Decimal("9.9999999")) == "10.000000"
    nines = Decimal("9" * 30 + ".9999999")
    assert fmt_unit(nines) == "1" + "0" * 30 + ".000000"


def test_from_units_is_exact_at_the_uint128_bound() -> None:
    """``Decimal(wei) / 10**18`` silently drops the low wei of a 39-digit supply."""
    tokens = from_units(MAX_UINT128, 18)
    assert fmt_plain(tokens) == "340282366920938463463.374607431768211455"
    with money_context():
        assert int(tokens.scaleb(18)) == MAX_UINT128
    assert tokens != Decimal(MAX_UINT128) / Decimal(10**18)  # the lossy form, at prec 28


@pytest.mark.parametrize(
    ("units", "decimals", "expected"),
    [
        (0, 18, "0"),
        (0, 6, "0"),
        (1, 18, "0.000000000000000001"),
        (8_000_000, 18, "0.000000000008"),
        (10**24, 18, "1000000"),
        (7 * 10**17, 18, "0.7"),
        (-5 * 10**18, 18, "-5"),
        (333_333, 6, "0.333333"),
        (8_000_000_000, 6, "8000"),
        (12345, 0, "12345"),
    ],
)
def test_from_units_matches_exact_division(units: int, decimals: int, expected: str) -> None:
    value = from_units(units, decimals)
    assert fmt_plain(value) == expected
    assert value == Decimal(units) / Decimal(10**decimals)


def test_from_units_rejects_negative_decimals() -> None:
    with pytest.raises(ValueError, match="decimals"):
        from_units(1, -1)


def test_to_decimal_goes_through_str() -> None:
    assert to_decimal(6.65) == Decimal("6.65")
    assert to_decimal("6.65") == Decimal("6.65")
    assert to_decimal(Decimal("6.65")) == Decimal("6.65")
    with pytest.raises(TypeError):
        to_decimal(True)
