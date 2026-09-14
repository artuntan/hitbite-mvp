"""Shared fixtures: paths and one session-wide fixture run of the engine (FIXTURE.md horizon)."""

from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

import pytest

from nav_engine.pipeline import ComputeOptions, ComputeResult, run_compute

ENGINE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ENGINE_DIR / "data"
FIXTURES_DIR = ENGINE_DIR / "tests" / "fixtures"
FIXTURE_AS_OF = date(2026, 9, 15)
FIXTURE_INCEPTION = date(2026, 9, 8)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


@pytest.fixture(scope="session")
def fixture_result(tmp_path_factory: pytest.TempPathFactory) -> ComputeResult:
    """The engine run the fixture ties out to: data/, fixture distributions, no chain, 2026-09-15."""
    cache = tmp_path_factory.mktemp("cache") / "chain_cache.json"
    return run_compute(
        ComputeOptions(
            as_of=FIXTURE_AS_OF,
            data_dir=DATA_DIR,
            out_dir=None,
            distributions_path=FIXTURES_DIR / "distributions_fixture.csv",
            reader=None,
            cache_path=cache,
        )
    )
