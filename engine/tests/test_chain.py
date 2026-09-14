import json
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

import pytest

from nav_engine.abi import COUPON_DISTRIBUTED_SIGNATURE, HBTOKEN_MIN_ABI
from nav_engine.chain import (
    ChainCache,
    CouponDistributedEvent,
    FakeChainReader,
    event_to_distribution,
    load_chain_cache,
    per_token_usdc_6dec,
    read_chain_with_fallback,
)
from nav_engine.errors import ChainError

TOKEN = "0x" + "ab" * 20
TS = int(datetime(2026, 9, 11, 23, 59, 30, tzinfo=UTC).timestamp())


def _event(**overrides: object) -> CouponDistributedEvent:
    base = dict(
        distribution_id=1,
        usdc_amount=8_000_000_000,  # 8,000 USDC
        usdc_allocated=8_000_000_000,
        coupon_index=8000,
        total_supply=1_000_000 * 10**18,
        block_number=42,
        block_timestamp=TS,
        tx_hash="0x" + "11" * 32,
    )
    base.update(overrides)
    return CouponDistributedEvent(**base)  # type: ignore[arg-type]


def test_abi_signatures() -> None:
    names = {(e["type"], e["name"]) for e in HBTOKEN_MIN_ABI}
    assert names == {
        ("function", "totalSupply"),
        ("function", "nav"),
        ("function", "decimals"),
        ("event", "CouponDistributed"),
        ("event", "NAVUpdated"),
    }
    event = next(e for e in HBTOKEN_MIN_ABI if e["name"] == "CouponDistributed")
    assert [i["name"] for i in event["inputs"]] == [
        "distributionId",
        "usdcAmount",
        "usdcAllocated",
        "couponIndex",
        "totalSupply",
    ]
    assert event["inputs"][0]["indexed"] is True
    assert (
        COUPON_DISTRIBUTED_SIGNATURE == "CouponDistributed(uint256,uint256,uint256,uint256,uint256)"
    )


def test_event_to_distribution_matches_fixture_distribution() -> None:
    row = event_to_distribution(_event())
    assert row.date == date(2026, 9, 11)  # UTC date of the block timestamp
    assert row.distribution_id == 1
    assert row.usdc_per_token == Decimal("0.008")
    assert row.usdc_amount == Decimal("8000")
    assert row.total_supply_tokens == Decimal("1000000")
    assert row.tx_hash == "0x" + "11" * 32
    assert row.source == "chain"


@pytest.mark.parametrize(
    ("usdc_amount", "total_supply", "expected_6dec"),
    [
        (1_000_000, 3 * 10**18, 333_333),  # 1 USDC over 3 tokens: floor, not 333333.33
        (1, 3 * 10**18, 0),  # dust truncates to zero, exactly like the contract index
        (2_000_000, 3 * 10**18, 666_666),  # never rounds up
        (5_000_000, 7 * 10**17, 7_142_857),
    ],
)
def test_per_token_replicates_contract_integer_floor(
    usdc_amount: int, total_supply: int, expected_6dec: int
) -> None:
    assert per_token_usdc_6dec(usdc_amount, total_supply) == expected_6dec
    row = event_to_distribution(_event(usdc_amount=usdc_amount, total_supply=total_supply))
    assert row.usdc_per_token == Decimal(expected_6dec) / Decimal(10**6)
    naive = Decimal(usdc_amount) / Decimal(10**6) / (Decimal(total_supply) / Decimal(10**18))
    assert row.usdc_per_token <= naive


def test_zero_supply_event_is_rejected() -> None:
    with pytest.raises(ChainError):
        event_to_distribution(_event(total_supply=0))


def test_rpc_success_writes_cache(tmp_path: Path) -> None:
    cache = tmp_path / "chain_cache.json"
    reader = FakeChainReader(total_supply=1_000_000 * 10**18, nav=994_658, events=[_event()])
    now = datetime(2026, 9, 15, 6, 0, tzinfo=UTC)
    snap = read_chain_with_fallback(reader, cache, chain_id=31337, token_address=TOKEN, now=now)
    assert snap.supply_source == "rpc"
    assert snap.warning is None
    assert snap.total_supply_wei == 1_000_000 * 10**18
    assert snap.total_supply_tokens == Decimal("1000000")
    assert snap.onchain_nav_usdc_6dec == 994_658
    assert [r.distribution_id for r in snap.distributions] == [1]
    assert reader.calls == ["totalSupply", "nav", "CouponDistributed"]
    cached = json.loads(cache.read_text())
    assert cached["total_supply_wei"] == str(1_000_000 * 10**18)
    assert cached["onchain_nav_usdc_6dec"] == 994_658
    assert cached["token_address"] == TOKEN
    assert cached["cached_at"] == "2026-09-15T06:00:00Z"


def test_rpc_failure_falls_back_to_cache_with_warning(tmp_path: Path) -> None:
    cache = tmp_path / "chain_cache.json"
    ok = FakeChainReader(total_supply=5 * 10**18, nav=1_001_000)
    read_chain_with_fallback(ok, cache, chain_id=31337, token_address=TOKEN)
    failing = FakeChainReader(fail_with=ConnectionError("boom"))
    snap = read_chain_with_fallback(failing, cache, chain_id=31337, token_address=TOKEN)
    assert snap.supply_source == "cache"
    assert snap.total_supply_wei == 5 * 10**18
    assert snap.onchain_nav_usdc_6dec == 1_001_000
    assert snap.warning is not None
    assert "RPC read failed" in snap.warning
    assert "ConnectionError" in snap.warning
    assert "cached totalSupply" in snap.warning
    assert snap.distributions == []
    # The address check is case-insensitive.
    snap2 = read_chain_with_fallback(
        failing, cache, token_address=TOKEN.upper().replace("0X", "0x")
    )
    assert snap2.supply_source == "cache"


def test_rpc_failure_without_cache_is_none_with_warning(tmp_path: Path) -> None:
    failing = FakeChainReader(fail_with=TimeoutError("slow"))
    snap = read_chain_with_fallback(failing, tmp_path / "missing.json", token_address=TOKEN)
    assert snap.supply_source == "none"
    assert snap.total_supply_wei is None
    assert snap.total_supply_tokens is None
    assert snap.warning is not None
    assert "TimeoutError" in snap.warning
    assert "no cache file" in snap.warning


def test_unconfigured_reader_uses_cache_or_none(tmp_path: Path) -> None:
    cache = tmp_path / "chain_cache.json"
    snap = read_chain_with_fallback(None, cache)
    assert snap.supply_source == "none"
    assert snap.warning is not None
    assert "not configured" in snap.warning
    read_chain_with_fallback(
        FakeChainReader(total_supply=10**18), cache, chain_id=84532, token_address=TOKEN
    )
    snap = read_chain_with_fallback(None, cache)
    assert snap.supply_source == "cache"
    assert snap.chain_id == 84532
    assert snap.token_address == TOKEN
    assert snap.total_supply_wei == 10**18


def test_cache_for_another_token_is_not_used(tmp_path: Path) -> None:
    cache = tmp_path / "chain_cache.json"
    read_chain_with_fallback(FakeChainReader(total_supply=10**18), cache, token_address=TOKEN)
    other = "0x" + "cd" * 20
    snap = read_chain_with_fallback(
        FakeChainReader(fail_with=OSError()), cache, token_address=other
    )
    assert snap.supply_source == "none"
    assert snap.warning is not None
    assert "is for token" in snap.warning


def test_malformed_cache_is_reported_not_fatal(tmp_path: Path) -> None:
    cache = tmp_path / "chain_cache.json"
    cache.write_text("{not json")
    loaded, problem = load_chain_cache(cache)
    assert loaded is None
    assert problem is not None and "unreadable" in problem
    snap = read_chain_with_fallback(None, cache)
    assert snap.supply_source == "none"
    assert snap.warning is not None
    assert "unreadable" in snap.warning


def test_fake_reader_filters_events_by_from_block() -> None:
    reader = FakeChainReader(
        events=[_event(block_number=10), _event(distribution_id=2, block_number=20)]
    )
    assert [e.distribution_id for e in reader.read_coupon_distributions(from_block=15)] == [2]


def test_chain_cache_model_round_trip() -> None:
    cache = ChainCache(total_supply_wei="1", cached_at="2026-09-15T00:00:00Z")
    assert ChainCache.model_validate_json(cache.model_dump_json()) == cache
