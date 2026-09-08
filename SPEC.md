# HitBite Testnet MVP — Specification v1

**Purpose.** A working, public, testnet-only reference implementation of the HitBite product: a whitelisted token representing a custodied portfolio of Türkiye USD sovereign bonds, with NAV-based subscription and redemption, pro-rata coupon distribution, and a transparency layer. It exists to (1) prove the team can ship, (2) specify the token rules and investor-facing layers that HitBite owns in production, and (3) give licensed partners and distribution channels something concrete to quote against.

**What this is not.** Not an offer of securities, not connected to real money, not the production issuance stack. In production the licensed fund manager's stack runs KYC, subscription, custody and issuance; HitBite owns the dashboard, data/NAV pipeline, transparency publishing, token rule specification and integrations. The subscription flow here simulates the flow the partner's vendor will run.

**Owner.** Artun (build). Berke (copy, test users, feedback). Timeline: 10 days. Tooling: any AI coding assistant is expected; ship over polish.

---

## 1. Scope (must ship)

### 1.1 Smart contracts (Solidity ^0.8.24, Foundry, OpenZeppelin)
- **IdentityRegistry** — on-chain whitelist. `addVerified(address, uint16 countryCode)`, `removeVerified(address)`, `isVerified(address) → bool`, `countryOf(address)`. Role: `REGISTRAR_ROLE`. Block a configurable list of country codes (at minimum US = 840, TR = 792 for the first phase).
- **HBToken** — ERC-20 (18 decimals) with transfer restrictions. Symbol `hbTRS`, name `HitBite Türkiye Sovereign (Testnet)`.
  - Transfers (`transfer`, `transferFrom`) succeed only if **both** sender and receiver are verified; mint to unverified reverts.
  - `ISSUER_ROLE`: `mint`, `burn`, `pause/unpause`.
  - `ORACLE_ROLE`: `setNAV(uint256 navPerToken)` (USDC-denominated, 6 decimals) — emits `NAVUpdated(nav, timestamp)`.
  - `subscribe(uint256 usdcAmount)`: pulls test USDC via `transferFrom`, mints `usdcAmount * 1e18 / nav` tokens to the caller (caller must be verified). Emits `Subscribed`.
  - `redeem(uint256 tokenAmount)`: burns, pays `tokenAmount * nav / 1e18` USDC from the contract's vault balance. Emits `Redeemed`. Revert if vault balance insufficient (MVP has no liquidity guarantee — say so in README).
  - `distributeCoupon(uint256 usdcAmount)` (ISSUER_ROLE): pulls USDC and increases a cumulative `couponIndex` (reward-per-token pattern). `claimCoupon()` pays each holder their accrued share. Emits `CouponDistributed`, `CouponClaimed`. Do not iterate holders; use the index pattern.
  - `pause` blocks subscribe/redeem/transfer.
- **MockUSDC** — 6-decimal mintable ERC-20 with a public faucet `mint(address, amount)` capped per call, for testnet only.
- **Tests (Foundry)** — restriction (unverified sender/receiver reverts), subscribe math at three NAV values, redeem math and insufficient-vault revert, coupon index correctness across two distributions and a transfer between them, pause behaviour, role checks. Target: all green, run in CI.
- **Deployment** — Base Sepolia (fallback: Avalanche Fuji). Script `Deploy.s.sol` writes addresses to `deployments/base-sepolia.json`. Verify contracts on the explorer.

### 1.2 NAV & data pipeline (Python 3.11)
- `nav_engine/portfolio.json` — simulated holdings: e.g. 40% TURKEY 6.0% 2029, 40% TURKEY 6.65% 2034, 20% TURKEY 7.04% 2036, with ISIN, coupon, maturity, face, clean price, purchase date. Mark clearly as **simulated**.
- `nav_engine/prices.csv` — daily prices/yields, maintained manually at first (source noted per row; e.g. public yield reports). No scraping of paywalled sources.
- `nav_engine/compute_nav.py` — computes dirty prices (clean + accrued), portfolio value, cash, fees accrual (0.75% p.a. management fee, 0.30% p.a. simulated fund expenses), tokens outstanding (read from chain), `nav_per_token`, weighted yield-to-maturity, 30-day trailing distribution yield. Outputs `public/data/nav.json` with timestamp.
- `nav_engine/push_nav.py` — signs and sends `setNAV` on-chain with the ORACLE key (env var). Runs on demand and via a scheduled GitHub Action (daily).
- `nav_engine/attest.py` — produces `public/data/attestation.json`: holdings, cash, NAV, token supply, `supply_backed_ratio`, timestamp; signed with an ECDSA key labelled **"Simulated attestor — replaced by an independent firm in production."** Publishes the signature and the public key.

### 1.3 Web app (Next.js 14, TypeScript, wagmi + viem, RainbowKit; Tailwind)
Deployed on Vercel. Pages:
- **/** — one-screen product summary: what the token is, live NAV, weighted YTM, trailing distribution yield, portfolio composition chart, "how it works" (five steps), testnet banner and disclaimer.
- **/verify** — connect wallet → form (name, country, "I am a professional investor" checkbox) → request stored → admin whitelists (MVP: auto-approve for non-blocked countries after a 10-second delay to simulate KYC). Shows status: not verified / pending / verified.
- **/subscribe** — enter USDC → preview tokens at current NAV and the fee line → `approve` then `subscribe`. Faucet button for MockUSDC.
- **/portfolio** — token balance, USD value at NAV, accrued coupons, `Claim`, `Redeem` with preview; transaction history from events.
- **/transparency** — holdings table, cash, NAV history chart, attestation JSON + signature + public key, contract addresses, supply-backed ratio, link to explorer.
- **/admin** (wallet-gated to ISSUER/ORACLE/REGISTRAR roles) — whitelist list and country blocklist, `setNAV`, `distributeCoupon`, pause.
- Global: testnet-only banner; "Not an offer of securities" footer; no marketing claims about returns.

### 1.4 Repository & hygiene
- Public GitHub repo `hitbite/mvp`. README: purpose, architecture diagram, contract addresses, how to run, what is simulated, what HitBite owns vs. what a licensed partner runs in production, disclaimers.
- MIT license. CI: Foundry tests + Python lint on every push. `.env.example` for keys. No private keys in repo, ever.
- A 90-second **product demo screen recording** (separate from the Alliance founder video, which must not contain a demo) linked from README.

## 2. Out of scope (do not build)
Real KYC vendor integration; real custody; fiat on-ramp; secondary trading or AMM; mobile app; multi-chain; token launch; any mainnet deployment; marketing pages beyond the landing.

## 3. Ten-day plan
| Day | Deliverable | Done when |
|---|---|---|
| 1 | Repo, Foundry project, `IdentityRegistry` + `HBToken` skeleton | Compiles; role tests pass |
| 2 | Subscribe/redeem/coupon logic + full test suite | All tests green |
| 3 | `MockUSDC`, deploy script, Base Sepolia deployment, explorer verification | Addresses in `deployments/`, README updated |
| 4 | `portfolio.json`, `prices.csv`, `compute_nav.py` | `nav.json` produced; NAV ties out by hand |
| 5 | `push_nav.py`, GitHub Action, `attest.py` | On-chain NAV matches `nav.json`; attestation signed |
| 6 | Web app scaffold, wallet connect, `/` with live data | Deployed on Vercel |
| 7 | `/verify` + `/subscribe` + faucet | A new wallet can verify and subscribe end-to-end |
| 8 | `/portfolio` + claim/redeem + event history | Coupon distributed by admin is claimable by two test wallets |
| 9 | `/transparency` + `/admin` + disclaimers | Attestation and holdings render; admin actions work |
| 10 | README, architecture diagram, CI badge, 90-second screen recording | A stranger can run it from README; Berke completes the flow without help |

## 4. Definition of done
1. Two independent test wallets complete verify → subscribe → receive coupon → claim → redeem on Base Sepolia.
2. An unverified wallet cannot receive tokens; a US-coded wallet cannot verify.
3. `nav.json`, on-chain NAV and the transparency page agree to the cent.
4. CI green; README complete; demo recording linked.

## 5. What this MVP says to each audience
- **Alliance:** two founders shipped a working, tested, deployed product in ten days; the data-science founder owns the on-chain and data layers.
- **Licensed fund manager / tokenization vendor:** this is the exact token behaviour and investor experience we want; quote against it.
- **Distribution partners (DeFi curators, exchanges):** transfer rules, NAV oracle and transparency you would integrate with.
- **Regulators (later):** a transparent, whitelisted, registry-anchored design consistent with a "recorded and tracked" model.

## 6. Production mapping (to keep us honest)
| Layer | MVP (testnet) | Production (first issuance) |
|---|---|---|
| Legal issuer | none (simulation) | Licensed ADGM fund manager's fund |
| KYC / whitelist | auto-approve | Partner's KYC vendor writes to the registry |
| Subscription & money | MockUSDC to contract | Partner's portal; fiat/USDC to the fund's account |
| Custody | none | Bonds at broker/Euroclear; tokens with licensed digital custodian |
| Token contract | ours | Vendor's audited contract implementing this spec |
| NAV oracle | our Python job | Fund administrator's NAV, published by us / oracle |
| Attestation | simulated signer | Independent firm, monthly |
| Dashboard & transparency | ours | ours (white-label front to the partner's flow) |
