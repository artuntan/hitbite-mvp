# Architecture

**Testnet demonstration on Base Sepolia. Simulated portfolio and attestation. Not an offer of securities.**

Four pieces, one direction of flow. A Python engine computes NAV from bond data, publishes it as JSON
and pushes it on-chain. Solidity contracts hold the token, the whitelist and the vault. A Next.js app
reads both and is the only thing a human touches. Partners read the same JSON and the same contract
the app does, which is the point: there is no private interface.

---

## 1. System

```mermaid
flowchart TB
    subgraph data["Reference data (simulated)"]
        portfolio["portfolio.json<br/>positions, cash, fees payable"]
        prices["prices.csv<br/>clean price, YTM, source"]
        config["config.yaml<br/>fees, rail, scenarios"]
    end

    subgraph engine["engine/ — NAV engine (Python 3.11)"]
        compute["nav-engine compute<br/>30/360 accrual, dirty price, YTM,<br/>duration, convexity, daily fees"]
        attest["nav-engine attest<br/>canonical JSON + EIP-191 signature"]
        push["nav-engine push<br/>rail check, idempotent per day"]
    end

    subgraph json["web/public/data/ — published JSON"]
        nav["nav.json"]
        history["nav_history.json"]
        holdings["holdings.json"]
        scenarios["scenarios.json"]
        attestation["attestation.json"]
    end

    subgraph chain["contracts/ — Base Sepolia (84532)"]
        registry["IdentityRegistry<br/>whitelist, country blocklist"]
        token["HBToken (hbTRS)<br/>NAV, vault, coupon index"]
        usdc["MockUSDC<br/>6 decimals, faucet"]
    end

    subgraph web["web/ — Next.js app"]
        pages["Pages<br/>overview, verify, subscribe,<br/>portfolio, transparency, admin"]
        api["Public API<br/>/api/nav, /holdings,<br/>/attestation, /stats, /events"]
        indexer["Event indexer<br/>viem.getLogs from deployBlock"]
    end

    partners["Partners<br/>vault curators, exchanges"]

    portfolio --> compute
    prices --> compute
    config --> compute
    compute --> nav
    compute --> history
    compute --> holdings
    compute --> scenarios
    attest --> attestation
    nav --> push
    push -->|"setNAV, ORACLE_ROLE"| token
    token -->|"totalSupply, nav, CouponDistributed"| compute

    registry <-->|"canHold"| token
    usdc <-->|"vault transfers"| token

    json --> api
    token --> indexer
    indexer --> api
    api --> pages
    token -->|"wagmi + viem, user wallet"| pages

    api --> partners
    token --> partners
```

Two details in that diagram carry most of the design.

**The engine reads the chain and the chain reads the engine.** Token supply comes from
`totalSupply()`, and coupon distributions come from `CouponDistributed` events, both of which feed the
NAV computation. NAV then goes back on-chain through the oracle push. The loop is deliberate and it is
why the numbers on the transparency page can be checked against the contract rather than taken on
trust. When the RPC is unreachable the engine falls back to a cached supply and says so in the output.

**Partners read exactly what the app reads.** There is no partner API and no privileged endpoint. A
vault curator pricing `hbTRS` as collateral calls `nav()` on the token, the same function the
subscribe page calls, and reads `/api/nav` for the off-chain view with its assumptions attached.

---

## 2. Trust boundaries

| Boundary | What crosses it | What is checked |
|---|---|---|
| Reference data → engine | Prices and positions, maintained by hand | Every row cites a source or is labelled `illustrative` |
| Engine → chain | `setNAV` signed by the oracle key | The contract's own 5% per-24-hour rail (D27); the engine pre-checks so it does not burn gas on a revert |
| Engine → web | JSON files in the repository | Zod schemas at the API boundary; the transparency page re-checks `nav.json` against on-chain `nav()` |
| User wallet → chain | Subscribe, redeem, transfer, claim | `IdentityRegistry.canHold` on both sides of every balance change |
| Web server → chain | `addVerified` signed by the registrar key | A testnet-only key with no other role; the weakest link, and treated as such in `SECURITY.md` |
| Attestor key → published document | ECDSA signature over canonical JSON | Verifiable in the browser with viem, and in Python with eth-account |

The registrar key living on a web server is the one boundary that would not survive production
unchanged. It is called out here, in `SECURITY.md` and in `RISKS.md` rather than buried, because a
reviewer will find it in ninety seconds and the honest version is better than the discovered version.

---

## 3. Subscribe

```mermaid
sequenceDiagram
    autonumber
    actor U as Investor
    participant W as Web app
    participant R as IdentityRegistry
    participant M as MockUSDC
    participant T as HBToken

    U->>W: connect wallet
    W->>R: canHold(user)
    R-->>W: false — not verified
    U->>W: submit verification form
    W->>W: store request, wait AUTO_APPROVE_DELAY_MS
    W->>R: addVerified(user, country, professional)<br/>REGISTRAR_ROLE
    Note over R: reverts CountryBlocked for 840 / 792<br/>reverts RetailNotAllowed for retail
    R-->>W: IdentityVerified

    U->>W: enter USDC amount
    W->>T: previewSubscribe(amount)
    T-->>W: tokens = amount × 1e18 / nav
    U->>M: approve(HBToken, amount)
    U->>T: subscribe(amount)

    activate T
    T->>T: amount > 0, ≤ MAX_INPUT, ≥ minSubscription
    T->>R: canHold(user)
    R-->>T: true
    T->>M: safeTransferFrom(user → vault)
    T->>T: _update(0 → user): canHold(to), settle(to)
    T->>T: _mint
    deactivate T
    T-->>U: Subscribed(user, usdcIn, tokensOut, nav)
```

The preview and the real call compute tokens the same way, so what the interface quotes is what
settles. A fuzz test pins that equality rather than leaving it to review.

---

## 4. Coupon distribution and claim

```mermaid
sequenceDiagram
    autonumber
    actor I as Issuer
    participant T as HBToken
    participant M as MockUSDC
    actor A as Holder A (70%)
    actor B as Holder B (30%)

    I->>M: approve(HBToken, 12 USDC)
    I->>T: distributeCoupon(12 USDC)

    activate T
    T->>M: safeTransferFrom(issuer → vault)
    T->>T: supply > 0, perToken = amount × 1e18 / supply
    Note over T: reverts DistributionTooSmall if perToken == 0<br/>reverts DistributionExceedsNav if perToken ≥ nav
    T->>T: couponIndex += perToken
    T->>T: totalAllocated += ceil(perToken × supply / 1e18)
    T->>T: nav -= perToken, railAnchorNav -= perToken (D26)
    deactivate T
    T-->>I: CouponDistributed + NAVUpdated

    Note over A,B: nobody is iterated — each holder settles lazily

    A->>T: claimCoupon()
    T->>T: settle(A): accrued += balance × (index − userIndex[A]) / 1e18
    T->>M: safeTransfer(A, 8.40 USDC)
    T-->>A: CouponClaimed

    B->>T: transfer(some hbTRS, → A)
    T->>T: _update settles B then A before balances move
    Note over T: settling first is what stops double-counting

    B->>T: claimCoupon()
    T->>M: safeTransfer(B, 3.60 USDC)
    T-->>B: CouponClaimed
```

NAV dropping at distribution is the non-obvious step. Without it, an address could subscribe just
before a distribution, claim, and redeem at an unchanged NAV, taking the coupon from the holders who
earned it. The engine reduces reference cash by the same per-unit amount on the same day, so the
computed NAV and the on-chain NAV stay equal through a distribution.

---

## 5. Redeem

```mermaid
sequenceDiagram
    autonumber
    actor U as Holder
    participant T as HBToken
    participant M as MockUSDC

    U->>T: previewRedeem(tokens)
    T-->>U: usdcOut = tokens × nav / 1e18

    U->>T: redeem(tokens)
    activate T
    T->>T: tokens > 0, ≤ MAX_INPUT, usdcOut > 0
    T->>T: available = vaultBalance − couponReserve
    Note over T: couponReserve = totalAllocated − totalClaimed (D6)<br/>coupon money is never redeemable
    alt usdcOut > available
        T-->>U: revert InsufficientLiquidity(available, usdcOut)
    else
        T->>T: _update(user → 0): settle(from), burn
        Note over T: canHold(from) is NOT checked on a burn (D4)<br/>a de-verified holder can still exit
        T->>M: safeTransfer(user, usdcOut)
        T-->>U: Redeemed(user, tokensIn, usdcOut, nav)
    end
    deactivate T
```

---

## 6. Where each number comes from

A reviewer checking that the numbers agree across three layers needs to know which layer owns each
one. Integers are the contract between them: the engine emits six-decimal integer USDC next to every
display string, the chain stores the same integer, and the interface formats from the integer rather
than re-deriving it from a float (D22).

| Number | Computed by | Stored on-chain | Shown by |
|---|---|---|---|
| NAV per token | Engine, from prices + cash − fees | `nav()`, pushed by the oracle | Every page; transparency re-checks the two agree |
| Reported AUM | Engine, NAV × supply | `reportedAUM`, set with NAV | Transparency |
| Token supply | Chain | `totalSupply()` | Stats, and it feeds the engine back |
| Weighted YTM, duration, convexity | Engine | not on-chain | Overview, transparency, notebook |
| Distribution yield | Engine, from `CouponDistributed` events | not on-chain | Overview |
| Pending coupon | Chain | `pendingCoupon(address)` | Portfolio |
| Available liquidity | Chain | `availableLiquidity()` | Portfolio, transparency |
| Supply-backed ratio | Chain | `supplyBackedRatio()` | Transparency |

---

## 7. Deployment and scheduling

Contracts deploy through `script/Deploy.s.sol`, which writes `contracts/deployments/<chain>.json`
holding the chain id, addresses, deploy block, transaction hashes and a timestamp. That file is the
single source of addresses: the web build generates its ABIs and addresses from it, the engine reads
it to find the token, and the event indexer reads `deployBlock` from it so it never scans from genesis.
The script refuses to run against any chain id other than Anvil or Base Sepolia.

Two scheduled paths, split on purpose by whether a key is involved:

- `nav-daily.yml` runs the engine on a cron and opens a pull request with refreshed JSON. It touches
  no key, so it can run on the default runner with nothing secret in scope.
- `oracle-push.yml` is manual only, gated behind a protected `oracle` environment, and is the only
  place a signing key enters CI.

`ci.yml` runs four jobs on every push: contracts, engine, web and a secret scan.

---

*This is a technical demonstration on a public test network. Portfolio data, prices and attestations
are simulated or illustrative and are labelled as such. Nothing here is an offer, solicitation or
recommendation to buy any security. HitBite is not a licensed financial institution.*
