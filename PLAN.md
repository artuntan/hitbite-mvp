# HitBite Testnet v2 — implementation plan

**2026-09-20 · Phase 0 plan approved by the founder; Phase 1 authorized.**

Approval record (2026-09-20): the founder approved this plan, including its Next.js 16 amendment, NAV bootstrap model and revoked-holder exit policy. Proposed/pending wording below is retained as the original planning record; approval is also recorded in `PROGRESS.md`. Later phases retain their separate checkpoints.

Execution amendment (2026-09-20): the founder subsequently instructed the agent to continue until the platform is complete without further phase-approval stops. Checkpoint tests, reports, commits and pushes still apply; earlier approval-stop language is superseded. The founder has funded the testnet accounts and enabled Vercel access.

Scope change: this plan replaces the v1 plan with the attached Arc Testnet v2 brief. [BUILD_PROMPT_V2.md](BUILD_PROMPT_V2.md) defines the product; [design.md](design.md) defines its visual system. Both are byte-for-byte copies of the supplied attachments. The previous plan and implementation remain available at [tag v1](https://github.com/artuntan/hitbite-mvp/tree/v1).

No v2 application code is included in Phase 0. Each subsequent phase ends with evidence in `PROGRESS.md`, a descriptive commit, a push, and founder approval before the next phase. `STATUS.md` is generated only by `pnpm e2e`; it does not exist yet and will not be created manually. Older entries in `PROGRESS.md` describe v1, not v2.

## 1. Repository baseline and preservation

- Workspace branch: `plan-and-build-from-build-prompt`; keep its name and work in this workspace.
- V1 snapshot: `2fc8f9e75229ceca4a7347ffd089e76185030c16`.
- Created and pushed `v1-base-sepolia` and annotated tag `v1` at that snapshot before changing files. Verified the remote branch and peeled tag resolve to the same commit.
- `origin/main` currently contains only `.gitkeep` at `42da28add1beb83d328924f3e2740ecf33922e57`. The v1 application has not been merged there.
- Build the fresh v2 tree on the existing workspace branch and integrate it into `main` through review. Do not rename the workspace branch, reset history, force-push, or replace the preserved v1 refs. This reconciles the brief's fresh-main destination with the workspace instruction to retain its branch.
- Phase 1 removes superseded v1 application directories and workflows from the v2 working tree after preservation; v1 remains fully recoverable from its refs. Retain applicable MIT licensing and dependency attribution. Contracts are reused only after a requirements review and passing v2 tests; the UI is rewritten.
- Node, pnpm, Python 3.11, uv, forge, cast, and gh are available. `.env*` is already ignored except the documented `.env.example`; `.context/` is ignored. No credentials were inspected or printed.

## 2. Scope and decisions proposed for approval

| Decision | Proposed implementation |
| --- | --- |
| Four product routes | `/`, `/app`, `/transparency`, `/admin`. One verification API route is infrastructure, not another product screen. No v1 marketing, rules, developer, or risk routes carry forward. |
| Framework version | The brief requests Next.js 14. Its [official support policy](https://nextjs.org/support-policy), checked 2026-09-20, lists 14 as unsupported and 16 as Active LTS. Propose Next.js 16 App Router, TypeScript, Tailwind, wagmi, viem, RainbowKit; pin compatible stable versions in Phase 1. This is an explicit proposed scope amendment, pending approval. |
| Client-side attestation verification | Core: required by §5.3 and definition of done §11, despite its duplicate placement under Excellence. |
| Chain switch | Core configuration supports Arc Testnet, Base Sepolia, and local Anvil. An actual Base Sepolia deployment remains Excellence. |
| Font | Use the design's permitted Inter substitute, self-hosted, weights 400–600; Inconsolata for technical captions. No proprietary font files were supplied. |
| NAV update interface | Preserve `setNAV(uint256)` for normal oracle writes; add `setNAV(uint256,bool)` for an explicit issuer-only forced update. A normal update checks the previous NAV, not v1's rolling 24-hour anchor. |
| Coupon liquidity | Reserve unpaid coupon funds so redemptions cannot consume another holder's entitlement. Report both total vault cash and spendable redemption cash. |
| Coupon accounting | The issuer funds testnet distributions externally as specified. `distributeCoupon` does not silently change NAV. Simulated bond coupon cash and externally funded on-chain coupon payments are identified separately; the NAV engine must not count the same cash twice. |
| Revoked holders | Transfers and mint/subscription require current eligibility. Propose allowing a revoked holder to redeem existing tokens and claim earned coupons while unpaused; no receiving new tokens. This exit policy is not specified in v2 and needs approval before Phase 2. |
| NAV bootstrap | Propose a disclosed reference basket scaled to actual on-chain supply, with separate simulated assets and real testnet vault liquidity. See §6. This avoids dividing a large fixed simulated book by a tiny testnet supply. The model needs approval before Phase 4. |
| Evidence | A transaction runner proves transaction behavior. Browser evidence is separately collected and consumed by the runner; missing UI evidence cannot become a green UI row in `STATUS.md`. |

Core includes every behavior in brief §§5.1–5.4, documentation, CI, Arc deployment, funded liquidity, and all six definition-of-done items. Excellence starts only after Core is green with a day available. Showcase is deferred; any later extra page would need an explicit amendment to the four-route limit.

## 3. Intended file tree

Paths below are planned outputs, not claims that these files already exist. `app/` is the pnpm package; `app/src/app/` is its Next.js route directory. The brief's `public/data/` is `app/public/data/` in this workspace.

```text
BUILD_PROMPT_V2.md              # unmodified founder brief
design.md                      # unmodified supplied design
PLAN.md
PROGRESS.md                    # append-only checkpoint evidence/questions
STATUS.md                      # generated later, only by pnpm e2e
README.md                      # five-minute guide + production mapping
LICENSE
.gitignore
.env.example                   # every supported variable documented
.nvmrc
package.json                   # root command interface
pnpm-workspace.yaml
pnpm-lock.yaml
tsconfig.json
.github/workflows/
  ci.yml
  nav.yml                      # 07:00 UTC, nav -> push -> attest -> commit
  coupon.yml                   # Excellence only
contracts/
  foundry.toml
  lib/                         # pinned OpenZeppelin 5 + forge-std
  src/{IdentityRegistry,HBToken,MockUSDC}.sol
  src/interfaces/{IIdentityRegistry,IHBToken}.sol
  script/Deploy.s.sol
  test/{IdentityRegistry,HBToken,HBTokenCoupon,MockUSDC}.t.sol
  test/HBTokenRoundTrip.fuzz.t.sol
  test/invariant/CouponReserve.t.sol
deployments/
  arc-testnet.json              # real receipts only, never placeholders
  local.json
  verification/                # standard JSON input, metadata, constructor args
packages/config/
  package.json
  chains.ts                    # only 5042002, 84532, 31337
  env.ts                       # public/server validation boundaries
  contracts.ts                 # typed ABI + deployment artifact validation
  copy.ts                      # exact copy blocks + production mapping
nav_engine/
  portfolio.json
  prices.csv
  hb.py                        # PEP 723 pinned deps; nav | push | attest
app/
  package.json
  next.config.ts
  tsconfig.json
  postcss.config.mjs
  public/fonts/                # permitted open-source fonts + licences
  public/data/{nav,attestation}.json
  src/app/
    layout.tsx
    globals.css
    page.tsx
    app/page.tsx
    transparency/page.tsx
    admin/page.tsx
    api/verify/route.ts
  src/components/
    ui/{Button,Card,Input,Select,Checkbox,Badge,Table}.tsx
    shell/{Header,TestnetBanner,Footer,WalkthroughToggle}.tsx
    flow/{FlowShell,Stepper,ActionCard,Receipt,Position,ActivityLog}.tsx
    flow/steps/{Connect,Verify,Subscribe,Hold,Redeem}.tsx
    transparency/{Holdings,NavHistory,Attestation,ProductionMapping}.tsx
    admin/{RegistryPanel,NavPanel,CouponPanel,PausePanel,VaultPanel}.tsx
  src/lib/
    providers.tsx
    transactions.ts
    amounts.ts
    verification.ts
    verification-store.ts
    attestation.ts
    data.ts
scripts/
  deploy.ts                    # env/chain/fee preflight; runs Deploy.s.sol
  fund-vault.ts
  verify-contracts.ts
  sync-contracts.ts
  e2e.ts                       # only writer of STATUS.md
  smoke.ts                     # calls same checks read-only
  check-secrets.sh
tests/
  nav/test_hb.py                # keeps runtime nav_engine/ to three files
  web/                         # focused state, arithmetic, signature tests
  browser/                     # flow, transparency, admin, screenshot evidence
.context/
  evidence/                    # ignored run evidence, tagged by commit/URL
  screenshots/                 # founder review images
```

Avoid a new generic framework, separate backend service, analytics notebook, or another dashboard. Small shared modules are for chain configuration, exact copy, arithmetic, and transaction handling only.

## 4. Design and component map

Implement design tokens once in `globals.css` and expose them through Tailwind. Use white `#ffffff`, primary/ink `#080808`, hairline `#d8d8d8`, body `#363636`, secondary text `#5a5a5a`; use only the supplied semantic/accent colors. Primary buttons stay near-black. Buttons/inputs use 4px radii, cards 8px; no pill CTAs, added gradients, or dark theme.

| Product element | Supplied design primitive/tokens | Implementation |
| --- | --- | --- |
| Header, four-route navigation | `nav-bar`, `nav-link`; 16px/32px padding | Header with wallet and walkthrough controls; mobile menu |
| Global testnet notice | `badge-info-soft`, `content-band`, `body-sm` | Persistent text banner; no marketing treatment |
| Overview introduction | `hero-band`, `display-xxl`, `body-md` | Three factual sentences, live NAV, one primary “Open the app” button |
| NAV and position cards | `card-feature`, `display-md`, `caption-mono` | NAV/time/block, balances, value, coupons; 32px padding |
| Portfolio bars, chart | `hairline`, primary + one supplied blue accent | Three labelled simulated holdings; accessible text/table equivalent |
| Overview how-it-works strip | `content-band`, `ex-app-shell-row`, `body-sm` | Verify → Subscribe → Hold → Coupons → Redeem |
| Flow stepper | `ex-app-shell-row` | Connect → Verify → Subscribe → Hold → Redeem, near-black active indicator |
| Action card / receipt | `card-feature`, `button-primary`, `caption-mono` | What will happen → Sign → Receipt, consistent for every write |
| Inputs, country select, checkbox | `text-input`, `body-md`, `rounded.sm` | Visible labels, plain native controls where design is silent |
| Verification/status badge | `badge-info-soft`, `caption` | Not verified / Pending / Verified; semantic text + icon |
| Activity and holdings/admin tables | `ex-data-table-cell` | 12px/16px cells, hairline row borders, text explorer links |
| Wallet modal | `ex-modal-card`, `button-*` | RainbowKit themed to supplied geometry/type; scope any library limitations |
| Walkthrough toggle and captions | `body-sm`, `caption`, `text-input` geometry | Off by default; remember in localStorage, keyboard accessible |
| Footer | `footer`, `body-sm` | Exact disclaimer and repository link |

Desktop ≥992px: stepper on the left, one active step in the middle, position on the right. Tablet 768–991px: two columns with the position after the active task. Mobile <768px: compact step list, active task, then position in document order; no horizontally clipped actions. Use the supplied 479px breakpoint for smaller display typography. Hero type scales through supplied 80/56/32px sizes; weights never exceed 600. Spacing follows the supplied 2/4/8/12/16/20/24/32px tokens.

Design gaps to record in `PROGRESS.md`: no HitBite-specific screen mockups, explicit column widths, disabled/focus/loading/error states, chart/bar style, select/checkbox/toggle primitives, or wallet-modal treatment. Defaults are native controls, white/hairline cards, near-black focus outlines, text errors, existing tokens, and generous whitespace. Muted colors will not be used for essential text that fails contrast. The source's approximate touch-target statement is not an accessibility test; verify actual targets ≥44px, focus, labels, and keyboard navigation.

All six copy blocks in brief §10 remain verbatim. No real ISINs, partner logos, audit or regulatory claims, incentive mechanics, or return promises. The prohibited yield acronym never renders in the UI. “Simulated yield to maturity” and “Simulated distribution yield” are confined to `/transparency`.

## 5. Contract interfaces and transaction rules

Use Solidity `^0.8.24` with an exact compiler pinned at implementation, Foundry, and pinned OpenZeppelin 5. No upgradeable proxy. Use `SafeERC20`, checks/effects/interactions, `ReentrancyGuard`, and full-precision `Math.mulDiv` where needed.

### IdentityRegistry

```solidity
constructor(address admin, address registrar);
function addVerified(address account, uint16 countryCode) external;
function removeVerified(address account) external;
function isVerified(address account) external view returns (bool);
function countryOf(address account) external view returns (uint16);
function setCountryBlocked(uint16 code, bool blocked) external;
function isCountryBlocked(uint16 code) external view returns (bool);
event Verified(address indexed account, uint16 country);
event Revoked(address indexed account);
event CountryBlocked(uint16 code, bool blocked);
```

`REGISTRAR_ROLE` controls verification/revocation and the proposed country-blocklist management. Initialize 840 and 792 as blocked. Validate nonzero accounts and ISO numeric country codes. `isVerified` means currently eligible: blocking a country also affects previously registered residents. Standard AccessControl role administration belongs to `DEFAULT_ADMIN_ROLE`. The UI and API use the same numeric codes.

### HBToken

```solidity
constructor(address registry, address settlementAsset, address admin,
            address issuer, address oracle, uint256 initialNAV);
function setNAV(uint256 navPerToken) external;             // ORACLE_ROLE
function setNAV(uint256 navPerToken, bool force) external; // force: ISSUER_ROLE
function subscribe(uint256 usdcAmount) external returns (uint256 tokensOut);
function redeem(uint256 tokenAmount) external returns (uint256 usdcOut);
function distributeCoupon(uint256 usdcAmount) external;    // ISSUER_ROLE
function claimCoupon() external returns (uint256 usdcOut);
function accruedCoupon(address account) external view returns (uint256);
function mint(address to, uint256 amount) external;         // ISSUER_ROLE
function burn(address from, uint256 amount) external;       // ISSUER_ROLE
function pause() external;                                 // ISSUER_ROLE
function unpause() external;                               // ISSUER_ROLE
function settlementAsset() external view returns (address);
function navPerToken() external view returns (uint256);
function navUpdatedAt() external view returns (uint256);
function navUpdatedBlock() external view returns (uint256);
function couponIndex() external view returns (uint256);
function couponReserve() external view returns (uint256);
function availableLiquidity() external view returns (uint256);
uint256 public constant NAV_RAIL_BPS = 500;
event NAVUpdated(uint256 nav, uint256 timestamp, uint256 blockNumber);
event Subscribed(address indexed account, uint256 usdcIn, uint256 tokensOut, uint256 nav);
event Redeemed(address indexed account, uint256 tokensIn, uint256 usdcOut, uint256 nav);
event CouponDistributed(uint256 usdcAmount, uint256 index);
event CouponClaimed(address indexed account, uint256 usdcAmount);
```

Standard ERC-20 and AccessControl views/events remain available. Name: `HitBite Türkiye Sovereign (Testnet)`; symbol: `hbTRS`; decimals: 18. `force=false` uses the normal oracle rule; `force=true` requires issuer even if the caller also has oracle/admin privileges. Emit an additional `NAVForced` audit event for bypasses. NAV must be positive; compare basis points without rounding the threshold upward.

- USDC amounts/NAV use 6 decimals; `tokensOut = floor(usdcIn * 1e18 / nav)`, `usdcOut = floor(tokensIn * nav / 1e18)`. Reject zero input and zero output.
- Settle coupon accrual for both sides before transfer and before mint/burn. New tokens receive no historical coupons; transfers preserve the sender's earned coupons; burning cannot erase already earned coupons. Keep fractional accrual remainders to avoid loss from repeated transfers.
- Distribution pulls issuer USDC and increases the index without holder iteration. Reserve all unpaid distribution cash conservatively, including rounding dust; never allow redemptions to spend it. Reject a distribution with zero supply or a zero index increment.
- Revert with explicit errors including `NotVerified`, `BlockedCountry`, `InvalidNAV`, `NAVMoveExceedsRail`, `ZeroAmount`, `ZeroOutput`, `InsufficientVaultLiquidity(available,requested)`, `NoSupply`, and `NothingToClaim`, plus standard OpenZeppelin errors.
- Pause blocks subscription, redemption, transfer, and claim; proposed conservative default also pauses mint, burn, and distribution. Registry and NAV corrections remain possible. Never send USDC to the zero address.
- Mint checks recipient eligibility; transfers check both parties. No minimum subscription beyond an amount that mints nonzero tokens. Issuer mint/burn is an administrative correction, not the normal investor path.

### MockUSDC and required tests

6-decimal ERC-20 with `faucet()` and a documented per-address amount/cooldown cap. Deployment rejects its use on Arc. Local and fallback tests exercise the same settlement interface.

Foundry tests cover unverified/revoked/blocked sender and receiver, mint restrictions, all roles and pause paths, three NAV values, exact 6→18→6 math, insufficient available cash, rail boundaries and issuer override, two distributions with an intervening transfer, late entry, burn then claim, dust, zero supply, and zero USDC recipient rejection. Fuzz unchanged-NAV subscribe/redeem round trips with loss ≤1 micro-USDC for NAV below `1e18` (the relevant domain where the mathematical bound holds); separately test larger NAV and its generalized rounding bound. Maintain a coupon-reserve solvency invariant. Report actual coverage, not an assumed percentage.

V1's ABI is incompatible: its NAV event/signature, default minimum subscription, rolling rail, coupon-triggered NAV mutation, and `pendingCoupon` naming must not leak into v2 by copying code.

## 6. NAV, attestation, and publication

Keep the runtime engine to `portfolio.json`, `prices.csv`, and `hb.py`. Use Python 3.11, `Decimal`/integer money math, embedded pinned script dependencies, and `uv run --script`. Tests live outside this directory.

Portfolio contains the requested 40/40/20 basket, simulated identifiers, coupon schedules, maturity, face, clean price, purchase date, and `simulated: true`. Exact day/month conventions are disclosed simulation inputs, not claimed real bond terms. Prices have valuation date and truthful source attribution; initial manual fixtures say `manual simulated input`. Implement clean + accrued = dirty price, maturity/coupon-date boundaries, 0.75% management plus 0.30% simulated expenses accrued ACT/365, weighted YTM, and 30-day trailing distribution yield. With no qualifying distribution history, show unavailable/zero as defined by data, never invent an observation or annualize it silently.

**Proposed bootstrap model, requiring approval:** define a fixed reference basket and reference unit count in `portfolio.json`; scale its holdings/cash to the actual supply read at a pinned block. Publish the reference units, scale, actual supply, calculation inputs, and simulated nature. Compute `(scaled simulated assets - scaled fees) / actual supply` when supply is positive. At zero supply publish `nav_per_token: null` with `no supply`; show the separately labelled contract bootstrap NAV (proposed 1.000000 USDC) as the initial subscription price. Do not divide by zero or create a fake positive supply. Ordinary subscriptions/redemptions change the scale, not per-unit valuation. If the founder prefers a fixed-size fund, agree its seeded supply and explicit cash-flow ledger before implementation.

The simulated basket and admin-funded USDC vault are different representations: publish both but do not add them together as if both bought bonds. On-chain distributions are externally funded test distributions; disclose their relationship to simulated coupon cash. `supply_backed_ratio` describes simulated net assets against token NAV liabilities, labelled simulated; separately publish actual redemption liquidity coverage. At zero liabilities use null/not applicable, never a fabricated 100% backing figure.

`nav` reads supply at a pinned block; records block/hash/time, units, fees, prices, holdings, freshness, calculation NAV and append-only history in `app/public/data/nav.json`. Same inputs/date/block produce identical bytes. Live mode fails clearly on RPC failure or stale/missing inputs; CI dry-run uses an explicit fixture mode. No fixture output is represented as live.

`push` checks chain/roles, reads the latest supply/NAV again, rejects a stale or inconsistent calculation, previews the change, and submits the ordinary `setNAV` with fee estimation and the Arc minimum floor. It never forces a rail failure automatically. Wait for a successful receipt and compare on-chain NAV to the intended integer value before recording transaction evidence.

`attest` signs a deterministic canonical UTF-8 payload using EIP-191/secp256k1. It includes holdings, simulated cash, NAV, supply, ratios, timestamp, chain/contract, pinned block, and the exact §10 attestor label. Publish the exact signed message, signature, signer address, and uncompressed public key. The browser checks that the message matches the displayed payload, recovers the signer, and compares it with the configured expected public attestor address. A signature from an arbitrary supplied key is not enough. Changing a value, key, or signature must fail verification. This proves a simulated signer's statement, not real custody.

`nav.yml` runs at `0 7 * * *` with manual dispatch, a concurrency lock, scoped environment secrets, and only the needed repository-write permission. Run `nav` → `push` → `attest`; commit valid JSON only after all succeed and preserve the prior published data on failure. Data publication triggers the live app deployment and must be observable at its URL. If an on-chain update succeeds but a later publication fails, record/reconcile that transaction before retrying; do not silently leave the site reporting synchronized NAV. The page explicitly displays stale or mismatched data. All ledger ordering uses block number/log index, not timestamp alone.

## 7. App behavior and verification API

`/`: three factual introductory sentences, on-chain NAV/time/block with freshness, simulated three-bar basket, next simulated coupon date with schedule status, five explanatory steps, one primary app CTA. Do not imply coupons are automatically scheduled before the optional monthly job is enabled.

`/app`: one guided screen; derive completion from live wallet/chain state. Refresh and wallet/network changes re-read balances, eligibility, NAV, allowances, and coupons. Never preserve another wallet's receipt as the active wallet's result.

1. **Connect:** RainbowKit; one add/switch Arc button; one ERC-20 USDC balance; Circle faucet when needed. Native 18-decimal gas estimates are converted for display, not added as a second balance.
2. **Verify:** name, ISO country dropdown, professional-investor checkbox. `GET /api/verify` issues a short-lived wallet-bound challenge; signed `POST` validates country, consent, chain, origin and nonce. Enforce the ten-second review server-side, then the registrar writes `addVerified`; status becomes Verified only after a successful receipt. Block US/TR before requesting signatures. No name goes on-chain or into logs. A small durable verification store handles consumed nonces, rate limits, pending receipts, and a registrar nonce lease across server instances; use local SQLite for development and libSQL/Turso on Vercel. Keep the HTTP wait within configured platform duration and allow idempotent receipt polling after a timeout. No real KYC claim.
3. **Subscribe:** integer-parsed amount, current-NAV token preview, zero subscription fee, gas reserve estimate for both transactions. Separate `USDC.approve` and `HBToken.subscribe` cards/receipts; exact allowance, and an explicit already-approved state on resume. Refresh preview before signing; do not add unlimited approval or v1's minimum investment.
4. **Hold:** tokens, value at current NAV, coupons, claim card, activity. Include address events plus relevant global coupon distributions, ordered by block/log index. Fetch in bounded RPC block ranges; user-facing pagination is Excellence.
5. **Redeem:** token input, current-NAV USDC preview, available redemption liquidity preflight, exact vault notice, single redeem receipt. Explain wallet rejection, pause, network mismatch, stale preview, insufficient vault, and RPC failures inline.

Every on-chain action, including admin and verification's registrar action, explains the contract/function, required signature or operator submission, and resulting receipt/events. Wallet connection and network changes are labelled wallet operations rather than fake transactions. No fabricated hashes, balances, or successful states.

`/transparency`: holdings, simulated cash, NAV history, freshness, raw attestation, working client verification, expected signer/public key, contract explorer links, simulated backing ratio and actual liquidity, exact eight-row production mapping from §7 of the brief. Render yields here only with adjacent simulated labels.

`/admin`: read contract roles after wallet connection; registrar sees registry/blocklist controls, oracle sees normal NAV updates, issuer sees force-NAV/coupons/pause and funding status. Hidden UI is not authorization: contracts enforce roles. Registry table is reconstructed from events/current state without adding enumeration to transfer logic. Coupon funding uses its own approval + distribution receipts. Vault funding is a direct nonzero-address USDC transfer with a receipt.

## 8. Chain, deployment, and environment contract

Chain config is centralized in `packages/config/chains.ts`; runtime chain ID must match the selected allowlisted network before reads are trusted or anything is signed. Arc USDC is fixed to `0x3600000000000000000000000000000000000000`, checked for 6 decimals; the deployment script never creates MockUSDC there. Local is 31337; Base Sepolia is 84532. Selecting a chain without a matching deployment fails clearly. Do not copy mainnet examples from upstream docs.

Arc transactions use dynamically estimated EIP-1559 fees with `maxFeePerGas >= 20 gwei` and enough headroom for the current base fee/tip, across browser, registrar, deployer, Python and E2E. Keep USDC available for gas. Contract transfers always use the 6-decimal interface. Read receipts to populate deploy blocks and hashes instead of trusting positional broadcast output.

The explorer documents Blockscout verification with `--verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/`. Use that with the deployment compiler/settings/constructor arguments; store standard JSON input and metadata for reproducibility. If verification is unavailable, record the actual failure and publish those inputs as the brief permits. A JSON file alone does not establish successful explorer verification.

`deployments/arc-testnet.json` records chain ID, addresses, deployed block/hash/time, deployer and role addresses, settlement asset/decimals, verification status/links, and each real vault funding amount/receipt. Proposed initial target is 20 testnet USDC vault liquidity plus a separate 2 USDC coupon budget, adjustable to actual faucet availability; record actual amounts, not targets, as funded. Test accounts and every signing role need separate gas balances.

All configuration below receives a comment in `.env.example`. Private values remain environment-only and never use a `NEXT_PUBLIC_` prefix. Deployment artifacts supply addresses rather than duplicating editable address environment variables.

| Variable | Exposure / use |
| --- | --- |
| `NEXT_PUBLIC_CHAIN` | `arc-testnet` default; `base-sepolia` or `local` fallback selector, used consistently by app and tools |
| `NEXT_PUBLIC_RPC_URL` | Optional browser-safe RPC override for selected chain; no secret provider keys |
| `RPC_URL` | Optional private server/tool RPC override; otherwise selected chain default |
| `NEXT_PUBLIC_APP_URL` | Expected app origin and wallet metadata; local default documented |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Public WalletConnect project ID; injected wallets remain usable without it |
| `NEXT_PUBLIC_ATTESTOR_ADDRESS` | Public expected attestation signer, checked against signatures |
| `DEPLOYER_PRIVATE_KEY` | Deployment only, funded testnet account |
| `ADMIN_ADDRESS` | Public deployment role administrator, not a private key |
| `ISSUER_ADDRESS`, `ORACLE_ADDRESS`, `REGISTRAR_ADDRESS` | Public intended deployment role holders |
| `ISSUER_PRIVATE_KEY` | E2E coupon/pause/funding and optional scheduled coupon job only |
| `ORACLE_PRIVATE_KEY` | Python NAV pushes only |
| `REGISTRAR_PRIVATE_KEY` | Server-only verification writes |
| `ATTESTOR_PRIVATE_KEY` | NAV job's simulated attestation signing key only |
| `DATABASE_URL` | Verification store: ignored local SQLite path or hosted libSQL URL |
| `DATABASE_AUTH_TOKEN` | Hosted verification store credential; absent for local SQLite |
| `E2E_WALLET_A_PRIVATE_KEY`, `E2E_WALLET_B_PRIVATE_KEY` | Two separately funded test wallets; never documented as literal keys |
| `E2E_BASE_URL` | Exact live app under test; also used by smoke/browser evidence collection |
| `E2E_SUBSCRIBE_USDC`, `E2E_COUPON_USDC` | Optional positive decimal test amounts with documented small defaults |
| `NAV_MAX_AGE_HOURS` | Staleness threshold, proposed 30 hours for the daily job |
| `BASESCAN_API_KEY` | Optional, only for Excellence fallback verification |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | Optional CI/CLI publishing; not needed for Git-linked Vercel deployment |
| `GH_TOKEN` | Optional local CI-evidence reads if no gh session; Actions uses scoped `GITHUB_TOKEN` |

Each process loads only the secrets it needs; never upload the entire root environment to the web runtime. Parse decimal env amounts with strict limits. No keys in command arguments, debug output, public bundles, screenshots, or committed fixtures. Recheck ignored patterns for the new app/build/SQLite paths before Phase 1 commits.

## 9. Exact command interface for the founder

These commands are the implementation contract for future phases; they are not available in the current v1 tree. Pin tool/package versions in Phase 1. Root pnpm scripts load `.env` internally; no shell exporting or printing of keys is required. A missing secret reports its variable name only. Run commands from the repository root.

```sh
# Phase 1: setup and empty-build checkpoint
cp -n .env.example .env
# Edit the local .env using your editor; never paste private keys in chat.
pnpm install --frozen-lockfile
git submodule update --init --recursive
pnpm lint
pnpm typecheck
pnpm build

# Phase 2: contract checkpoint
forge test --root contracts
forge coverage --root contracts

# Phase 3: fund required addresses through the Circle faucet first
pnpm deploy --chain arc-testnet --dry-run
pnpm deploy --chain arc-testnet
pnpm verify:contracts --chain arc-testnet
pnpm fund:vault --amount 20
pnpm sync:contracts

# Phase 4: one engine entrypoint
pnpm hb nav --dry-run
pnpm hb nav
pnpm hb push --dry-run
pnpm hb push
pnpm hb attest
pnpm test:nav

# Phases 5–6: app + evidence
pnpm dev
# In a second terminal, with E2E_BASE_URL set to the app being reviewed:
pnpm test:ui
pnpm screenshots

# Phase 7: evidence and automated STATUS.md
pnpm check
pnpm smoke
pnpm e2e

# Phase 8: production-mode local build and handover
pnpm build
pnpm start
```

`pnpm hb` invokes `uv run --env-file .env --python 3.11 --script nav_engine/hb.py` with the remaining arguments. `pnpm check` runs Foundry tests, Python lint/tests + an explicitly fixture-backed NAV dry-run, secret checks, TypeScript checking, focused web tests and Next build. `pnpm screenshots` saves under `.context/screenshots/`; `pnpm test:ui` writes evidence keyed to the tested deployment and commit. Deployment/funding commands honor the selected chain and reject an Arc-only command on another chain.

Phase 3 also records an actual CLI subscription: after preparing a verified funded test account and setting `ETH_PRIVATE_KEY` locally from that account's environment entry, use `cast send` without a key argument:

```sh
cast send 0x3600000000000000000000000000000000000000 \
  'approve(address,uint256)' "$HBTOKEN_ADDRESS" 1000000 \
  --rpc-url https://rpc.testnet.arc.io --gas-price "$ARC_MAX_FEE_WEI"
cast send "$HBTOKEN_ADDRESS" 'subscribe(uint256)' 1000000 \
  --rpc-url https://rpc.testnet.arc.io --gas-price "$ARC_MAX_FEE_WEI"
```

The Phase 3 report fills in the real public `HBTOKEN_ADDRESS` and a current estimated `ARC_MAX_FEE_WEI` ≥20000000000, verifies the installed cast environment-key support, and records both receipts. These shell variables are operator command inputs, not additional persistent application settings. If standard Foundry cannot simulate an Arc-specific behavior, use the documented Arc Foundry toolchain and record the reason; ordinary Anvil tests are never presented as Arc validation.

Vercel uses repository root with workspace build `pnpm --filter @hitbite/app build` and output `app/.next`; verify the exact monorepo project settings in Phase 5. Configure its environment separately, connect the reviewed branch for preview, and use `main` for the eventual live deployment. Credentials/project access are prerequisites, not a reason to claim a deployment exists.

## 10. Checkpoints, deliverables, and acceptance evidence

The brief estimates eight working days. Timing depends on approval, faucet access and deployment credentials; each numbered checkpoint remains mandatory.

| Phase | Deliverable | Evidence required before asking to advance |
| --- | --- | --- |
| 0 — Plan | Preserved v1 refs, input copies, this plan, appended progress | Remote ref hashes, matching input bytes, documentation diff; founder approves plan/amendments |
| 1 — Repo and safety | Fresh pnpm workspace, env/ignore rules, config, MIT licence, README with exact production mapping, CI skeleton | Clean empty Next build/typecheck and green CI link; no stale v1 runtime/workflows |
| 2 — Contracts | Registry, token, local/fallback mock, deploy script, required tests | `forge test` and coverage report; documented role/rail/coupon/rounding results |
| 3 — Arc deployment | Real contracts, verification, funded vault, deployment artifact | Explorer links, actual balance and funding receipts, successful cast approve/subscribe |
| 4 — NAV | Three-file engine, signed outputs, daily workflow | Deterministic fixture, live supply read, JSON/on-chain NAV equality, one-line Python signature verification, workflow publication evidence |
| 5 — App flow | Five steps on one screen, API verification, receipts, position, walkthrough | Fresh-wallet founder completion, desktop/mobile screenshots for each step, blocked-country/low-gas/insufficient-vault/pause cases |
| 6 — Other routes | Overview, transparency and minimal role-based admin | NAV agreement to the cent; browser verifies signature and rejects tampering; role gating and production table |
| 7 — E2E and STATUS | Transaction runner, read-only smoke, generated report | Two independent wallets complete the live Arc flow; receipt links, smoke result, current UI/CI/NAV evidence; all Core rows green |
| 8 — Handover | README, deployment/STATUS links, ownership/simulation explanation | Stranger follows faucet → network → connect → verify → subscribe; founder confirms; final live URL |

At each checkpoint append date, phase, changes, verification commands/results, evidence links, founder questions, design deviations and known gaps to `PROGRESS.md`; commit and push before requesting the next phase. Do not advance without its approval. Do not label the product working in README/progress from a successful local build: the generated status matrix is authoritative.

Excellence, only after Core: monthly `coupon.yml` (first day of month, idempotent, funded, receipt recorded), activity pagination, `arc-anvil` convenience script, actual Base Sepolia deployment. Showcase, only after Excellence: 90-second recording and architecture diagram; an extra ownership page requires scope approval, while its information is already Core in README/transparency.

## 11. E2E truthfulness and release conditions

`scripts/e2e.ts` is a viem runner, with no browser embedded. It checks chain/address/role/fee prerequisites and both funded test accounts before any write. Run the verify API, approve, subscribe, issuer coupon distribution, each holder's accrual/claim, redeem, pause-enforced subscription failure, and unpause. Test two independent wallets, not two runs using one address. Ensure distinct/fresh input accounts for the definition-of-done run; label later repeat runs honestly. Check decoded amounts/events against balances and expected math, including Arc gas paid from the same USDC balance.

Expected rejection is checked as the correct custom error/failed receipt, not any arbitrary RPC failure. Record successful, failed and skipped steps; flush partial evidence on failure. Restore pause state in cleanup only when this run introduced the pause. Avoid disruptive runs on a concurrent founder review; use a dedicated test window/deployment and do not overwrite someone else's admin state.

The generated matrix covers contracts, deployment, NAV, every flow step, transparency, admin, CI and the overall Core gate. Include UTC time, git SHA, chain, app URL/build identity, wallet addresses, transaction hashes/blocks/explorer links, and evidence source. Green means a passed assertion with matching current evidence; yellow means missing/stale/not exercised; red means a failed assertion. Do not infer UI functionality from a successful contract call or CI success from a local command. Browser checks and human fresh-wallet acceptance remain explicit prerequisites and are linked in the report, never invented. `pnpm e2e` exits nonzero when Core is incomplete or failing, and is the sole writer of `STATUS.md` even on failure.

`pnpm smoke` uses shared checks without signing, sending, or changing `STATUS.md`: chain ID, deployed contract reads, settlement decimals, NAV freshness and JSON/on-chain consistency. RPC outages produce useful failure information. CI cannot replace live Arc evidence; local fixtures stay labelled local. Initial report generation is Phase 7, so earlier phase checkpoints use raw receipts/tests/screenshots in progress without hand-maintained status claims.

The release requires all six brief §11 items: two live wallets; restriction/country tests; cent-level NAV consistency; working client verification; green CI and complete handover with founder walkthrough; and design compliance with deviations recorded.

## 12. Questions for the founder and external prerequisites

Approve the plan before Phase 1. The material decisions are:

1. **Next.js:** approve supported Next.js 16 in place of the brief's unsupported 14. No framework installation/change occurs before approval.
2. **NAV model:** approve the explicitly labelled supply-scaled reference basket and separate testnet-vault reporting, or specify a fixed fund capitalization model. Resolve before Phase 4.
3. **Revocation:** approve allowing existing revoked holders to redeem/claim while prohibiting new receipts/transfers, subject to pause. Resolve before Phase 2.

Plan approval also covers the stated ordinary defaults: Inter substitute, client signature verification in Core, exact v2 NAV interfaces, no automatic NAV decrease on externally funded coupon distributions, and building on the current workspace branch for eventual integration into `main`.

Needed before live-dependent checkpoints: env-only testnet role keys and addresses, funded Arc accounts plus two E2E wallets, public expected attestor address, a WalletConnect project ID for connector coverage, a Vercel project/domain and hosted verification store, and GitHub Actions access/secrets. Provide these through local environment or provider settings, not this document or chat. Their current availability has not been established by Phase 0.

The provided design is a generic visual system, so component placements beyond the brief use the documented plain defaults. No new brand assets or marketing copy are required to start. All additional product wording questions go in the append-only progress log with a conservative proposed default.

## 13. Primary references checked during planning

- [Arc connection details](https://docs.arc.io/arc/references/connect-to-arc): testnet chain/RPC/explorer, one USDC balance, wallet setup.
- [Arc gas and fees](https://docs.arc.io/arc/references/gas-and-fees): EIP-1559 fee floor and native precision.
- [Arc contract addresses](https://docs.arc.io/arc/references/contract-addresses): 6-decimal USDC ERC-20 interface and no wrapper.
- [Arc deployment and verification](https://docs.arc.io/arc/tutorials/deploy-on-arc): Arc Foundry and Blockscout verification endpoint.
- [Arc EVM differences](https://docs.arc.io/arc/references/evm-differences): reference for deployment-time compatibility checks.
- [Next.js support policy](https://nextjs.org/support-policy): version amendment rationale.

Recheck network/tooling behavior at its implementation checkpoint. Upstream examples do not override the testnet-only allowlist, decimals discipline, secret handling, or the founder's product scope.
