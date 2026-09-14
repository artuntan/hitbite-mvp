"""Build, sign, verify and write ``attestation.json`` (BUILD_PROMPT 6.3, PLAN.md D9).

The attestation is the transparency layer's proof object: it republishes the state the engine just
computed - holdings, cash, fees payable, NAV, token supply, supply-backed ratio, timestamp - and
signs it, so anyone can check that the numbers on the website are the numbers the signer saw.

*Simulated attestor - an independent firm signs in production.* The key is a testnet key held by
this repository's operator; the label is repeated in the code, in the payload, in the signature
block and in the UI.

How the bytes are pinned:

1. The payload is a pydantic model (:class:`nav_engine.schemas.AttestationPayload`) built from the
   already-published ``nav.json`` and ``holdings.json`` documents, so the attested numbers are the
   same strings the web app renders - by construction, not by convention.
2. It is serialised canonically: ``sort_keys=True``, ``separators=(",", ":")``, ``ensure_ascii=False``
   and encoded UTF-8. Every value is a string, an integer or a boolean; floats are rejected outright
   (:func:`canonical_dumps`), so no binary-rounding ambiguity can enter the signed bytes. The same
   state always produces the same bytes, and therefore the same signature (RFC 6979 is deterministic).
3. The signature is EIP-191 ``personal_sign`` over that string. The exact string is published as
   ``signature.message``: a verifier never has to re-canonicalise anything, and
   ``viem.verifyMessage({ address, message, signature })`` verifies it unchanged in the browser.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import UTC
from decimal import Decimal
from pathlib import Path
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from nav_engine.errors import DataError
from nav_engine.keys import SigningKey
from nav_engine.money import ONE_HUNDRED, TOKEN_UNIT, money_context, quantize_unit, to_decimal
from nav_engine.outputs import OUTPUT_FILENAMES, parse_generated_at
from nav_engine.schemas import (
    ATTESTOR_NOTE,
    AttestationChain,
    AttestationDocument,
    AttestationHolding,
    AttestationNav,
    AttestationPayload,
    AttestationSignature,
    HoldingsDocument,
    NavDocument,
    SupplyBackedRatio,
)

ATTESTATION_FILENAME = "attestation.json"

RATIO_SCALE = 10**18
"""The on-chain ``supplyBackedRatio()`` scale (1e18 = 1.0); mirrored here so the two can be compared."""

_RATIO_BASIS_CHAIN = (
    "Computed book value of the tokens outstanding (engine NAV x totalSupply) over their on-chain "
    "NAV liability (on-chain nav x totalSupply), scaled 1e18 like HBToken.supplyBackedRatio(). It "
    "excludes the vault's USDC balance, which the engine does not read, so the on-chain ratio is "
    "this figure plus available liquidity. Simulated portfolio (testnet)."
)
_RATIO_BASIS_NO_CHAIN = (
    "No on-chain supply or NAV was available to this run ({reason}), so the ratio is 1.000000 by "
    "construction: in the reference-unit model (PLAN.md D19) one token is one reference unit and "
    "the whole simulated book backs the units outstanding. Simulated portfolio (testnet)."
)


# --------------------------------------------------------------------------- canonical JSON
def _reject_floats(value: Any, path: str = "$") -> None:
    """Canonical JSON carries no floats: money is a fixed-scale string, counts are integers."""
    if isinstance(value, float):
        raise DataError(
            f"attestation payload {path} is a float ({value!r}); canonical JSON takes only "
            "strings, integers, booleans and null so the signed bytes are unambiguous"
        )
    if isinstance(value, dict):
        for key, item in value.items():
            _reject_floats(item, f"{path}.{key}")
    elif isinstance(value, list | tuple):
        for index, item in enumerate(value):
            _reject_floats(item, f"{path}[{index}]")


def canonical_dumps(value: Any) -> str:
    """Deterministic JSON: sorted keys, no whitespace, real UTF-8, no floats, no NaN/Infinity."""
    _reject_floats(value)
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    )


def canonical_bytes(value: Any) -> bytes:
    """The exact bytes that get signed and hashed."""
    return canonical_dumps(value).encode("utf-8")


def payload_message(payload: AttestationPayload) -> str:
    """Canonical JSON of the payload: the string the attestor signs and publishes."""
    return canonical_dumps(payload.model_dump(mode="json"))


def sha256_hex(text: str) -> str:
    return "0x" + hashlib.sha256(text.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- payload
def compute_supply_backed_ratio(nav: NavDocument) -> SupplyBackedRatio:
    """Book value of the outstanding tokens over their on-chain NAV liability (PLAN.md D20).

    Returns exactly 1.000000 when there is no on-chain supply or NAV to compare against, and says
    so in ``basis`` rather than inventing backing the engine cannot see.
    """
    supply_wei = int(nav.chain.total_supply_wei) if nav.chain.total_supply_wei is not None else None
    onchain_nav = nav.chain.onchain_nav_usdc_6dec
    if supply_wei is None or supply_wei == 0 or onchain_nav is None or onchain_nav == 0:
        reason = (
            "supply_source=" + nav.chain.supply_source
            if supply_wei is None or supply_wei == 0
            else "no on-chain NAV was read"
        )
        return SupplyBackedRatio(
            ratio=Decimal(1),
            ratio_1e18=str(RATIO_SCALE),
            assets_usdc_6dec=None,
            liabilities_usdc_6dec=None,
            basis=_RATIO_BASIS_NO_CHAIN.format(reason=reason),
        )
    assets = nav.nav.usdc_6dec * supply_wei // int(TOKEN_UNIT)
    liabilities = onchain_nav * supply_wei // int(TOKEN_UNIT)
    if liabilities == 0:
        # Mirrors the contract: liabilities that round to zero are treated as fully backed.
        return SupplyBackedRatio(
            ratio=Decimal(1),
            ratio_1e18=str(RATIO_SCALE),
            assets_usdc_6dec=assets,
            liabilities_usdc_6dec=liabilities,
            basis=_RATIO_BASIS_CHAIN,
        )
    with money_context():
        ratio = quantize_unit(Decimal(assets) / Decimal(liabilities))
    return SupplyBackedRatio(
        ratio=ratio,
        ratio_1e18=str(assets * RATIO_SCALE // liabilities),
        assets_usdc_6dec=assets,
        liabilities_usdc_6dec=liabilities,
        basis=_RATIO_BASIS_CHAIN,
    )


def _unix_seconds(generated_at: str) -> int:
    return int(parse_generated_at(generated_at).astimezone(UTC).timestamp())


def build_payload(
    nav: NavDocument, holdings: HoldingsDocument, generated_at: str | None = None
) -> AttestationPayload:
    """Assemble the signable payload from the two published documents of the same engine run."""
    if nav.as_of != holdings.as_of:
        raise DataError(
            f"nav.json is as of {nav.as_of} but holdings.json is as of {holdings.as_of}: "
            "attest a single engine run (re-run `nav-engine compute`)"
        )
    if generated_at is None and nav.generated_at != holdings.generated_at:
        raise DataError(
            f"nav.json was generated at {nav.generated_at} and holdings.json at "
            f"{holdings.generated_at}: attest a single engine run (re-run `nav-engine compute`)"
        )
    stamp = generated_at or nav.generated_at
    return AttestationPayload(
        generated_at=stamp,
        timestamp=_unix_seconds(stamp),
        as_of=nav.as_of,
        source_note=nav.source_note,
        chain=AttestationChain(
            chain_id=nav.chain.chain_id,
            token_address=nav.chain.token_address,
            total_supply_wei=nav.chain.total_supply_wei,
            total_supply_tokens=nav.chain.total_supply_tokens,
            onchain_nav_usdc_6dec=nav.chain.onchain_nav_usdc_6dec,
            supply_source=nav.chain.supply_source,
        ),
        nav=AttestationNav(
            per_token_usd=nav.nav.per_token_usd,
            usdc_6dec=nav.nav.usdc_6dec,
            total_usd=nav.nav.total_usd,
            reference_units=nav.nav.reference_units,
            reported_aum_usd=nav.nav.reported_aum_usd,
            reported_aum_usdc_6dec=nav.nav.reported_aum_usdc_6dec,
        ),
        cash_usd=holdings.cash_usd,
        fees_payable_usd=holdings.fees_payable_usd,
        sum_market_value_usd=nav.portfolio.sum_market_value_usd,
        positions_count=len(holdings.positions),
        holdings=[
            AttestationHolding(
                name=position.name,
                isin=position.isin,
                coupon_pct=to_decimal(position.coupon_pct),
                maturity=position.maturity,
                face_usd=position.face_usd,
                scaled_face_usd=position.scaled_face_usd,
                clean_price=position.clean_price,
                accrued_usd=position.accrued_usd,
                dirty_price=position.dirty_price,
                market_value_usd=position.market_value_usd,
            )
            for position in holdings.positions
        ],
        supply_backed_ratio=compute_supply_backed_ratio(nav),
    )


# --------------------------------------------------------------------------- sign / verify
def sign_payload(payload: AttestationPayload, key: SigningKey) -> AttestationDocument:
    """Sign the canonical payload with the attestor key and publish it beside the signature."""
    message = payload_message(payload)
    return AttestationDocument(
        generated_at=payload.generated_at,
        source_note=payload.source_note,
        attestation=payload,
        signature=AttestationSignature(
            message=message,
            message_sha256=sha256_hex(message),
            signature=key.sign_text(message),
            attestor_address=key.address,
            attestor_public_key=key.public_key,
        ),
    )


def build_attestation(
    nav: NavDocument,
    holdings: HoldingsDocument,
    key: SigningKey,
    generated_at: str | None = None,
) -> AttestationDocument:
    """``build_payload`` then ``sign_payload``: the whole attestation in one call."""
    return sign_payload(build_payload(nav, holdings, generated_at), key)


@dataclass(frozen=True)
class VerificationResult:
    """Outcome of :func:`verify_attestation`; ``problems`` is empty exactly when ``ok`` is true."""

    ok: bool
    recovered_address: str | None
    attestor_address: str
    problems: list[str] = field(default_factory=list)

    def summary(self) -> str:
        if self.ok:
            return f"signature verifies against {self.attestor_address}"
        return "; ".join(self.problems)


def _recover_address(message: str, signature: str) -> tuple[str | None, str | None]:
    from eth_account import Account
    from eth_account.messages import encode_defunct

    try:
        return str(Account.recover_message(encode_defunct(text=message), signature=signature)), None
    except Exception as exc:  # a malformed signature is a verification failure, not a crash
        return None, f"signature could not be recovered ({exc.__class__.__name__})"


def verify_attestation(document: AttestationDocument) -> VerificationResult:
    """Check that the payload, the signed message, the hash and the published address all agree.

    Any single-byte change to the payload, the message or the signature makes this fail: the
    payload is re-canonicalised and compared to the signed message, the SHA-256 is recomputed, and
    the address is recovered from the signature.
    """
    problems: list[str] = []
    signature = document.signature
    recomputed = payload_message(document.attestation)
    if recomputed != signature.message:
        problems.append("payload does not re-serialise to the signed message (payload tampered)")
    if sha256_hex(signature.message) != signature.message_sha256:
        problems.append("message_sha256 does not match the signed message")
    recovered, failure = _recover_address(signature.message, signature.signature)
    if failure is not None:
        problems.append(failure)
    elif recovered is None or recovered.lower() != signature.attestor_address.lower():
        problems.append(
            f"signature recovers {recovered}, not the published attestor "
            f"{signature.attestor_address}"
        )
    return VerificationResult(
        ok=not problems,
        recovered_address=recovered,
        attestor_address=signature.attestor_address,
        problems=problems,
    )


# --------------------------------------------------------------------------- files
DocumentT = TypeVar("DocumentT", bound=BaseModel)


def load_output_document(path: Path, model: type[DocumentT]) -> DocumentT:
    """Read one document written by ``nav-engine compute`` back into its model."""
    if not path.is_file():
        raise DataError(f"{path} not found: run `nav-engine compute` first")
    try:
        return model.model_validate_json(path.read_text(encoding="utf-8"))
    except (ValidationError, ValueError) as exc:
        raise DataError(f"{path} is not a valid {model.__name__}: {exc}") from exc


def load_run_documents(in_dir: Path) -> tuple[NavDocument, HoldingsDocument]:
    """Read ``nav.json`` and ``holdings.json`` written by ``nav-engine compute``."""
    nav = load_output_document(in_dir / OUTPUT_FILENAMES["nav"], NavDocument)
    holdings = load_output_document(in_dir / OUTPUT_FILENAMES["holdings"], HoldingsDocument)
    return nav, holdings


def load_attestation(path: Path) -> AttestationDocument:
    """Read a published ``attestation.json`` back into its model (for verification)."""
    if not path.is_file():
        raise DataError(f"{path} not found")
    try:
        return AttestationDocument.model_validate_json(path.read_text(encoding="utf-8"))
    except (ValidationError, ValueError) as exc:
        raise DataError(f"{path} is not a valid attestation document: {exc}") from exc


def write_attestation(out_dir: Path, document: AttestationDocument) -> Path:
    """Write ``attestation.json`` next to the other published documents."""
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / ATTESTATION_FILENAME
    target.write_text(document.model_dump_json(indent=2) + "\n", encoding="utf-8")
    return target


def attestation_summary(document: AttestationDocument) -> str:
    """One line for the CLI and the daily log."""
    payload = document.attestation
    ratio_pct = to_decimal(payload.supply_backed_ratio.ratio) * ONE_HUNDRED
    return (
        f"as_of {payload.as_of}  nav {payload.nav.per_token_usd} USD "
        f"({payload.nav.usdc_6dec} usdc_6dec)  supply_backed {ratio_pct:.4f}%  "
        f"attestor {document.signature.attestor_address}  {ATTESTOR_NOTE}"
    )
