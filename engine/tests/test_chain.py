import json
import os
import time
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import pytest

from nav_engine.abi import COUPON_DISTRIBUTED_SIGNATURE, HBTOKEN_MIN_ABI
from nav_engine.chain import (
    ChainCache,
    ChainSnapshot,
    CouponDistributedEvent,
    FakeChainReader,
    as_utc,
    describe_age,
    event_to_distribution,
    format_stamp,
    load_chain_cache,
    parse_stamp,
    per_token_usdc_6dec,
    read_chain_with_fallback,
)
from nav_engine.errors import ChainError
from nav_engine.money import MAX_UINT128, fmt_fixed
from nav_engine.outputs import format_generated_at

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


# ------------------------------------------------------- a good RPC read is never thrown away
def test_cache_write_failure_keeps_the_fresh_rpc_read(tmp_path: Path) -> None:
    """A write side effect must not invalidate values that were read successfully."""
    cache = tmp_path / "chain_cache.json"
    yesterday = FakeChainReader(total_supply=1_000 * 10**18, nav=1_000_000)
    read_chain_with_fallback(yesterday, cache, chain_id=31337, token_address=TOKEN)
    stale = cache.read_text()
    cache.chmod(0o400)
    try:
        fresh = FakeChainReader(total_supply=5_000 * 10**18, nav=1_004_000)
        snap = read_chain_with_fallback(fresh, cache, chain_id=31337, token_address=TOKEN)
    finally:
        cache.chmod(0o600)
    assert snap.supply_source == "rpc"
    assert snap.total_supply_wei == 5_000 * 10**18  # not the cached 1,000 tokens
    assert snap.onchain_nav_usdc_6dec == 1_004_000
    assert snap.warning is not None
    assert "could not be written" in snap.warning
    assert "RPC read failed" not in snap.warning  # the RPC answered; do not blame it
    assert cache.read_text() == stale  # the old cache is untouched, not corrupted


def test_cache_write_failure_without_any_cache_still_reports_rpc(tmp_path: Path) -> None:
    """The commoner shape: nothing cached yet and the path cannot be written at all."""
    cache = tmp_path / "chain_cache.json"
    cache.mkdir()  # a directory where the file should be: write_text raises IsADirectoryError
    reader = FakeChainReader(total_supply=7 * 10**18, nav=1_002_000)
    snap = read_chain_with_fallback(reader, cache, chain_id=31337, token_address=TOKEN)
    assert snap.supply_source == "rpc"
    assert snap.total_supply_wei == 7 * 10**18  # previously dropped to None ("no supply")
    assert snap.onchain_nav_usdc_6dec == 1_002_000
    assert snap.warning is not None
    assert "could not be written" in snap.warning


def test_successful_write_leaves_no_warning_and_records_the_stamp(tmp_path: Path) -> None:
    cache = tmp_path / "chain_cache.json"
    now = datetime(2026, 9, 15, 6, 0, tzinfo=UTC)
    snap = read_chain_with_fallback(
        FakeChainReader(total_supply=10**18), cache, token_address=TOKEN, now=now
    )
    assert snap.warning is None
    assert snap.cached_at == "2026-09-15T06:00:00Z"


# ------------------------------------------------------- the fallback cannot cross deployments
def test_cache_for_another_chain_is_not_used(tmp_path: Path) -> None:
    """A supply read from another chain would be published as this chain's, with no hint."""
    cache = tmp_path / "chain_cache.json"
    read_chain_with_fallback(
        FakeChainReader(total_supply=9 * 10**18), cache, chain_id=84532, token_address=TOKEN
    )
    snap = read_chain_with_fallback(
        FakeChainReader(fail_with=OSError("down")),
        cache,
        chain_id=31337,
        token_address=TOKEN,
    )
    assert snap.supply_source == "none"
    assert snap.total_supply_wei is None
    assert snap.warning is not None
    assert "is for chain 84532, not 31337" in snap.warning


def test_cache_with_unknown_chain_id_is_still_usable(tmp_path: Path) -> None:
    cache = tmp_path / "chain_cache.json"
    read_chain_with_fallback(FakeChainReader(total_supply=9 * 10**18), cache, token_address=TOKEN)
    snap = read_chain_with_fallback(
        FakeChainReader(fail_with=OSError("down")), cache, chain_id=31337, token_address=TOKEN
    )
    assert snap.supply_source == "cache"
    assert snap.total_supply_wei == 9 * 10**18


def test_fallback_warning_states_how_stale_the_cache_is(tmp_path: Path) -> None:
    """Whoever reads nav.json has to be able to see the age, not just that a cache was used."""
    cache = tmp_path / "chain_cache.json"
    read_chain_with_fallback(
        FakeChainReader(total_supply=10**18),
        cache,
        chain_id=31337,
        token_address=TOKEN,
        now=datetime(2026, 9, 11, 6, 0, tzinfo=UTC),
    )
    snap = read_chain_with_fallback(
        FakeChainReader(fail_with=ConnectionError("boom")),
        cache,
        chain_id=31337,
        token_address=TOKEN,
        now=datetime(2026, 9, 15, 6, 0, tzinfo=UTC),
    )
    assert snap.warning is not None
    assert "2026-09-11T06:00:00Z (4 days old)" in snap.warning
    assert snap.cached_at == "2026-09-11T06:00:00Z"


@pytest.mark.parametrize(
    ("cached_at", "expected"),
    [
        ("2026-09-15T05:30:00Z", "(30 minutes old)"),
        ("2026-09-15T01:00:00Z", "(5 hours old)"),
        ("2026-09-01T06:00:00Z", "(14 days old)"),
        ("2026-09-15T06:00:00Z", "(0 minutes old)"),
        ("2026-09-16T06:00:00Z", "(stamped in the future)"),
    ],
)
def test_describe_age(cached_at: str, expected: str) -> None:
    now = datetime(2026, 9, 15, 6, 0, tzinfo=UTC)
    assert describe_age(cached_at, now) == f"{cached_at} {expected}"


def test_describe_age_of_an_unparseable_stamp_is_the_stamp() -> None:
    assert describe_age("whenever", datetime(2026, 9, 15, 6, 0, tzinfo=UTC)) == "whenever"


# ------------------------------------------------------- timestamps are UTC, never local time
@contextmanager
def _timezone(name: str) -> Iterator[None]:
    previous = os.environ.get("TZ")
    os.environ["TZ"] = name
    time.tzset()
    try:
        yield
    finally:
        if previous is None:
            del os.environ["TZ"]
        else:
            os.environ["TZ"] = previous
        time.tzset()


@pytest.mark.parametrize("zone", ["Asia/Istanbul", "America/New_York", "UTC"])
def test_naive_generated_at_is_utc_in_the_cache_stamp(tmp_path: Path, zone: str) -> None:
    """A naive datetime means UTC engine-wide; reading it as local wall clock shifts the stamp."""
    naive = datetime(2026, 9, 15, 6, 0)
    with _timezone(zone):
        cache = tmp_path / f"chain_cache_{zone.replace('/', '_')}.json"
        snap = read_chain_with_fallback(
            FakeChainReader(total_supply=10**18), cache, token_address=TOKEN, now=naive
        )
        assert json.loads(cache.read_text())["cached_at"] == "2026-09-15T06:00:00Z"
        # The same value the rest of the engine stamps into nav.json.
        assert snap.cached_at == format_generated_at(naive)
        assert format_stamp(naive) == format_generated_at(naive)


@pytest.mark.parametrize("zone", ["Asia/Istanbul", "America/New_York"])
def test_cache_round_trip_preserves_the_instant(tmp_path: Path, zone: str) -> None:
    naive = datetime(2026, 9, 15, 6, 0)
    aware = datetime(2026, 9, 15, 6, 0, tzinfo=UTC)
    with _timezone(zone):
        for when in (naive, aware):
            cache = tmp_path / f"cache_{zone.replace('/', '_')}_{when.tzinfo}.json"
            read_chain_with_fallback(
                FakeChainReader(total_supply=10**18), cache, token_address=TOKEN, now=when
            )
            loaded, problem = load_chain_cache(cache)
            assert problem is None and loaded is not None
            assert parse_stamp(loaded.cached_at) == aware


def test_as_utc_normalises_naive_and_aware_values() -> None:
    with _timezone("Asia/Istanbul"):
        assert as_utc(datetime(2026, 9, 15, 6, 0)) == datetime(2026, 9, 15, 6, 0, tzinfo=UTC)
    other = timezone(timedelta(hours=-5))
    assert as_utc(datetime(2026, 9, 15, 1, 0, tzinfo=other)) == datetime(
        2026, 9, 15, 6, 0, tzinfo=UTC
    )
    assert as_utc().tzinfo is UTC


def test_parse_stamp_rejects_nonsense() -> None:
    assert parse_stamp("not-a-stamp") is None
    assert parse_stamp("2026-09-15T06:00:00Z") == datetime(2026, 9, 15, 6, 0, tzinfo=UTC)


# ------------------------------------------------------- big supplies survive the D28 bound
def test_uint128_supply_is_exact_and_serialisable() -> None:
    """D28 bounds mint at type(uint128).max; dividing by 1e18 at prec 28 loses the low wei."""
    snap = ChainSnapshot(
        chain_id=31337,
        token_address=TOKEN,
        total_supply_wei=MAX_UINT128,
        onchain_nav_usdc_6dec=1_000_000,
        supply_source="rpc",
        warning=None,
    )
    tokens = snap.total_supply_tokens
    assert tokens is not None
    assert fmt_fixed(tokens, 18) == "340282366920938463463.374607431768211455"
    assert tokens != Decimal(MAX_UINT128) / Decimal(10**18)


def test_large_event_amounts_keep_every_digit() -> None:
    row = event_to_distribution(
        _event(usdc_amount=MAX_UINT128, total_supply=MAX_UINT128, distribution_id=9)
    )
    assert fmt_fixed(row.usdc_amount, 6) == "340282366920938463463374607431768.211455"
    assert row.total_supply_tokens is not None
    assert fmt_fixed(row.total_supply_tokens, 18) == "340282366920938463463.374607431768211455"
    assert row.usdc_per_token == Decimal(10**18) / Decimal(10**6)
