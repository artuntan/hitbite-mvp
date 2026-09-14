"""Oracle push: the rail, the idempotency rule and the force override, plus a real Anvil run.

The chain-backed tests spawn ``anvil`` on port **8546** (8545 is left free for interactive use),
deploy MockUSDC / IdentityRegistry / HBToken with ``forge create`` and push a real ``nav.json``.
They skip - loudly, with a reason - when Foundry is not installed or the port is taken. Everything
that can be decided without a chain (rail arithmetic, idempotency, force, the testnet guard, the
CLI's argument rules) is covered by the fast tests above them, so CI keeps real coverage either way.

Anvil's default accounts are public, well-known development keys; nothing else is ever used here.
"""

from __future__ import annotations

import json
import shutil
import socket
import subprocess
import time
from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import pytest
from web3 import Web3

from nav_engine.attest import load_output_document
from nav_engine.cli import main
from nav_engine.errors import DataError
from nav_engine.keys import ENV_ORACLE_KEY, SigningKey, load_signing_key
from nav_engine.pipeline import ComputeOptions, run_compute
from nav_engine.push_nav import (
    HBTOKEN_ORACLE_ABI,
    MAX_INPUT,
    ChainState,
    NavUpdate,
    OracleClient,
    OracleError,
    PushResult,
    check_already_pushed,
    check_testnet,
    decide,
    evaluate_rail,
    load_nav_document,
    push_nav,
    reported_aum_for,
    update_from_nav_document,
)
from nav_engine.schemas import NavDocument
from tests.conftest import DATA_DIR, FIXTURE_AS_OF, FIXTURES_DIR

ANVIL_PORT = 8546
ANVIL_RPC = f"http://127.0.0.1:{ANVIL_PORT}"
GENESIS_TIMESTAMP = 1789473600  # 2026-09-15T12:00:00Z: the same day as FIXTURE_AS_OF
FIXTURE_NAV_6DEC = 994_658

# Anvil's published development accounts (index 0 = admin/deployer, 1 = oracle).
ADMIN_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
ORACLE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
BLOCKED_COUNTRIES = "[840,792]"
UAE = 784
PROFESSIONAL = 1
MINT_TOKENS_WEI = 1000 * 10**18

REPO_ROOT = Path(__file__).resolve().parents[2]
CONTRACTS_DIR = REPO_ROOT / "contracts"

_ROLE_ABI: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "grantRole",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "role", "type": "bytes32"}, {"name": "account", "type": "address"}],
        "outputs": [],
    },
]
TOKEN_TEST_ABI: list[dict[str, Any]] = [
    *HBTOKEN_ORACLE_ABI,
    *_ROLE_ABI,
    {
        "type": "function",
        "name": "ISSUER_ROLE",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "bytes32"}],
    },
    {
        "type": "function",
        "name": "mint",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "to", "type": "address"}, {"name": "amount", "type": "uint256"}],
        "outputs": [],
    },
]
REGISTRY_TEST_ABI: list[dict[str, Any]] = [
    *_ROLE_ABI,
    {
        "type": "function",
        "name": "REGISTRAR_ROLE",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "bytes32"}],
    },
    {
        "type": "function",
        "name": "addVerified",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "account", "type": "address"},
            {"name": "country", "type": "uint16"},
            {"name": "investorType", "type": "uint8"},
        ],
        "outputs": [],
    },
]


# =========================================================================== fast, chain-free
def make_state(**overrides: Any) -> ChainState:
    """A plausible just-deployed HBToken: NAV 1.000000, 5% rail, window opened an hour ago."""
    base = ChainState(
        chain_id=31337,
        nav=1_000_000,
        reported_aum=0,
        total_supply_wei=MINT_TOKENS_WEI,
        max_nav_move_bps=500,
        rail_anchor_nav=1_000_000,
        rail_window_start=GENESIS_TIMESTAMP,
        rail_window_seconds=86_400,
        nav_updated_at=GENESIS_TIMESTAMP,
        block_timestamp=GENESIS_TIMESTAMP + 3_600,
    )
    return replace(base, **overrides)


def make_update(**overrides: Any) -> NavUpdate:
    base = NavUpdate(
        as_of=FIXTURE_AS_OF,
        nav_usdc_6dec=FIXTURE_NAV_6DEC,
        reported_aum_usdc_6dec=reported_aum_for(FIXTURE_NAV_6DEC, MINT_TOKENS_WEI),
    )
    return replace(base, **overrides)


def test_reported_aum_is_the_contracts_integer_floor() -> None:
    assert reported_aum_for(994_658, 1000 * 10**18) == 994_658_000
    assert reported_aum_for(1_000_000, 0) == 0
    assert reported_aum_for(1_000_001, 3 * 10**17) == 300_000  # floored, never rounded up


def test_rail_accepts_a_move_inside_the_window_band() -> None:
    check = evaluate_rail(make_state(), 1_040_000)
    assert check.ok
    assert check.max_bps == 500
    assert [c.anchor for c in check.checks] == [1_000_000]
    assert check.checks[0].move_bps == 400
    assert "within 500 bps" in check.detail()


def test_rail_rejects_a_move_beyond_the_band_measured_from_the_anchor() -> None:
    # Exactly on the limit is allowed; one micro-USDC past it is not (the contract uses <=).
    assert evaluate_rail(make_state(), 1_050_000).ok
    check = evaluate_rail(make_state(), 1_050_001)
    assert not check.ok
    assert "beyond 500 bps" in check.detail()


def test_rail_is_measured_from_the_anchor_not_from_the_last_update() -> None:
    """D27: chained in-rail updates cannot compound past the band inside one window."""
    state = make_state(nav=1_050_000, rail_anchor_nav=1_000_000)
    assert not evaluate_rail(state, 1_100_000).ok  # 5% from the last update, 10% from the anchor
    assert evaluate_rail(state, 1_049_000).ok


def test_rail_uses_the_current_nav_once_the_window_has_rolled() -> None:
    state = make_state(
        nav=1_050_000,
        rail_anchor_nav=1_000_000,
        block_timestamp=GENESIS_TIMESTAMP + 86_401,
    )
    check = evaluate_rail(state, 1_100_000)
    assert check.ok
    assert "rolled" in check.checks[0].label
    assert check.checks[0].anchor == 1_050_000


def test_a_move_near_the_roll_must_clear_both_anchors() -> None:
    """The operator cannot know which block mines the push, so both anchors must accept it."""
    state = make_state(
        nav=1_050_000,
        rail_anchor_nav=1_000_000,
        block_timestamp=GENESIS_TIMESTAMP + 86_400 - 30,
    )
    check = evaluate_rail(state, 1_100_000)
    assert not check.ok
    assert [c.ok for c in check.checks] == [False, True]
    assert len(check.checks) == 2
    # Well before the roll only the current anchor is consulted.
    assert len(evaluate_rail(make_state(nav=1_050_000), 1_100_000).checks) == 1


def test_idempotency_rule_same_integer_pushed_on_or_after_as_of() -> None:
    state = make_state(nav=FIXTURE_NAV_6DEC)
    already, note = check_already_pushed(state, make_update())
    assert already
    assert "already equals 994658" in note and "on or after as_of" in note


def test_a_different_value_is_a_revision_and_is_not_skipped() -> None:
    already, note = check_already_pushed(make_state(nav=1_000_000), make_update())
    assert not already
    assert "not a repeat" in note


def test_the_same_value_stamped_before_as_of_is_still_pushed() -> None:
    stale = make_state(
        nav=FIXTURE_NAV_6DEC,
        nav_updated_at=GENESIS_TIMESTAMP - 2 * 86_400,  # two days earlier
    )
    already, note = check_already_pushed(stale, make_update())
    assert not already
    assert "before as_of" in note
    assert stale.nav_updated_date == date(2026, 9, 13)


def test_decide_sends_when_inside_the_rail_and_new() -> None:
    decision = decide(make_state(), make_update())
    assert decision.send
    assert decision.blocked_reason is None
    assert not decision.already_pushed
    assert "within the rail" in decision.note


def test_decide_skips_an_already_pushed_value() -> None:
    decision = decide(make_state(nav=FIXTURE_NAV_6DEC), make_update())
    assert not decision.send
    assert decision.already_pushed
    assert decision.blocked_reason is None
    assert "nothing to do" in decision.note


def test_decide_refuses_a_rail_breach_with_an_actionable_reason() -> None:
    decision = decide(make_state(), make_update(nav_usdc_6dec=1_200_000))
    assert not decision.send
    assert decision.blocked_reason is not None
    assert "NavMoveExceedsRail" in decision.blocked_reason
    assert "--force --reason" in decision.blocked_reason
    assert "2026-09-16T12:00:00Z" in decision.blocked_reason  # when the window rolls


def test_force_overrides_both_the_rail_and_the_skip() -> None:
    forced = decide(make_state(nav=FIXTURE_NAV_6DEC), make_update(), force=True)
    assert forced.send and forced.already_pushed and forced.blocked_reason is None
    assert "overridden" in forced.note
    breach = decide(make_state(), make_update(nav_usdc_6dec=1_200_000), force=True)
    assert breach.send and breach.blocked_reason is None


def test_mainnet_chain_ids_are_refused_and_unknown_ones_warn() -> None:
    for chain_id, name in ((1, "Ethereum"), (8453, "Base"), (43114, "Avalanche")):
        with pytest.raises(OracleError) as excinfo:
            check_testnet(chain_id)
        assert name in str(excinfo.value)
        assert "testnet-only" in str(excinfo.value)
    assert check_testnet(31337) is None
    assert check_testnet(84532) is None
    warning = check_testnet(12345)
    assert warning is not None and "not one of the known testnets" in warning


def test_nav_document_bounds_are_checked_before_sending(fixture_result: Any) -> None:
    document = fixture_result.documents.nav
    update = update_from_nav_document(document, MINT_TOKENS_WEI)
    assert update.nav_usdc_6dec == FIXTURE_NAV_6DEC
    assert update.as_of == FIXTURE_AS_OF

    zero = document.model_copy(deep=True)
    zero.nav.usdc_6dec = 0
    with pytest.raises(OracleError, match="rejects zero"):
        update_from_nav_document(zero, MINT_TOKENS_WEI)

    huge = document.model_copy(deep=True)
    huge.nav.usdc_6dec = MAX_INPUT + 1
    with pytest.raises(OracleError, match="MAX_INPUT"):
        update_from_nav_document(huge, MINT_TOKENS_WEI)


class FakeClient(OracleClient):
    """An ``OracleClient`` with the RPC replaced: the orchestration is testable without a chain."""

    def __init__(self, state: ChainState, missing: str | None = None) -> None:
        super().__init__("http://127.0.0.1:0", "0x" + "ab" * 20)
        self.state = state
        self.missing = missing
        self.sent: list[tuple[NavUpdate, bool]] = []

    def read_state(self) -> ChainState:
        return self.state

    def missing_role(self, account: str, force: bool) -> str | None:
        return self.missing

    def send_set_nav(self, key: SigningKey, update: NavUpdate, force: bool) -> str:
        self.sent.append((update, force))
        return "0x" + "cd" * 32

    def wait_for_success(self, tx_hash: str, timeout: float = 0) -> int:
        return 42


@pytest.fixture
def oracle_key() -> SigningKey:
    return load_signing_key(ENV_ORACLE_KEY, {ENV_ORACLE_KEY: "0x" + "44" * 32})


def test_push_nav_sends_once_and_reports_the_transaction(
    fixture_result: Any, oracle_key: SigningKey
) -> None:
    client = FakeClient(make_state())
    result = push_nav(client, fixture_result.documents.nav, oracle_key)
    assert result.sent and result.tx_hash is not None and result.block_number == 42
    assert client.sent == [(make_update(), False)]
    assert any("tx:" in line for line in result.lines())


def test_push_nav_dry_run_sends_nothing(fixture_result: Any, oracle_key: SigningKey) -> None:
    client = FakeClient(make_state())
    result = push_nav(client, fixture_result.documents.nav, oracle_key, dry_run=True)
    assert not result.sent
    assert client.sent == []
    assert "--dry-run" in " ".join(result.warnings)


def test_push_nav_refuses_a_rail_breach_without_sending(
    fixture_result: Any, oracle_key: SigningKey
) -> None:
    document = fixture_result.documents.nav.model_copy(deep=True)
    document.nav.usdc_6dec = 1_200_000
    client = FakeClient(make_state())
    with pytest.raises(OracleError, match="exceeds the contract's rail"):
        push_nav(client, document, oracle_key)
    assert client.sent == []


def test_push_nav_refuses_when_the_signer_lacks_the_role(
    fixture_result: Any, oracle_key: SigningKey
) -> None:
    client = FakeClient(make_state(), missing="ORACLE_ROLE")
    with pytest.raises(OracleError) as excinfo:
        push_nav(client, fixture_result.documents.nav, oracle_key)
    assert "does not hold ORACLE_ROLE" in str(excinfo.value)
    assert "nothing was sent" in str(excinfo.value)
    assert client.sent == []


def test_push_nav_refuses_force_without_a_reason(
    fixture_result: Any, oracle_key: SigningKey
) -> None:
    client = FakeClient(make_state())
    with pytest.raises(OracleError, match="--force requires --reason"):
        push_nav(client, fixture_result.documents.nav, oracle_key, force=True)
    with pytest.raises(OracleError, match="--force requires --reason"):
        push_nav(client, fixture_result.documents.nav, oracle_key, force=True, reason="   ")
    assert client.sent == []


def test_push_nav_logs_the_force_reason(fixture_result: Any, oracle_key: SigningKey) -> None:
    client = FakeClient(make_state(nav=FIXTURE_NAV_6DEC))
    result = push_nav(
        client,
        fixture_result.documents.nav,
        oracle_key,
        force=True,
        reason="book revised after a pricing correction",
    )
    assert result.sent
    assert client.sent == [(make_update(), True)]
    assert "force reason: book revised after a pricing correction" in "\n".join(result.lines())


def test_push_nav_refuses_a_mainnet_chain_id(fixture_result: Any, oracle_key: SigningKey) -> None:
    client = FakeClient(make_state(chain_id=8453))
    with pytest.raises(OracleError, match="Base mainnet"):
        push_nav(client, fixture_result.documents.nav, oracle_key)
    assert client.sent == []


def test_push_result_lines_are_printable(fixture_result: Any) -> None:
    result = PushResult(
        sent=False,
        decision=decide(make_state(), make_update()),
        update=make_update(),
        state=make_state(),
    )
    text = "\n".join(result.lines())
    assert "as_of 2026-09-15" in text
    assert "reportedAUM 994658000" in text
    assert "navUpdatedAt 2026-09-15" in text


# --------------------------------------------------------------------------- CLI, no chain
def test_cli_push_rejects_force_without_reason(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["push", "--force", "--rpc", ANVIL_RPC, "--token", "0x" + "ab" * 20]) == 2
    err = capsys.readouterr().err
    assert "--force requires --reason" in err
    assert "DEFAULT_ADMIN_ROLE" in err


def test_cli_push_needs_an_rpc_and_a_token(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr("nav_engine.cli.load_dotenv", lambda *a, **k: False)
    monkeypatch.delenv("NAV_ENGINE_RPC_URL", raising=False)
    monkeypatch.delenv("NAV_ENGINE_TOKEN_ADDRESS", raising=False)
    monkeypatch.delenv("NAV_ENGINE_DEPLOYMENT", raising=False)
    assert main(["push"]) == 2
    assert "no RPC endpoint" in capsys.readouterr().err
    assert main(["push", "--rpc", ANVIL_RPC]) == 2
    assert "no HBToken address" in capsys.readouterr().err


def test_push_target_resolution_prefers_explicit_flags(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A command that sends a transaction must leave no doubt about which contract it addressed."""
    from argparse import Namespace

    from nav_engine.cli import _resolve_push_target

    flag_file = tmp_path / "flag.json"
    flag_file.write_text(json.dumps({"chainId": 31337, "addresses": {"HBToken": "0x" + "11" * 20}}))
    env_file = tmp_path / "env.json"
    env_file.write_text(json.dumps({"chainId": 31337, "addresses": {"HBToken": "0x" + "22" * 20}}))
    monkeypatch.setattr("nav_engine.cli.load_dotenv", lambda *a, **k: False)
    monkeypatch.setenv("NAV_ENGINE_DEPLOYMENT", str(env_file))
    monkeypatch.setenv("NAV_ENGINE_TOKEN_ADDRESS", "0x" + "33" * 20)
    monkeypatch.setenv("NAV_ENGINE_RPC_URL", ANVIL_RPC)

    def target(**overrides: Any) -> tuple[str, str]:
        args = Namespace(rpc=None, token=None, deployment=None)
        for name, value in overrides.items():
            setattr(args, name, value)
        return _resolve_push_target(args)

    assert target(deployment=flag_file, token="0x" + "44" * 20)[1] == "0x" + "11" * 20
    assert target(token="0x" + "44" * 20)[1] == "0x" + "44" * 20
    assert target()[1] == "0x" + "22" * 20  # the environment's deployment file
    monkeypatch.delenv("NAV_ENGINE_DEPLOYMENT")
    assert target()[1] == "0x" + "33" * 20
    assert target()[0] == ANVIL_RPC
    assert target(rpc="http://127.0.0.1:9999")[0] == "http://127.0.0.1:9999"


def test_loading_a_missing_nav_json_is_a_readable_error(tmp_path: Path) -> None:
    with pytest.raises(DataError) as excinfo:
        load_nav_document(tmp_path / "nav.json")
    assert "nav-engine compute" in str(excinfo.value)


# =========================================================================== Anvil-backed
def _port_is_free(port: int) -> bool:
    with socket.socket() as probe:
        probe.settimeout(0.5)
        return probe.connect_ex(("127.0.0.1", port)) != 0


def _rpc_ready(url: str) -> bool:
    try:
        return Web3(Web3.HTTPProvider(url, request_kwargs={"timeout": 1})).is_connected()
    except Exception:
        return False


@pytest.fixture(scope="module")
def anvil() -> Iterator[str]:
    """A private Anvil on port 8546 whose genesis timestamp is the fixture's as-of day."""
    if shutil.which("anvil") is None or shutil.which("forge") is None:
        pytest.skip("anvil/forge not on PATH: install Foundry (foundryup) to run the chain tests")
    if not CONTRACTS_DIR.is_dir():
        pytest.skip(f"no contracts directory at {CONTRACTS_DIR}")
    if not _port_is_free(ANVIL_PORT):
        pytest.skip(f"port {ANVIL_PORT} is already in use; not touching another process's chain")
    process = subprocess.Popen(  # fixed argv, no shell
        [
            "anvil",
            "--port",
            str(ANVIL_PORT),
            "--timestamp",
            str(GENESIS_TIMESTAMP),
            "--silent",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline and not _rpc_ready(ANVIL_RPC):
            if process.poll() is not None:
                pytest.skip("anvil exited immediately; cannot run the chain-backed tests")
            time.sleep(0.2)
        if not _rpc_ready(ANVIL_RPC):
            pytest.skip(f"anvil did not answer on {ANVIL_RPC} within 30s")
        yield ANVIL_RPC
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:  # pragma: no cover - only on a wedged process
            process.kill()


def _forge_create(contract: str, rpc: str, *args: str) -> str:
    completed = subprocess.run(  # fixed argv, no shell
        [
            "forge",
            "create",
            contract,
            "--rpc-url",
            rpc,
            "--private-key",
            ADMIN_KEY,
            "--broadcast",
            "--json",
            *(("--constructor-args", *args) if args else ()),
        ],
        cwd=CONTRACTS_DIR,
        capture_output=True,
        text=True,
        timeout=600,
    )
    if completed.returncode != 0:
        pytest.skip(f"forge create {contract} failed: {completed.stderr.strip()[:400]}")
    payload = completed.stdout[completed.stdout.index("{") :]
    return str(json.loads(payload)["deployedTo"])


def _send(w3: Web3, function: Any, key: SigningKey) -> None:
    transaction = function.build_transaction(
        {
            "from": key.address,
            "nonce": w3.eth.get_transaction_count(key.address),
            "chainId": int(w3.eth.chain_id),
        }
    )
    receipt = w3.eth.wait_for_transaction_receipt(
        w3.eth.send_raw_transaction(key.sign_transaction(transaction)), timeout=60
    )
    assert int(receipt["status"]) == 1


@pytest.fixture(scope="module")
def deployment(anvil: str) -> dict[str, Any]:
    """MockUSDC + IdentityRegistry + HBToken, with ORACLE_ROLE granted and 1000 hbTRS minted."""
    admin = load_signing_key("ADMIN_KEY", {"ADMIN_KEY": ADMIN_KEY})
    oracle = load_signing_key(ENV_ORACLE_KEY, {ENV_ORACLE_KEY: ORACLE_KEY})
    usdc = _forge_create("src/MockUSDC.sol:MockUSDC", anvil)
    registry = _forge_create(
        "src/IdentityRegistry.sol:IdentityRegistry", anvil, admin.address, BLOCKED_COUNTRIES
    )
    token_address = _forge_create("src/HBToken.sol:HBToken", anvil, registry, usdc, admin.address)

    w3 = Web3(Web3.HTTPProvider(anvil))
    token = w3.eth.contract(address=Web3.to_checksum_address(token_address), abi=TOKEN_TEST_ABI)
    registry_contract = w3.eth.contract(
        address=Web3.to_checksum_address(registry), abi=REGISTRY_TEST_ABI
    )
    _send(
        w3, token.functions.grantRole(token.functions.ORACLE_ROLE().call(), oracle.address), admin
    )
    _send(w3, token.functions.grantRole(token.functions.ISSUER_ROLE().call(), admin.address), admin)
    _send(
        w3,
        registry_contract.functions.grantRole(
            registry_contract.functions.REGISTRAR_ROLE().call(), admin.address
        ),
        admin,
    )
    _send(w3, registry_contract.functions.addVerified(admin.address, UAE, PROFESSIONAL), admin)
    _send(w3, token.functions.mint(admin.address, MINT_TOKENS_WEI), admin)
    assert int(token.functions.totalSupply().call()) == MINT_TOKENS_WEI
    return {
        "rpc": anvil,
        "token": token_address,
        "registry": registry,
        "usdc": usdc,
        "contract": token,
        "admin": admin,
        "oracle": oracle,
    }


@pytest.fixture(scope="module")
def nav_json(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A real engine run for the chain's genesis day, written to disk exactly as the CLI writes it."""
    out_dir = tmp_path_factory.mktemp("published")
    run_compute(
        ComputeOptions(
            as_of=FIXTURE_AS_OF,
            data_dir=DATA_DIR,
            out_dir=out_dir,
            distributions_path=FIXTURES_DIR / "distributions_fixture.csv",
            reader=None,
            cache_path=out_dir / "chain_cache.json",
            generated_at=datetime(2026, 9, 15, 6, tzinfo=UTC),
        )
    )
    return out_dir / "nav.json"


def test_anvil_cli_dry_run_reads_the_chain_and_sends_nothing(
    deployment: dict[str, Any],
    nav_json: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv(ENV_ORACLE_KEY, ORACLE_KEY)
    code = main(
        [
            "push",
            "--nav",
            str(nav_json),
            "--rpc",
            deployment["rpc"],
            "--token",
            deployment["token"],
            "--dry-run",
        ]
    )
    captured = capsys.readouterr()
    assert code == 0
    assert "within the rail" in captured.out
    assert "dry-run" in captured.err
    assert int(deployment["contract"].functions.nav().call()) == 1_000_000


def test_anvil_push_sets_the_nav_json_integer_on_chain(
    deployment: dict[str, Any], nav_json: Path
) -> None:
    """The Phase 5 checkpoint: on-chain nav() equals nav.json's nav_usdc_6dec exactly."""
    document = load_nav_document(nav_json)
    result = push_nav(
        OracleClient(deployment["rpc"], deployment["token"]), document, deployment["oracle"]
    )
    assert result.sent
    assert result.tx_hash is not None and result.tx_hash.startswith("0x")
    assert len(result.tx_hash) == 66

    token = deployment["contract"]
    assert int(token.functions.nav().call()) == document.nav.usdc_6dec == FIXTURE_NAV_6DEC
    assert int(token.functions.reportedAUM().call()) == reported_aum_for(
        document.nav.usdc_6dec, MINT_TOKENS_WEI
    )
    assert int(token.functions.navUpdatedAt().call()) >= GENESIS_TIMESTAMP


def test_anvil_second_push_for_the_same_as_of_is_a_no_op(
    deployment: dict[str, Any], nav_json: Path
) -> None:
    before = int(deployment["contract"].functions.navUpdatedAt().call())
    result = push_nav(
        OracleClient(deployment["rpc"], deployment["token"]),
        load_nav_document(nav_json),
        deployment["oracle"],
    )
    assert not result.sent
    assert result.decision.already_pushed
    assert result.tx_hash is None
    assert int(deployment["contract"].functions.navUpdatedAt().call()) == before


def _nav_json_with(nav_json: Path, tmp_path: Path, usdc_6dec: int) -> Path:
    document = load_output_document(nav_json, NavDocument)
    document.nav.usdc_6dec = usdc_6dec
    target = tmp_path / "nav.json"
    target.write_text(document.model_dump_json(indent=2) + "\n", encoding="utf-8")
    return target


def test_anvil_rail_breach_is_refused_before_any_gas_is_spent(
    deployment: dict[str, Any], nav_json: Path, tmp_path: Path
) -> None:
    token = deployment["contract"]
    before_nav = int(token.functions.nav().call())
    before_block = int(Web3(Web3.HTTPProvider(deployment["rpc"])).eth.block_number)
    beyond = _nav_json_with(nav_json, tmp_path, 1_200_000)

    with pytest.raises(OracleError) as excinfo:
        push_nav(
            OracleClient(deployment["rpc"], deployment["token"]),
            load_nav_document(beyond),
            deployment["oracle"],
        )
    assert "exceeds the contract's rail" in str(excinfo.value)
    assert int(token.functions.nav().call()) == before_nav
    assert int(Web3(Web3.HTTPProvider(deployment["rpc"])).eth.block_number) == before_block


def test_anvil_force_without_the_admin_role_is_refused(
    deployment: dict[str, Any], nav_json: Path, tmp_path: Path
) -> None:
    beyond = _nav_json_with(nav_json, tmp_path, 1_020_000)
    with pytest.raises(OracleError) as excinfo:
        push_nav(
            OracleClient(deployment["rpc"], deployment["token"]),
            load_nav_document(beyond),
            deployment["oracle"],  # ORACLE_ROLE only
            force=True,
            reason="testing the admin gate",
        )
    assert "does not hold DEFAULT_ADMIN_ROLE" in str(excinfo.value)
    assert int(deployment["contract"].functions.nav().call()) == FIXTURE_NAV_6DEC


def test_anvil_admin_force_overrides_the_rail(
    deployment: dict[str, Any], nav_json: Path, tmp_path: Path
) -> None:
    beyond = _nav_json_with(nav_json, tmp_path, 1_200_000)
    result = push_nav(
        OracleClient(deployment["rpc"], deployment["token"]),
        load_nav_document(beyond),
        deployment["admin"],  # DEFAULT_ADMIN_ROLE
        force=True,
        reason="simulated pricing correction outside the rail",
    )
    assert result.sent
    assert "simulated pricing correction" in "\n".join(result.lines())
    assert int(deployment["contract"].functions.nav().call()) == 1_200_000
    assert int(deployment["contract"].functions.railAnchorNav().call()) == 1_200_000
