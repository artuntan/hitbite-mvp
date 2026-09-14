"""Push the computed NAV on chain: ``HBToken.setNAV(newNav, newReportedAUM, force)``.

BUILD_PROMPT 6.3, PLAN.md D5 / D22 / D27. The command reads ``nav.json`` - the document the web app
already shows - and sends its ``nav.usdc_6dec`` integer verbatim, so the number on the site, in the
JSON and on chain is one integer, never a re-rounded float.

Three things happen before a transaction is built, because each of them is a revert the operator
should never pay gas to discover:

* **Role.** ``setNAV(.., force=false)`` is ORACLE_ROLE and ``force=true`` is DEFAULT_ADMIN_ROLE. The
  signer's roles are read first and a missing role is reported by name.
* **Rail (D5, D27).** The contract compares the new NAV against ``railAnchorNav`` - the NAV at the
  start of the current 24 h window - not against the previous update, and reverts
  ``NavMoveExceedsRail`` beyond ``maxNavMoveBps``. Both values are read from the contract itself, so
  this check cannot drift from the deployed rail. When the window is about to roll, the move must
  clear both the current anchor and the post-roll anchor, since the operator cannot know which block
  will include the transaction.
* **Idempotency.** "Already pushed" means: the on-chain NAV is already exactly
  ``nav.json``'s integer *and* the last ``navUpdatedAt`` is on or after the document's ``as_of``
  (UTC date). A repeat run then prints what it found and exits 0 without sending. A *different*
  value is a revision and is pushed even on the same day - the rail still applies.

``--force`` is the contract's admin override. It requires an explicit ``--reason``, which is logged
with the transaction, and it bypasses the rail *and* the idempotency skip because an administrator
has asked for exactly that. It fails fast unless the signer holds DEFAULT_ADMIN_ROLE.

Testnet only: a known mainnet chain id is refused outright.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Final

from nav_engine.abi import HBTOKEN_MIN_ABI
from nav_engine.attest import load_output_document
from nav_engine.errors import EngineError
from nav_engine.keys import SigningKey
from nav_engine.money import TOKEN_UNIT, money_context
from nav_engine.schemas import NavDocument

MAX_BPS: Final = 10_000
"""Basis-point denominator, as in HBToken."""

MAX_INPUT: Final = 2**128 - 1
"""HBToken.MAX_INPUT (D28): every NAV and reported-AUM input must fit in uint128."""

NEAR_ROLL_MARGIN_SECONDS: Final = 120
"""Within this margin of the rail window rolling, the move must clear both anchors."""

RECEIPT_TIMEOUT_SECONDS: Final = 180

GAS_LIMIT_HEADROOM: Final = 1.25
"""Multiplier applied to ``eth_estimateGas`` so a warm/cold storage difference cannot strand a push."""

MAINNET_CHAIN_IDS: Final[dict[int, str]] = {
    1: "Ethereum",
    10: "OP Mainnet",
    56: "BNB Smart Chain",
    100: "Gnosis",
    137: "Polygon",
    324: "zkSync Era",
    8453: "Base",
    42161: "Arbitrum One",
    43114: "Avalanche C-Chain",
    59144: "Linea",
    534352: "Scroll",
}
"""Refused outright: this project is testnet-only (BUILD_PROMPT Section 2)."""

KNOWN_TESTNET_CHAIN_IDS: Final[dict[int, str]] = {
    31337: "Anvil",
    43113: "Avalanche Fuji",
    84532: "Base Sepolia",
    11155111: "Ethereum Sepolia",
}

ORACLE_EXTRA_ABI: Final[list[dict[str, Any]]] = [
    {
        "type": "function",
        "name": "setNAV",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "newNav", "type": "uint256"},
            {"name": "newReportedAUM", "type": "uint256"},
            {"name": "force", "type": "bool"},
        ],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "hasRole",
        "stateMutability": "view",
        "inputs": [{"name": "role", "type": "bytes32"}, {"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "bool"}],
    },
    *(
        {
            "type": "function",
            "name": name,
            "stateMutability": "view",
            "inputs": [],
            "outputs": [{"name": "", "type": solidity_type}],
        }
        for name, solidity_type in (
            ("reportedAUM", "uint256"),
            ("maxNavMoveBps", "uint256"),
            ("railAnchorNav", "uint256"),
            ("railWindowStart", "uint64"),
            ("navUpdatedAt", "uint64"),
            ("RAIL_WINDOW", "uint64"),
            ("ORACLE_ROLE", "bytes32"),
            ("DEFAULT_ADMIN_ROLE", "bytes32"),
        )
    ),
]

HBTOKEN_ORACLE_ABI: Final[list[dict[str, Any]]] = [*HBTOKEN_MIN_ABI, *ORACLE_EXTRA_ABI]
"""Read side (``nav_engine.abi``) plus the rail, role and write functions this module needs."""


class OracleError(EngineError):
    """The push cannot proceed: bad configuration, missing role, rail breach or a failed send."""


# --------------------------------------------------------------------------- values
@dataclass(frozen=True)
class NavUpdate:
    """What ``nav.json`` asks the chain to store."""

    as_of: date
    nav_usdc_6dec: int
    reported_aum_usdc_6dec: int
    source: str = "nav.json"


@dataclass(frozen=True)
class ChainState:
    """Everything ``setNAV`` depends on, read from the contract in one pass."""

    chain_id: int
    nav: int
    reported_aum: int
    total_supply_wei: int
    max_nav_move_bps: int
    rail_anchor_nav: int
    rail_window_start: int
    rail_window_seconds: int
    nav_updated_at: int
    block_timestamp: int

    @property
    def window_rolls_at(self) -> int:
        return self.rail_window_start + self.rail_window_seconds

    @property
    def nav_updated_date(self) -> date:
        return datetime.fromtimestamp(self.nav_updated_at, tz=UTC).date()


@dataclass(frozen=True)
class RailAnchorCheck:
    """One anchor the contract might use when the transaction is mined."""

    label: str
    anchor: int
    move_bps: Decimal
    ok: bool


@dataclass(frozen=True)
class RailCheck:
    ok: bool
    max_bps: int
    checks: tuple[RailAnchorCheck, ...]

    def detail(self) -> str:
        parts = [
            f"{c.label}: anchor {c.anchor} -> move {c.move_bps} bps "
            f"({'within' if c.ok else 'beyond'} {self.max_bps} bps)"
            for c in self.checks
        ]
        return "; ".join(parts)


@dataclass(frozen=True)
class PushDecision:
    """The pure verdict on a pending push; the sender only obeys it."""

    send: bool
    rail: RailCheck
    already_pushed: bool
    idempotency_note: str
    blocked_reason: str | None
    note: str


def reported_aum_for(nav_usdc_6dec: int, total_supply_wei: int) -> int:
    """``reportedAUM = nav x totalSupply`` in 6-decimal USDC (PLAN.md D19), floored like the chain."""
    return nav_usdc_6dec * total_supply_wei // int(TOKEN_UNIT)


def update_from_nav_document(document: NavDocument, total_supply_wei: int) -> NavUpdate:
    """Take the published NAV integer verbatim and price the reported AUM at push-time supply."""
    nav_usdc_6dec = document.nav.usdc_6dec
    if nav_usdc_6dec <= 0 or nav_usdc_6dec > MAX_INPUT:
        raise OracleError(
            f"nav.json carries nav.usdc_6dec = {nav_usdc_6dec}; HBToken rejects zero and anything "
            f"above MAX_INPUT ({MAX_INPUT})"
        )
    return NavUpdate(
        as_of=document.as_of,
        nav_usdc_6dec=nav_usdc_6dec,
        reported_aum_usdc_6dec=reported_aum_for(nav_usdc_6dec, total_supply_wei),
    )


# --------------------------------------------------------------------------- pure decisions
def _move_bps(anchor: int, new_nav: int) -> Decimal:
    with money_context():
        return (Decimal(abs(new_nav - anchor)) * Decimal(MAX_BPS) / Decimal(anchor)).quantize(
            Decimal("0.01")
        )


def evaluate_rail(
    state: ChainState, new_nav: int, margin_seconds: int = NEAR_ROLL_MARGIN_SECONDS
) -> RailCheck:
    """Replay HBToken's rail arithmetic against every anchor the mined block could use (D27).

    The contract rolls the window - ``railAnchorNav := nav`` - when ``block.timestamp`` has passed
    ``railWindowStart + RAIL_WINDOW``. The operator cannot know that timestamp in advance, so within
    ``margin_seconds`` of the roll both anchors must accept the move.
    """
    anchors: list[tuple[str, int]] = []
    if state.block_timestamp >= state.window_rolls_at:
        anchors.append(("rail window has rolled (anchor = current nav)", state.nav))
    else:
        anchors.append(("current rail window", state.rail_anchor_nav))
        if state.block_timestamp + margin_seconds >= state.window_rolls_at:
            anchors.append(
                (
                    f"rail window rolls within {margin_seconds}s (anchor = current nav)",
                    state.nav,
                )
            )
    checks = tuple(
        RailAnchorCheck(
            label=label,
            anchor=anchor,
            move_bps=_move_bps(anchor, new_nav),
            ok=abs(new_nav - anchor) * MAX_BPS <= anchor * state.max_nav_move_bps,
        )
        for label, anchor in anchors
    )
    return RailCheck(ok=all(c.ok for c in checks), max_bps=state.max_nav_move_bps, checks=checks)


def check_already_pushed(state: ChainState, update: NavUpdate) -> tuple[bool, str]:
    """The idempotency rule, stated once: same integer on chain, set on or after ``as_of``."""
    if state.nav != update.nav_usdc_6dec:
        return False, (
            f"on-chain nav is {state.nav}, {update.source} asks for {update.nav_usdc_6dec}: "
            "this is a new value, not a repeat"
        )
    if state.nav_updated_date < update.as_of:
        return False, (
            f"on-chain nav already equals {update.nav_usdc_6dec} but was last set on "
            f"{state.nav_updated_date} (UTC), before as_of {update.as_of}: pushing to date-stamp it"
        )
    return True, (
        f"on-chain nav already equals {update.nav_usdc_6dec} and was set on "
        f"{state.nav_updated_date} (UTC), on or after as_of {update.as_of}"
    )


def decide(state: ChainState, update: NavUpdate, force: bool = False) -> PushDecision:
    """Pure push/skip/refuse verdict: no RPC, no key, no side effects."""
    rail = evaluate_rail(state, update.nav_usdc_6dec)
    already, idempotency_note = check_already_pushed(state, update)
    if force:
        return PushDecision(
            send=True,
            rail=rail,
            already_pushed=already,
            idempotency_note=idempotency_note,
            blocked_reason=None,
            note=(
                "forced admin update: the rail and the once-per-day rule are both overridden "
                f"({rail.detail()})"
            ),
        )
    if already:
        return PushDecision(
            send=False,
            rail=rail,
            already_pushed=True,
            idempotency_note=idempotency_note,
            blocked_reason=None,
            note=f"nothing to do: {idempotency_note}",
        )
    if not rail.ok:
        wait_until = datetime.fromtimestamp(state.window_rolls_at, tz=UTC)
        return PushDecision(
            send=False,
            rail=rail,
            already_pushed=False,
            idempotency_note=idempotency_note,
            blocked_reason=(
                f"NAV move exceeds the contract's rail: {rail.detail()}. HBToken would revert "
                f"NavMoveExceedsRail and the gas would be lost. Either wait for the rail window to "
                f"roll at {wait_until:%Y-%m-%dT%H:%M:%SZ} and push the move in steps, or have an "
                f"administrator re-run with --force --reason '<why>' (DEFAULT_ADMIN_ROLE only)"
            ),
            note="refused before sending",
        )
    return PushDecision(
        send=True,
        rail=rail,
        already_pushed=False,
        idempotency_note=idempotency_note,
        blocked_reason=None,
        note=f"within the rail ({rail.detail()})",
    )


def check_testnet(chain_id: int) -> str | None:
    """Refuse mainnets by id; return a warning for a chain id we do not recognise."""
    if chain_id in MAINNET_CHAIN_IDS:
        raise OracleError(
            f"refusing to send: chain id {chain_id} is {MAINNET_CHAIN_IDS[chain_id]} mainnet. "
            "HitBite is a testnet-only demonstration (BUILD_PROMPT Section 2)."
        )
    if chain_id not in KNOWN_TESTNET_CHAIN_IDS:
        return (
            f"chain id {chain_id} is not one of the known testnets "
            f"({', '.join(f'{k} {v}' for k, v in KNOWN_TESTNET_CHAIN_IDS.items())}); "
            "continuing because it is not a known mainnet either"
        )
    return None


# --------------------------------------------------------------------------- chain client
class OracleClient:
    """Thin web3 v7 client for the oracle path: read the rail state, send ``setNAV``.

    Read-only NAV/supply access lives in :mod:`nav_engine.chain`; this client adds the rail, role
    and write calls, and is the only place in the engine that signs a transaction.
    """

    def __init__(self, rpc_url: str, token_address: str, timeout: float = 20.0) -> None:
        self.rpc_url = rpc_url
        self.token_address = token_address
        self.timeout = timeout
        self._w3: Any = None
        self._contract: Any = None

    def _connect(self) -> tuple[Any, Any]:
        if self._w3 is None:
            from web3 import Web3

            w3 = Web3(Web3.HTTPProvider(self.rpc_url, request_kwargs={"timeout": self.timeout}))
            if not w3.is_connected():
                raise OracleError(f"cannot reach the JSON-RPC endpoint at {self.rpc_url}")
            self._w3 = w3
            self._contract = w3.eth.contract(
                address=Web3.to_checksum_address(self.token_address), abi=HBTOKEN_ORACLE_ABI
            )
        return self._w3, self._contract

    def read_state(self) -> ChainState:
        w3, contract = self._connect()
        call = contract.functions
        try:
            latest_block = w3.eth.get_block("latest")
            return ChainState(
                chain_id=int(w3.eth.chain_id),
                nav=int(call.nav().call()),
                reported_aum=int(call.reportedAUM().call()),
                total_supply_wei=int(call.totalSupply().call()),
                max_nav_move_bps=int(call.maxNavMoveBps().call()),
                rail_anchor_nav=int(call.railAnchorNav().call()),
                rail_window_start=int(call.railWindowStart().call()),
                rail_window_seconds=int(call.RAIL_WINDOW().call()),
                nav_updated_at=int(call.navUpdatedAt().call()),
                block_timestamp=int(latest_block["timestamp"]),
            )
        except OracleError:
            raise
        except Exception as exc:
            raise OracleError(
                f"could not read HBToken state at {self.token_address} via {self.rpc_url} "
                f"({exc.__class__.__name__}: {exc}). Check --token/--deployment and --rpc."
            ) from exc

    def missing_role(self, account: str, force: bool) -> str | None:
        """Return the name of the role the signer lacks for this call, or ``None``."""
        _, contract = self._connect()
        try:
            role_name = "DEFAULT_ADMIN_ROLE" if force else "ORACLE_ROLE"
            role = getattr(contract.functions, role_name)().call()
            held = bool(contract.functions.hasRole(role, account).call())
        except Exception as exc:
            raise OracleError(
                f"could not read roles from {self.token_address} ({exc.__class__.__name__}: {exc})"
            ) from exc
        return None if held else role_name

    def send_set_nav(self, key: SigningKey, update: NavUpdate, force: bool) -> str:
        """Build, sign and broadcast ``setNAV``; returns the transaction hash."""
        w3, contract = self._connect()
        try:
            transaction = contract.functions.setNAV(
                update.nav_usdc_6dec, update.reported_aum_usdc_6dec, force
            ).build_transaction(
                {
                    "from": key.address,
                    "nonce": w3.eth.get_transaction_count(key.address),
                    "chainId": int(w3.eth.chain_id),
                }
            )
        except Exception as exc:
            raise OracleError(
                f"setNAV would revert or could not be estimated ({exc.__class__.__name__}: {exc}); "
                "nothing was sent"
            ) from exc
        # A small head-room over eth_estimateGas: the estimate is taken against the latest block and
        # the transaction executes against a later one, where warm/cold storage costs can differ.
        transaction["gas"] = int(int(transaction["gas"]) * GAS_LIMIT_HEADROOM)
        raw = key.sign_transaction(transaction)
        try:
            tx_hash = w3.eth.send_raw_transaction(raw)
        except Exception as exc:
            raise OracleError(
                f"broadcast failed ({exc.__class__.__name__}: {exc}); nothing was mined"
            ) from exc
        return "0x" + bytes(tx_hash).hex()

    def wait_for_success(self, tx_hash: str, timeout: float = RECEIPT_TIMEOUT_SECONDS) -> int:
        """Block until the receipt is available; raise unless it succeeded. Returns the block."""
        w3, _ = self._connect()
        try:
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=timeout)
        except Exception as exc:
            raise OracleError(
                f"no receipt for {tx_hash} within {timeout:.0f}s ({exc.__class__.__name__})"
            ) from exc
        if int(receipt["status"]) != 1:
            raise OracleError(
                f"setNAV transaction {tx_hash} reverted on chain: {self._revert_reason(tx_hash)}"
            )
        return int(receipt["blockNumber"])

    def _revert_reason(self, tx_hash: str) -> str:
        """Replay a failed transaction one block earlier to recover the revert data, best effort."""
        w3, _ = self._connect()
        try:
            transaction = w3.eth.get_transaction(tx_hash)
            replay = {
                "from": transaction["from"],
                "to": transaction["to"],
                "data": transaction["input"],
                "value": transaction.get("value", 0),
                "gas": transaction["gas"],
            }
            w3.eth.call(replay, int(transaction["blockNumber"]) - 1)
        except Exception as exc:
            return f"{exc.__class__.__name__}: {exc}"
        return "no revert data returned on replay (the transaction most likely ran out of gas)"


# --------------------------------------------------------------------------- orchestration
@dataclass(frozen=True)
class PushResult:
    """What happened, for the CLI to print and for tests to assert on."""

    sent: bool
    decision: PushDecision
    update: NavUpdate
    state: ChainState
    tx_hash: str | None = None
    block_number: int | None = None
    reason: str | None = None
    warnings: tuple[str, ...] = ()

    def lines(self) -> list[str]:
        out = [
            f"as_of {self.update.as_of}  nav {self.update.nav_usdc_6dec} usdc_6dec  "
            f"reportedAUM {self.update.reported_aum_usdc_6dec} usdc_6dec "
            f"(supply {self.state.total_supply_wei} wei)",
            f"on-chain before: nav {self.state.nav}, anchor {self.state.rail_anchor_nav}, "
            f"rail {self.state.max_nav_move_bps} bps, navUpdatedAt {self.state.nav_updated_date}",
            f"decision: {self.decision.note}",
        ]
        if self.reason is not None:
            out.append(f"force reason: {self.reason}")
        if self.tx_hash is not None:
            out.append(f"tx: {self.tx_hash} (block {self.block_number})")
        return out


def load_nav_document(path: Path) -> NavDocument:
    """Read the ``nav.json`` the engine published."""
    return load_output_document(path, NavDocument)


def push_nav(
    client: OracleClient,
    document: NavDocument,
    key: SigningKey,
    force: bool = False,
    reason: str | None = None,
    dry_run: bool = False,
) -> PushResult:
    """Read the chain, decide, and send ``setNAV`` only when the decision says to.

    Raises :class:`OracleError` for anything that would revert on chain (wrong chain, missing role,
    rail breach, ``--force`` without a reason).
    """
    if force and not (reason or "").strip():
        raise OracleError(
            "--force requires --reason: the override is admin-only and the reason is logged "
            "with the push"
        )
    state = client.read_state()
    warnings: list[str] = []
    unknown_chain = check_testnet(state.chain_id)
    if unknown_chain is not None:
        warnings.append(unknown_chain)

    update = update_from_nav_document(document, state.total_supply_wei)
    decision = decide(state, update, force=force)
    if decision.blocked_reason is not None:
        raise OracleError(decision.blocked_reason)
    if not decision.send or dry_run:
        if dry_run and decision.send:
            warnings.append("--dry-run: the transaction was not sent")
        return PushResult(
            sent=False,
            decision=decision,
            update=update,
            state=state,
            reason=reason if force else None,
            warnings=tuple(warnings),
        )

    missing = client.missing_role(key.address, force)
    if missing is not None:
        raise OracleError(
            f"{key.address} does not hold {missing} on HBToken at {client.token_address}; "
            f"nothing was sent. Grant it from the admin account, or use the right key."
        )
    tx_hash = client.send_set_nav(key, update, force)
    block_number = client.wait_for_success(tx_hash)
    return PushResult(
        sent=True,
        decision=decision,
        update=update,
        state=state,
        tx_hash=tx_hash,
        block_number=block_number,
        reason=reason if force else None,
        warnings=tuple(warnings),
    )
