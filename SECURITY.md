# Security

> **Testnet demonstration on Base Sepolia. Simulated portfolio and attestation. Not an offer of securities.**

**These contracts have not been audited.** They have been unit tested, fuzzed, checked with stateful invariants
and run through static analysis, all of which is reproducible from this repository — and none of which is a
substitute for an independent audit. No third party has reviewed, certified or attested to this code. Nothing in
this document should be read as a claim that it is safe to hold value.

This file covers the on-chain system (`contracts/`) and the keys around it. Product and market risk is in
[`RISKS.md`](RISKS.md); the rules themselves are in [`COMPLIANCE_RULES.md`](COMPLIANCE_RULES.md); the trust
boundaries are drawn in [`ARCHITECTURE.md`](ARCHITECTURE.md). Decisions referenced as **D3**…**D48** are the
numbered decisions in [`PLAN.md`](PLAN.md).

---

## 1. Threat model

| # | Threat | What an attacker gets | Mitigation in this MVP | Residual risk |
|---|---|---|---|---|
| T1 | **Oracle key compromise / NAV manipulation** | Subscriptions and redemptions settle at a price the attacker chooses | **D5 / D27** rail: a non-forced `setNAV` may not move NAV more than `maxNavMoveBps` (500 = 5%) from `railAnchorNav`, the NAV at the start of the current 24 h window. Chained in-rail updates cannot compound. `NAVUpdated` on every change | 5% per day is still 5% per day, and it compounds across windows. One key, no second opinion, no deviation monitor |
| T2 | **Reported-AUM manipulation** | An inflated `supplyBackedRatio()` on the transparency page | `reportedAUM` is written only by `setNAV` (same role as T1) and reduced by every distribution (**D26**). The coupon reserve is excluded from the numerator (**D20**) | `reportedAUM` is an oracle-asserted number, not a proof of assets. On testnet there are no assets behind it at all |
| T3 | **Registrar key compromise** | Whitelist arbitrary addresses, or de-verify real holders | `REGISTRAR_ROLE` is separate from every other role and can do nothing else: it cannot mint, move, price or pause. `addVerified` still rejects blocked countries and retail (**D21**). Every change emits an event; the admin can revoke the role | **Not mitigated:** the registrar key is a testnet key held by a web server (**D8**). Country and investor type are self-declared and only attested by that key. A de-verified holder keeps the right to exit (**D4**), so de-verification cannot be used to seize funds |
| T4 | **Issuer key compromise** | Mint or burn supply, pause the token, push a distribution | Every operational mint and burn emits a dedicated `OperationalMint` / `OperationalBurn` event rather than hiding in `Transfer`. Minting creates no USDC, so `supplyBackedRatio()` falls immediately and visibly. Production issuance never uses these functions | **Not mitigated:** a single hot key can dilute holders without limit and burn any balance. No multisig, no timelock, no mint cap beyond the per-call `MAX_INPUT` bound |
| T5 | **Admin key compromise** | Everything above, plus `setNAV(force = true)`, the rail width, the minimum and all role grants | Forced NAV updates emit `NAVForced(old, new, by)` in addition to `NAVUpdated`. Role changes emit the standard AccessControl events | **Not mitigated:** the admin key is the root of trust. On testnet it is a single EOA |
| T6 | **Vault insolvency on redemption** | A redemption drains USDC that is owed to somebody else | **D6 / D29:** `couponReserve() = totalAllocated - totalClaimed` is carved out of the vault; `availableLiquidity() = vaultBalance() - couponReserve()`; `redeem` reverts `InsufficientLiquidity(available, requested)` against *available* liquidity. Proved by `invariant_couponReserveCoversEveryPendingCoupon` and `invariant_availableLiquidityPlusReserveEqualsVault` | Redemption is first come, first served: the vault is not the portfolio, and a large redemption simply reverts once liquidity runs out. There is no queue, no gate and no pro-rata scaling. In production this is a fund-level liquidity policy, not a contract feature |
| T7 | **Coupon capture (sandwich)** | Subscribe just before a distribution, claim, redeem at an unchanged NAV, taking the coupon from existing holders | **D26:** `distributeCoupon` lowers `nav` by the per-token amount distributed and emits `NAVUpdated`, exactly as a fund's NAV drops on the ex-distribution date. A wallet that subscribes, claims and redeems around a distribution gets back what it put in (`test_navDrop_sandwichSubscriberGainsNothing`) | The oracle can still move NAV between the two legs (T1) |
| T8 | **Retroactive coupon claim** | A new holder claims a distribution that happened before it held anything | The index pattern settles an account before every balance change, so a mint or an incoming transfer re-anchors `userIndex` at the current index with a zero-value settlement (`test_subscriberAfterDistribution_receivesNothingFromIt`, `test_exitAndReSubscribe_doesNotInheritIndexGrowthWhileAway`) | None known; this is the property the fuzz and invariant suites lean on hardest |
| T9 | **Locking money in a distribution** | USDC enters the vault that nobody can ever claim or redeem | **D29:** `distributeCoupon` reverts `DistributionTooSmall` when the per-token increment would truncate to zero, and tracks `totalAllocated` (rounded **up**) separately from `totalDistributed`, so the truncation remainder is ordinary liquidity from the start rather than a permanently locked reserve | Per-holder settlement truncates below one USDC unit per holder per distribution and that dust stays in the reserve for good. Bounded and quantified (§3, §4) |
| T10 | **Arithmetic denial of service** | An input that makes a normal call revert with a `Panic`, or wedges the contract | **D28:** every amount, NAV and reported-AUM input is bounded by `MAX_INPUT = type(uint128).max` and rejected with `AmountTooLarge` / `InvalidNav` before any arithmetic. Under that bound every intermediate product fits in `uint256`. Proved by `testFuzz_aboveMaxInput_revertsNamedError_neverPanics` and `testFuzz_legalRangeExtremes_neverPanic` | The bound assumes `totalSupply()` stays below `2^128`; each operational mint is bounded per call but the sum is not. Reaching it needs ~3.4 × 10^20 tokens minted by the issuer key (T4) |
| T11 | **Re-entrancy** | Re-enter during a USDC transfer and settle or redeem twice | `subscribe`, `redeem`, `claimCoupon` and `distributeCoupon` are `nonReentrant`; all token movement goes through `SafeERC20`; state is written before the outbound transfer in `redeem` and `claimCoupon`; `distributeCoupon` pulls the USDC before it reads `totalSupply()` so a settlement asset with hooks cannot observe a half-computed distribution | The settlement asset is assumed to be a plain ERC-20 without transfer hooks. Real USDC and `MockUSDC` are; a fee-on-transfer or rebasing asset would break the accounting and must never be configured |
| T12 | **Transfer-restriction bypass** | Move tokens to an address the whitelist never approved | The restriction lives in `_update`, so it covers `transfer`, `transferFrom`, `subscribe` and `mint` alike — not just the public entry points. Both sides are checked on a transfer; the receiving side is checked on every mint | **By design (D4):** burns do not check the sender, so a de-verified holder can still redeem and be force-burned. This deviates from the literal BUILD_PROMPT 5.2 rule and is flagged for founder confirmation |
| T13 | **Blocked-country evasion** | A US or Turkish resident holds the token behind a different country code | The blocklist is enforced on-chain at verification and on every balance change, and the admin can block a country after the fact — `canHold` flips to false for its holders without deleting their records | **Not mitigated on-chain:** the country attached to an address is whatever the registrar wrote (T3). Real sanction and residency screening is the licensed partner's KYC vendor, not this contract |
| T14 | **Front-running a NAV update** | Subscribe or redeem at a price the subscriber already knows is stale | None at the contract level. The rail bounds how far any single move can go | **Not mitigated:** settlement is instant at the current on-chain NAV. A production fund uses forward pricing (orders queued and settled at the *next* published NAV). Documented in `contracts/README.md` under *Known limitations* |
| T15 | **Pause misuse** | The issuer freezes holders out of their money | **D3** makes pause auditable and total rather than selective: it blocks transfer, mint, burn, subscribe, redeem, distribute **and** claim, and the paused state is public (`Paused` / `Unpaused` events, shown in the app). `setNAV` and registry changes keep working, so the price does not go stale during an incident | **Not mitigated:** a compromised or malicious issuer key can pause indefinitely, and coupons cannot be claimed while paused. There is no time limit, no guardian and no forced-unpause path |
| T16 | **Rail anchor freeze** | Oracle updates revert until the window rolls | Only reachable when a single coupon's per-token amount is at least the window-start NAV (a payout above 100% of NAV in one go), which floors `railAnchorNav` at 1. The admin can restore service with a forced update | Documented in `distributeCoupon` and tested (`test_navDrop_anchorFloorsAtOne_untilAdminForces`). Not reachable with plausible coupon sizes |
| T17 | **Faucet abuse (`MockUSDC`)** | Mint unlimited test USDC | **D14:** 10,000 USDC per call and per address per fixed 24 h window | **Deliberately weak.** Anyone may call the faucet for any address, so the cap is a convenience against accidental over-minting, not an economic bound. `MockUSDC` must never be deployed to a mainnet and holds no value |
| T18 | **Attestation forgery** | A fake transparency document | The attestation is ECDSA-signed and verifiable in the browser (**D9**) | **Not mitigated in substance:** the attestor key is ours. The signature proves who signed, not that the holdings exist. Labelled *Simulated attestor — an independent firm signs in production* everywhere it appears |

---

## 2. Keys and roles

| Role | Held by (testnet) | Can do | Cannot do |
|---|---|---|---|
| `DEFAULT_ADMIN_ROLE` | Deployer EOA | Force NAV, set the rail width and minimum subscription, grant/revoke every role, edit the country blocklist | — (root of trust) |
| `ORACLE_ROLE` | Engine key, used from a protected environment or locally | `setNAV` inside the rail | Move NAV past the rail, mint, pause, whitelist |
| `ISSUER_ROLE` | Deployer EOA on testnet | Mint, burn, pause, unpause, distribute coupons | Set NAV, whitelist |
| `REGISTRAR_ROLE` | **Web server key** (`REGISTRAR_PRIVATE_KEY`) | `addVerified`, `removeVerified` | Anything touching money or price |
| none | Anyone | `subscribe`, `redeem`, `claimCoupon`, `transfer` (all subject to the whitelist), `faucet` | — |

The registrar key on a web server is the weakest link in this design. It is a testnet-only key with no other role,
it is the only server-held key in the system, and it is called out here, in `ARCHITECTURE.md` and in `RISKS.md`
rather than buried. Secrets come from environment variables only; `.env.example` documents every variable; CI runs
gitleaks and `scripts/check-secrets.sh` on every push.

---

## 3. What has been proved, and how

Every command below runs from `contracts/` and is reproducible.

| Layer | Command | What it establishes |
|---|---|---|
| Unit — 151 tests | `forge test` | Every function and every revert path, including each custom error with its exact arguments. The BUILD_PROMPT 5.3 cases — 70/30 split, no double count across a transfer, late subscriber gets nothing — are hand-computed in `test/HBTokenCoupon.t.sol` |
| Fuzz — 7 properties | `forge test --match-contract HBTokenFuzz` | Round trip never mints value (exactly, not approximately: `usdcOut == usdcIn` at NAV 1.00, and `usdcIn - 1 ≤ usdcOut ≤ usdcIn` across the NAV range, with the single-unit loss proved to occur exactly when the subscription leg truncates); previews match execution byte for byte; coupon conservation with quantified dust; D28 bounds with named errors and no `Panic`; the D27 rail under chained in-window updates |
| Invariant — 9 properties | `forge test --match-contract HBTokenInvariant` | A 32,768-call campaign (128 sequences × 256 calls; 65,536 under the `ci` profile) over five actors whose eligibility changes mid-run. `fail_on_revert = true`: the handler bounds every input, so a revert is a finding, not noise |
| Coverage | `forge coverage --no-match-coverage script` | 100% of lines, statements, branches and functions in `src/` |
| Gas | `forge snapshot --check --tolerance 10 --no-match-test "invariant\|testFuzz"` | 153 committed measurements; CI fails on a >10% regression |
| Static analysis | `slither . --config-file slither.config.json` | 15 findings, all medium or below, each triaged in §5 |

The invariants asserted after **every call** of every sequence:

1. `usdc.balanceOf(token) ≥ Σ pendingCoupon(holder)` — the coupon money holders can still claim is really there.
2. `couponReserve() ≥ Σ pendingCoupon(holder)` — and it is reserved, not merely present (D6).
3. `totalSupply() == ghostMinted - ghostBurned`, counted independently by the handler.
4. `availableLiquidity() + couponReserve() == vaultBalance()`, and `vaultBalance() ≥ couponReserve()`.
5. `totalClaimed ≤ totalAllocated ≤ totalDistributed` (D29).
6. `Σ balanceOf(actor) == totalSupply()` — no balance escapes the whitelisted set.
7. `nav > 0`, `railAnchorNav ≥ 1`, `reportedAUM ≤ MAX_INPUT` — NAV never reaches zero and `reportedAUM` never
   wraps around.
8. The contract's `totalDistributed` / `totalClaimed` equal the handler's independent ghost totals.
9. `vaultBalance() == subscribed + distributed - claimed - redeemed`, end to end.

The properties were checked against deliberate mutations of `src/HBToken.sol` before being accepted: rounding the
coupon allocation down instead of up breaks properties 2 and 5 and the conservation fuzz test; measuring the rail
against the previous NAV instead of the window anchor breaks the rail property; rounding `previewRedeem` up breaks
the preview property. A property that nothing can break is not a property.

---

## 4. Known limitations

Ranked by how much they would matter if this were real.

1. **No audit.** See the banner. The production intent is that a licensed vendor's audited implementation of this
   spec holds real assets, not this code.
2. **The portfolio is simulated.** There are no bonds, no custodian and no Euroclear settlement. `reportedAUM` is
   a number the oracle asserts. On testnet the vault holds only subscription USDC.
3. **Keys are hot and single-signature.** Admin, issuer and oracle are EOAs; the registrar key sits on a web
   server. Production puts these behind a multisig with a timelock and keeps the oracle key separate from both.
4. **Instant settlement at the current NAV** (T14), rather than forward pricing.
5. **Redemption is first come, first served** (T6). No queue, no gate, no pro-rata scaling.
6. **Coupons cannot be claimed while paused** (D3, T15). This is the price of pause semantics that are simple
   enough to reason about; a selective pause would be a larger surface, not a smaller one.
7. **Coupon dust is not recoverable.** Two separate terms, both quantified: up to `ceil(totalSupply / 1e18) - 1`
   USDC units per distribution are never allocated (they stay as ordinary vault liquidity, D29), and each holder's
   settlement truncates below one USDC unit per distribution, which stays in the reserve for good. After every
   holder has claimed, the reserve is at most the number of holders in USDC units — cents, not dollars, and it is
   never redeemable by anyone.
8. **`totalSupply` is assumed below `2^128`** (T10). Per-call mints are bounded; their sum is not.
9. **The settlement asset must be a plain ERC-20** (T11). Fee-on-transfer or rebasing assets would break the
   accounting silently.
10. **`_update` does not check `canHold(from)` on burns** (D4, T12) — a deliberate deviation from the literal
    BUILD_PROMPT 5.2 rule so that a de-verified holder can always exit to cash. Pending founder confirmation;
    reverting to the literal rule is a one-line change.
11. **The attestor is us** (T18). An independent firm signs in production.

---

## 5. Static analysis — triaged findings

```bash
cd contracts && slither . --config-file slither.config.json
```

`slither.config.json` restricts analysis to `src/` (`filter_paths` excludes `lib/`, `test/` and `script/`) and
turns **no detector off**: informational, low, medium and high findings are all printed. The run exits non-zero
only on a high-severity finding; there are none. Every finding below is printed on every run and accepted here
with an argument. If this output changes, re-triage it — do not extend the exclusion.

Current result: **15 findings — 0 high, 1 medium, 3 low, 11 informational.**

| Detector | Severity | Location | Why it is accepted |
|---|---|---|---|
| `divide-before-multiply` | Medium | `HBToken.distributeCoupon`, `src/HBToken.sol#280` → `#287`: `perToken = usdcAmount * 1e18 / supply` then `allocated = (perToken * supply + 1e18 - 1) / 1e18` | The truncation is the point, not a bug. Holders are settled against the **truncated** `perToken`, so the reserve must be computed from that same truncated value; computing it from the exact ratio would over-allocate and lock USDC that no holder can ever claim (D29). The rounding direction is up, which is what makes `couponReserve()` provably cover every floor-rounded claim. `test_allocationRoundsUp_reserveNeverUnderflows` pins the two-coupon case where rounding down would underflow the reserve, and `invariant_couponReserveCoversEveryPendingCoupon` re-checks it after every call of a 32,768-call campaign |
| `timestamp` | Low | `HBToken.setNAV`, `src/HBToken.sol#171`: `block.timestamp >= railWindowStart + RAIL_WINDOW` | The rail window is a 24-hour period *by definition*. Validator drift of a few seconds moves the instant at which the anchor refreshes; it cannot widen the per-window band, because the band is computed from `railAnchorNav` and `maxNavMoveBps` and never from elapsed time. The worst case is that one update is measured against the previous window's anchor — a stricter check, not a looser one |
| `timestamp` | Low | `MockUSDC.faucet`, `src/MockUSDC.sol#53` | Same shape, on a testnet faucet. Drift shifts when a test allowance refreshes and can never mint above `FAUCET_CAP` within a window. `MockUSDC` holds no value and is never deployed to a mainnet |
| `timestamp` | Low | `MockUSDC.faucetRemaining`, `src/MockUSDC.sol#70` | The view mirrors the comparison in `faucet` so the UI shows what the next call would do. Same argument |
| `naming-convention` | Informational | `HBToken.REGISTRY` `#81`, `HBToken.USDC` `#82` | Two linters disagree. Foundry's own `forge lint` requires `SCREAMING_SNAKE_CASE` for immutables; Slither's Solidity style guide wants `mixedCase` for variables. Foundry is this project's primary toolchain and its check runs on every build, so its convention wins. Both are private immutables read through the `registry()` and `usdc()` getters that partners integrate against — the lowercase names are already taken by those functions |
| `naming-convention` | Informational | `IHBToken.ISSUER_ROLE` `#77`, `ORACLE_ROLE` `#79`, `NAV_SCALE` `#81`, `TOKEN_SCALE` `#83`, `MAX_INPUT` `#85`, `RAIL_WINDOW` `#87` | These are `public constant` state variables surfaced through the interface, so the getter carries the constant's name. `SCREAMING_SNAKE_CASE` is the Solidity convention for constants and the convention OpenZeppelin's `AccessControl` uses for role identifiers; renaming them would break the integration surface that `PARTNER_INTEGRATION.md` documents. Same reasoning as the `setNAV` / `reportedAUM` exclusions in `foundry.toml`, which are mandated verbatim by `SPEC.md` |
| `naming-convention` | Informational | `IIdentityRegistry.REGISTRAR_ROLE` `#44`, `INVESTOR_PROFESSIONAL` `#46`, `INVESTOR_RETAIL` `#48` | Same as above |

---

## 6. What changes in production

| Layer | This MVP | Production |
|---|---|---|
| Token contract | Ours, unaudited, on a testnet | A licensed tokenization vendor's **audited** implementation of this spec |
| Audit | None | Independent audit before any real value, plus a re-audit on every material change |
| Admin / issuer keys | Single EOAs | Multisig with a timelock, under a licensed operator's key-management controls, with role separation enforced organisationally as well as on-chain |
| Oracle | One key, 5% per 24 h rail | Fund administrator's NAV, multiple signers that must agree within a tolerance before an update lands (showcase item 6 sketches the direction), plus deviation alerting |
| Registrar | Testnet key on a web server, auto-approval after a short delay | The partner's KYC/AML vendor writing to the registry, with sanctions and residency screening and a human approval step |
| Custody | None | Broker plus Euroclear settlement and a licensed digital custodian |
| NAV data | Our engine over simulated positions | Fund administrator's official NAV over real holdings |
| Attestation | Our key, labelled simulated | An independent firm signing monthly |
| Settlement asset | `MockUSDC` with an open faucet | Real USDC, or fiat into the fund's account |
| Pricing | Instant at the current on-chain NAV | Forward pricing: subscriptions and redemptions queued and settled at the next published NAV |
| Redemption | First come, first served against vault liquidity | A fund-level liquidity policy: notice periods, gates, and redemption in kind where the documentation allows it |

---

## 7. Reporting a vulnerability

This is a public testnet demonstration with no funds at risk. If you find a flaw, please open an issue in this
repository, or contact the founders directly if you would rather not disclose it publicly first. There is no bug
bounty. We would rather hear about it than not.
