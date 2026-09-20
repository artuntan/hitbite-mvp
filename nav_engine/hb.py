# /// script
# requires-python = ">=3.11"
# dependencies = ["web3==8.0.0", "python-dotenv==1.2.2"]
# ///
"""Simulated reference NAV. Run: uv run --python 3.11 nav_engine/hb.py nav|push|attest.

Semiannual ACT/ACT is a declared simulation convention, not a term sheet for real
Türkiye bonds. Clean quotes carry forward visibly. Coupons received since purchase
stay in simulated cash. Real faucet money is separate and never double counted.
"""
import argparse
import calendar
import csv
import json
import os
import time
import traceback
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_DOWN, Decimal, getcontext
from pathlib import Path

getcontext().prec = 50
D = Decimal
ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "app/public/data"
CHAINS = {"arc-testnet": (5042002, "https://rpc.testnet.arc.io"),
          "base-sepolia": (84532, "https://sepolia.base.org"),
          "local": (31337, "http://127.0.0.1:8545")}
LABEL = "Simulated attestor. Replaced by an independent firm in production."


def failure_summary(error):
    """Log only error type, local source location and numeric HTTP status."""
    parts = [type(error).__name__]
    # Use the deepest engine frame, without exception text, locals or RPC URLs.
    locations = [f"{f.name}:{f.lineno}" for f in traceback.extract_tb(error.__traceback__)
                 if Path(f.filename).resolve() == Path(__file__).resolve()]
    if locations:
        parts.append(locations[-1])
    status = getattr(getattr(error, "response", None), "status_code", None)
    if isinstance(status, int) and 100 <= status <= 599:
        parts.append(f"HTTP {status}")
    return "NAV engine failed (" + ", ".join(parts) + "). Check configuration, RPC and inputs."


def decimal_text(value):
    return format(value, "f")


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    temporary.replace(path)


def six_months(day, periods):
    total = day.year * 12 + day.month - 1 + periods * 6
    year, month = total // 12, total % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def coupon_dates(holding, today):
    maturity = date.fromisoformat(holding["maturity"])
    if today >= maturity:
        raise ValueError("Matured simulated holdings require an explicit portfolio revision.")
    next_coupon = maturity
    index = -1
    previous = six_months(maturity, index)
    while previous > today:
        next_coupon = previous
        index -= 1
        previous = six_months(maturity, index)
    return previous, next_coupon


def bond(holding, clean, today):
    previous, upcoming = coupon_dates(holding, today)
    fraction = D((today - previous).days) / D((upcoming - previous).days)
    coupon = D(holding["coupon"]) * 100 / 2
    accrued = coupon * fraction
    dirty = clean + accrued
    maturity = date.fromisoformat(holding["maturity"])
    count = (maturity.year - upcoming.year) * 2 + (maturity.month - upcoming.month) // 6 + 1
    # Solve nominal annual YTM using fractional first-period discounting.
    def price(yield_rate):
        base = 1 + yield_rate / 2
        return sum((coupon + (100 if i == count - 1 else 0)) /
                   base ** (D(i + 1) - fraction) for i in range(count))
    low, high = D("-0.99"), D("10")
    if not price(high) <= dirty <= price(low):
        raise ValueError("Simulated yield root is outside the supported interval.")
    for _ in range(100):
        mid = (low + high) / 2
        if price(mid) > dirty:
            low = mid
        else:
            high = mid
    return dirty, accrued, (low + high) / 2, upcoming


def model(today, supply, portfolio=None, quotes=None):
    portfolio = portfolio or json.loads((ROOT / "nav_engine/portfolio.json").read_text())
    if not portfolio.get("simulated"):
        raise ValueError("Only simulated portfolios are allowed.")
    start = date.fromisoformat(portfolio["fee_start"])
    if today < start or supply < 0:
        raise ValueError("Invalid valuation date or supply.")
    if quotes is None:
        with (ROOT / "nav_engine/prices.csv").open() as file:
            quotes = list(csv.DictReader(file))
    units = D(portfolio["reference_units"])
    scale = supply / units
    reference_value, weighted_yield = D(0), D(0)
    reference_cash = D(portfolio["cash"])
    holdings, next_dates = [], []
    for holding in portfolio["holdings"]:
        valid = [q for q in quotes if q["id"] == holding["id"] and date.fromisoformat(q["date"]) <= today]
        if not valid:
            raise ValueError("Missing as-of quote for " + holding["id"])
        quote = max(valid, key=lambda q: q["date"])
        clean = D(quote["clean_price"])
        if not clean.is_finite() or clean <= 0 or not quote["source"]:
            raise ValueError("Invalid manual simulated quote.")
        dirty, accrued, ytm, upcoming = bond(holding, clean, today)
        face = D(holding["face"])
        value = face * dirty / 100
        reference_value += value
        weighted_yield += value * ytm
        next_dates.append(upcoming)
        # Accumulated simulated bond payments; external on-chain coupons are separate.
        payment = upcoming
        index = -1
        while True:
            payment = six_months(upcoming, index)
            if payment <= date.fromisoformat(holding["purchase_date"]):
                break
            reference_cash += face * D(holding["coupon"]) / 2
            index -= 1
        holdings.append({**holding, "clean_price": decimal_text(clean),
                         "dirty_price": decimal_text(dirty), "accrued_per_100": decimal_text(accrued),
                         "simulated_ytm": decimal_text(ytm), "reference_value": decimal_text(value),
                         "scaled_face": decimal_text(face * scale), "value": decimal_text(value * scale),
                         "price_date": quote["date"], "price_source": quote["source"]})
    elapsed = D((today - start).days) / 365
    management = units * D(portfolio["management_fee_rate"]) * elapsed
    expenses = units * D(portfolio["expense_rate"]) * elapsed
    net = reference_value + reference_cash - management - expenses
    if net <= 0:
        raise ValueError("Reference net assets must be positive.")
    nav_units = int((net / units * 10**6).to_integral_value(rounding=ROUND_DOWN))
    if nav_units <= 0:
        raise ValueError("NAV rounds to zero.")
    return {"simulated": True, "label": portfolio["label"], "valuation_date": today.isoformat(),
            "model": "Reference basket scaled by actual token supply; real vault cash excluded from simulated NAV.",
            "day_count": portfolio["day_count"], "reference_units": str(units),
            "supply": decimal_text(supply), "bootstrap": supply == 0,
            "nav_per_token": decimal_text(D(nav_units) / 10**6), "nav_units": str(nav_units),
            "portfolio_value": decimal_text(reference_value * scale), "cash": decimal_text(reference_cash * scale),
            "fees": {"management_rate": portfolio["management_fee_rate"], "expense_rate": portfolio["expense_rate"],
                     "management_accrued": decimal_text(management * scale), "expenses_accrued": decimal_text(expenses * scale)},
            "net_assets": decimal_text(net * scale), "holdings": holdings,
            "weighted_simulated_ytm": decimal_text(weighted_yield / reference_value),
            "next_simulated_coupon_date": min(next_dates).isoformat(),
            "supply_backed_ratio": decimal_text(net / units / (D(nav_units) / 10**6)) if supply else None,
            "backing_label": "Simulated assets / token NAV liability; not evidence of custody or redeemable cash."}


def connection():
    from dotenv import load_dotenv
    from web3 import Web3
    load_dotenv(ROOT / ".env")
    name = os.getenv("NEXT_PUBLIC_CHAIN", "arc-testnet")
    if name not in CHAINS:
        raise ValueError("Network is not an allowlisted testnet.")
    chain_id, default_rpc = CHAINS[name]
    w3 = Web3(Web3.HTTPProvider(os.getenv("RPC_URL") or os.getenv("NEXT_PUBLIC_RPC_URL") or default_rpc,
                              request_kwargs={"timeout": 30}))
    if w3.eth.chain_id != chain_id:
        raise ValueError("RPC chain mismatch.")
    deployment = json.loads((ROOT / f"deployments/{name}.json").read_text())
    if deployment["status"] != "confirmed" or deployment["chainId"] != chain_id:
        raise ValueError("Deployment mismatch.")
    abi = json.loads((ROOT / "deployments/verification/HBToken.metadata.json").read_text())["metadata"]["output"]["abi"]
    token = w3.eth.contract(address=Web3.to_checksum_address(deployment["addresses"]["HBToken"]), abi=abi)
    return w3, token, deployment


def live_nav(block_number=None):
    from web3 import Web3
    w3, token, deployment = connection()
    block = w3.eth.get_block(block_number or "latest")
    number = block["number"]
    timestamp = datetime.fromtimestamp(block["timestamp"], timezone.utc)
    supply = D(token.functions.totalSupply().call(block_identifier=number)) / 10**18
    result = model(timestamp.date(), supply)
    asset = w3.eth.contract(address=Web3.to_checksum_address(deployment["addresses"]["USDC"]), abi=[
        {"type": "function", "name": "balanceOf", "stateMutability": "view", "inputs": [{"type": "address", "name": "account"}],
         "outputs": [{"type": "uint256"}]}])
    vault = D(asset.functions.balanceOf(token.address).call(block_identifier=number)) / 10**6
    available = D(token.functions.availableLiquidity().call(block_identifier=number)) / 10**6
    result.update({"chain_id": w3.eth.chain_id, "token": token.address,
                   "timestamp": timestamp.isoformat().replace("+00:00", "Z"), "block_number": number,
                   "onchain_nav_units": str(token.functions.navPerToken().call(block_identifier=number)),
                   "vault_cash": decimal_text(vault), "available_liquidity": decimal_text(available),
                   "coupon_reserve": decimal_text(vault - available),
                   "vault_coverage_ratio": decimal_text(available / (supply * D(result["nav_per_token"]))) if supply else None})
    # Seek the trailing window by block timestamps, then request bounded log ranges.
    cutoff = int((timestamp - timedelta(days=30)).timestamp())
    low, high = deployment["blockNumber"], number
    while low < high:
        mid = (low + high) // 2
        if w3.eth.get_block(mid)["timestamp"] < cutoff:
            low = mid + 1
        else:
            high = mid
    increments, previous_index = D(0), 0
    # Index at the block immediately before the window excludes older distributions.
    if low > deployment["blockNumber"]:
        previous_index = token.functions.couponIndex().call(block_identifier=low - 1)
    for first in range(low, number + 1, 2000):
        for event in token.events.CouponDistributed().get_logs(from_block=first, to_block=min(first + 1999, number)):
            index = event["args"]["index"]
            increments += D(index - previous_index) / 10**24  # index scaled 1e36, tokens 1e18, cash 1e6
            previous_index = index
    result["simulated_distribution_yield_30d"] = decimal_text(increments / D(result["nav_per_token"]))
    result["distribution_yield_method"] = "Trailing 30-day funded coupon per token / current NAV; not annualized."
    return result


def save_nav(result):
    path = OUTPUT / "nav.json"
    old = json.loads(path.read_text()) if path.exists() else {}
    history = [h for h in old.get("history", []) if h["date"] != result["valuation_date"]]
    history.append({"date": result["valuation_date"], "nav": result["nav_per_token"], "block": result["block_number"]})
    result["history"] = sorted(history, key=lambda h: h["date"])[-366:]
    write(path, result)


def confirmed_nav(block_number):
    # A receipt can reach one RPC backend before its historical state/logs reach
    # another. Retry only pinned reads; never sign or submit a second transaction.
    for attempt in range(8):
        try:
            return live_nav(block_number)
        except Exception as error:
            status = getattr(getattr(error, "response", None), "status_code", None)
            retryable = status in {400, 408, 429, 500, 502, 503, 504} or type(error).__name__ in {
                "ReadTimeout", "ConnectTimeout", "ConnectionError", "BlockNotFound"
            }
            if not retryable or attempt == 7:
                raise
            time.sleep(min(2 * (attempt + 1), 8))


def canonical(payload):
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def attest():
    from eth_account import Account
    from eth_account.messages import encode_defunct
    from eth_keys import keys
    from hexbytes import HexBytes
    data = json.loads((OUTPUT / "nav.json").read_text())
    if data.get("dry_run") or data["nav_units"] != data["onchain_nav_units"] or not data.get("publication"):
        raise ValueError("Attestation requires a confirmed, matching NAV publication.")
    w3, token, _ = connection()
    if str(token.functions.navPerToken().call()) != data["nav_units"]:
        raise ValueError("On-chain NAV has changed; rerun the pipeline.")
    payload = {"label": LABEL, "simulated": True, "schema": "hitbite.attestation.v2", "chain_id": w3.eth.chain_id,
               "token": token.address, "block_number": data["block_number"], "timestamp": data["timestamp"],
               "holdings": data["holdings"], "cash": data["cash"], "nav": data["nav_per_token"],
               "nav_units": data["nav_units"], "supply": data["supply"], "net_assets": data["net_assets"],
               "supply_backed_ratio": data["supply_backed_ratio"], "vault_cash": data["vault_cash"],
               "publication": data["publication"]}
    message = canonical(payload)
    key = os.environ["ATTESTOR_PRIVATE_KEY"]
    signer = Account.from_key(key)
    expected = os.environ.get("NEXT_PUBLIC_ATTESTOR_ADDRESS", "")
    if signer.address.lower() != expected.lower():
        raise ValueError("Attestor does not match the configured public trust anchor.")
    signature = signer.sign_message(encode_defunct(text=message)).signature.to_0x_hex()
    if Account.recover_message(encode_defunct(text=message), signature=signature) != signer.address:
        raise ValueError("Signature self-verification failed.")
    write(OUTPUT / "attestation.json", {"payload": payload, "message": message, "signature": signature,
                                       "signer": signer.address, "public_key": keys.PrivateKey(HexBytes(key)).public_key.to_hex()})
    print("Attestation signed and independently recovered for", signer.address)


def push(dry_run=False):
    from eth_account import Account
    data = json.loads((OUTPUT / "nav.json").read_text())
    w3, token, _ = connection()
    if data.get("dry_run") or data["chain_id"] != w3.eth.chain_id or data["token"].lower() != token.address.lower():
        raise ValueError("Refusing to publish a fixture or mismatched NAV.")
    latest = w3.eth.get_block("latest")
    if not 0 <= latest["timestamp"] - int(datetime.fromisoformat(data["timestamp"].replace("Z", "+00:00")).timestamp()) <= 600:
        raise ValueError("Recompute NAV immediately before publishing (maximum age 10 minutes).")
    value = int(data["nav_units"])
    current = token.functions.navPerToken().call()
    if abs(value - current) * 10000 > current * 500:
        raise ValueError("NAV exceeds the 5% rail. An issuer must review and explicitly force an update.")
    if dry_run:
        print(json.dumps({"dry_run": True, "function": "setNAV(uint256)", "nav_units": str(value)}))
        return
    account = Account.from_key(os.environ["ORACLE_PRIVATE_KEY"])
    if not token.functions.hasRole(token.functions.ORACLE_ROLE().call(), account.address).call():
        raise ValueError("Configured NAV signer lacks ORACLE_ROLE.")
    print("NAV signer role verified:", account.address, flush=True)
    priority = w3.eth.max_priority_fee
    maximum = max(20_000_000_000 if w3.eth.chain_id == 5042002 else 0, latest["baseFeePerGas"] * 2 + priority)
    call = token.get_function_by_signature("setNAV(uint256)")(value)
    tx = call.build_transaction({"from": account.address, "nonce": w3.eth.get_transaction_count(account.address, "pending"),
                                 "chainId": w3.eth.chain_id, "maxFeePerGas": maximum, "maxPriorityFeePerGas": priority})
    tx["gas"] = w3.eth.estimate_gas(tx) * 12 // 10
    tx_hash = w3.eth.send_raw_transaction(account.sign_transaction(tx).raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
    if receipt["status"] != 1:
        raise ValueError("NAV transaction reverted.")
    print("NAV transaction confirmed:", tx_hash.to_0x_hex(), flush=True)
    refreshed = confirmed_nav(receipt["blockNumber"])
    if refreshed["nav_units"] != str(value) or refreshed["onchain_nav_units"] != str(value):
        raise ValueError("Snapshot or date changed during publication; rerun NAV.")
    refreshed["publication"] = {"transaction_hash": tx_hash.to_0x_hex(), "block_number": receipt["blockNumber"]}
    save_nav(refreshed)
    print("NAV confirmed:", tx_hash.to_0x_hex())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["nav", "push", "attest"])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--date", default="2026-09-20", help="Deterministic fixture date; dry-run only")
    parser.add_argument("--block", type=int, help="Pinned live snapshot block")
    args = parser.parse_args()
    if args.command == "nav":
        if args.dry_run:
            result = model(date.fromisoformat(args.date), D("100000"))
            print(json.dumps({**result, "dry_run": True}, indent=2))
        else:
            result = live_nav(args.block)
            save_nav(result)
            print("NAV snapshot:", result["nav_per_token"], "at block", result["block_number"])
    elif args.command == "push":
        push(args.dry_run)
    else:
        if args.dry_run:
            raise ValueError("Attestation signs only confirmed live snapshots.")
        attest()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Provider and signer exceptions can contain request data. Keep all values local.
        print(failure_summary(error))
        raise SystemExit(1) from None
