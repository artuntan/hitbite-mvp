# HitBite MVP — Build Prompt for the coding agent

> **Nasıl kullanılır (TR):** Bu dosyayı `mvp/` klasörünün köküne koy. Kodlama asistanını (Claude Code, Cursor, vb.) `mvp/` içinde başlat ve ilk mesaj olarak şunu yaz: *"Read BUILD_PROMPT.md fully. Produce PLAN.md, then execute phase by phase as instructed."* Asistan önce plan yazar, sonra fazları sırayla uygular; her fazın sonunda testler yeşil olmadan ilerlemez. Sen her akşam `PROGRESS.md`'yi okur, takıldığı yeri bana getirirsin. Aşağısı asistana yöneliktir ve İngilizcedir.

---

## 0. How to work (read this first)

You are the engineering agent building the HitBite testnet MVP inside this `mvp/` directory. Work in this order and do not skip steps:

1. Read this entire document. Do not start coding before you finish it.
2. Write `PLAN.md`: the phases below broken into concrete tasks with file paths, your stack decisions where this document leaves a choice, and a risk list. Keep it under 300 lines.
3. Execute phase by phase (Section 12). A phase is done only when its checkpoint passes: tests green, lint clean, app builds, `PROGRESS.md` updated with what shipped, what is left, and any open questions.
4. Keep `PROGRESS.md` as a dated log. Every session: what you did, what broke, what you need from the founders. Founders read it every evening.
5. Commit small and often with Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). Never commit secrets, private keys, `.env`, or node_modules.
6. When something is ambiguous, choose the option that is simpler, safer and closer to production reality, note the decision in `PLAN.md` under "Decisions", and continue. Ask the founders only when a decision would be expensive to reverse (chain choice, data model, token economics).
7. Ship working software over impressive scaffolding. Everything you add must run, be tested, and be documented. A feature that half-works is removed before delivery.
8. Never invent facts: no fabricated ISINs, prices, legal claims, partner names, audits or "backed by" statements. Where data is illustrative, label it `illustrative` in code and UI.
9. Never add a HitBite token, airdrop, points, referral rewards, or any incentive mechanic. Never deploy to a mainnet.

Success is judged by one question a reviewer at a top-tier accelerator will ask within 60 seconds of opening the repo: *"Can this team ship a real product?"* The answer must be yes from the README alone, and confirmed by running the demo.

---

## 1. Mission and audiences

HitBite brings Türkiye's dollar sovereign debt — Eurobonds and sukuk — on-chain through licensed rails in Abu Dhabi and distributes it to on-chain treasuries, DeFi collateral desks and Gulf investors. No Turkish asset has ever been tokenized. Türkiye's USD curve yields roughly 6.0% (2029) to 7.8% (2047) at a 5-year CDS near 217 bp (31 Aug 2026), settles through Euroclear, and Türkiye's Medium-Term Programme 2027–2029 (Official Gazette, 6 Sept 2026) committed the state to writing rules for issuing capital-market instruments as crypto assets.

This MVP is a **public, testnet-only reference implementation** of the product:

- a whitelisted token, `hbTRS` (HitBite Türkiye Sovereign, Testnet), representing a simulated custodied portfolio of Türkiye USD sovereign bonds;
- NAV-based subscription and redemption in test USDC;
- pro-rata coupon distribution and claiming;
- a NAV and data pipeline computed from bond prices;
- a transparency layer with simulated attestations;
- an investor web app, an admin console, public JSON endpoints, an end-to-end demo script, and analytics.

Audiences, in priority order:

1. **Accelerator reviewers (Alliance).** They look for: technical founders who ship, deep user insight, clean engineering, honesty about what is real. They will open README, click the live demo, skim tests and the contracts, and watch a 90-second screen recording.
2. **Licensed fund manager and tokenization vendor (ADGM).** They will read the token rules, the compliance model and the production mapping to quote against it.
3. **Distribution partners (DeFi vault curators, exchanges).** They will read `PARTNER_INTEGRATION.md`: NAV oracle, transfer rules, transparency endpoints.
4. **Regulators (later).** They will see a registry-anchored, whitelisted, transparent design.

What is real vs. simulated must be visible everywhere: a persistent testnet banner in the app, a table in the README, `illustrative`/`simulated` labels on data.

---

## 2. Non-negotiables

- Testnet only (Base Sepolia, chain id 84532; fallback Avalanche Fuji 43113). No mainnet configuration anywhere.
- No real money, no fiat, no real KYC vendor, no real custody.
- Every page shows: `Testnet demonstration. Simulated portfolio. Not an offer of securities.`
- No promises of returns in copy. Yields are shown as computed portfolio metrics with their assumptions, never as "you will earn".
- Whitelist rules enforced on-chain, not only in the UI.
- Secrets only via environment variables; `.env.example` documents every variable; CI fails if a private key pattern is committed (add a gitleaks or simple regex check).
- Tests are mandatory for contracts and the NAV engine; smoke tests for the web app.
- English UI by default; Turkish toggle is a showcase item (Section 14).
- Licence: MIT.

---

## 3. Repository layout

```
mvp/
  BUILD_PROMPT.md            # this file
  PLAN.md                    # you write it
  PROGRESS.md                # dated log
  README.md                  # reviewer-first
  ARCHITECTURE.md            # diagram + data flow
  SPEC.md                    # product spec (copy from ../HitBite-MVP-SPEC.md, keep in sync)
  SECURITY.md                # threat model, known limitations
  PARTNER_INTEGRATION.md     # how a curator/exchange integrates
  COMPLIANCE_RULES.md        # whitelist, country codes, transfer rules
  RISKS.md                   # product and bond risks (plain language)
  CHANGELOG.md
  LICENSE
  .github/workflows/         # ci.yml (contracts, engine, web), nav-daily.yml
  contracts/                 # Foundry project
    src/  test/  script/  deployments/  foundry.toml  README.md
  engine/                    # Python 3.11: NAV, attestation, oracle push
    nav_engine/  data/  tests/  pyproject.toml  README.md
  web/                       # Next.js app
    app/  components/  lib/  public/  e2e/  package.json  README.md
  demo/                      # end-to-end testnet scenario runner + REPORT.md
  notebooks/                 # portfolio_analytics.ipynb + exported figures
  docs/                      # screenshots, diagrams, figures used by README
  Makefile                   # make test, make demo, make nav, make dev
  docker-compose.yml         # optional local stack (web + engine cron)
```

---

## 4. Stack

- **Contracts:** Solidity ^0.8.24, Foundry (forge/cast/anvil), OpenZeppelin Contracts v5 (`ERC20`, `AccessControl`, `Pausable`, `ReentrancyGuard`, `SafeERC20`). Slither for static analysis. Gas snapshots committed.
- **Engine:** Python 3.11, `pandas`, `numpy`, `web3` (or `eth-account` + JSON-RPC), `pydantic` for schemas, `pytest`, `ruff`, `mypy` (lenient). Managed with `uv` or `poetry`.
- **Web:** Next.js 14+ (App Router), TypeScript strict, Tailwind, shadcn/ui, `wagmi` v2 + `viem`, RainbowKit, Recharts, `zod` for schema validation, `next-intl` for the TR toggle (showcase). ESLint + Prettier. Playwright smoke tests. Deployed on Vercel.
- **CI:** GitHub Actions. Jobs: `contracts` (forge fmt check, build, test, snapshot diff), `engine` (ruff, pytest), `web` (lint, typecheck, build, playwright smoke), `secrets` (leak scan). A scheduled workflow runs the NAV engine daily and opens a PR with the updated `nav.json` (never pushes keys; oracle push runs only from a protected environment).
- **Explorer verification:** Basescan (Sepolia) API key via env.

---

## 5. Smart contracts (`contracts/`)

### 5.1 `IdentityRegistry`
- Roles: `DEFAULT_ADMIN_ROLE`, `REGISTRAR_ROLE`.
- Storage: `mapping(address => Identity)` where `Identity { bool verified; uint16 country; uint8 investorType; uint64 verifiedAt; }`. `investorType`: 1 = professional, 2 = retail (retail cannot be verified in phase one; keep the field for later).
- Blocklist: `mapping(uint16 => bool) blockedCountry`; admin sets. Initial blocked set: `840` (United States), `792` (Türkiye). Keep a small configurable list; document why (US securities law; product not offered to Turkish residents in phase one).
- Functions: `addVerified(address, uint16 country, uint8 investorType)`, `removeVerified(address)`, `setCountryBlocked(uint16, bool)`, `isVerified(address) view`, `identityOf(address) view`, `canHold(address) view` (verified and country not blocked).
- Events for every change.
- Reverts with custom errors (`CountryBlocked(uint16)`, `NotRegistrar()`).

### 5.2 `HBToken` (symbol `hbTRS`, 18 decimals)
- Inherits `ERC20`, `AccessControl`, `Pausable`, `ReentrancyGuard`.
- Immutable references: `IdentityRegistry registry`, `IERC20 usdc` (6 decimals).
- Roles: `ISSUER_ROLE` (mint, burn, distribute, pause), `ORACLE_ROLE` (setNAV).
- NAV: `uint256 public nav` in USDC units (6 decimals) per 1e18 tokens; initial `1_000_000` (1.00 USDC). `setNAV(uint256)` reverts if change exceeds `maxNavMovePerUpdate` (default 5%) unless called with an explicit `force` flag by admin — document as an oracle safety rail. Emits `NAVUpdated(oldNav, newNav, timestamp)`.
- Transfer restriction: override `_update(from, to, value)`: if `from != address(0)` require `registry.canHold(from)`; if `to != address(0)` require `registry.canHold(to)`; when paused revert (except burns by issuer, decide and document). Settle coupon accruals for `from` and `to` before balances change (see 5.3).
- `subscribe(uint256 usdcAmount)`: caller must `canHold`; `usdc.safeTransferFrom(msg.sender, address(this), usdcAmount)`; `tokens = usdcAmount * 1e18 / nav`; require `tokens > 0`; `_mint(msg.sender, tokens)`; emit `Subscribed(account, usdcAmount, tokens, nav)`. Optional minimum subscription (default 100 USDC) configurable.
- `redeem(uint256 tokenAmount)`: `usdcOut = tokenAmount * nav / 1e18`; require vault balance ≥ `usdcOut` else revert `InsufficientLiquidity(available, requested)`; `_burn`; `usdc.safeTransfer`. Emit `Redeemed`.
- `distributeCoupon(uint256 usdcAmount)` (ISSUER): `usdc.safeTransferFrom(msg.sender, this, usdcAmount)`; require `totalSupply() > 0`; `couponIndex += usdcAmount * 1e18 / totalSupply()`; emit `CouponDistributed(usdcAmount, couponIndex, distributionId)`.
- `claimCoupon()`: settle caller; pay `accrued[caller]`; zero; emit `CouponClaimed`.
- `pendingCoupon(address) view`.
- `mint(address, uint256)` and `burn(address, uint256)` for ISSUER (operational corrections; document that production uses only subscribe/redeem).
- `pause()/unpause()`.
- Views for the UI: `previewSubscribe(usdc) → tokens`, `previewRedeem(tokens) → usdc`, `vaultBalance()`, `supplyBackedRatio()` (vault USDC + reported portfolio value from oracle field `portfolioValue` set with NAV; keep simple: store `reportedAUM` alongside NAV).

### 5.3 Coupon index pattern (no holder iteration)
```
couponIndex            // cumulative USDC per token, scaled 1e18
userIndex[account]     // last index settled for account
accrued[account]       // USDC (6 dec) claimable

settle(account):
  owed = balanceOf(account) * (couponIndex - userIndex[account]) / 1e18
  accrued[account] += owed
  userIndex[account] = couponIndex

_update(from, to, value): settle(from) if from != 0; settle(to) if to != 0; then super._update
```
Write tests that prove: two holders with 70/30 split receive 70/30 of a distribution; a transfer between distributions does not double-count; a new subscriber after a distribution receives nothing from it.

### 5.4 `MockUSDC`
- 6 decimals, `faucet(address to, uint256 amount)` capped at 10,000 USDC per call and per address per day (simple timestamp map). Clearly named `MockUSDC (Testnet)`.

### 5.5 Tests (`contracts/test/`)
- Unit tests for every function and revert path.
- Fuzz tests: subscribe/redeem round-trip never mints value (`usdcOut <= usdcIn` at same NAV, allowing for rounding ≤ 1 wei-equivalent); coupon accounting conserves total (sum of claims ≤ distributed, difference ≤ dust).
- Invariant tests: `usdc.balanceOf(token) >= sum(accrued)`; `totalSupply` matches minted − burned.
- Gas snapshot (`forge snapshot`) committed; CI fails on > 10% regression.
- Slither runs in CI with a triaged `slither.config.json`; document any accepted findings in `SECURITY.md`.

### 5.6 Scripts and deployment
- `script/Deploy.s.sol`: deploys `MockUSDC`, `IdentityRegistry`, `HBToken`; grants roles to addresses from env; sets blocklist; writes `deployments/base-sepolia.json` `{ chainId, addresses, deployBlock, txHashes, timestamp }`.
- `script/Seed.s.sol`: verifies two demo wallets, funds them from faucet, sets initial NAV.
- Verify all contracts on the explorer; put links in README.
- `contracts/README.md`: how to build, test, deploy, roles table, addresses.

---

## 6. NAV and data engine (`engine/`)

### 6.1 Data model (`engine/data/`)
- `portfolio.json` — simulated holdings. Fields per position: `name` (e.g. `TURKEY USD 6.00% 2029 (illustrative)`), `isin` (`"TBD"` unless taken from an official source and cited), `coupon_pct`, `maturity`, `face_usd`, `clean_price`, `purchase_date`, `day_count` (`30/360`), `frequency` (2). Initial allocation ~40% 2029, 40% 2034, 20% 2036. Include `cash_usd` and `fees_payable_usd`.
- `prices.csv` — `date, name, clean_price, ytm_pct, source` — maintained by hand at first; each row cites a public source or `illustrative`.
- `config.yaml` — management fee 0.75% p.a., simulated fund expenses 0.30% p.a., NAV update policy, oracle safety rail.

### 6.2 Computations (`nav_engine/`)
- Accrued interest (30/360, semi-annual). Dirty price = clean + accrued.
- Position market value = face × dirty / 100.
- Yield-to-maturity from clean price via Newton's method; weighted YTM by market value; modified duration and convexity per position and portfolio.
- Fee accrual daily on NAV.
- `tokens_outstanding` read from chain (`totalSupply`) via RPC; fall back to a cached value with a warning.
- `nav_per_token = (sum(mv) + cash − fees_payable) / tokens_outstanding` (if supply is 0, NAV = 1.00).
- Distribution yield: trailing distributions / average NAV, annualized; show months available.
- Scenario module: NAV impact for parallel yield shifts (±50/±100/±200 bp) and a CDS shock mapping (document the simple assumption used).
- Outputs: `web/public/data/nav.json`, `nav_history.json` (append), `holdings.json`, `scenarios.json`, all with `generated_at`, `source_note`, and `simulated: true`.

### 6.3 Oracle push and attestation
- `push_nav.py`: reads `nav.json`, signs and sends `setNAV` with the ORACLE key from env; respects the 5% rail (use `force` only with an explicit flag and a logged reason). Prints tx hash. Idempotent per day.
- `attest.py`: builds `attestation.json` (holdings, cash, NAV, token supply, `supply_backed_ratio`, timestamp), canonical JSON, ECDSA-signed with an "attestor" key; publishes signature and public key. Label everywhere: *Simulated attestor — an independent firm signs in production.*
- Tests: accrued interest against hand-computed cases; YTM round-trip (price → ytm → price); NAV ties to a hand-built spreadsheet in `engine/tests/fixtures/`; attestation signature verifies.

### 6.4 Scheduling
- `nav-daily.yml` runs the engine on a schedule, commits updated JSON via PR. The oracle push runs only via a manual workflow_dispatch in a protected environment (documented), or locally.

---

## 7. Web app (`web/`)

### 7.1 Design system
- Institutional, calm, data-first. No neon, no memes, no gradients-for-their-own-sake. Light and dark themes.
- Type: IBM Plex Sans for UI, IBM Plex Mono for numbers and addresses; tabular numerals everywhere numbers align.
- Palette: near-black ink, off-white paper, one accent (HitBite blue — use `#2E6BFF` as placeholder until the founders supply the brand hex), semantic green/amber/red for status. Persistent testnet banner in amber.
- Components via shadcn/ui; charts via Recharts with theme-aware colors; skeleton loading states; empty states; error states with recovery actions; toasts for transactions with explorer links.
- Responsive; Lighthouse ≥ 90 on performance/accessibility/best practices for public pages; keyboard-navigable; focus states visible.

### 7.2 Pages
- `/` **Overview.** Product in two sentences; live NAV, weighted YTM, modified duration, trailing distribution yield; portfolio composition (donut) and maturity ladder (bars); NAV history line; "How it works" in five steps; comparison card: hbTRS simulated metrics vs. a tokenized US T-bill reference (parameterized, labelled illustrative); CTA to verify/subscribe; disclaimer.
- `/verify` **Verification.** Connect wallet; form (name, country select, professional-investor attestation checkbox, consent). Blocked countries show a clear message and no submission. On submit: request stored (server route + JSON/SQLite) and, for testnet, auto-approved after a short delay by a registrar worker that calls `addVerified`. Status states: not connected / not verified / pending / verified / blocked.
- `/subscribe` **Subscribe.** USDC amount input, preview tokens at NAV, fee line, minimum; faucet button for MockUSDC; approve → subscribe with progress steps; success card with tx link.
- `/portfolio` **Portfolio.** Balance, value at NAV, cost basis from events, pending coupon, claim; redeem with preview and liquidity check; transaction history (events) with filters; export CSV.
- `/transparency` **Transparency.** Holdings table (illustrative labels), cash, fees payable, NAV vs. on-chain NAV check (must match), supply-backed ratio, attestation JSON + signature + public key with a "verify signature in browser" button, contract addresses, deploy block, links to explorer.
- `/rules` **Compliance rules.** Human-readable explanation of whitelist, blocked countries, transfer restrictions, pause, NAV rail; pulled from `COMPLIANCE_RULES.md`.
- `/risks` **Risks.** Plain-language product and bond risks from `RISKS.md`.
- `/stats` **Stats.** Holders, supply, distributions to date, NAV history, subscriptions/redemptions over time (from events).
- `/admin` **Admin console** (wallet-gated by on-chain roles): pending verification queue with approve/reject, country blocklist editor, set NAV (with rail warning), distribute coupon, pause/unpause, mint/burn corrections with confirmation modals; every action shows the encoded call and requires typed confirmation for destructive ones.
- `/api/nav`, `/api/holdings`, `/api/attestation`, `/api/stats`, `/api/events` — public JSON with caching headers; `/api/openapi.json` and a `/developers` page rendering it.

### 7.3 Data access
- Contract addresses and ABIs generated from `contracts/deployments/base-sepolia.json` and `out/` at build time (script `web/scripts/sync-contracts.ts`).
- Events indexed server-side with `viem.getLogs` from `deployBlock`, cached (60s) in memory or a small SQLite file; expose via `/api/events`.
- Wrong-network detection with a one-click switch to Base Sepolia.

### 7.4 Tests
- Unit tests for formatting/math helpers (NAV preview, decimals).
- Playwright smoke: public pages render, API routes return valid JSON matching zod schemas, transparency check passes against fixture data.
- Wallet flows are validated by the demo script (Section 9) and a manual QA checklist in `README.md`.

---

## 8. Public API and partner integration

`PARTNER_INTEGRATION.md` explains, for a DeFi vault curator or exchange listing team: how to read NAV on-chain and off-chain, how transfer restrictions affect custody wallets (omnibus wallet must be verified), how to verify attestations, event schemas, and an example of pricing the token for collateral using NAV with a haircut. Include a `curl` example for each endpoint and a viem snippet for `nav()` and `canHold()`.

---

## 9. Demo scenario (`demo/`)

`make demo` runs, against Base Sepolia, using two demo wallets from env:
1. Registrar verifies wallet A (country 784 – UAE, professional) and wallet B (country 276 – Germany, professional); attempts to verify wallet C (country 840) and shows the revert.
2. Faucet funds A and B.
3. A subscribes 1,000 USDC; B subscribes 500 USDC.
4. Oracle sets NAV to 1.0043 (within rail).
5. Issuer distributes a 12.00 USDC coupon; A and B claim; the script asserts the 2:1 split.
6. A transfers 100 hbTRS to B (allowed); A attempts a transfer to C (reverts).
7. B redeems 200 hbTRS; the script asserts the USDC received equals preview.
8. Writes `demo/REPORT.md` with every tx hash, balances before/after, assertions, and timing; links in README.

The report is the proof artifact for reviewers. Keep the script idempotent and re-runnable.

---

## 10. Analytics notebook (`notebooks/`)

`portfolio_analytics.ipynb` (also exported to HTML in `docs/`): portfolio cash-flow calendar; YTM, duration, convexity per bond and portfolio; NAV sensitivity table for ±50/100/200 bp; a simple CDS-shock mapping with stated assumptions; fee drag illustration at 10M / 50M / 100M AUM; distribution yield vs. a tokenized T-bill reference. Every chart theme-consistent with the web app; figures saved to `docs/figures/` and used in README. This notebook is where the data-science founder's craft shows; make it clean, commented, reproducible (`make notebook`).

---

## 11. Documentation set

- **README.md (reviewer-first).** Order: one-paragraph what/why → live demo link → 90-second screen recording link → contract addresses (verified) → CI badges → "What is real vs. simulated" table → architecture diagram → quickstart (`make dev`, `make test`, `make demo`) → what HitBite owns vs. what a licensed partner runs in production → team (two founders, one line each) → disclaimers → licence.
- **ARCHITECTURE.md.** Mermaid diagram: engine → nav.json/on-chain NAV → contracts → web/API → partners. Sequence diagrams for subscribe, coupon, redeem.
- **SPEC.md.** Product spec; keep in sync with `../HitBite-MVP-SPEC.md`.
- **SECURITY.md.** Threat model (oracle manipulation, registrar key compromise, vault insolvency on redemption, pause misuse), mitigations in MVP, known limitations, what changes in production (audited vendor contract, independent attestor, licensed custody).
- **COMPLIANCE_RULES.md**, **RISKS.md**, **PARTNER_INTEGRATION.md**, **CHANGELOG.md**, **CONTRIBUTING.md**, **PROGRESS.md**, **PLAN.md**.
- Screenshots in `docs/` for each page (light and dark).

---

## 12. Phases and checkpoints

| Phase | Scope | Checkpoint (all must pass) |
|---|---|---|
| 0 | `PLAN.md`, repo scaffolding, Makefile, CI skeleton, `.env.example`, secret scan | CI green on an empty build |
| 1 | `IdentityRegistry`, `HBToken` core (restrictions, roles, NAV, subscribe/redeem), unit tests | `forge test` green; coverage of every revert path |
| 2 | Coupon index, claim, fuzz + invariant tests, gas snapshot, slither | Tests prove 70/30 split and no double-count; snapshot committed |
| 3 | `MockUSDC`, deploy + seed scripts, Base Sepolia deployment, explorer verification, `deployments/base-sepolia.json` | Addresses verified; README addresses section filled |
| 4 | Engine: data model, accrued interest, YTM, NAV, fees, outputs, tests | `nav.json` ties to fixture spreadsheet to the cent |
| 5 | Oracle push, attestation, daily workflow | On-chain NAV equals `nav.json`; signature verifies |
| 6 | Web scaffold, design system, `/`, `/transparency`, API routes, contract sync | Vercel deploy; Lighthouse ≥ 90 on `/` |
| 7 | `/verify`, `/subscribe`, faucet, registrar worker | New wallet completes verify → subscribe on testnet |
| 8 | `/portfolio`, claim, redeem, events indexer, `/stats` | Coupon distributed by admin is claimable by two wallets; history renders |
| 9 | `/admin`, `/rules`, `/risks`, `/developers`, OpenAPI | Every admin action works with confirmations |
| 10 | Demo script + REPORT.md, notebook + figures, docs set, screenshots, screen recording | `make demo` passes all assertions; README complete; a stranger runs it from README |

Order is strict through Phase 8. Phases 9–10 may interleave. Showcase items (Section 14) only after Phase 10 is done.

---

## 13. Definition of done and QA checklist

Done means all of the following are true:
1. `make test` runs contracts, engine and web tests green locally and in CI.
2. `make demo` completes on Base Sepolia and `demo/REPORT.md` contains passing assertions with tx hashes.
3. Two independent wallets complete verify → subscribe → coupon → claim → transfer → redeem in the web app.
4. An unverified wallet cannot receive tokens; a US- or TR-coded wallet cannot verify; a paused contract blocks transfers.
5. `nav.json`, on-chain `nav()` and the transparency page agree to the cent; attestation verifies in the browser.
6. Public pages score ≥ 90 on Lighthouse; no console errors; mobile layout works.
7. README passes the 60-second test: what, demo, video, addresses, real-vs-simulated, how to run.
8. No secrets in git history; `.env.example` complete; licence and disclaimers present.

Manual QA script (put in README): fresh browser, new wallet, walk every page in light and dark, run each admin action, disconnect mid-transaction, switch network, reload — nothing should dead-end without a message and a next action.

---

## 14. Tiers — what to build in which order

**Core (Phases 1–8).** Contracts, engine, verify/subscribe/portfolio/transparency, API, tests, deployment. Nothing else counts until this works.

**Excellence (Phases 9–10).** Admin console, rules/risks/developers pages, demo script and report, notebook and figures, full documentation set, screenshots, screen recording, security write-up, gas and static analysis.

**Showcase (only after Done).** In this order, each fully working or not included:
1. Turkish language toggle (`next-intl`), full UI translated by Berke's copy.
2. Sukuk series preview: a second token configuration (`hbTRK`, illustrative) sharing the registry, shown as "series" in the UI, demonstrating a multi-series design.
3. Curator view: a page that shows how a vault would price hbTRS as collateral (NAV, haircut, liquidity from vault balance) with live numbers.
4. Email/webhook notifications for admin events (e.g., Resend) with opt-in.
5. Docker Compose local stack (anvil + engine cron + web) with one-command reset and seeded data.
6. Multi-oracle NAV: two ORACLE keys must agree within tolerance before NAV updates (document as production direction).
7. Public status JSON and an uptime badge.

Do not start a showcase item unless the previous one is complete and tested.

---

## 15. Copy blocks (use verbatim, adjust only for grammar)

**Testnet banner:** `Testnet demonstration on Base Sepolia. Simulated portfolio and attestation. Not an offer of securities.`

**Product summary (Overview):** `hbTRS is a whitelisted token representing a simulated, custodied portfolio of Türkiye USD sovereign bonds. Subscriptions and redemptions settle at net asset value in test USDC; coupons are passed through pro-rata. In production the fund is issued and managed by a licensed fund manager; HitBite designs the product, runs the data and transparency layers, and builds distribution.`

**How it works (five steps):** `1. Verify your wallet (professional investors; some countries are excluded). 2. Subscribe in USDC at the current NAV. 3. The portfolio holds Türkiye USD sovereign bonds; NAV updates daily. 4. Coupons are distributed to holders and claimable any time. 5. Redeem at NAV, subject to available liquidity.`

**Footer disclaimer:** `This is a technical demonstration on a public test network. Portfolio data, prices and attestations are simulated or illustrative and are labelled as such. Nothing here is an offer, solicitation or recommendation to buy any security. HitBite is not a licensed financial institution.`

**Real vs. simulated (README table rows):** legal issuer — none / licensed ADGM fund manager; KYC — auto-approve on testnet / partner's KYC vendor; money — MockUSDC / fiat or USDC to the fund's account; custody — none / broker-Euroclear and licensed digital custodian; token contract — ours / vendor's audited implementation of this spec; NAV — our engine / fund administrator's NAV; attestation — simulated signer / independent firm monthly; dashboard and transparency — ours / ours.

---

## 16. Appendix

### 16.1 Country codes (ISO 3166-1 numeric) used in tests and UI
`784` UAE, `682` Saudi Arabia, `634` Qatar, `276` Germany, `826` United Kingdom, `756` Switzerland, `702` Singapore, `840` United States (blocked), `792` Türkiye (blocked in phase one). Keep the select list full (all countries) with blocked ones disabled and explained.

### 16.2 Sample `portfolio.json` shape
```json
{
  "as_of": "2026-09-08",
  "simulated": true,
  "cash_usd": 12500.00,
  "fees_payable_usd": 0.0,
  "positions": [
    {"name": "TURKEY USD 6.00% 2029 (illustrative)", "isin": "TBD", "coupon_pct": 6.00, "maturity": "2029-03-01", "face_usd": 400000, "clean_price": 100.0, "purchase_date": "2026-09-08", "day_count": "30/360", "frequency": 2},
    {"name": "TURKEY USD 6.65% 2034 (illustrative)", "isin": "TBD", "coupon_pct": 6.65, "maturity": "2034-03-01", "face_usd": 400000, "clean_price": 100.0, "purchase_date": "2026-09-08", "day_count": "30/360", "frequency": 2},
    {"name": "TURKEY USD 7.04% 2036 (illustrative)", "isin": "TBD", "coupon_pct": 7.04, "maturity": "2036-03-01", "face_usd": 200000, "clean_price": 100.0, "purchase_date": "2026-09-08", "day_count": "30/360", "frequency": 2}
  ]
}
```
Coupons and maturities are illustrative placeholders chosen to match the yield levels observed on 31 Aug 2026; replace with official reference data when available and cite the source.

### 16.3 NAV formula
```
dirty_i   = clean_i + accrued_i(30/360, semi-annual)
mv_i      = face_i * dirty_i / 100
fees_day  = NAV_prev * (0.0075 + 0.0030) / 365
NAV_total = sum(mv_i) + cash - fees_payable
nav_per_token (USDC, 6 dec) = NAV_total / tokens_outstanding   (1.00 if supply is 0)
```

### 16.4 Subscribe / redeem math (on-chain)
```
tokens (1e18) = usdcAmount (1e6) * 1e18 / nav (1e6)
usdcOut (1e6) = tokens (1e18) * nav (1e6) / 1e18
```

### 16.5 Things reviewers notice
Verified contracts; tests that read like a spec; a demo report with real tx hashes; a README that says what is simulated; consistent numbers across engine, chain and UI; no dead links; no broken dark mode; commit history that shows steady, small progress over ten days.
