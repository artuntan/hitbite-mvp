# HitBite Testnet v2 — Build Brief for the Coding Agent

**Read this file fully before writing any code.** Then produce `PLAN.md`, wait for the founder's approval of the plan, and execute phase by phase. Keep `PROGRESS.md` and `STATUS.md` updated as described in Section 9. Never skip a checkpoint.

---

## 0. What this is, in one paragraph

HitBite gives compliant on-chain access to Türkiye's USD sovereign bonds. In production a licensed fund manager in Abu Dhabi (ADGM) issues a regulated fund that holds the bonds, and the HitBite token represents units in that fund. This repository is the **testnet reference implementation** of the investor-facing product: a whitelisted token, subscriptions and redemptions at NAV, coupon pass-through, a NAV and attestation pipeline, and a web app where a user can do the whole flow and understand every step. It runs on **Arc Testnet** (Circle's chain, USDC as native gas) with real testnet USDC. It is not an offer of securities, it touches no real money, and it is not the production issuance stack.

Two people will judge this repo: a technical reviewer at an accelerator who opens the GitHub link and the live app for ten minutes, and a partner at a licensed fund manager who wants to see exactly what token behaviour and investor experience we want. Build for both. The bar is: a stranger with a wallet completes the flow in five minutes without help, and can explain afterwards what happened on-chain.

## 1. Why v2 exists (learn from v1)

v1 (branch `v1-base-sepolia`) worked but failed the founder's review for three reasons: it was too complicated (many pages, many states), the UI/UX did not follow a design system, and nobody could tell which parts worked and which didn't. v2 fixes all three by design:

1. **One flow, one screen.** The product is a single guided flow with five steps. Everything else is secondary.
2. **`design.md` is the visual source of truth.** The founder provides it. You implement it. You do not invent visual language, colours, typography, spacing, or component styles. If `design.md` is missing or silent on something, use the plainest possible default (system font, one accent colour, generous whitespace) and list the gap in `PROGRESS.md`.
3. **Nothing is "done" until `STATUS.md` says so,** and `STATUS.md` is written by an automated end-to-end run against the live testnet, not by hand.

## 2. Non-negotiable rules

- Testnet only. No mainnet configuration, keys, or deployment scripts. `chainId` allowlist in code: Arc Testnet (5042002), Base Sepolia (84532, fallback), local anvil.
- No fabricated real-world identifiers presented as real: no real ISINs, no audit claims, no partner logos, no "regulated by" language. Portfolio data is **clearly labelled simulated**.
- No token launch, no airdrop, no points, no referral mechanics, no yield promises. The word "APY" does not appear in the UI. "Yield to maturity" and "distribution yield" appear only on the Transparency page with the word "simulated" next to them.
- Secrets only via environment variables. `.env.example` lists every variable with a comment. Private keys never appear in code, logs, README, or commit history. Add `.env*` to `.gitignore` before the first commit.
- Small commits with descriptive messages, pushed at each checkpoint. The founder must be able to read the history and see the work happen; no single "big bang" commit.
- Do not delete v1. Before touching anything, make sure v1 lives on branch `v1-base-sepolia` (tag `v1`). v2 is built fresh on `main`.
- When unsure about a product or legal wording question, write the question in `PROGRESS.md` under "Questions for the founder" and pick the most conservative option to keep moving.

## 3. Target chain: Arc Testnet (verified 20 Sep 2026 from docs.arc.io)

| Item | Value |
|---|---|
| Network name | Arc Testnet |
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.io` (alternatives: `https://rpc.drpc.testnet.arc.io`, `https://rpc.quicknode.testnet.arc.io`) |
| WebSocket | `wss://rpc.testnet.arc.io` |
| Explorer | `https://explorer.testnet.arc.io` |
| Faucet | `https://faucet.circle.com` |
| Native gas token | USDC (native interface uses 18 decimals) |
| USDC ERC-20 interface | `0x3600000000000000000000000000000000000000`, **6 decimals**, same balance as the native token, satisfies `IERC20` directly. There is no wrapped USDC. |
| Fee market | EIP-1559. **Minimum base fee 20 gwei**; set `maxFeePerGas` ≥ 20 gwei on every transaction. Base fee goes to the block beneficiary. |
| Finality | Deterministic and instant; a transaction is final on inclusion. |
| EVM | Osaka baseline (EIP-7702 supported). `PREVRANDAO` returns 0. No blob transactions. `block.timestamp` is one-second granularity and non-decreasing; use block number for ordering. Transfers to the zero address are forbidden at runtime. |
| Tooling | Solidity, Foundry, Hardhat, viem and standard wallets work. For local simulation Circle recommends Arc Foundry (`arc-anvil --network arc`); standard anvil is acceptable for unit tests but not for Arc-specific behaviour. |

Consequences for us:
- **No MockUSDC on Arc.** Subscriptions, redemptions and coupons use the real testnet USDC ERC-20 interface at `0x3600…0000` (6 decimals). Users get testnet USDC from the Circle faucet; the app shows the faucet link and a one-click "Add Arc Testnet to wallet" button.
- **Gas is paid in USDC.** The app shows one USDC balance (never two rows) and warns the user to keep a small USDC balance for gas before a full-balance subscription.
- **Decimals discipline.** All contract math with USDC uses 6 decimals. Never mix the 18-decimal native representation into contract logic. Write a unit test that proves the subscribe/redeem math with 6-decimal USDC and 18-decimal hbTRS.
- **Never send USDC to `address(0)`.** Burning hbTRS is our own ERC-20 burn, fine; USDC never moves to zero.
- **Chain config is data, not code.** `packages/config/chains.ts` holds Arc Testnet, Base Sepolia (fallback) and local. Switching the fallback on requires only an env var. Base Sepolia keeps a `MockUSDC` deployment for parity; Arc does not.

## 4. Inputs you have

- `design.md` — the founder's design system and screen design. Source of truth for the UI.
- This brief.
- The v1 branch for reference only (do not copy code blindly; v1 contracts may be reused if their tests pass and they meet Section 5, but the app is rewritten).

## 5. Product specification

### 5.1 Contracts (Solidity ^0.8.24, Foundry, OpenZeppelin 5)

**`IdentityRegistry`** — on-chain whitelist.
- `addVerified(address account, uint16 countryCode)`, `removeVerified(address)`, `isVerified(address) → bool`, `countryOf(address) → uint16`.
- `REGISTRAR_ROLE`. Country blocklist configurable; initial blocklist `840` (US) and `792` (TR). `addVerified` reverts for blocked countries.
- Events: `Verified(account, country)`, `Revoked(account)`, `CountryBlocked(code, blocked)`.

**`HBToken`** — ERC-20, 18 decimals, symbol `hbTRS`, name `HitBite Türkiye Sovereign (Testnet)`.
- Transfers succeed only if sender and receiver are verified; mint to unverified reverts.
- Roles: `ISSUER_ROLE` (mint, burn, pause, unpause, distributeCoupon), `ORACLE_ROLE` (setNAV).
- `setNAV(uint256 navPerToken)` in USDC 6-decimals per 1e18 hbTRS. Emits `NAVUpdated(nav, timestamp, blockNumber)`. Guard: a single update may not move NAV by more than 5% (`NAV_RAIL_BPS = 500`) unless called with an explicit `force` flag by ISSUER.
- `subscribe(uint256 usdcAmount)`: pulls USDC via `transferFrom`, mints `usdcAmount * 1e18 / nav` hbTRS to the caller (caller must be verified). Emits `Subscribed(account, usdcIn, tokensOut, nav)`.
- `redeem(uint256 tokenAmount)`: burns, pays `tokenAmount * nav / 1e18` USDC from the contract's balance. Emits `Redeemed(account, tokensIn, usdcOut, nav)`. Reverts with a clear custom error if the vault balance is insufficient; the app explains this ("the testnet vault is funded by the admin; there is no liquidity guarantee").
- `distributeCoupon(uint256 usdcAmount)` (ISSUER): pulls USDC, increases cumulative `couponIndex` (reward-per-token pattern, no holder iteration). `claimCoupon()` pays each holder their accrued share. `accruedCoupon(address) → uint256` view. Events `CouponDistributed(usdcAmount, index)`, `CouponClaimed(account, usdcAmount)`.
- `pause()` blocks subscribe, redeem, transfer, claim; `unpause()` restores.
- `settlementAsset()` returns the USDC address in use (Arc: `0x3600…0000`).

**`MockUSDC`** — 6-decimal mintable ERC-20 with a capped public faucet, **deployed only on Base Sepolia and local**. Arc uses the real testnet USDC.

**Tests (Foundry, all green, run in CI):** transfer restriction (unverified sender/receiver reverts), subscribe math at three NAV values with 6-decimal USDC, redeem math and insufficient-vault revert, coupon index correctness across two distributions with a transfer in between, pause behaviour, role checks, NAV rail, blocked-country revert. Fuzz the subscribe/redeem round trip (subscribe then redeem returns the same USDC minus rounding ≤ 1 unit).

**Deployment:** `script/Deploy.s.sol` writes `deployments/<chain>.json` (addresses, block number, deployer, timestamp). Deploy to Arc Testnet with `maxFeePerGas ≥ 20 gwei`. Verify contracts on `explorer.testnet.arc.io` using the explorer's documented verification method; if the explorer does not support programmatic verification yet, commit the standard JSON input and metadata under `deployments/verification/` and link them from the README so anyone can verify by hand. Fund the vault with faucet USDC for redemptions and coupons; document the amounts in `deployments/arc-testnet.json`.

### 5.2 NAV and attestation engine (Python 3.11, `nav_engine/`)

Keep it to three files and one command.
- `portfolio.json` — simulated holdings, clearly marked `"simulated": true`: 40% TURKEY 6.0% 2029, 40% TURKEY 6.65% 2034, 20% TURKEY 7.04% 2036, with coupon, maturity, face, clean price, purchase date. No real ISINs.
- `prices.csv` — daily clean prices with a `source` column (public yield reports, manual entry). No scraping of paywalled sources.
- `hb.py` with subcommands: `nav` (compute dirty prices, portfolio value, cash, fee accrual 0.75% p.a. management + 0.30% p.a. simulated fund expenses, tokens outstanding read from chain, `nav_per_token`, weighted YTM, 30-day trailing distribution yield → `public/data/nav.json`), `push` (signs and sends `setNAV` with the ORACLE key from env), `attest` (writes `public/data/attestation.json` with holdings, cash, NAV, supply, `supply_backed_ratio`, timestamp, signed with an ECDSA key labelled **"Simulated attestor, replaced by an independent firm in production"**, plus the public key). Deterministic output; a `--dry-run` flag prints what would be pushed.
- GitHub Action `nav.yml`: daily at 07:00 UTC, runs `nav` → `push` → `attest`, commits the JSON outputs. A second Action `coupon.yml` (Excellence tier): on the 1st of each month calls `distributeCoupon` with the simulated monthly coupon amount so the testnet visibly pays coupons on schedule.

### 5.3 Web app (Next.js 14 app router, TypeScript, wagmi + viem, RainbowKit, Tailwind; Vercel)

Four routes. Nothing else.

**`/` Overview.** What hbTRS is in three sentences. Live NAV with last update time and block. Portfolio composition (three bars, "simulated" label). Next simulated coupon date. One primary button: "Open the app". A five-step "How it works" strip: Verify → Subscribe → Hold → Coupons → Redeem, each with one sentence about what happens on-chain. Testnet banner at the top of every page: "Testnet. Simulated portfolio. Not an offer of securities."

**`/app` The flow.** One screen, a vertical stepper on the left, the active step in the middle, "Your position" on the right.
1. *Connect.* Wallet connect. If the wallet is on the wrong network, a single button adds and switches to Arc Testnet. Shows one USDC balance. If the balance is zero, shows the faucet link and the sentence "Gas on Arc is paid in USDC."
2. *Verify.* Form: name, country (dropdown), professional-investor checkbox. On submit the app calls a tiny API route that whitelists the address after a 10-second simulated review (non-blocked countries only; blocked countries get a clear message "Not available to residents of the United States or Türkiye on this testnet"). Status pill: Not verified / Pending / Verified.
3. *Subscribe.* Input USDC amount → preview: tokens at current NAV, fee line (0), gas note. Two transactions, `approve` then `subscribe`, shown as two explicit sub-steps with their own receipts.
4. *Hold.* Position card: hbTRS balance, value at NAV, accrued coupons, "Claim coupons" button. Activity log: every event for this address (Verified, Subscribed, CouponDistributed, CouponClaimed, Redeemed) with block number and explorer link.
5. *Redeem.* Input tokens → preview USDC out at NAV → `redeem`. If the vault cannot cover it, say so before the user signs.

Every on-chain action has the same three-part card: **What will happen** (one sentence, contract name and function), **Sign** (button; disabled with the reason when it cannot proceed), **Receipt** (tx hash, block, explorer link, the events emitted). A "Walkthrough" toggle in the header turns on one-line captions under every element explaining it in plain language; off by default, remembered per browser.

**`/transparency`.** Holdings table (simulated), cash, NAV history chart from `nav.json` history, attestation JSON with signature and public key and a **"Verify signature" button that verifies client-side**, contract addresses with explorer links, supply-backed ratio, and the production mapping table from Section 7 rendered as plain text.

**`/admin`.** Wallet-gated to ISSUER, ORACLE and REGISTRAR roles: whitelist table and country blocklist, `setNAV`, `distributeCoupon`, pause/unpause, vault funding status. Minimal, functional, no styling beyond `design.md` defaults.

Global: no marketing sections, no testimonials, no returns claims. Footer: "Not an offer of securities. Testnet only." with a link to the GitHub repo.

### 5.4 Observability for the founder

- `pnpm e2e` runs `scripts/e2e.ts` (viem, two funded test wallets from env, no browser): fresh wallet → verify (via the API route) → approve → subscribe → admin distributes coupon → claim → redeem → pause blocks subscribe → unpause. Each step records pass/fail, tx hash and explorer link, and the script writes **`STATUS.md`**: a feature matrix (contracts, NAV engine, each app step, transparency, admin, CI) with ✅ / ⚠️ / ❌, timestamps and links. `STATUS.md` is the only place "what works" is claimed. The README links to it.
- `pnpm smoke` runs the same in read-only mode (no transactions) to check RPC, addresses and NAV freshness.
- CI (`ci.yml`): Foundry tests, Python lint and a NAV dry-run, TypeScript type-check, Next build. Green badge in README.

## 6. Tiers

- **Core (must ship):** everything in 5.1, 5.2 (`nav`, `push`, `attest`, daily Action), 5.3 (`/`, `/app`, `/transparency`, `/admin`), 5.4, README, CI, Arc Testnet deployment with a funded vault.
- **Excellence (ship if Core is green with a day to spare):** monthly coupon Action, client-side attestation verification, activity log with pagination, `arc-anvil` local script, Base Sepolia fallback deployment and the chain switch in config.
- **Showcase (only after Excellence):** a 90-second product screen recording linked from the README (this is separate from any founder video), a `docs/architecture.md` with one diagram, a "what HitBite owns vs what the licensed partner runs" page in the app.

## 7. Production mapping (keep this table in the README and in `/transparency`)

| Layer | Testnet v2 | Production (first issuance) |
|---|---|---|
| Legal issuer | none (simulation) | Licensed ADGM fund manager's fund |
| KYC / whitelist | 10-second simulated review | Partner's KYC vendor writes to the registry |
| Money | testnet USDC on Arc | Fiat/USDC into the fund's account via the partner |
| Custody | none | Bonds at broker/Euroclear; tokens with a licensed digital custodian |
| Token contract | ours | Vendor's audited contract implementing this behaviour |
| NAV | our Python job | Fund administrator's NAV, published by us |
| Attestation | simulated signer | Independent firm, monthly |
| App and transparency | ours | ours, fronting the partner's flow |

## 8. Phases and checkpoints

Each checkpoint ends with a commit, an entry in `PROGRESS.md`, and the founder's OK before the next phase. Estimated total: eight working days.

0. **Plan (half day).** Read `design.md` and this brief. Write `PLAN.md`: file tree, component list mapped to `design.md`, contract interfaces, env variables, the exact commands the founder will run. List open questions. Stop and wait for approval.
1. **Repo and safety (half day).** v1 preserved on `v1-base-sepolia` (tag `v1`). Fresh `main`: pnpm workspace with `contracts/`, `nav_engine/`, `app/`, `scripts/`, `packages/config`. `.gitignore`, `.env.example`, CI skeleton, MIT licence, README stub with the production mapping table. Checkpoint: CI green on an empty build.
2. **Contracts (1.5 days).** Contracts, full test suite, fuzz test, deploy script. Checkpoint: `forge test` green; coverage report in `PROGRESS.md`.
3. **Arc deployment (half day).** Deploy to Arc Testnet, verify or publish verification inputs, fund vault, write `deployments/arc-testnet.json`. Checkpoint: explorer links in `PROGRESS.md`; a manual `cast` subscribe from a test wallet succeeds.
4. **NAV engine (1 day).** `portfolio.json`, `prices.csv`, `hb.py nav|push|attest`, daily Action. Checkpoint: `nav.json` on disk, on-chain NAV equal to it, attestation signature verifies with a one-line Python snippet.
5. **App: flow (2 days).** `/app` end to end against Arc Testnet following `design.md`. Checkpoint: the founder completes the flow from a fresh wallet without help; screenshots of each step in `PROGRESS.md`.
6. **App: overview, transparency, admin (1 day).** Checkpoint: NAV on `/` equals `nav.json` and on-chain NAV to the cent; attestation renders and verifies.
7. **E2E and STATUS (half day).** `scripts/e2e.ts`, `pnpm e2e` writes `STATUS.md`; `pnpm smoke`. Checkpoint: `STATUS.md` all ✅ for Core.
8. **README and handover (half day).** "Try it in 5 minutes" (faucet → add network → connect → verify → subscribe), architecture, what is simulated, what HitBite owns vs the partner, disclaimers, links to `STATUS.md`, deployments and explorer. Checkpoint: a stranger can follow the README; the founder confirms.

## 9. Reporting files

- `PLAN.md` — written once in Phase 0, updated only if scope changes (with a dated note).
- `PROGRESS.md` — append-only log: date, phase, what was done, what was verified and how, open questions for the founder, known gaps.
- `STATUS.md` — generated by `pnpm e2e` only. Never edited by hand.
- `deployments/arc-testnet.json` — addresses, block numbers, vault funding, explorer links.

## 10. Copy blocks (use verbatim)

- Testnet banner: "Testnet. Simulated portfolio. Not an offer of securities."
- Blocked country: "Not available to residents of the United States or Türkiye on this testnet."
- Vault notice: "Redemptions on the testnet are paid from a vault the admin funds. There is no liquidity guarantee."
- Attestation label: "Simulated attestor. Replaced by an independent firm in production."
- Gas notice: "Gas on Arc is paid in USDC. Keep a small balance for fees."
- Footer: "Not an offer of securities. Testnet only."

## 11. Definition of done (all must hold)

1. Two independent test wallets complete verify → subscribe → receive coupon → claim → redeem on Arc Testnet, recorded in `STATUS.md` with tx links.
2. An unverified wallet cannot receive hbTRS; a US-coded or TR-coded wallet cannot verify.
3. `nav.json`, on-chain NAV and the `/` and `/transparency` pages agree to the cent.
4. The attestation signature verifies client-side on `/transparency`.
5. CI green; README complete; `STATUS.md` all ✅ for Core; the founder ran the flow from a fresh wallet without asking a question.
6. The UI matches `design.md`; every deviation is listed in `PROGRESS.md` with a reason.

## 12. How to start

First message to the agent, verbatim:

> Read `BUILD_PROMPT_V2.md` and `design.md` fully. Confirm v1 is preserved on branch `v1-base-sepolia` with tag `v1`. Then produce `PLAN.md` as described in Section 8, Phase 0, and stop for my approval. Do not write application code before I approve the plan.
