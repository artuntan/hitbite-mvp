import json
import shutil
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from nav_engine import __version__
from nav_engine.chain import CouponDistributedEvent, FakeChainReader
from nav_engine.distributions import load_distributions
from nav_engine.errors import DataError
from nav_engine.outputs import merge_history
from nav_engine.pipeline import ComputeOptions, ComputeResult, run_compute
from nav_engine.schemas import (
    HoldingsDocument,
    NavDocument,
    NavHistoryDocument,
    NavHistoryEntry,
    ScenariosDocument,
)
from tests.conftest import DATA_DIR, FIXTURE_AS_OF, FIXTURES_DIR

T1 = datetime(2026, 9, 15, 6, 0, 0, tzinfo=UTC)
T2 = datetime(2026, 9, 15, 7, 30, 0, tzinfo=UTC)
TOKEN = "0x" + "ab" * 20


def _run(
    out: Path, when: datetime, reader: FakeChainReader | None = None, data_dir: Path = DATA_DIR
) -> ComputeResult:
    return run_compute(
        ComputeOptions(
            as_of=FIXTURE_AS_OF,
            data_dir=data_dir,
            out_dir=out,
            distributions_path=FIXTURES_DIR / "distributions_fixture.csv"
            if data_dir == DATA_DIR
            else None,
            reader=reader,
            chain_id=31337 if reader else None,
            token_address=TOKEN if reader else None,
            generated_at=when,
            cache_path=out / "chain_cache.json",
        )
    )


def _load(out: Path) -> dict[str, Any]:
    return {
        p.stem: json.loads(p.read_text())
        for p in sorted(out.glob("*.json"))
        if p.stem != "chain_cache"
    }


def _strip(doc: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in doc.items() if k != "generated_at"}


def test_documents_are_written_and_validate(tmp_path: Path) -> None:
    result = _run(tmp_path, T1)
    assert set(result.written) == {"nav", "holdings", "nav_history", "scenarios"}
    nav = NavDocument.model_validate_json((tmp_path / "nav.json").read_text())
    holdings = HoldingsDocument.model_validate_json((tmp_path / "holdings.json").read_text())
    history = NavHistoryDocument.model_validate_json((tmp_path / "nav_history.json").read_text())
    scenarios = ScenariosDocument.model_validate_json((tmp_path / "scenarios.json").read_text())

    for doc in (nav, holdings, history, scenarios):
        assert doc.generated_at == "2026-09-15T06:00:00Z"
        assert doc.simulated is True
        assert doc.source_note.startswith(result.portfolio.source_note)
        assert f"nav-engine {__version__}" in doc.source_note

    raw = _load(tmp_path)
    assert raw["nav"]["nav"] == {
        "per_token_usd": "0.994658",
        "usdc_6dec": 994658,
        "total_usd": "1008341.99",
        "reference_units": "1013757.6666666667",
        "reported_aum_usd": None,
        "reported_aum_usdc_6dec": None,
    }
    assert raw["nav"]["chain"]["supply_source"] == "none"
    assert raw["nav"]["chain"]["warning"]
    assert raw["nav"]["portfolio"]["cash_usd"] == "4389.94"
    assert raw["nav"]["portfolio"]["fees_payable_usd"] == "203.28"
    assert raw["nav"]["portfolio"]["positions_count"] == 3
    assert raw["nav"]["distribution_yield"]["annualized_pct"] is None
    assert raw["nav"]["distribution_yield"]["window_days"] == 8
    assert raw["nav"]["fees"] == {"management_fee_pct_pa": 0.75, "fund_expenses_pct_pa": 0.3}
    assert raw["nav"]["comparison"]["tokenized_tbill_reference"]["illustrative"] is True

    assert raw["holdings"]["scaled_by"] is None
    assert [p["market_value_usd"] for p in raw["holdings"]["positions"]] == [
        "401253.33",
        "401754.44",
        "201147.56",
    ]
    assert all(
        p["illustrative"] is True and p["scaled_face_usd"] is None
        for p in raw["holdings"]["positions"]
    )
    assert raw["holdings"]["positions"][0]["accrued_usd"] == "933.33"
    assert raw["holdings"]["positions"][0]["dirty_price"] == "100.31333333"
    assert raw["holdings"]["positions"][0]["prev_coupon_date"] == "2026-09-01"
    assert sum(p["weight_pct"] for p in raw["holdings"]["positions"]) == pytest.approx(
        100.0, abs=1e-6
    )
    assert raw["holdings"]["nav_total_usd"] == "1008341.99"

    assert raw["nav_history"]["entries"][0]["date"] == "2026-09-08"
    assert len(raw["nav_history"]["entries"]) == 8
    assert raw["nav_history"]["entries"][-1]["usdc_6dec"] == 994658
    assert raw["nav_history"]["entries"][-1]["distributions_per_unit_cum"] == "0.008000"

    assert raw["scenarios"]["base"]["nav_total_usd"] == "1008341.99"
    assert [s["shift_bp"] for s in raw["scenarios"]["parallel"]] == [-200, -100, -50, 50, 100, 200]
    assert [s["shock_bp"] for s in raw["scenarios"]["cds"]] == [50.0, 100.0, 200.0]
    assert raw["scenarios"]["cds"][0]["beta"] == 1.0
    assert "1:1" in raw["scenarios"]["assumptions"]


def test_second_run_is_identical_except_generated_at(tmp_path: Path) -> None:
    _run(tmp_path, T1)
    first = _load(tmp_path)
    _run(tmp_path, T2)
    second = _load(tmp_path)
    assert set(first) == set(second) == {"nav", "holdings", "nav_history", "scenarios"}
    for name in first:
        assert first[name]["generated_at"] == "2026-09-15T06:00:00Z"
        assert second[name]["generated_at"] == "2026-09-15T07:30:00Z"
        assert _strip(first[name]) == _strip(second[name]), name


def test_nav_history_upserts_by_date_and_keeps_foreign_entries(tmp_path: Path) -> None:
    stale = NavHistoryEntry(
        date=date(2026, 9, 10),
        nav_per_token_usd=Decimal("9.999999"),
        usdc_6dec=9_999_999,
        nav_total_usd=Decimal("1"),
        weighted_ytm_pct=0.0,
        modified_duration=0.0,
        distributions_per_unit_cum=Decimal(0),
    )
    foreign = stale.model_copy(update={"date": date(2026, 9, 20), "usdc_6dec": 123})
    seed = NavHistoryDocument(
        generated_at="2026-09-01T00:00:00Z", source_note="seed", entries=[foreign, stale]
    )
    (tmp_path / "nav_history.json").write_text(seed.model_dump_json(indent=2))

    _run(tmp_path, T1)
    doc = NavHistoryDocument.model_validate_json((tmp_path / "nav_history.json").read_text())
    dates = [e.date for e in doc.entries]
    assert dates == sorted(dates)
    assert len(doc.entries) == 9
    by_date = {e.date: e for e in doc.entries}
    assert by_date[date(2026, 9, 10)].usdc_6dec == 998719  # regenerated, not the stale value
    assert by_date[date(2026, 9, 20)].usdc_6dec == 123  # untouched
    assert doc.source_note != "seed"


def test_merge_history_prefers_fresh_entries() -> None:
    old = NavHistoryEntry(
        date=date(2026, 9, 9),
        nav_per_token_usd=Decimal(1),
        usdc_6dec=1,
        nav_total_usd=Decimal(1),
        weighted_ytm_pct=0.0,
        modified_duration=0.0,
        distributions_per_unit_cum=Decimal(0),
    )
    new = old.model_copy(update={"usdc_6dec": 2})
    merged = merge_history([old], [new])
    assert [e.usdc_6dec for e in merged] == [2]


def test_invalid_existing_history_is_a_clear_error(tmp_path: Path) -> None:
    (tmp_path / "nav_history.json").write_text('{"entries": "nope"}')
    with pytest.raises(DataError, match="nav_history"):
        _run(tmp_path, T1)


def test_chain_supply_scales_reporting_and_upserts_distributions(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    shutil.copytree(DATA_DIR, data_dir, ignore=shutil.ignore_patterns("chain_cache.json"))
    out = tmp_path / "out"
    ts = int(datetime(2026, 9, 11, 12, 0, tzinfo=UTC).timestamp())
    event = CouponDistributedEvent(
        distribution_id=1,
        usdc_amount=8_000_000_000,
        usdc_allocated=8_000_000_000,
        coupon_index=8000,
        total_supply=1_000_000 * 10**18,
        block_number=7,
        block_timestamp=ts,
        tx_hash="0x" + "22" * 32,
    )
    reader = FakeChainReader(total_supply=2_500 * 10**18, nav=994_658, events=[event])

    result = _run(out, T1, reader=reader, data_dir=data_dir)
    # The chain distribution (0.008 per token on 2026-09-11) reproduces the fixture NAV path.
    assert result.documents.nav.nav.usdc_6dec == 994658
    raw = _load(out)
    chain = raw["nav"]["chain"]
    assert chain["supply_source"] == "rpc"
    assert chain["warning"] is None
    assert chain["chain_id"] == 31337
    assert chain["token_address"] == TOKEN
    assert chain["total_supply_tokens"] == "2500.000000000000000000"
    assert chain["total_supply_wei"] == str(2_500 * 10**18)
    assert chain["onchain_nav_usdc_6dec"] == 994658
    assert raw["nav"]["nav"]["reported_aum_usd"] == "2486.65"  # 0.994658 x 2500 tokens
    assert raw["nav"]["nav"]["reported_aum_usdc_6dec"] == 994658 * 2500
    assert raw["holdings"]["scaled_by"] == "0.0024660726"  # 2500 / reference_units
    assert raw["holdings"]["positions"][0]["scaled_face_usd"] == "986.43"

    rows = load_distributions(data_dir / "distributions.csv")
    assert len(rows) == 1
    assert rows[0].source == "chain"
    assert rows[0].usdc_per_token == Decimal("0.008")
    assert rows[0].tx_hash == "0x" + "22" * 32
    first_csv = (data_dir / "distributions.csv").read_text()
    assert "2026-09-11,1,8000.000000,1000000,0.008000,0x" in first_csv

    _run(out, T2, reader=reader, data_dir=data_dir)
    assert (data_dir / "distributions.csv").read_text() == first_csv
    assert json.loads((out / "chain_cache.json").read_text())["total_supply_wei"] == str(
        2_500 * 10**18
    )

    # RPC now fails: cached supply is used and the output says so.
    failing = FakeChainReader(fail_with=ConnectionError("rpc down"))
    result = _run(out, T2, reader=failing, data_dir=data_dir)
    assert result.documents.nav.chain.supply_source == "cache"
    assert result.documents.nav.chain.warning is not None
    assert "rpc down" in result.documents.nav.chain.warning
    assert result.documents.nav.nav.reported_aum_usd is not None
    assert result.documents.nav.nav.usdc_6dec == 994658
