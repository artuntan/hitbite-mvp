"""Command-line entry point: ``nav-engine compute | push | attest | schemas``."""

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
from nav_engine.attest import (
    attestation_summary,
    build_attestation,
    load_attestation,
    load_run_documents,
    verify_attestation,
    write_attestation,
)
from nav_engine.chain import ChainReader, Web3ChainReader
from nav_engine.errors import DataError, EngineError
from nav_engine.keys import load_attestor_key, load_oracle_key
from nav_engine.money import fmt_fixed
from nav_engine.outputs import parse_generated_at
from nav_engine.pipeline import ComputeOptions, run_compute
from nav_engine.push_nav import OracleClient, OracleError, load_nav_document, push_nav
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

    attest = sub.add_parser(
        "attest",
        help="sign attestation.json over the computed state (simulated attestor)",
        description=(
            "Build attestation.json from the nav.json and holdings.json of one engine run, sign "
            "the canonical JSON with ATTESTOR_PRIVATE_KEY (EIP-191 personal_sign) and publish the "
            "signature, address and public key beside it. Simulated attestor - an independent firm "
            "signs in production."
        ),
    )
    attest.add_argument(
        "--in",
        dest="in_dir",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help=f"directory holding nav.json and holdings.json (default: {DEFAULT_OUT_DIR})",
    )
    attest.add_argument(
        "--out", type=Path, default=None, help="directory for attestation.json (default: --in)"
    )
    attest.add_argument(
        "--generated-at",
        default=None,
        help="override the timestamp stamped and signed (default: the run's generated_at)",
    )
    attest.add_argument(
        "--verify",
        type=Path,
        default=None,
        metavar="PATH",
        help="verify an existing attestation.json and exit; needs no key",
    )

    push = sub.add_parser(
        "push",
        help="send the computed NAV on chain (HBToken.setNAV, ORACLE_PRIVATE_KEY)",
        description=(
            "Read nav.json and send its nav.usdc_6dec integer to HBToken.setNAV. The contract's own "
            "maxNavMoveBps and railAnchorNav are checked first, the signer's role is checked first, "
            "and a NAV already on chain for this as_of date is not pushed twice. Testnet only."
        ),
    )
    push.add_argument(
        "--nav",
        type=Path,
        default=DEFAULT_OUT_DIR / "nav.json",
        help=f"nav.json to push (default: {DEFAULT_OUT_DIR / 'nav.json'})",
    )
    push.add_argument("--rpc", default=None, help=f"JSON-RPC URL (or ${ENV_RPC})")
    push.add_argument("--token", default=None, help=f"HBToken address (or ${ENV_TOKEN})")
    push.add_argument(
        "--deployment",
        type=Path,
        default=None,
        help=f"contracts/deployments/<chain>.json with addresses.HBToken (or ${ENV_DEPLOYMENT})",
    )
    push.add_argument(
        "--force",
        action="store_true",
        help="admin override (DEFAULT_ADMIN_ROLE): bypass the rail and the once-per-day rule; requires --reason",
    )
    push.add_argument(
        "--reason", default=None, help="why the override is justified; logged with the push"
    )
    push.add_argument(
        "--dry-run", action="store_true", help="read the chain and print the decision, send nothing"
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


def _resolve_push_target(args: argparse.Namespace) -> tuple[str, str]:
    """RPC URL and HBToken address for ``push``.

    Explicit flags beat the environment, and ``--deployment`` beats ``--token``: a command that
    sends a transaction should never leave any doubt about which contract it addressed.
    """
    load_dotenv()
    rpc = args.rpc or os.environ.get(ENV_RPC)
    env_deployment = Path(os.environ[ENV_DEPLOYMENT]) if os.environ.get(ENV_DEPLOYMENT) else None
    token: str | None
    if args.deployment is not None:
        token, _ = _read_deployment(args.deployment)
    elif args.token:
        token = args.token
    elif env_deployment is not None:
        token, _ = _read_deployment(env_deployment)
    else:
        token = os.environ.get(ENV_TOKEN)
    if not rpc:
        raise DataError(f"no RPC endpoint: pass --rpc or set ${ENV_RPC}")
    if not token:
        raise DataError(
            f"no HBToken address: pass --token, --deployment, ${ENV_TOKEN} or ${ENV_DEPLOYMENT}"
        )
    return rpc, token


def _cmd_push(args: argparse.Namespace) -> int:
    if args.force and not (args.reason or "").strip():
        raise OracleError(
            "--force requires --reason: the override is admin-only (DEFAULT_ADMIN_ROLE) and the "
            "reason is logged with the push"
        )
    rpc, token = _resolve_push_target(args)
    document = load_nav_document(args.nav)
    key = load_oracle_key()
    print(f"oracle {key.address} -> HBToken {token} via {rpc}")
    result = push_nav(
        OracleClient(rpc, token),
        document,
        key,
        force=args.force,
        reason=args.reason,
        dry_run=args.dry_run,
    )
    for warning in result.warnings:
        print(f"warning: {warning}", file=sys.stderr)
    for line in result.lines():
        print(line)
    return 0


def _cmd_attest(args: argparse.Namespace) -> int:
    if args.verify is not None:
        document = load_attestation(args.verify)
        result = verify_attestation(document)
        if not result.ok:
            print(f"error: {args.verify} does not verify: {result.summary()}", file=sys.stderr)
            return 2
        print(f"{args.verify}: {result.summary()}")
        print(attestation_summary(document))
        return 0
    load_dotenv()
    nav, holdings = load_run_documents(args.in_dir)
    key = load_attestor_key()
    document = build_attestation(nav, holdings, key, generated_at=args.generated_at)
    target = write_attestation(args.out or args.in_dir, document)
    print(attestation_summary(document))
    print(f"signature {document.signature.signature}")
    print(f"message sha256 {document.signature.message_sha256}")
    print(f"wrote attestation: {target}")
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
        if args.command == "push":
            return _cmd_push(args)
        if args.command == "attest":
            return _cmd_attest(args)
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
