# nav-engine

Python 3.11 engine that computes the HitBite fund NAV from a **simulated reference book** and
writes the JSON documents the web app reads. Managed with [uv](https://docs.astral.sh/uv/).

> **Testnet / simulated data.** Every holding, price, distribution and figure produced here is
> simulated for the MVP. Nothing reflects real holdings, real prices or real cash. Every output
> carries `simulated: true`, a `source_note` and `generated_at`. The tokenized T-bill comparison is
> a parameterised, illustrative placeholder.

```sh
uv sync                                                                  # create .venv, install locked deps
uv run ruff check . && uv run ruff format --check . && uv run mypy nav_engine
uv run pytest
uv run nav-engine --version
uv run nav-engine compute --as-of 2026-09-15 --no-chain \
    --distributions tests/fixtures/distributions_fixture.csv --out /tmp/hitbite-nav-out
uv run nav-engine compute --no-chain                                     # today (UTC) -> web/public/data
uv run nav-engine schemas --out ../web/public/schemas                    # JSON schemas of the outputs

ATTESTOR_PRIVATE_KEY=0x... uv run nav-engine attest                      # sign attestation.json
uv run nav-engine attest --verify ../web/public/data/attestation.json    # check a published one
ORACLE_PRIVATE_KEY=0x... uv run nav-engine push --rpc "$RPC" --token "$HBTOKEN" --dry-run
```

## Purpose

- Value the reference book day by day from `inception_date` to `--as-of` (accrued interest,
  dirty prices, market values, fees, coupon receipts, distributions) and publish the unit NAV as a
  6-decimal string **and** the matching integer `usdc_6dec` (PLAN.md D22: one integer, three layers).
- Read `totalSupply`, `nav()` and `CouponDistributed` events from the HBToken contract when an RPC
  is configured; otherwise fall back to a cached supply with a visible warning (never crash).
- Produce yield-shift and CDS-shock scenarios, a trailing distribution yield, and portfolio risk
  (market-value weighted YTM, modified duration, convexity).
- Sign the computed state as an attestation (`attest`) and publish the NAV integer on chain
  (`push`, `HBToken.setNAV`) - the two steps that turn the computed number into something a
  reviewer, a partner and the contract all see identically.

## Data model (`data/`)

| File | Content |
|---|---|
| `portfolio.json` | The reference book: `as_of`, `inception_date`, `simulated`, `source_note`, `cash_usd`, `fees_payable_usd`, `positions[]` (`name`, `isin`, `coupon_pct`, `maturity`, `face_usd`, `clean_price`, `purchase_date`, `day_count` = `30/360`, `frequency` = 2). |
| `prices.csv` | `date,name,clean_price,ytm_pct,source` - one row per bond per pricing day; each row cites a source or says `illustrative`. |
| `config.yaml` | Fees (0.75 % management + 0.30 % simulated expenses p.a., ACT/365F), NAV rounding, oracle rail, scenario shifts, CDS beta, the illustrative T-bill comparison. |
| `distributions.csv` | `date,distribution_id,usdc_amount,total_supply_tokens,usdc_per_token,tx_hash,source` - distributions applied to the reference book. Chain events are upserted here by `distribution_id` with `source=chain`. |
| `chain_cache.json` | Written after every successful RPC read (`total_supply_wei`, `onchain_nav_usdc_6dec`, `cached_at`). Used, with a warning, when the RPC is unreachable or not configured. |

Pydantic models for all of these live in `nav_engine/schemas.py`.

### Reference-unit NAV (PLAN.md D19)

`reference_units = NAV_total` on inception day, so the unit NAV is exactly `1.000000` at inception and
`nav_per_token = NAV_total / reference_units`. Because subscriptions settle at NAV, one token is one
reference unit: on-chain `totalSupply` only *scales* the book for reporting (`reported_aum = nav x supply`,
`holdings.scaled_face_usd = face x supply / reference_units`). A distribution of `x` USDC per token on
day `d` reduces reference cash by `x x reference_units` on that day; the contract lowers `nav` by the
same per-token amount at distribution time (D26), so no further adjustment is made.

## Formulas

The binding conventions, with the hand-built numbers the tests tie out to, are in
[`tests/fixtures/FIXTURE.md`](tests/fixtures/FIXTURE.md). In short:

| Module | What it does |
|---|---|
| `daycount.py` | 30/360 US (Bond Basis): `D1 = min(D1, 30)`; `D1 == 30 and D2 == 31 -> D2 = 30`; `add_months`. |
| `bonds.py` | Coupon schedule backwards from maturity; accrued `= face x c/2 x days/180`; dirty `= clean + accrued/face x 100`; market value `= face x dirty/100`; street-convention YTM by Newton (`y0 = coupon`, stop at `|step| < 1e-14`); Macaulay/modified duration and convexity. |
| `portfolio.py` | Load and validate inputs, carry prices forward (error if no price on/before the date), value positions, coupon receipts on coupon dates, market-value weighted risk. |
| `fees.py` | `(0.75 % + 0.30 %) / 365 x NAV_total(d-1)` added to `fees_payable` every day after inception. |
| `nav.py` | The daily path: fees, coupon receipts, positions, distributions, `NAV_total = sum(mv) + cash - fees_payable`, `nav_per_unit` HALF_UP to 6 dp, `nav_usdc_6dec`; trailing distribution yield (window `min(365, days since inception + 1)`, annualised only from 30 days). |
| `scenarios.py` | Reprice every bond at `y_i + shift` with cash and fees unchanged; CDS shock `shift = shock x beta` (beta = 1.0, stated on every output). |
| `chain.py` / `abi.py` | `ChainReader` protocol, `Web3ChainReader` (web3 v7, HTTP, timeouts, embedded minimal ABI), `FakeChainReader` for tests, cached fallback. |
| `distributions.py` | Load/merge/write `distributions.csv` (idempotent upsert by `distribution_id`). |
| `outputs.py` | Build and write the four documents; `nav_history.json` is upserted by date. |
| `pipeline.py` | `run_compute(ComputeOptions)` - the one call the CLI and the tests use. |
| `keys.py` | `ORACLE_PRIVATE_KEY` / `ATTESTOR_PRIVATE_KEY` loaded from the environment only; the key never appears in `repr`, `str`, a log line or an exception. |
| `attest.py` | Canonical JSON of the computed state, EIP-191 `personal_sign`, verification, `attestation.json` (D9). |
| `push_nav.py` | Rail, role and idempotency checks against the deployed contract, then `setNAV` (D5, D27). |

Money is `decimal.Decimal` throughout (40-digit context) and is rounded HALF_UP only when written
(cents for USD, 6 decimals for the unit NAV). Yields and risk measures are floats.

## CLI

```
nav-engine compute [--as-of YYYY-MM-DD] [--data-dir DIR] [--out DIR]
                   [--rpc URL] [--token ADDRESS | --deployment PATH] [--chain-id N] [--no-chain]
                   [--distributions PATH] [--from-block N] [--generated-at ISO8601] [--no-write]
nav-engine attest  [--in DIR] [--out DIR] [--generated-at ISO8601] [--verify PATH]
nav-engine push    [--nav PATH] [--rpc URL] [--token ADDRESS | --deployment PATH]
                   [--force --reason TEXT] [--dry-run]
nav-engine schemas --out DIR
nav-engine --version
```

- `--as-of` defaults to today (UTC); `--data-dir` to `engine/data`; `--out` to `web/public/data`.
- `--deployment` reads `addresses.HBToken` (and `chainId`) from `contracts/deployments/<chain>.json`.
  Environment fallbacks: `NAV_ENGINE_RPC_URL`, `NAV_ENGINE_TOKEN_ADDRESS`, `NAV_ENGINE_CHAIN_ID`,
  `NAV_ENGINE_DEPLOYMENT` (a `.env` file is loaded if present; never commit one).
- `--generated-at` pins the timestamp for reproducible runs (tests and CI diffs). For `attest` it
  also pins the signed `generated_at`/`timestamp`; by default the attestation carries the
  `generated_at` of the run it attests to.
- `attest --in` is the directory holding `nav.json` and `holdings.json` (default `web/public/data`);
  `--out` defaults to `--in`. `--verify PATH` checks a published attestation and needs no key.
- `push --nav` defaults to `web/public/data/nav.json`; `--dry-run` reads the chain, prints the
  decision and sends nothing; `--force` requires `--reason` and `DEFAULT_ADMIN_ROLE`.
- Bad input exits with status 2 and a one-line `error: ...` on stderr; warnings (chain fallback,
  ignored distributions) go to stderr and are also written into `nav.json`.

## Outputs (`web/public/data/`)

Every document carries `generated_at` (UTC, `Z`), `simulated: true` and `source_note`
(the portfolio note plus a one-line engine note). Decimals are strings with a fixed scale.

- `nav.json` - `chain` (`chain_id`, `token_address`, `total_supply_tokens`, `total_supply_wei`,
  `onchain_nav_usdc_6dec`, `supply_source` = `rpc | cache | none`, `warning`), `nav` (`per_token_usd`,
  `usdc_6dec`, `total_usd`, `reference_units`, `reported_aum_usd`, `reported_aum_usdc_6dec`),
  `portfolio`, `distribution_yield`, `fees`, `comparison`.
- `holdings.json` - per position: reference `face_usd`, `scaled_face_usd`, clean/accrued/dirty,
  market value, weight, YTM, duration, convexity, coupon dates; plus cash, fees payable, NAV total.
- `nav_history.json` - one entry per day since inception (`date`, `nav_per_token_usd`, `usdc_6dec`,
  `nav_total_usd`, `weighted_ytm_pct`, `modified_duration`, `distributions_per_unit_cum`).
  Regenerated from inception on every run and merged with existing entries by date.
- `scenarios.json` - `assumptions`, `base`, `parallel[]` (`shift_bp`, NAV, delta), `cds[]`
  (`shock_bp`, `beta`, `shift_bp`, NAV, delta).
- `attestation.json` - written by `nav-engine attest`, not by `compute`: the signed payload plus the
  signature block (see [Attestation](#attestation-nav-engine-attest-planmd-d9)).

`nav-engine schemas --out DIR` writes `nav.schema.json`, `holdings.schema.json`,
`nav_history.schema.json` and `scenarios.schema.json` for the web app. The attestation document is
typed by `nav_engine.schemas.AttestationDocument` (pydantic) rather than a published JSON schema.

## Keys

`nav_engine/keys.py` is the only place a private key is read, and it reads `os.environ` - never a
file, never a keystore, never a default:

| Variable | Used by | Role needed on HBToken |
|---|---|---|
| `ORACLE_PRIVATE_KEY` | `nav-engine push` | `ORACLE_ROLE`, or `DEFAULT_ADMIN_ROLE` for `--force` |
| `ATTESTOR_PRIVATE_KEY` | `nav-engine attest` | none (off-chain signature) |

A loaded key is a `SigningKey` that exposes the address and the public key and nothing else: the
secret is absent from `repr`, `str` and every exception the module raises, including the ones the
underlying library would have raised with the key quoted in the text. A missing or malformed value
gives an actionable message naming the variable and the expected shape, and the value is never echoed.
`nav-engine` loads a local, git-ignored `.env` for convenience exactly as `compute` does; in CI the
key comes from the protected `oracle` GitHub environment and no file exists on the runner.

## Attestation (`nav-engine attest`, PLAN.md D9)

> **Simulated attestor - an independent firm signs in production.** The label is in the code, in the
> signed payload, in the signature block and on the transparency page.

`attest` reads `nav.json` and `holdings.json` from one engine run and writes `attestation.json`:

- **Payload** (`attestation`): `version`, `generated_at` + `timestamp` (Unix seconds), `as_of`,
  `simulated: true`, `attestor_note`, `source_note`, `chain` (token address, chain id, supply and
  on-chain NAV with the `supply_source` that produced them), `nav` (per-token string, `usdc_6dec`
  integer, total, reference units, reported AUM), `cash_usd`, `fees_payable_usd`,
  `sum_market_value_usd`, `positions_count`, `holdings[]` (name, ISIN, coupon, maturity, face,
  supply-scaled face, clean/accrued/dirty, market value) and `supply_backed_ratio`.
- **Signature block** (`signature`): `scheme`, `message` (the exact canonical JSON string that was
  signed), `message_sha256`, `signature`, `attestor_address`, `attestor_public_key` (SEC1
  uncompressed, `0x04…`), `attestor_note`, `verify_with`.

Canonical form: `json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`
encoded UTF-8. Every value is a string, an integer or a boolean - floats are rejected outright - so
the same state always produces the same bytes and therefore the same signature (ECDSA here is
deterministic, RFC 6979). Money strings are the ones `nav.json` and `holdings.json` already publish,
so an attestation cannot disagree with the documents it attests to.

`supply_backed_ratio` divides the book value of the tokens outstanding (engine NAV x `totalSupply`)
by their on-chain NAV liability (on-chain `nav()` x `totalSupply`), scaled `1e18` like
`HBToken.supplyBackedRatio()`. It deliberately excludes the vault's USDC balance, which the engine
does not read, so the on-chain ratio is this figure plus available liquidity. With no chain data it
is exactly `1.000000` and `basis` says why.

### Verifying in the browser (Phase 6, `viem`)

The signature is EIP-191 `personal_sign` over the UTF-8 bytes of `signature.message`, which is
byte-for-byte the format `viem` produces and consumes:

```ts
import { verifyMessage } from "viem";

const doc = await fetch("/data/attestation.json").then((r) => r.json());
const valid = await verifyMessage({
  address: doc.signature.attestor_address,
  message: doc.signature.message, // the exact string that was signed - do not re-serialise
  signature: doc.signature.signature,
});
// and the payload on screen is the payload that was signed:
const sameDocument =
  JSON.stringify(JSON.parse(doc.signature.message)) === JSON.stringify(doc.attestation);
```

Verify against `signature.message`, not against a re-serialisation of `doc.attestation`: the payload
contains non-ASCII text (`Türkiye`, the em dash in the attestor note), and EIP-191 hashes the *byte*
length of the message. `tests/test_attest.py` pins that digest by rebuilding
`keccak256("\x19Ethereum Signed Message:\n" + byteLength + bytes)` by hand.

Python verification, used by the tests and by `nav-engine attest --verify PATH`, re-canonicalises the
payload, recomputes the SHA-256 and recovers the address with `eth_account`. Any single-byte change
to the payload, the message, the hash or the signature fails it.

## Oracle push (`nav-engine push`, BUILD_PROMPT 6.3)

`push` sends `nav.json`'s `nav.usdc_6dec` integer to `HBToken.setNAV(newNav, newReportedAUM, force)`
with `ORACLE_PRIVATE_KEY`, and computes `newReportedAUM = nav x totalSupply / 1e18` from the supply
it reads at push time (PLAN.md D19/D22: one integer in the JSON, on chain and in the UI).

Three checks run before a transaction is built, because each of them is a revert nobody should pay
gas to discover:

1. **Chain.** A known mainnet chain id is refused outright; an unrecognised one warns.
2. **Role.** `hasRole(ORACLE_ROLE, signer)` - or `DEFAULT_ADMIN_ROLE` with `--force` - is read from
   the contract, and a missing role is reported by name.
3. **Rail (D5, D27).** `maxNavMoveBps` and `railAnchorNav` are read from the deployed contract, so
   this check cannot drift from the deployed rail. The contract measures the move against the NAV at
   the *start of the 24 h window*, not against the previous update. When the window is within two
   minutes of rolling, the move must clear both the current anchor and the post-roll anchor, since
   the operator cannot know which block will include the transaction. A breach prints the anchor, the
   move in basis points, the rail, the time the window rolls, and the `--force` alternative.

**Idempotency rule.** A NAV counts as already pushed when the on-chain `nav()` is already exactly
`nav.json`'s integer **and** `navUpdatedAt` falls on or after the document's `as_of` (UTC date). The
command then prints what it found and exits 0 without sending. A *different* value is a revision, not
a repeat, and is pushed even on the same day - the rail still applies.

**`--force` is admin-only.** It maps to the contract's `force = true`, which `HBToken` restricts to
`DEFAULT_ADMIN_ROLE`; it bypasses the rail *and* the idempotency skip, restarts the rail window at the
new NAV and emits `NAVForced`. It requires `--reason "<why>"`, which is printed with the push and
echoed in the workflow log. Use it for a genuine correction, not to make a wide move fit.

```sh
# Anvil runbook (deploy and grant ORACLE_ROLE first; see contracts/README.md)
uv run nav-engine compute --rpc http://127.0.0.1:8545 --deployment ../contracts/deployments/anvil.json
ORACLE_PRIVATE_KEY=0x... uv run nav-engine push \
    --rpc http://127.0.0.1:8545 --deployment ../contracts/deployments/anvil.json --dry-run
ORACLE_PRIVATE_KEY=0x... uv run nav-engine push \
    --rpc http://127.0.0.1:8545 --deployment ../contracts/deployments/anvil.json
```

Exit codes: `0` sent, or nothing to do; `2` refused (bad configuration, missing key or role, rail
breach, revert) with a one-line `error: ...` on stderr. Nothing is sent on a refusal.

## Scheduling (BUILD_PROMPT 6.4)

| Workflow | Trigger | Keys | What it does |
|---|---|---|---|
| `.github/workflows/nav-daily.yml` | cron 06:00 UTC + manual | none | Runs `compute` (chain read-only, optional) and opens a PR with the refreshed JSON via `peter-evans/create-pull-request`. `generated_at` is pinned to 06:00 UTC of the valuation date, so a second run on the same day produces identical bytes and no empty PR. |
| `.github/workflows/oracle-push.yml` | `workflow_dispatch` only, environment `oracle` | `ORACLE_PRIVATE_KEY` from the environment's secrets | Recomputes the NAV for the chosen date and runs `push`. Manual and protected on purpose: this is the only workflow that signs, `dry_run` defaults to true, and the environment's required reviewers put a second person in front of every push. |

Signing the attestation is not automated either: run `nav-engine attest` locally with the attestor
key, or add the step to a protected environment. The daily workflow never touches a key.

## Chain fallback behaviour

1. With `--rpc` and a token address the engine reads `totalSupply()`, `nav()` and all
   `CouponDistributed` logs from `--from-block`; on success it updates `data/chain_cache.json` and
   upserts the events into `distributions.csv` (`usdc_per_token = usdcAmount x 1e18 // totalSupply / 1e6`,
   replicating the contract's integer floor; `date` = UTC date of the block).
2. If the RPC fails, or no RPC/token is configured, or `--no-chain` is given, the cached supply is
   used with `supply_source: "cache"` and a warning naming the failure and the cache timestamp.
3. Without a usable cache the run still succeeds with `supply_source: "none"`: `reported_aum_*` and
   `scaled_*` fields are `null`, the reference-book NAV is unaffected.

## How to add a price row

Append one line per bond to `data/prices.csv` with the ISO date, the exact position `name` from
`portfolio.json`, the clean price per 100, an optional `ytm_pct` (informational) and a `source`
(cite a public source, or `illustrative`). Days without a row reuse the last known clean price
(weekends, holidays). The first row for a bond must be on or before `inception_date`; otherwise the
engine stops with `no clean price for ... on or before ...`. Then run `uv run nav-engine compute`.

## Tests

`uv run pytest` runs ~185 tests: hand cases for the day count and accrued interest, YTM round
trips, per-position and per-day tie-out to `tests/fixtures/*.csv` (built independently by
`tests/fixtures/build_fixture.py`, which does not import `nav_engine`), scenarios, distribution
yield, chain conversion and fallback, output schemas/idempotency and the CLI end to end; then
`test_keys.py` (no key may leak through `str`, `repr` or a raised error), `test_attest.py`
(sign -> verify, single-byte tamper detection, canonical stability across dict ordering, a JSON
round trip and a write/read cycle, and the EIP-191 digest `viem` computes) and `test_push_nav.py`.

`test_push_nav.py` runs the rail, idempotency, force and guard logic with no chain at all, and then
spawns a real **Anvil on port 8546**, deploys `MockUSDC`, `IdentityRegistry` and `HBToken` with
`forge create`, grants `ORACLE_ROLE`, mints 1000 hbTRS and pushes a real `nav.json`, asserting that
on-chain `nav()` equals `nav.usdc_6dec` exactly, that a second push sends nothing, that a move beyond
the rail is refused without mining a block, and that `--force` needs `DEFAULT_ADMIN_ROLE`. Those six
tests skip with a reason - they never fail - when Foundry is absent or the port is busy:

```
SKIPPED [6] anvil/forge not on PATH: install Foundry (foundryup) to run the chain tests
```
