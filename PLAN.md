# HitBite MVP — PLAN.md

Working plan for the engineering agent. Source of truth for scope is `BUILD_PROMPT.md`; product spec is `SPEC.md`.
Progress is logged in `PROGRESS.md`. Decisions below are numbered (D1…) and referenced from code and docs.

## 1. Environment findings (2026-09-08)

| Item | Found | Consequence |
|---|---|---|
| Git repo | `artuntan/hitbite-mvp` (private), branch `plan-and-build-from-build-prompt`, Actions enabled | Repo root = the `mvp/` root of Section 3 (D1) |
| Node / pnpm | Node 25.2, pnpm 10.22 | CI pins Node 22; `engines` ≥ 20 (D17) |
| Python | 3.11.15 + `uv` 0.7 | Engine managed with `uv` (D2) |
| Foundry / Slither | not installed | Installed via `foundryup`; Slither via `uv tool` |
| Network | GitHub, npm, PyPI, `https://sepolia.base.org` (chain 84532) reachable | Public RPC usable read-only; rate-limited |
| Credentials | none: no deployer/oracle/registrar keys, no Basescan, Vercel, WalletConnect | Testnet deploy, Vercel deploy and on-chain demo need founder keys (Section 5). Every checkpoint also has a local Anvil path. |

## 2. Stack decisions (where BUILD_PROMPT leaves a choice)

- **Contracts:** Foundry, Solidity 0.8.26, OpenZeppelin Contracts v5 as a git submodule in `contracts/lib` (D2). Custom errors everywhere. `forge fmt`, `forge snapshot --tolerance 10`, Slither in CI (`crytic/slither-action`).
- **Engine:** Python 3.11, `uv` + PEP 621 `pyproject.toml`, `pandas`, `numpy`, `pydantic` v2, `web3` v7, `eth-account`, `pyyaml`, `pytest`, `ruff`, `mypy` (lenient). Money math in `decimal.Decimal`; outputs carry both display strings and 6-decimal integer USDC (D22).
- **Web:** Next.js 15 App Router, TypeScript strict, Tailwind v4, shadcn/ui, `next-themes`, `wagmi` v2 + `viem` + RainbowKit 2, Recharts, `zod`, IBM Plex Sans/Mono via `next/font`. Vitest for unit tests, Playwright (chromium) for smoke + screenshots, Lighthouse CLI locally.
- **Persistence:** `@libsql/client` — `file:` URL locally/CI/docker, `libsql://` (Turso) on Vercel (D7).
- **Demo runner:** TypeScript + viem (`tsx`), chain-agnostic via `contracts/deployments/<chain>.json` (D11).
- **CI:** GitHub Actions `ci.yml` (jobs `contracts`, `engine`, `web`, `secrets`), `nav-daily.yml` (scheduled engine run → PR), `oracle-push.yml` (`workflow_dispatch`, protected environment `oracle`).
- **Secret scan:** `gitleaks/gitleaks-action@v2` in CI plus `scripts/check-secrets.sh` (regex) used by `make check-secrets` and a pre-commit hook (D18).

## 3. Decisions (ambiguities resolved; ask founders only where flagged)

- **D1 Repo root.** This git repo is the `mvp/` root. `BUILD_PROMPT.md` and `SPEC.md` are committed here; `SPEC.md` is kept byte-identical to `../HitBite-MVP-SPEC.md` (`make sync-spec`).
- **D2 Package managers.** pnpm (web), uv (engine), forge submodules (contracts). Lockfiles committed.
- **D3 Pause semantics.** `pause()` blocks transfer, mint, burn, subscribe, redeem, distributeCoupon and claimCoupon. Issuer burns are *not* exempt: unpause, correct, re-pause. Simpler and auditable. `setNAV` and registry changes keep working while paused.
- **D4 Burns and `canHold(from)`.** `_update` requires `canHold(to)` for every mint/transfer and `canHold(from)` for transfers, but **not** for burns. A de-verified holder can still redeem (exit to cash) and the issuer can force-burn for corrections. Receiving is the restriction that matters; trapping funds is never desirable. Coupon claims are likewise allowed for de-verified holders.
- **D5 NAV rail.** `setNAV(uint256 newNav, uint256 reportedAUM, bool force)`. `force=false` → `ORACLE_ROLE`, revert `NavMoveExceedsRail(old,new,maxBps)` if |Δ| > `maxNavMoveBps` (default 500). `force=true` → `DEFAULT_ADMIN_ROLE` only, emits `NAVForced`. `newNav == 0` reverts.
- **D6 Redemption liquidity.** Coupon money is never used for redemptions: `couponReserve = totalDistributed − totalClaimed`; `availableLiquidity() = usdc.balanceOf(this) − couponReserve`; `redeem` reverts `InsufficientLiquidity(available, requested)` against *available* liquidity. This is what makes the invariant `usdc.balanceOf(token) ≥ Σ accrued` hold.
- **D7 Verification store.** `@libsql/client` behind a `Store` interface. Default `DATABASE_URL=file:./.data/hitbite.db`. On Vercel the file store is per-instance and ephemeral; founders set a Turso URL for persistence (documented, non-blocking).
- **D8 Registrar worker.** `POST /api/verify` stores the request. `POST /api/verify/process` is the worker: approves pending, non-blocked requests older than `AUTO_APPROVE_DELAY_MS` (default 10 000) by calling `addVerified` with `REGISTRAR_PRIVATE_KEY` (testnet-only server key). The client calls it after the countdown; admins can approve/reject earlier from `/admin`; a cron may call it. No long-running process, works on serverless.
- **D9 Attestation signature.** secp256k1 key, EIP-191 `personal_sign` over `keccak256(canonical JSON)`; publish signature, attestor address and uncompressed public key. Browser verification uses viem `verifyMessage` (no new dependency). Labelled *Simulated attestor — an independent firm signs in production.*
- **D10 Event cache.** Server-side `viem.getLogs` from `deployBlock`, chunked (10k blocks), in-memory cache with 60 s TTL, `Cache-Control: s-maxage=60`. No database for events.
- **D11 Demo runner.** TypeScript/viem in `demo/`, reads keys from env, `CHAIN=anvil|base-sepolia`, idempotent (skips verify/faucet steps already satisfied, uses fresh amounts each run), writes `demo/REPORT.md`.
- **D12 Docs.** Root markdown (`COMPLIANCE_RULES.md`, `RISKS.md`) is canonical; `pnpm sync:docs` copies into `web/content/`; CI fails if out of sync (Vercel root is `web/`).
- **D13 Subscription minimum.** `minSubscription` default 100 USDC, admin-settable; `subscribe` reverts `BelowMinimum(min, given)`.
- **D14 MockUSDC faucet.** `faucet(to, amount)`: `amount ≤ 10_000e6` per call and `≤ 10_000e6` per `to` per fixed 24 h window anchored at first use (`windowStart`/`mintedInWindow` maps; BUILD_PROMPT's "simple timestamp map"). Anyone may call for any address: on a testnet the cap is a convenience, not an economic bound. Name `MockUSDC (Testnet)`, symbol `mUSDC`.
- **D15 Deployment files.** `deployments/anvil.json` is committed (deterministic on a fresh Anvil); `deployments/base-sepolia.json` is written by the founders' deploy run and committed then.
- **D16 Vercel / Lighthouse.** No Vercel token here. Ship `vercel.json` + env docs; run Lighthouse locally against `next build && next start` and record scores in `PROGRESS.md`. Founders link the project (Section 5).
- **D17 Node.** CI uses Node 22; `package.json` `engines.node >= 20`. No native Node modules except libsql prebuilt bindings.
- **D18 Secret scan.** gitleaks action + regex script (`0x[0-9a-fA-F]{64}` outside test fixtures, `PRIVATE_KEY=` with a value, mnemonic phrases). Anvil's public default keys are allow-listed only in `deployments/anvil.json`-adjacent docs, never assigned to real roles on Sepolia.
- **D19 Reference-unit NAV (data model; founders please confirm).** The literal formula `NAV_total / tokens_outstanding` divides a fixed 1,000,000-face book by a small on-chain supply and yields a NAV of hundreds of USDC, breaking the 1.00 start and the 5 % rail. Instead `portfolio.json` is a **reference book**: `reference_units = NAV_total on inception day` so unit NAV = 1.000000 at inception; `nav_per_token = (Σ mv + cash − fees_payable) / reference_units`. Because subscriptions settle at NAV, 1 token ≡ 1 reference unit, so on-chain `totalSupply` scales the book for reporting: `reportedAUM = nav × supply`, `holdings.json` shows reference faces and supply-scaled faces. Distributions reduce reference cash pro-rata (read from `CouponDistributed` events, fixture-driven in tests). Mirrors how unit-trust NAV is computed in practice; engine-only, cheap to reverse.
- **D20 `supplyBackedRatio()`.** On-chain: `(availableLiquidity() + reportedAUM) × 1e18 / (totalSupply × nav / 1e18)`; `1e18` when liabilities round to zero. The coupon reserve is owed to holders and is not counted as backing. Labelled illustrative: on testnet subscription USDC sits in the vault while the portfolio is simulated.
- **D21 Investor type.** Only `investorType == 1` (professional) can be verified; `2` (retail) reverts `RetailNotAllowed()`. Field kept for later.
- **D22 Number consistency.** Engine emits `nav_usdc_6dec` (integer) next to the display value; chain stores the same integer; UI formats from the integer. Tests compare integers, not floats.
- **D23 Country list.** Full ISO 3166-1 numeric list generated once into `web/lib/countries.json` (`pnpm gen:countries` from `i18n-iso-countries`), blocked codes disabled with an explanation.
- **D25 Phase 1/2 split.** `IHBToken` couples coupon settlement into `_update`, so `HBToken` is implemented in full (including coupons) with unit tests in Phase 1; Phase 2 adds the proof layer: 70/30 and no-double-count tests, fuzz, invariants, gas snapshot, Slither. No untested coupon code lands in the Phase 1 commit.
- **D26 Ex-distribution NAV drop.** `distributeCoupon` lowers `nav` by the per-token amount it distributes (and `reportedAUM` by the USDC pulled), emitting `NAVUpdated`, exactly as a fund's NAV drops on the ex-distribution date. Without it a verified wallet could subscribe just before a distribution, claim, and redeem at an unchanged NAV, capturing the coupon from existing holders (review finding security-002). The engine (D19) reduces reference cash by the same per-unit amount, so on-chain and computed NAV stay aligned; the rail anchor is reduced too so distributions never consume the oracle's rail budget. Deviation from the literal BUILD_PROMPT 5.2 (which is silent on NAV at distribution); flagged to founders.
- **D27 NAV rail window.** The rail is enforced against `railAnchorNav`, the NAV at the start of the current 24 h window, not against the previous call. Chained in-rail updates therefore cannot compound past `maxNavMoveBps` within a day (review finding security-001). A forced admin update restarts the window at the new NAV. `NavMoveExceedsRail(anchorNav, newNav, maxBps)` reports the anchor.
- **D28 Input bounds.** Every amount, NAV and reported-AUM input is bounded by `MAX_INPUT = type(uint128).max` and rejected with `AmountTooLarge`/`InvalidNav`; all intermediate products then fit in `uint256`, so the contract never reverts with a `Panic`. Constructors reject zero addresses; the registry rejects country `0` and codes above 999.
- **D29 Distribution accounting.** `distributeCoupon` reverts `DistributionTooSmall` when the index increment would truncate to zero (the whole amount would otherwise be locked) and `DistributionExceedsNav` when the per-token amount is not below NAV. `totalAllocated` (increment × supply / 1e18) is tracked separately from `totalDistributed` (USDC pulled); the coupon reserve uses `totalAllocated`, so the truncation remainder becomes ordinary vault liquidity instead of a permanently locked reserve. Per-holder settlement dust (< 1 micro-USDC per holder per distribution) remains in the reserve and is documented.
- **D30 Oracle push idempotency.** A day counts as already pushed when on-chain `nav()` equals `nav.json`'s `nav.usdc_6dec` *and* `navUpdatedAt`'s UTC date is on or after the document's `as_of`. A *different* value for the same day is a revision, not a repeat, and is pushed (the rail still applies). `--force` overrides both the rail and the skip and requires `--reason`.
- **D31 Rail pre-check headroom.** `push` reads `maxNavMoveBps` and `railAnchorNav` from the deployed contract, never from `config.yaml`, so the client check cannot drift from D5/D27. Within 120 s of the 24 h window rolling, the move must clear *both* the current anchor and the post-roll anchor: the operator cannot know which block mines the transaction, and a check that passes against only one of the two is a coin flip. Extends D27 on the client side; the contract is unchanged.
- **D32 Mainnet refusal in the engine.** `push` refuses known mainnet chain ids (1, 10, 56, 100, 137, 324, 8453, 42161, 43114, 59144, 534352) before it builds a transaction, and warns on an unrecognised id. `script/Config.s.sol` makes the same refusal on the contracts side. BUILD_PROMPT Section 2 forbids mainnet configuration; a guard in the tool beats a guard in the runbook.
- **D33 Attestation canonical form.** The payload is built from the *published* `nav.json` / `holdings.json` decimals, so attested strings equal rendered strings by construction. Canonical JSON is sorted keys, `(",", ":")` separators, `ensure_ascii=False`, UTF-8, floats rejected outright. The exact signed string is published as `signature.message` so a browser verifying with viem never has to re-canonicalise and cannot disagree about byte length — the payload contains `Türkiye` and an em dash, so byte-vs-character length is a real trap and is pinned by a test that rebuilds the EIP-191 digest by hand. The public key is published SEC1 uncompressed.
- **D34 `attestation.json` is not committed.** Signing needs the real `ATTESTOR_PRIVATE_KEY`; publishing a signature from a throwaway key would put a meaningless signature in the repository that looks meaningful. The file is generated by `make attest` before `/transparency` needs it, and the transparency page states plainly when no attestation is present.
- **D24 Coupons while paused / distribution ID.** `distributionId` is a monotonically increasing counter; distributions blocked while paused (D3).

## 4. Phases

Each phase ends with: tests green, lint clean, build ok, `PROGRESS.md` entry, Conventional Commit(s). Order strict through Phase 8.

### Phase 0 — Scaffolding, Makefile, CI skeleton, secret scan
- Files: `PLAN.md`, `PROGRESS.md`, `README.md` (skeleton), `LICENSE` (MIT), `CHANGELOG.md`, `CONTRIBUTING.md`, `.gitignore`, `.editorconfig`, `.nvmrc`, `.env.example`, `Makefile`, `scripts/check-secrets.sh`, `.gitleaks.toml`, `.github/workflows/ci.yml`, `.github/workflows/nav-daily.yml` (skeleton), `contracts/` (foundry init, OZ v5 submodule, `foundry.toml`, `remappings.txt`, placeholder test), `engine/` (`pyproject.toml`, `uv.lock`, `nav_engine/__init__.py`, placeholder test), `web/` (create-next-app, ESLint, Prettier, Vitest, Playwright, placeholder test).
- Checkpoint: `make test` and `make lint` pass locally on the empty build; branch pushed; CI green (`gh run watch`).

### Phase 1 — IdentityRegistry + HBToken core
- `contracts/src/interfaces/IIdentityRegistry.sol`, `contracts/src/IdentityRegistry.sol` (roles, `Identity` struct, blocklist 840/792, events, custom errors, D21).
- `contracts/src/HBToken.sol`: roles, immutables, `nav`/`reportedAUM`/`maxNavMoveBps`, `setNAV` (D5), `_update` restrictions (D3, D4), `subscribe` (D13), `redeem` (D6 without coupons yet), `mint`/`burn`, `pause`/`unpause`, views (`previewSubscribe`, `previewRedeem`, `vaultBalance`, `availableLiquidity`, `supplyBackedRatio`).
- `contracts/src/MockUSDC.sol` (needed by tests; D14).
- Tests: `contracts/test/utils/BaseTest.sol`, `IdentityRegistry.t.sol`, `HBToken.t.sol` (subscribe at three NAVs, redeem math, insufficient liquidity, restrictions both sides, pause, roles, rail, force), `MockUSDC.t.sol`.
- Checkpoint: `forge test` green; every custom error hit by at least one test (`forge coverage` report in PROGRESS).

### Phase 2 — Coupon index, fuzz, invariants, gas, Slither
- `HBToken.sol`: `couponIndex`, `userIndex`, `accrued`, `totalDistributed`, `totalClaimed`, `_settle`, `distributeCoupon`, `claimCoupon`, `pendingCoupon`; `_update` settles both sides; `availableLiquidity` uses the reserve (D6).
- Tests: `HBTokenCoupon.t.sol` (70/30 split, transfer between distributions no double count, late subscriber gets nothing, claim after burn), `HBToken.fuzz.t.sol` (round-trip never mints value; Σ claims ≤ distributed, dust bounded), `invariant/HBTokenInvariant.t.sol` + `invariant/handlers/HBTokenHandler.sol` (`balance ≥ Σ accrued`, supply = minted − burned).
- `.gas-snapshot` (unit tests only), `slither.config.json`, `contracts/README.md`, `SECURITY.md` (contract section, triaged findings).
- Checkpoint: split/no-double-count tests green; snapshot committed; `slither` clean or triaged.

### Phase 3 — Deploy + seed scripts, deployment JSON, explorer verification
- `contracts/script/Deploy.s.sol` (env-driven roles, blocklist, writes `deployments/<chain>.json` with `chainId, addresses, deployBlock, txHashes, timestamp`), `contracts/script/Seed.s.sol` (verify two demo wallets, faucet, initial NAV), `contracts/script/Config.s.sol` (env helpers).
- `Makefile`: `anvil`, `deploy-local`, `deploy CHAIN=base-sepolia`, `seed`, `verify`. `deployments/anvil.json` committed (D15).
- Checkpoint (local): fresh Anvil → deploy → seed → JSON written, addresses match README table. Checkpoint (testnet, founder key): `deployments/base-sepolia.json`, Basescan verified links in README. Until keys arrive this is logged as an open item, not skipped silently.

### Phase 4 — NAV engine
- `engine/data/portfolio.json`, `prices.csv`, `config.yaml`, `distributions.csv`.
- `engine/nav_engine/`: `schemas.py` (pydantic), `daycount.py` (30/360), `bonds.py` (accrued, dirty, YTM Newton, modified duration, convexity, cash-flow schedule), `portfolio.py` (load, scale, weights), `fees.py`, `nav.py` (D19), `scenarios.py` (±50/100/200 bp, CDS shock mapping), `chain.py` (`totalSupply`, `nav()`, `CouponDistributed` logs, cached fallback + warning), `outputs.py` (`nav.json`, `nav_history.json` append, `holdings.json`, `scenarios.json` with `generated_at`, `source_note`, `simulated: true`), `cli.py` (`nav-engine compute|push|attest`).
- Tests: `test_daycount.py`, `test_bonds.py` (hand cases, YTM round-trip), `test_nav.py` (ties to `tests/fixtures/nav_fixture.csv` + `FIXTURE.md` hand computation, to the cent), `test_scenarios.py`, `test_outputs.py` (schemas), `test_chain.py` (mocked RPC).
- Checkpoint: `make nav` writes `web/public/data/*.json`; fixture tie-out to the cent; ruff + mypy clean.

### Phase 5 — Oracle push, attestation, workflows
- `engine/nav_engine/push_nav.py` (rail check, `--force --reason`, idempotent per day via on-chain `NAVUpdated` timestamp), `attest.py` (D9), `keys.py`.
- Tests: `test_attest.py` (sign → verify, tamper fails), `test_push_nav.py` against Anvil (`anvil` spawned in test, skipped if absent).
- `.github/workflows/nav-daily.yml` (cron 06:00 UTC, PR via `peter-evans/create-pull-request`), `.github/workflows/oracle-push.yml` (`workflow_dispatch`, environment `oracle`).
- Checkpoint (local Anvil): on-chain `nav()` == `nav.json.nav_usdc_6dec`; attestation verifies with viem and with Python.

### Phase 6 — Web scaffold, design system, `/`, `/transparency`, API routes, contract sync
- `web/scripts/sync-contracts.ts` → `web/lib/generated/{abis,addresses}.ts` from `contracts/out` + `deployments/*.json`.
- Design system: `app/globals.css` tokens (ink/paper/accent `#2E6BFF` placeholder/semantic), `components/ui/*` (shadcn), `components/layout/{TestnetBanner,Header,Footer,ThemeToggle,WalletButton}`, `components/charts/*` (Recharts, theme-aware), skeleton/empty/error states, tx toasts with explorer links.
- `lib/{wagmi.ts,chains.ts,format.ts,schemas.ts,data.ts,copy.ts}`; `app/page.tsx` (Section 7.2 Overview incl. T-bill comparison card, parameterised, illustrative), `app/transparency/page.tsx` (holdings, cash, fees, NAV vs on-chain check, ratio, attestation + browser verify, addresses, deploy block).
- `app/api/{nav,holdings,attestation,stats,events}/route.ts` (zod-validated, `s-maxage=60`).
- Tests: Vitest `lib/__tests__/format.test.ts`, Playwright `e2e/smoke.spec.ts` (pages render, APIs match zod, transparency check passes on fixtures). `vercel.json`.
- Checkpoint: `pnpm build` ok; Lighthouse ≥ 90 (perf/a11y/best-practices) on `/` locally; Vercel deploy when founders link the project (D16).

### Phase 7 — `/verify`, `/subscribe`, faucet, registrar worker
- `lib/server/{store.ts,registrar.ts,env.ts}`, `app/api/verify/{route.ts,status/route.ts,process/route.ts}` (D7, D8), `lib/countries.json` (D23).
- `app/verify/page.tsx` (states: not connected / not verified / pending / verified / blocked), `app/subscribe/page.tsx` (amount, preview, fee line, minimum, faucet, approve → subscribe steps, success card), wrong-network switch.
- Tests: Vitest for store + zod schemas; Playwright for `/verify` blocked-country message and API contract.
- Checkpoint: fresh wallet completes verify → subscribe on Anvil (documented run) and on Base Sepolia once deployed.

### Phase 8 — `/portfolio`, claim, redeem, events indexer, `/stats`
- `lib/server/indexer.ts` (D10), `/api/events` (filters, pagination), `app/portfolio/page.tsx` (balance, value, cost basis from events, pending coupon, claim, redeem with preview + liquidity check, history with filters, CSV export), `app/stats/page.tsx`.
- Checkpoint: admin distributes coupon; two wallets claim correct shares; history renders; CSV exports.

### Phase 9 — `/admin`, `/rules`, `/risks`, `/developers`, OpenAPI
- `app/admin/*` (role-gated; queue approve/reject; blocklist editor; setNAV with rail warning; distribute; pause/unpause; mint/burn with typed confirmation; encoded calldata shown), `app/rules/page.tsx`, `app/risks/page.tsx` (from `web/content`, D12), `lib/openapi.ts` + `app/api/openapi.json/route.ts`, `app/developers/page.tsx`.
- Checkpoint: every admin action works on Anvil with confirmations; OpenAPI validates.

### Phase 10 — Demo script + REPORT, notebook + figures, docs, screenshots
- `demo/{run.ts,report.ts,steps/*.ts,README.md}` (Section 9 steps 1–8, assertions, timing), `demo/REPORT.md`.
- `notebooks/portfolio_analytics.ipynb` → `docs/portfolio_analytics.html`, `docs/figures/*.svg|png` (`make notebook`), theme matching web (follow the `dataviz` skill).
- Docs: `README.md` (Section 11 order), `ARCHITECTURE.md` (Mermaid), `SECURITY.md`, `PARTNER_INTEGRATION.md`, `COMPLIANCE_RULES.md`, `RISKS.md`, `CHANGELOG.md`, `CONTRIBUTING.md`; `docs/screenshots/*` via `web/e2e/screenshots.spec.ts` (light + dark).
- Checkpoint: `make demo-local` passes all assertions; `make demo` on Base Sepolia with founder keys; README 60-second test; QA checklist in README.

### Showcase (only after Definition of Done)
1 TR toggle (`next-intl`) → 2 `hbTRK` series preview → 3 curator view → 4 notifications → 5 Docker Compose stack → 6 multi-oracle NAV → 7 status JSON + badge. Each fully working or not included.

## 5. Founder asks (needed for real-testnet checkpoints; nothing else blocks)

1. **Base Sepolia keys:** one funded deployer/admin key (~0.2 ETH) plus registrar, issuer, oracle keys (can be the same key for MVP; separate is better) — Phase 3, 5.
2. **Basescan API key** — explorer verification, Phase 3.
3. **Demo wallets A/B/C** with a little Base Sepolia ETH — Phase 10 `make demo`.
4. **Vercel project** linked to the repo (root `web/`) with env from `.env.example`; **WalletConnect project id** — Phase 6/7.
5. **Turso/libSQL URL** for persistent verification requests on Vercel (optional; D7).
6. **Confirm D19** (reference-unit NAV) and D4 (de-verified holders may redeem).
7. Brand hex, two one-line team bios, the 90-second recording, Berke's Turkish copy (showcase).

## 6. Risks

| Risk | Mitigation |
|---|---|
| No testnet keys → Phases 3/5/10 verifiable only on Anvil until founders act | Anvil parity for every checkpoint; exact runbook in `contracts/README.md` and `PROGRESS.md`; nothing marked done that only ran locally |
| Public RPC limits on `eth_getLogs` / rate limits | Chunked ranges, 60 s cache, optional `ALCHEMY_RPC_URL` |
| Numbers drifting between engine, chain and UI | D22 integer-first outputs; cross-layer test in `web/e2e` comparing `/api/nav` to `nav()` |
| Wallet bundle hurts Lighthouse | Wallet provider loaded only on wallet pages; public pages are server-rendered from JSON |
| Version drift (Next 15 / wagmi 2 / RainbowKit 2 / Tailwind 4 / shadcn) | Pin exact versions; smoke tests; Node 22 in CI |
| Vercel ephemeral filesystem | libsql remote URL; documented degradation |
| Fuzz/invariant noise in gas snapshot | Snapshot unit tests only; `--tolerance 10` |
| Registrar key on the web server | Testnet-only key with no other role; threat-model entry in `SECURITY.md` |
| D19 disagrees with founders' mental model | Flagged; engine-only change if reversed |
| Scope creep from showcase items | Not started before DoD checklist passes |
