"""Chain access: ``totalSupply``, ``nav()`` and ``CouponDistributed`` logs, with a cached fallback.

The compute path never fails because the chain is unreachable: ``read_chain_with_fallback`` returns
a ``ChainSnapshot`` whose ``supply_source`` is ``'rpc'``, ``'cache'`` or ``'none'`` and carries a
warning string that the outputs surface verbatim.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Protocol

from pydantic import BaseModel, ValidationError

from nav_engine.abi import HBTOKEN_MIN_ABI
from nav_engine.errors import ChainError
from nav_engine.money import TOKEN_UNIT, USDC_UNIT
from nav_engine.schemas import DistributionRow, SupplySource


@dataclass(frozen=True)
class CouponDistributedEvent:
    """Decoded ``CouponDistributed`` log plus block context."""

    distribution_id: int
    usdc_amount: int
    usdc_allocated: int
    coupon_index: int
    total_supply: int
    block_number: int
    block_timestamp: int
    tx_hash: str


class ChainReader(Protocol):
    def read_total_supply(self) -> int: ...

    def read_nav(self) -> int: ...

    def read_coupon_distributions(self, from_block: int = 0) -> list[CouponDistributedEvent]: ...


def _hex(value: Any) -> str:
    if isinstance(value, bytes | bytearray):
        return "0x" + bytes(value).hex()
    text = str(value)
    return text if text.startswith("0x") else "0x" + text


class Web3ChainReader:
    """web3 v7 HTTP reader using the embedded minimal ABI (``nav_engine.abi``)."""

    def __init__(self, rpc_url: str, token_address: str, timeout: float = 10.0) -> None:
        self.rpc_url = rpc_url
        self.token_address = token_address
        self.timeout = timeout
        self._w3: Any = None
        self._contract: Any = None

    def _connect(self) -> tuple[Any, Any]:
        if self._w3 is None:
            from web3 import Web3

            w3 = Web3(Web3.HTTPProvider(self.rpc_url, request_kwargs={"timeout": self.timeout}))
            address = Web3.to_checksum_address(self.token_address)
            self._w3 = w3
            self._contract = w3.eth.contract(address=address, abi=HBTOKEN_MIN_ABI)
        return self._w3, self._contract

    def read_chain_id(self) -> int:
        w3, _ = self._connect()
        return int(w3.eth.chain_id)

    def read_total_supply(self) -> int:
        _, contract = self._connect()
        return int(contract.functions.totalSupply().call())

    def read_nav(self) -> int:
        _, contract = self._connect()
        return int(contract.functions.nav().call())

    def read_decimals(self) -> int:
        _, contract = self._connect()
        return int(contract.functions.decimals().call())

    def read_coupon_distributions(self, from_block: int = 0) -> list[CouponDistributedEvent]:
        w3, contract = self._connect()
        logs = contract.events.CouponDistributed.get_logs(from_block=from_block, to_block="latest")
        timestamps: dict[int, int] = {}
        events: list[CouponDistributedEvent] = []
        for log in logs:
            block_number = int(log["blockNumber"])
            if block_number not in timestamps:
                timestamps[block_number] = int(w3.eth.get_block(block_number)["timestamp"])
            args = log["args"]
            events.append(
                CouponDistributedEvent(
                    distribution_id=int(args["distributionId"]),
                    usdc_amount=int(args["usdcAmount"]),
                    usdc_allocated=int(args["usdcAllocated"]),
                    coupon_index=int(args["couponIndex"]),
                    total_supply=int(args["totalSupply"]),
                    block_number=block_number,
                    block_timestamp=timestamps[block_number],
                    tx_hash=_hex(log["transactionHash"]),
                )
            )
        return sorted(events, key=lambda e: (e.block_number, e.distribution_id))


class FakeChainReader:
    """In-memory reader for tests. ``fail_with`` makes every read raise."""

    def __init__(
        self,
        total_supply: int = 0,
        nav: int = 1_000_000,
        events: Sequence[CouponDistributedEvent] = (),
        fail_with: Exception | None = None,
        chain_id: int = 31337,
    ) -> None:
        self.total_supply = total_supply
        self.nav = nav
        self.events = list(events)
        self.fail_with = fail_with
        self.chain_id = chain_id
        self.calls: list[str] = []

    def _maybe_fail(self, name: str) -> None:
        self.calls.append(name)
        if self.fail_with is not None:
            raise self.fail_with

    def read_chain_id(self) -> int:
        self._maybe_fail("chain_id")
        return self.chain_id

    def read_total_supply(self) -> int:
        self._maybe_fail("totalSupply")
        return self.total_supply

    def read_nav(self) -> int:
        self._maybe_fail("nav")
        return self.nav

    def read_coupon_distributions(self, from_block: int = 0) -> list[CouponDistributedEvent]:
        self._maybe_fail("CouponDistributed")
        return [e for e in self.events if e.block_number >= from_block]


def per_token_usdc_6dec(usdc_amount: int, total_supply: int) -> int:
    """The contract's integer floor: ``usdcAmount * 1e18 // totalSupply`` (USDC 6-dec per token)."""
    if total_supply <= 0:
        raise ChainError("CouponDistributed with zero totalSupply cannot be converted")
    return usdc_amount * 10**18 // total_supply


def event_to_distribution(event: CouponDistributedEvent) -> DistributionRow:
    """Convert a log to a distribution record, replicating the contract's integer maths exactly."""
    per_token = per_token_usdc_6dec(event.usdc_amount, event.total_supply)
    when = datetime.fromtimestamp(event.block_timestamp, tz=UTC).date()
    return DistributionRow(
        date=when,
        distribution_id=event.distribution_id,
        usdc_per_token=Decimal(per_token) / USDC_UNIT,
        usdc_amount=Decimal(event.usdc_amount) / USDC_UNIT,
        total_supply_tokens=Decimal(event.total_supply) / TOKEN_UNIT,
        tx_hash=event.tx_hash,
        source="chain",
    )


class ChainCache(BaseModel):
    """``data/chain_cache.json``: last successful RPC read."""

    chain_id: int | None = None
    token_address: str | None = None
    total_supply_wei: str
    onchain_nav_usdc_6dec: int | None = None
    cached_at: str
    note: str = "Cached on-chain values from the last successful RPC read (testnet, simulated)."


@dataclass(frozen=True)
class ChainSnapshot:
    chain_id: int | None
    token_address: str | None
    total_supply_wei: int | None
    onchain_nav_usdc_6dec: int | None
    supply_source: SupplySource
    warning: str | None
    distributions: list[DistributionRow] = field(default_factory=list)
    cached_at: str | None = None

    @property
    def total_supply_tokens(self) -> Decimal | None:
        if self.total_supply_wei is None:
            return None
        return Decimal(self.total_supply_wei) / TOKEN_UNIT


def load_chain_cache(path: Path) -> tuple[ChainCache | None, str | None]:
    """Return (cache, problem). A missing or malformed file yields ``(None, reason)``."""
    if not path.is_file():
        return None, f"no cache file at {path}"
    try:
        return ChainCache.model_validate_json(path.read_text()), None
    except (ValidationError, ValueError) as exc:
        return None, f"cache file {path} is unreadable ({exc.__class__.__name__})"


def save_chain_cache(path: Path, snapshot: ChainSnapshot, now: datetime | None = None) -> None:
    if snapshot.total_supply_wei is None:
        return
    stamp = (now or datetime.now(UTC)).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    cache = ChainCache(
        chain_id=snapshot.chain_id,
        token_address=snapshot.token_address,
        total_supply_wei=str(snapshot.total_supply_wei),
        onchain_nav_usdc_6dec=snapshot.onchain_nav_usdc_6dec,
        cached_at=stamp,
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(cache.model_dump_json(indent=2) + "\n")


def _same_address(a: str | None, b: str | None) -> bool:
    return a is None or b is None or a.lower() == b.lower()


def read_chain_with_fallback(
    reader: ChainReader | None,
    cache_path: Path,
    *,
    chain_id: int | None = None,
    token_address: str | None = None,
    from_block: int = 0,
    now: datetime | None = None,
) -> ChainSnapshot:
    """Read supply, NAV and distributions; fall back to the cache (or nothing) with a warning."""
    if reader is None:
        reason = "chain not configured (no RPC/token or --no-chain)"
    else:
        try:
            supply = reader.read_total_supply()
            nav = reader.read_nav()
            events = reader.read_coupon_distributions(from_block)
            snapshot = ChainSnapshot(
                chain_id=chain_id,
                token_address=token_address,
                total_supply_wei=supply,
                onchain_nav_usdc_6dec=nav,
                supply_source="rpc",
                warning=None,
                distributions=[event_to_distribution(e) for e in events],
            )
            save_chain_cache(cache_path, snapshot, now)
            return snapshot
        except Exception as exc:  # any RPC failure falls back to the cache, by design
            reason = f"RPC read failed ({exc.__class__.__name__}: {exc})"

    cache, problem = load_chain_cache(cache_path)
    if cache is not None and _same_address(token_address, cache.token_address):
        return ChainSnapshot(
            chain_id=chain_id if chain_id is not None else cache.chain_id,
            token_address=token_address or cache.token_address,
            total_supply_wei=int(cache.total_supply_wei),
            onchain_nav_usdc_6dec=cache.onchain_nav_usdc_6dec,
            supply_source="cache",
            warning=(
                f"{reason}; using cached totalSupply from {cache.cached_at}. "
                "On-chain figures may be stale."
            ),
            cached_at=cache.cached_at,
        )
    if cache is not None:
        problem = f"cache at {cache_path} is for token {cache.token_address}, not {token_address}"
    return ChainSnapshot(
        chain_id=chain_id,
        token_address=token_address,
        total_supply_wei=None,
        onchain_nav_usdc_6dec=None,
        supply_source="none",
        warning=(
            f"{reason}; {problem}. Reported AUM and supply-scaled holdings are null; "
            "reference-book NAV is unaffected."
        ),
    )
