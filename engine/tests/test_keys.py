"""Signing keys: loaded from the environment, actionable errors, and never leaked.

The test keys here are built from repeated bytes (``"0x" + "11" * 32``) so that no 32-byte hex
literal ever appears in the repository; they are dummies, not funded accounts.
"""

from __future__ import annotations

import re
from typing import Any

import pytest

from nav_engine.errors import EngineError
from nav_engine.keys import (
    ENV_ATTESTOR_KEY,
    ENV_ORACLE_KEY,
    SECP256K1_N,
    KeyNotConfiguredError,
    MalformedKeyError,
    SigningKey,
    load_attestor_key,
    load_oracle_key,
    load_signing_key,
)

KEY = "0x" + "11" * 32
KEY_ADDRESS = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A"
SECOND_KEY = "0x" + "22" * 32
SECRET_HEX = KEY[2:]


def test_loads_a_key_and_exposes_only_public_material() -> None:
    key = load_signing_key(ENV_ORACLE_KEY, {ENV_ORACLE_KEY: KEY})
    assert key.address == KEY_ADDRESS
    assert key.env_var == ENV_ORACLE_KEY
    assert key.public_key.startswith("0x04")
    assert len(key.public_key) == 132  # 0x + 04 + 64-byte uncompressed point
    assert re.fullmatch(r"0x04[0-9a-f]{128}", key.public_key)


@pytest.mark.parametrize("raw", [KEY, KEY[2:], f"  {KEY}\n", KEY.upper().replace("0X", "0x")])
def test_accepts_prefixed_unprefixed_and_padded_forms(raw: str) -> None:
    assert load_signing_key(ENV_ORACLE_KEY, {ENV_ORACLE_KEY: raw}).address == KEY_ADDRESS


def test_named_loaders_read_their_own_variables() -> None:
    env = {ENV_ORACLE_KEY: KEY, ENV_ATTESTOR_KEY: SECOND_KEY}
    assert load_oracle_key(env).address == KEY_ADDRESS
    assert load_attestor_key(env).address != KEY_ADDRESS
    assert load_attestor_key(env).env_var == ENV_ATTESTOR_KEY


def test_named_loaders_fall_back_to_the_process_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(ENV_ORACLE_KEY, KEY)
    monkeypatch.setenv(ENV_ATTESTOR_KEY, SECOND_KEY)
    assert load_oracle_key().address == KEY_ADDRESS
    assert (
        load_attestor_key().address
        == load_signing_key(ENV_ATTESTOR_KEY, {ENV_ATTESTOR_KEY: SECOND_KEY}).address
    )


@pytest.mark.parametrize("value", [None, "", "   "])
def test_missing_key_is_an_actionable_error(value: str | None) -> None:
    env = {} if value is None else {ENV_ORACLE_KEY: value}
    with pytest.raises(KeyNotConfiguredError) as excinfo:
        load_signing_key(ENV_ORACLE_KEY, env)
    message = str(excinfo.value)
    assert ENV_ORACLE_KEY in message
    assert "export" in message and ".env.example" in message
    assert isinstance(excinfo.value, EngineError)  # the CLI turns it into exit code 2


@pytest.mark.parametrize(
    "bad",
    [
        "not-a-key",
        "0x" + "11" * 31,  # 31 bytes
        "0x" + "11" * 33,  # 33 bytes
        "0x" + "zz" * 32,  # right length, not hex
        "0x" + "00" * 32,  # zero is not a valid scalar
        hex(SECP256K1_N),  # out of range
    ],
)
def test_malformed_key_is_rejected_without_echoing_the_value(bad: str) -> None:
    with pytest.raises(MalformedKeyError) as excinfo:
        load_signing_key(ENV_ORACLE_KEY, {ENV_ORACLE_KEY: bad})
    message = str(excinfo.value)
    assert ENV_ORACLE_KEY in message
    assert bad.strip() not in message
    assert bad.strip().removeprefix("0x") not in message
    assert "not shown" in message


def test_library_failures_are_never_chained_because_they_echo_the_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``eth_account`` puts the input in its error text; we must not re-raise from it."""
    import eth_account

    def explode(value: Any) -> Any:
        raise ValueError(f"could not import key: {value!r}")

    monkeypatch.setattr(eth_account.Account, "from_key", staticmethod(explode))
    with pytest.raises(MalformedKeyError) as excinfo:
        load_signing_key(ENV_ORACLE_KEY, {ENV_ORACLE_KEY: KEY})
    assert SECRET_HEX not in str(excinfo.value)
    # The fresh error is raised outside the handler, so the leaking one is not reachable at all.
    assert excinfo.value.__cause__ is None
    assert excinfo.value.__context__ is None


def test_the_key_cannot_leak_through_repr_str_or_format() -> None:
    key = load_signing_key(ENV_ORACLE_KEY, {ENV_ORACLE_KEY: KEY})
    renderings = [repr(key), str(key), f"{key}", f"{key!r}", "{}".format(key)]  # noqa: UP032
    for text in renderings:
        assert SECRET_HEX not in text.lower()
        assert KEY_ADDRESS in text
        assert ENV_ORACLE_KEY in text
    assert not hasattr(key, "__dict__")  # __slots__: no accidental attribute dump


def test_the_key_cannot_leak_through_a_raised_error() -> None:
    key = load_signing_key(ENV_ORACLE_KEY, {ENV_ORACLE_KEY: KEY})
    with pytest.raises(Exception) as excinfo:
        key.sign_transaction({"to": "not an address"})
    assert SECRET_HEX not in str(excinfo.value).lower()
    assert SECRET_HEX not in repr(excinfo.value).lower()


def test_sign_text_round_trips_through_eip191_recovery() -> None:
    from eth_account import Account
    from eth_account.messages import encode_defunct

    key = load_signing_key(ENV_ATTESTOR_KEY, {ENV_ATTESTOR_KEY: KEY})
    signature = key.sign_text("hello Türkiye")
    assert signature.startswith("0x") and len(signature) == 132  # 65 bytes
    recovered = Account.recover_message(encode_defunct(text="hello Türkiye"), signature=signature)
    assert recovered == key.address


def test_sign_transaction_returns_broadcastable_bytes() -> None:
    key = load_signing_key(ENV_ORACLE_KEY, {ENV_ORACLE_KEY: KEY})
    raw = key.sign_transaction(
        {
            "to": KEY_ADDRESS,
            "value": 0,
            "gas": 21_000,
            "maxFeePerGas": 10**9,
            "maxPriorityFeePerGas": 10**9,
            "nonce": 0,
            "chainId": 31337,
        }
    )
    assert isinstance(raw, bytes) and raw


def test_signing_key_is_constructible_only_from_a_loaded_account() -> None:
    """``SigningKey`` is a thin wrapper; the loader is the only supported entry point."""
    from eth_account import Account

    key = SigningKey(Account.from_key(KEY), ENV_ORACLE_KEY)
    assert key.address == KEY_ADDRESS
    assert SECRET_HEX not in repr(key).lower()
