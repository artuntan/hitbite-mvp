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
```

## Purpose

- Value the reference book day by day from `inception_date` to `--as-of` (accrued interest,
  dirty prices, market values, fees, coupon receipts, distributions) and publish the unit NAV as a
  6-decimal string **and** the matching integer `usdc_6dec` (PLAN.md D22: one integer, three layers).
- Read `totalSupply`, `nav()` and `CouponDistributed` events from the HBToken contract when an RPC
  is configured; otherwise fall back to a cached supply with a visible warning (never crash).
- Produce yield-shift and CDS-shock scenarios, a trailing distribution yield, and portfolio risk
  (market-value weighted YTM, modified duration, convexity).

Phase 5 adds `push_nav` (oracle) and `attest` (signed attestation) on top of these outputs.

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

Money is `decimal.Decimal` throughout (40-digit context) and is rounded HALF_UP only when written
(cents for USD, 6 decimals for the unit NAV). Yields and risk measures are floats.

## CLI

```
nav-engine compute [--as-of YYYY-MM-DD] [--data-dir DIR] [--out DIR]
                   [--rpc URL] [--token ADDRESS | --deployment PATH] [--chain-id N] [--no-chain]
                   [--distributions PATH] [--from-block N] [--generated-at ISO8601] [--no-write]
nav-engine schemas --out DIR
nav-engine --version
```

- `--as-of` defaults to today (UTC); `--data-dir` to `engine/data`; `--out` to `web/public/data`.
- `--deployment` reads `addresses.HBToken` (and `chainId`) from `contracts/deployments/<chain>.json`.
  Environment fallbacks: `NAV_ENGINE_RPC_URL`, `NAV_ENGINE_TOKEN_ADDRESS`, `NAV_ENGINE_CHAIN_ID`,
  `NAV_ENGINE_DEPLOYMENT` (a `.env` file is loaded if present; never commit one).
- `--generated-at` pins the timestamp for reproducible runs (tests and CI diffs).
- Bad input exits with status 2 and a one-line `error: ...` on stderr; warnings (chain fallback,
  ignored distributions) go to stderr and are also written into `nav.json`.

## Outputs (`web/public/data/`)

All four documents carry `generated_at` (UTC, `Z`), `simulated: true` and `source_note`
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

`nav-engine schemas --out DIR` writes `nav.schema.json`, `holdings.schema.json`,
`nav_history.schema.json` and `scenarios.schema.json` for the web app.

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

`uv run pytest` runs ~100 tests: hand cases for the day count and accrued interest, YTM round
trips, per-position and per-day tie-out to `tests/fixtures/*.csv` (built independently by
`tests/fixtures/build_fixture.py`, which does not import `nav_engine`), scenarios, distribution
yield, chain conversion and fallback, output schemas/idempotency and the CLI end to end.
