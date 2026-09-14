"""secp256k1 signing keys, loaded from environment variables only.

Two keys exist in this engine, both testnet-only:

- ``ORACLE_PRIVATE_KEY`` signs the ``setNAV`` transaction (:mod:`nav_engine.push_nav`);
- ``ATTESTOR_PRIVATE_KEY`` signs the attestation document (:mod:`nav_engine.attest`); it belongs to
  a *simulated* attestor - an independent firm signs in production.

Rules this module enforces:

1. A key is read from ``os.environ`` (or an explicitly passed mapping) and from nowhere else. No
   file is opened, no keystore is supported, no default or fallback key exists.
2. The private material never leaves :class:`SigningKey`: it is not an attribute of the instance,
   it is absent from ``repr`` / ``str``, and no exception raised here interpolates the value. The
   underlying library echoes its input in error text, so a failure there is swallowed and a fresh
   error is raised *outside* the handler: the leaking exception is not even reachable as
   ``__context__``.
3. A missing or malformed key produces an actionable message naming the variable and the exact
   expected shape.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from typing import Any, Final

from nav_engine.errors import EngineError

ENV_ORACLE_KEY: Final = "ORACLE_PRIVATE_KEY"
"""Environment variable holding the ORACLE_ROLE key used by ``nav-engine push``."""

ENV_ATTESTOR_KEY: Final = "ATTESTOR_PRIVATE_KEY"
"""Environment variable holding the simulated attestor key used by ``nav-engine attest``."""

SECP256K1_N: Final = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141  # allow-secret: public curve order
"""Order of the secp256k1 curve; a valid private key is in ``1 .. n-1``."""

_HEX_32_BYTES: Final = re.compile(r"(?:0x)?[0-9a-fA-F]{64}")

_REDACTED: Final = "The value is not shown here and is never logged."


class SigningKeyError(EngineError):
    """A signing key could not be loaded. The offending value is never part of the message."""


class KeyNotConfiguredError(SigningKeyError):
    """The environment variable is missing or empty."""


class MalformedKeyError(SigningKeyError):
    """The environment variable is set but is not a usable secp256k1 private key."""


class SigningKey:
    """A loaded secp256k1 key: address and public key are public, the secret is not reachable.

    The key material lives inside the ``eth_account`` account object held in a private slot. The
    class defines ``__repr__``/``__str__`` so that neither debugging output nor an f-string in a log
    line can print it, and exposes only the operations the engine needs: EIP-191 ``personal_sign``
    over text, and transaction signing.
    """

    __slots__ = ("_account", "address", "env_var", "public_key")

    def __init__(self, account: Any, env_var: str) -> None:
        self._account = account
        self.env_var = env_var
        self.address: str = str(account.address)
        # eth_account exposes the uncompressed point as 64 bytes (X || Y); republish it in SEC1
        # uncompressed form (0x04 || X || Y), which is what verification tooling expects.
        self.public_key: str = "0x04" + str(account._key_obj.public_key.to_hex())[2:]

    def __repr__(self) -> str:
        return f"SigningKey(address={self.address}, source=${self.env_var})"

    __str__ = __repr__

    def sign_text(self, text: str) -> str:
        """EIP-191 ``personal_sign`` over the UTF-8 bytes of ``text``; returns ``0x``-hex (65 bytes).

        This is byte-for-byte what ``viem``'s ``signMessage({ message })`` produces, so
        ``verifyMessage({ address, message, signature })`` in the browser verifies it.
        """
        from eth_account.messages import encode_defunct

        signed = self._account.sign_message(encode_defunct(text=text))
        return "0x" + bytes(signed.signature).hex()

    def sign_transaction(self, transaction: Mapping[str, Any]) -> bytes:
        """Sign a fully-populated transaction dict; returns the raw RLP bytes to broadcast."""
        signed = self._account.sign_transaction(dict(transaction))
        return bytes(signed.raw_transaction)


def load_signing_key(env_var: str, env: Mapping[str, str] | None = None) -> SigningKey:
    """Load the key in ``env_var`` from the process environment (or ``env`` in tests).

    Raises :class:`KeyNotConfiguredError` when unset or blank and :class:`MalformedKeyError` when
    the value is not 32 bytes of hex in ``1 .. n-1``. Neither message contains the value.
    """
    source: Mapping[str, str] = os.environ if env is None else env
    raw = source.get(env_var)
    if raw is None or not raw.strip():
        raise KeyNotConfiguredError(
            f"{env_var} is not set. Export it in the environment before running this command "
            f"(never commit it and never store it in a tracked file): "
            f'export {env_var}="0x<64 hex characters>". See .env.example.'
        )
    value = raw.strip()
    if _HEX_32_BYTES.fullmatch(value) is None:
        raise MalformedKeyError(
            f"{env_var} is not a 32-byte hex private key: expected 64 hexadecimal characters, "
            f"optionally 0x-prefixed, got {len(value)} character(s). {_REDACTED}"
        )
    if not 0 < int(value, 16) < SECP256K1_N:
        raise MalformedKeyError(
            f"{env_var} is not a valid secp256k1 private key: it must be in 1..n-1. {_REDACTED}"
        )
    account: Any = None
    try:
        from eth_account import Account

        account = Account.from_key(value)
    except Exception:  # the library's message quotes the key; it must not escape
        account = None
    if account is None:
        # Raised outside the handler so the original exception is not even reachable through
        # __context__: its text contains the key.
        raise MalformedKeyError(
            f"{env_var} could not be loaded as a secp256k1 private key. {_REDACTED}"
        )
    return SigningKey(account, env_var)


def load_oracle_key(env: Mapping[str, str] | None = None) -> SigningKey:
    """The ORACLE_ROLE key that signs ``setNAV`` (``ORACLE_PRIVATE_KEY``)."""
    return load_signing_key(ENV_ORACLE_KEY, env)


def load_attestor_key(env: Mapping[str, str] | None = None) -> SigningKey:
    """The simulated attestor key that signs ``attestation.json`` (``ATTESTOR_PRIVATE_KEY``)."""
    return load_signing_key(ENV_ATTESTOR_KEY, env)
