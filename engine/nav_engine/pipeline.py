"""One-call orchestration of a NAV compute: load, run the path, read the chain, build outputs."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

import yaml
from pydantic import ValidationError

from nav_engine.chain import ChainReader, ChainSnapshot, read_chain_with_fallback
from nav_engine.distributions import load_distributions, merge_distributions, write_distributions
from nav_engine.errors import DataError
from nav_engine.nav import DistributionYield, NavPath, compute_nav_path, distribution_yield
from nav_engine.outputs import (
    OUTPUT_FILENAMES,
    OutputDocuments,
    build_documents,
    format_generated_at,
    load_existing_history,
    write_documents,
)
from nav_engine.portfolio import PriceTable, load_portfolio, load_prices
from nav_engine.scenarios import ScenarioSet, run_scenarios
from nav_engine.schemas import EngineConfig, Portfolio

CHAIN_CACHE_FILENAME = "chain_cache.json"


def load_config(path: Path) -> EngineConfig:
    if not path.is_file():
        raise DataError(f"config file not found: {path}")
    try:
        raw = yaml.safe_load(path.read_text())
    except yaml.YAMLError as exc:
        raise DataError(f"{path}: not valid YAML ({exc})") from exc
    if not isinstance(raw, dict):
        raise DataError(f"{path}: expected a mapping at the top level")
    try:
        return EngineConfig.model_validate(raw)
    except ValidationError as exc:
        detail = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())
        raise DataError(f"{path}: invalid config ({detail})") from exc


@dataclass
class ComputeOptions:
    as_of: date
    data_dir: Path
    out_dir: Path | None = None
    """Where to write the JSON documents; ``None`` computes without writing."""
    distributions_path: Path | None = None
    reader: ChainReader | None = None
    chain_id: int | None = None
    token_address: str | None = None
    from_block: int = 0
    generated_at: datetime | None = None
    cache_path: Path | None = None


@dataclass
class ComputeResult:
    as_of: date
    generated_at: str
    portfolio: Portfolio
    config: EngineConfig
    prices: PriceTable
    path: NavPath
    dist_yield: DistributionYield
    scenarios: ScenarioSet
    chain: ChainSnapshot
    documents: OutputDocuments
    written: dict[str, Path] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def run_compute(opts: ComputeOptions) -> ComputeResult:
    data_dir = opts.data_dir
    portfolio = load_portfolio(data_dir / "portfolio.json")
    prices = load_prices(data_dir / "prices.csv")
    config = load_config(data_dir / "config.yaml")
    dist_path = opts.distributions_path or (data_dir / "distributions.csv")
    distributions = load_distributions(dist_path, missing_ok=opts.distributions_path is None)

    warnings: list[str] = []
    chain = read_chain_with_fallback(
        opts.reader,
        opts.cache_path or (data_dir / CHAIN_CACHE_FILENAME),
        chain_id=opts.chain_id,
        token_address=opts.token_address,
        from_block=opts.from_block,
        now=opts.generated_at,
    )
    if chain.warning:
        warnings.append(chain.warning)
    if chain.distributions:
        distributions = merge_distributions(distributions, chain.distributions)
        write_distributions(dist_path, distributions)

    path = compute_nav_path(portfolio, prices, config, distributions, opts.as_of)
    for row in path.distributions_ignored:
        warnings.append(
            f"distribution {row.distribution_id} dated {row.date} is on or before inception "
            f"{portfolio.inception_date} and was ignored"
        )
    dist_yield = distribution_yield(path, config.distribution_yield.trailing_months)
    scenarios = run_scenarios(path, config.scenarios)

    generated_at = format_generated_at(opts.generated_at)
    existing_history = (
        load_existing_history(opts.out_dir / OUTPUT_FILENAMES["nav_history"])
        if opts.out_dir is not None
        else []
    )
    documents = build_documents(
        path, dist_yield, scenarios, chain, config, portfolio, generated_at, existing_history
    )
    written = write_documents(opts.out_dir, documents) if opts.out_dir is not None else {}
    return ComputeResult(
        as_of=opts.as_of,
        generated_at=generated_at,
        portfolio=portfolio,
        config=config,
        prices=prices,
        path=path,
        dist_yield=dist_yield,
        scenarios=scenarios,
        chain=chain,
        documents=documents,
        written=written,
        warnings=warnings,
    )
