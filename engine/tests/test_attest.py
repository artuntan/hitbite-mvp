"""Attestation: canonical bytes, EIP-191 signature, verification, tamper detection (PLAN.md D9).

The attestor key here is a dummy built from repeated bytes, never a funded account.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3

from nav_engine.attest import (
    ATTESTATION_FILENAME,
    build_attestation,
    build_payload,
    canonical_bytes,
    canonical_dumps,
    compute_supply_backed_ratio,
    load_attestation,
    load_run_documents,
    payload_message,
    sha256_hex,
    verify_attestation,
    write_attestation,
)
from nav_engine.chain import FakeChainReader
from nav_engine.cli import main
from nav_engine.errors import DataError
from nav_engine.keys import ENV_ATTESTOR_KEY, SigningKey, load_signing_key
from nav_engine.outputs import write_documents
from nav_engine.pipeline import ComputeOptions, ComputeResult, run_compute
from nav_engine.schemas import ATTESTOR_NOTE, AttestationDocument
from tests.conftest import DATA_DIR, FIXTURE_AS_OF, FIXTURES_DIR

ATTESTOR_KEY = "0x" + "33" * 32
GENERATED_AT = "2026-09-15T06:00:00Z"
SUPPLY_WEI = 1000 * 10**18


@pytest.fixture(scope="session")
def attestor() -> SigningKey:
    return load_signing_key(ENV_ATTESTOR_KEY, {ENV_ATTESTOR_KEY: ATTESTOR_KEY})


@pytest.fixture(scope="session")
def chain_result(tmp_path_factory: pytest.TempPathFactory) -> ComputeResult:
    """An engine run that did reach the chain: supply and on-chain NAV are populated."""
    return run_compute(
        ComputeOptions(
            as_of=FIXTURE_AS_OF,
            data_dir=DATA_DIR,
            out_dir=None,
            distributions_path=FIXTURES_DIR / "distributions_fixture.csv",
            reader=FakeChainReader(total_supply=SUPPLY_WEI, nav=1_000_000),
            chain_id=31337,
            token_address="0x" + "ab" * 20,
            generated_at=None,
            cache_path=tmp_path_factory.mktemp("chain-cache") / "chain_cache.json",
        )
    )


@pytest.fixture
def document(fixture_result: ComputeResult, attestor: SigningKey) -> AttestationDocument:
    return build_attestation(
        fixture_result.documents.nav,
        fixture_result.documents.holdings,
        attestor,
        generated_at=GENERATED_AT,
    )


# --------------------------------------------------------------------------- payload content
def test_payload_carries_the_state_the_spec_asks_for(document: AttestationDocument) -> None:
    payload = document.attestation
    assert payload.version == "hitbite.attestation.v1"
    assert payload.as_of == FIXTURE_AS_OF
    assert payload.generated_at == GENERATED_AT
    assert payload.timestamp == 1789452000  # 2026-09-15T06:00:00Z
    assert payload.simulated is True
    assert payload.nav.usdc_6dec == 994658
    assert payload.positions_count == 3 == len(payload.holdings)
    assert payload.cash_usd > 0
    assert payload.fees_payable_usd > 0
    assert payload.supply_backed_ratio.ratio_1e18 == str(10**18)
    assert all(holding.illustrative is True for holding in payload.holdings)


def test_the_simulated_attestor_label_is_everywhere(document: AttestationDocument) -> None:
    assert ATTESTOR_NOTE.startswith("Simulated attestor")
    assert document.attestation.attestor_note == ATTESTOR_NOTE
    assert document.signature.attestor_note == ATTESTOR_NOTE
    assert ATTESTOR_NOTE in document.signature.message
    assert ATTESTOR_NOTE in document.model_dump_json()


def test_payload_values_are_the_published_strings(
    fixture_result: ComputeResult, document: AttestationDocument
) -> None:
    """Attested numbers are the same strings nav.json / holdings.json publish, by construction."""
    nav_json = json.loads(fixture_result.documents.nav.model_dump_json())
    holdings_json = json.loads(fixture_result.documents.holdings.model_dump_json())
    payload = json.loads(document.attestation.model_dump_json())
    assert payload["nav"]["per_token_usd"] == nav_json["nav"]["per_token_usd"]
    assert payload["nav"]["usdc_6dec"] == nav_json["nav"]["usdc_6dec"]
    assert payload["cash_usd"] == holdings_json["cash_usd"]
    assert payload["fees_payable_usd"] == holdings_json["fees_payable_usd"]
    assert payload["sum_market_value_usd"] == nav_json["portfolio"]["sum_market_value_usd"]
    assert [h["market_value_usd"] for h in payload["holdings"]] == [
        h["market_value_usd"] for h in holdings_json["positions"]
    ]


def test_payload_has_no_floats_anywhere(document: AttestationDocument) -> None:
    def walk(value: Any) -> None:
        assert not isinstance(value, float), value
        if isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(document.attestation.model_dump(mode="json"))


def test_canonical_dumps_rejects_floats() -> None:
    with pytest.raises(DataError) as excinfo:
        canonical_dumps({"nav": {"per_token_usd": 1.0034}})
    assert "$.nav.per_token_usd" in str(excinfo.value)
    with pytest.raises(DataError):
        canonical_dumps({"holdings": [{"price": 100.5}]})


# --------------------------------------------------------------------------- canonical form
def test_canonical_form_is_sorted_compact_and_utf8() -> None:
    text = canonical_dumps({"b": 1, "a": {"d": "Türkiye", "c": True}})
    assert text == '{"a":{"c":true,"d":"Türkiye"},"b":1}'
    assert canonical_bytes({"a": "Türkiye"}) == '{"a":"Türkiye"}'.encode()


def test_canonical_form_ignores_dict_ordering_and_survives_a_json_round_trip(
    document: AttestationDocument,
) -> None:
    payload = document.attestation.model_dump(mode="json")
    reordered = dict(reversed(list(payload.items())))
    assert list(reordered) != list(payload)
    assert canonical_dumps(reordered) == canonical_dumps(payload)
    assert canonical_dumps(json.loads(json.dumps(payload))) == canonical_dumps(payload)
    assert canonical_dumps(payload) == document.signature.message


def test_same_state_produces_identical_bytes_and_signature(
    fixture_result: ComputeResult, attestor: SigningKey, document: AttestationDocument
) -> None:
    again = build_attestation(
        fixture_result.documents.nav,
        fixture_result.documents.holdings,
        attestor,
        generated_at=GENERATED_AT,
    )
    assert again.signature.message == document.signature.message
    assert again.signature.signature == document.signature.signature


def test_documents_reloaded_from_disk_attest_to_the_same_bytes(
    tmp_path: Path,
    fixture_result: ComputeResult,
    attestor: SigningKey,
    document: AttestationDocument,
) -> None:
    """In-memory Decimals and the rounded strings read back from disk sign identically."""
    write_documents(tmp_path, fixture_result.documents)
    nav, holdings = load_run_documents(tmp_path)
    from_disk = build_attestation(nav, holdings, attestor, generated_at=GENERATED_AT)
    assert from_disk.signature.message == document.signature.message
    assert from_disk.signature.signature == document.signature.signature


def test_message_sha256_matches_the_signed_bytes(document: AttestationDocument) -> None:
    assert document.signature.message_sha256 == sha256_hex(document.signature.message)
    assert document.signature.message_sha256.startswith("0x")


# --------------------------------------------------------------------------- signature
def test_sign_then_verify_succeeds(document: AttestationDocument) -> None:
    result = verify_attestation(document)
    assert result.ok
    assert result.problems == []
    assert result.recovered_address == document.signature.attestor_address
    assert "verifies against" in result.summary()


def test_signature_verifies_against_the_published_address(
    document: AttestationDocument, attestor: SigningKey
) -> None:
    recovered = Account.recover_message(
        encode_defunct(text=document.signature.message), signature=document.signature.signature
    )
    assert recovered == document.signature.attestor_address == attestor.address


def test_published_public_key_belongs_to_the_published_address(
    document: AttestationDocument,
) -> None:
    uncompressed = bytes.fromhex(document.signature.attestor_public_key[4:])  # drop 0x04
    assert Web3.to_checksum_address(Web3.keccak(uncompressed)[-20:].hex()) == (
        document.signature.attestor_address
    )


def test_message_hash_is_the_eip191_prefixed_hash_viem_computes(
    document: AttestationDocument,
) -> None:
    """viem's hashMessage: keccak256("\\x19Ethereum Signed Message:\\n" + byteLength + bytes).

    The payload contains non-ASCII ("Türkiye", the em dash in the attestor note), so byte length
    and character length differ - this is the detail a hand-rolled verifier gets wrong.
    """
    message = document.signature.message
    raw = message.encode("utf-8")
    assert len(raw) != len(message)
    expected = Web3.keccak(b"\x19Ethereum Signed Message:\n" + str(len(raw)).encode() + raw)
    signed = Account.from_key(ATTESTOR_KEY).sign_message(encode_defunct(text=message))
    assert bytes(signed.message_hash) == expected
    assert "0x" + bytes(signed.signature).hex() == document.signature.signature


@pytest.mark.parametrize("position", ["first", "middle", "last"])
def test_a_single_byte_change_to_the_message_breaks_verification(
    document: AttestationDocument, position: str
) -> None:
    text = document.signature.message
    index = {"first": 0, "middle": len(text) // 2, "last": len(text) - 1}[position]
    flipped = chr(ord(text[index]) ^ 0x01)
    tampered = document.model_copy(deep=True)
    tampered.signature.message = text[:index] + flipped + text[index + 1 :]
    assert tampered.signature.message != text
    result = verify_attestation(tampered)
    assert not result.ok
    assert result.problems


def test_a_single_byte_change_to_the_payload_breaks_verification(
    document: AttestationDocument,
) -> None:
    tampered = document.model_copy(deep=True)
    tampered.attestation.nav.usdc_6dec += 1
    result = verify_attestation(tampered)
    assert not result.ok
    assert "does not re-serialise to the signed message" in result.summary()


def test_a_tampered_signature_or_address_breaks_verification(
    document: AttestationDocument,
) -> None:
    signature = document.signature.signature
    flipped_nibble = "0" if signature[10] != "0" else "1"
    tampered = document.model_copy(deep=True)
    tampered.signature.signature = signature[:10] + flipped_nibble + signature[11:]
    assert not verify_attestation(tampered).ok

    wrong_address = document.model_copy(deep=True)
    wrong_address.signature.attestor_address = "0x" + "ab" * 20
    result = verify_attestation(wrong_address)
    assert not result.ok
    assert "recovers" in result.summary()

    garbage = document.model_copy(deep=True)
    garbage.signature.signature = "0xnotasignature"
    assert "could not be recovered" in verify_attestation(garbage).summary()

    rehashed = document.model_copy(deep=True)
    rehashed.signature.message_sha256 = sha256_hex("something else")
    assert "message_sha256 does not match" in verify_attestation(rehashed).summary()


# --------------------------------------------------------------------------- supply-backed ratio
def test_supply_backed_ratio_compares_the_book_to_the_on_chain_liability(
    chain_result: ComputeResult,
) -> None:
    nav = chain_result.documents.nav
    ratio = compute_supply_backed_ratio(nav)
    assert ratio.liabilities_usdc_6dec == 1_000_000 * SUPPLY_WEI // 10**18
    assert ratio.assets_usdc_6dec == nav.nav.usdc_6dec * SUPPLY_WEI // 10**18
    expected = ratio.assets_usdc_6dec * 10**18 // ratio.liabilities_usdc_6dec
    assert ratio.ratio_1e18 == str(expected)
    assert ratio.ratio < 1  # the engine NAV is below the un-pushed on-chain NAV
    assert "supplyBackedRatio()" in ratio.basis


def test_supply_backed_ratio_is_one_when_the_chain_was_not_read(
    fixture_result: ComputeResult,
) -> None:
    ratio = compute_supply_backed_ratio(fixture_result.documents.nav)
    assert ratio.ratio == 1
    assert ratio.ratio_1e18 == str(10**18)
    assert ratio.assets_usdc_6dec is None
    assert "supply_source=none" in ratio.basis


def test_supply_backed_ratio_is_one_when_supply_is_zero(chain_result: ComputeResult) -> None:
    nav = chain_result.documents.nav.model_copy(deep=True)
    nav.chain.total_supply_wei = "0"
    assert compute_supply_backed_ratio(nav).ratio == 1


def test_attestation_from_a_chain_backed_run_reports_the_supply(
    chain_result: ComputeResult, attestor: SigningKey
) -> None:
    document = build_attestation(
        chain_result.documents.nav, chain_result.documents.holdings, attestor
    )
    assert document.attestation.chain.total_supply_wei == str(SUPPLY_WEI)
    assert document.attestation.chain.supply_source == "rpc"
    assert document.attestation.chain.onchain_nav_usdc_6dec == 1_000_000
    assert verify_attestation(document).ok


# --------------------------------------------------------------------------- inputs and files
def test_documents_from_different_runs_are_refused(fixture_result: ComputeResult) -> None:
    nav = fixture_result.documents.nav
    holdings = fixture_result.documents.holdings.model_copy(deep=True)
    holdings.generated_at = "2020-01-01T00:00:00Z"
    with pytest.raises(DataError) as excinfo:
        build_payload(nav, holdings)
    assert "single engine run" in str(excinfo.value)

    other_day = fixture_result.documents.holdings.model_copy(deep=True)
    other_day.as_of = date(2026, 9, 14)
    with pytest.raises(DataError) as excinfo:
        build_payload(nav, other_day)
    assert "as of" in str(excinfo.value)


def test_payload_message_is_stable_after_a_write_and_read_cycle(
    tmp_path: Path, document: AttestationDocument
) -> None:
    target = write_attestation(tmp_path, document)
    assert target.name == ATTESTATION_FILENAME
    reloaded = load_attestation(target)
    assert payload_message(reloaded.attestation) == document.signature.message
    assert verify_attestation(reloaded).ok
    assert target.read_text(encoding="utf-8").endswith("}\n")


def test_loading_a_bad_attestation_file_is_a_readable_error(tmp_path: Path) -> None:
    with pytest.raises(DataError) as excinfo:
        load_attestation(tmp_path / "nowhere.json")
    assert "not found" in str(excinfo.value)
    broken = tmp_path / ATTESTATION_FILENAME
    broken.write_text('{"generated_at": "x"}', encoding="utf-8")
    with pytest.raises(DataError) as excinfo:
        load_attestation(broken)
    assert "not a valid attestation document" in str(excinfo.value)


def test_missing_nav_json_is_a_readable_error(tmp_path: Path) -> None:
    with pytest.raises(DataError) as excinfo:
        load_run_documents(tmp_path)
    assert "nav.json not found" in str(excinfo.value)
    assert "nav-engine compute" in str(excinfo.value)


# --------------------------------------------------------------------------- CLI
def _write_run(tmp_path: Path) -> Path:
    assert (
        main(
            [
                "compute",
                "--as-of",
                FIXTURE_AS_OF.isoformat(),
                "--no-chain",
                "--data-dir",
                str(DATA_DIR),
                "--distributions",
                str(FIXTURES_DIR / "distributions_fixture.csv"),
                "--out",
                str(tmp_path),
                "--generated-at",
                GENERATED_AT,
            ]
        )
        == 0
    )
    return tmp_path


def test_cli_attest_writes_and_verifies(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    run_dir = _write_run(tmp_path)
    monkeypatch.setenv(ENV_ATTESTOR_KEY, ATTESTOR_KEY)
    assert main(["attest", "--in", str(run_dir)]) == 0
    out = capsys.readouterr().out
    assert "wrote attestation" in out
    assert ATTESTOR_NOTE in out
    target = run_dir / ATTESTATION_FILENAME
    assert verify_attestation(load_attestation(target)).ok

    assert main(["attest", "--verify", str(target)]) == 0
    assert "verifies against" in capsys.readouterr().out


def test_cli_attest_verify_fails_on_a_tampered_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    run_dir = _write_run(tmp_path)
    monkeypatch.setenv(ENV_ATTESTOR_KEY, ATTESTOR_KEY)
    assert main(["attest", "--in", str(run_dir), "--out", str(tmp_path / "signed")]) == 0
    target = tmp_path / "signed" / ATTESTATION_FILENAME
    capsys.readouterr()

    document = load_attestation(target)
    document.attestation.cash_usd += 1
    target.write_text(document.model_dump_json(indent=2) + "\n", encoding="utf-8")
    assert main(["attest", "--verify", str(target)]) == 2
    assert "does not verify" in capsys.readouterr().err


def test_cli_attest_without_a_key_is_actionable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    run_dir = _write_run(tmp_path)
    monkeypatch.delenv(ENV_ATTESTOR_KEY, raising=False)
    monkeypatch.setattr("nav_engine.cli.load_dotenv", lambda *a, **k: False)
    assert main(["attest", "--in", str(run_dir)]) == 2
    err = capsys.readouterr().err
    assert ENV_ATTESTOR_KEY in err
    assert "is not set" in err
    assert not (run_dir / ATTESTATION_FILENAME).exists()


def test_cli_attest_generated_at_override_is_what_gets_signed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    run_dir = _write_run(tmp_path)
    monkeypatch.setenv(ENV_ATTESTOR_KEY, ATTESTOR_KEY)
    assert main(["attest", "--in", str(run_dir), "--generated-at", "2026-09-16T06:00:00Z"]) == 0
    document = load_attestation(run_dir / ATTESTATION_FILENAME)
    assert document.attestation.generated_at == "2026-09-16T06:00:00Z"
    assert document.attestation.timestamp == 1789538400
    assert verify_attestation(document).ok
