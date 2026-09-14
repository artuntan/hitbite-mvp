"""Command-line entry point for the NAV engine: ``nav-engine compute`` and ``nav-engine schemas``."""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Sequence
from datetime import UTC, date, datetime
from pathlib import Path

from dotenv import load_dotenv

from nav_engine import __version__
from nav_engine.chain import ChainReader, Web3ChainReader
from nav_engine.errors import DataError, EngineError
from nav_engine.money import fmt_fixed
from nav_engine.outputs import parse_generated_at
from nav_engine.pipeline import ComputeOptions, run_compute
from nav_engine.schemas import export_json_schemas

PACKAGE_DIR = Path(__file__).resolve().parent
DEFAULT_DATA_DIR = PACKAGE_DIR.parent / "data"
DEFAULT_OUT_DIR = PACKAGE_DIR.parents[1] / "web" / "public" / "data"

ENV_RPC = "NAV_ENGINE_RPC_URL"
ENV_TOKEN = "NAV_ENGINE_TOKEN_ADDRESS"
ENV_CHAIN_ID = "NAV_ENGINE_CHAIN_ID"
ENV_DEPLOYMENT = "NAV_ENGINE_DEPLOYMENT"


def _parse_date(text: str) -> date:
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"expected YYYY-MM-DD, got {text!r}") from exc


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="nav-engine",
        description="HitBite NAV, attestation and oracle engine (testnet, simulated data).",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command", metavar="COMMAND")

    compute = sub.add_parser(
        "compute",
        help="compute the NAV path and write nav/holdings/nav_history/scenarios JSON",
        description=(
            "Run the day-by-day NAV from inception to --as-of and write the JSON documents the "
            "web app reads. All inputs are simulated (testnet)."
        ),
    )
    compute.add_argument(
        "--as-of", type=_parse_date, default=None, help="YYYY-MM-DD (default: today UTC)"
    )
    compute.add_argument(
        "--data-dir", type=Path, default=DEFAULT_DATA_DIR, help=f"default: {DEFAULT_DATA_DIR}"
    )
    compute.add_argument(
        "--out", type=Path, default=DEFAULT_OUT_DIR, help=f"default: {DEFAULT_OUT_DIR}"
    )
    compute.add_argument("--rpc", default=None, help=f"JSON-RPC URL (or ${ENV_RPC})")
    compute.add_argument("--token", default=None, help=f"HBToken address (or ${ENV_TOKEN})")
    compute.add_argument(
        "--deployment",
        type=Path,
        default=None,
        help=f"contracts/deployments/<chain>.json with addresses.HBToken (or ${ENV_DEPLOYMENT})",
    )
    compute.add_argument(
        "--chain-id", type=int, default=None, help=f"chain id (or ${ENV_CHAIN_ID})"
    )
    compute.add_argument(
        "--no-chain", action="store_true", help="skip RPC; use the cache if present"
    )
    compute.add_argument(
        "--distributions",
        type=Path,
        default=None,
        help="distributions CSV (default: data-dir/distributions.csv)",
    )
    compute.add_argument(
        "--from-block", type=int, default=0, help="first block to scan for CouponDistributed"
    )
    compute.add_argument(
        "--generated-at",
        default=None,
        help="ISO 8601 UTC timestamp to stamp outputs (reproducible runs)",
    )
    compute.add_argument(
        "--no-write", action="store_true", help="compute and print, do not write files"
    )

    schemas = sub.add_parser("schemas", help="write JSON schemas of the output documents")
    schemas.add_argument("--out", type=Path, required=True, help="directory for <name>.schema.json")
    return parser


def _read_deployment(path: Path) -> tuple[str, int | None]:
    if not path.is_file():
        raise DataError(f"deployment file not found: {path}")
    try:
        raw = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise DataError(f"{path}: not valid JSON ({exc})") from exc
    address = (raw.get("addresses") or {}).get("HBToken") if isinstance(raw, dict) else None
    if not isinstance(address, str) or not address:
        raise DataError(f"{path}: missing addresses.HBToken")
    chain_id = raw.get("chainId", raw.get("chain_id"))
    return address, int(chain_id) if chain_id is not None else None


def _chain_setup(
    args: argparse.Namespace,
) -> tuple[ChainReader | None, str | None, int | None, list[str]]:
    """Resolve reader, token address and chain id from flags, env and the deployment file."""
    notes: list[str] = []
    if args.no_chain:
        return None, None, args.chain_id, notes
    load_dotenv()
    rpc = args.rpc or os.environ.get(ENV_RPC)
    token = args.token or os.environ.get(ENV_TOKEN)
    chain_id = args.chain_id
    if chain_id is None and os.environ.get(ENV_CHAIN_ID):
        chain_id = int(os.environ[ENV_CHAIN_ID])
    deployment = args.deployment or (
        Path(os.environ[ENV_DEPLOYMENT]) if os.environ.get(ENV_DEPLOYMENT) else None
    )
    if deployment is not None:
        token, deployed_chain_id = _read_deployment(deployment)
        chain_id = chain_id if chain_id is not None else deployed_chain_id
    if not rpc or not token:
        missing = [n for n, v in (("--rpc", rpc), ("--token/--deployment", token)) if not v]
        notes.append(
            f"chain skipped: {', '.join(missing)} not provided (use --no-chain to silence)"
        )
        return None, token, chain_id, notes
    reader = Web3ChainReader(rpc, token)
    if chain_id is None:
        try:
            chain_id = reader.read_chain_id()
        except Exception as exc:  # the fallback path reports the failure
            notes.append(f"could not read chain id from RPC ({exc.__class__.__name__})")
    return reader, token, chain_id, notes


def _cmd_compute(args: argparse.Namespace) -> int:
    as_of = args.as_of or datetime.now(UTC).date()
    generated_at = parse_generated_at(args.generated_at) if args.generated_at else None
    reader, token, chain_id, notes = _chain_setup(args)
    result = run_compute(
        ComputeOptions(
            as_of=as_of,
            data_dir=args.data_dir,
            out_dir=None if args.no_write else args.out,
            distributions_path=args.distributions,
            reader=reader,
            chain_id=chain_id,
            token_address=token,
            from_block=args.from_block,
            generated_at=generated_at,
        )
    )
    for note in [*notes, *result.warnings]:
        print(f"warning: {note}", file=sys.stderr)
    nav = result.documents.nav
    print(
        f"as_of {result.as_of}  nav_per_token {nav.nav.per_token_usd} USD  usdc_6dec {nav.nav.usdc_6dec}"
    )
    units = fmt_fixed(result.path.reference_units, 10)
    print(
        f"nav_total {nav.nav.total_usd} USD  reference_units {units}  supply_source {nav.chain.supply_source}"
    )
    for name, target in result.written.items():
        print(f"wrote {name}: {target}")
    return 0


def _cmd_schemas(args: argparse.Namespace) -> int:
    for target in export_json_schemas(args.out):
        print(f"wrote {target}")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return 0
    try:
        if args.command == "compute":
            return _cmd_compute(args)
        if args.command == "schemas":
            return _cmd_schemas(args)
    except EngineError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    parser.error(f"unknown command {args.command!r}")
    return 2
