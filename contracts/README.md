# contracts/

Foundry project for the HitBite testnet MVP: `IdentityRegistry`, `HBToken` (`hbTRS`) and `MockUSDC`.

**Testnet only.** Never configured for a mainnet. Simulated portfolio. Not an offer of securities.

## Build and test

Toolchain: Foundry 1.8.x, solc 0.8.26, OpenZeppelin Contracts v5.7.0 and forge-std v1.11 as git submodules
(`git submodule update --init --recursive` or `make setup` from the repo root).

```bash
forge build --force                                          # compile; lint runs on src/ and must print zero notes
forge fmt --check                                            # formatting (forge fmt to fix)
forge test -vvv                                              # unit tests (149 tests across 4 suites)
forge coverage --report summary --no-match-coverage test/    # coverage of src/ only: 100% lines / branches / funcs
forge inspect HBToken userdoc                                # every external function carries a @notice
forge snapshot                                               # gas snapshot (.gas-snapshot), added in Phase 2
```

From the repo root the same steps are `make build-contracts`, `make lint-contracts`, `make test-contracts`.

Layout:

| Path | Purpose |
|---|---|
| `src/interfaces/IIdentityRegistry.sol`, `src/interfaces/IHBToken.sol` | Binding API (names, events, errors, NatSpec semantics). Partners integrate against these; implementations use `@inheritdoc`. |
| `src/IdentityRegistry.sol` | On-chain whitelist with a deployer-configured, admin-editable country blocklist. |
| `src/HBToken.sol` | `hbTRS`: whitelisted ERC-20, NAV subscription/redemption, coupon index, ex-distribution NAV drop, pause, NAV rail window, input bounds. |
| `src/MockUSDC.sol` | Six-decimal test USDC with a capped public faucet. No roles. |
| `test/utils/BaseTest.sol` | Shared fixture: deploys the three contracts, grants roles, `_verify` / `_fund` / `_fundAcrossWindows` / `_subscribe` / `_distribute` / `_setNav` helpers. `_fund` is a single faucet call and never warps time; `_fundAcrossWindows` warps and is used only by tests that opt in. |
| `test/IdentityRegistry.t.sol`, `test/HBToken.t.sol`, `test/HBTokenCoupon.t.sol`, `test/MockUSDC.t.sol` | Unit tests. Every custom error in `src/` (interfaces included) is hit by at least one `vm.expectRevert` with the exact selector and arguments; every reachable OpenZeppelin error (`ERC20InsufficientBalance`, `ERC20InsufficientAllowance`, `EnforcedPause`, `ExpectedPause`, `AccessControlUnauthorizedAccount`) likewise. |
| `deployments/` | `<chain>.json` written by the deploy script (Phase 3). |

Lint: `[lint]` in `foundry.toml` excludes `mixed-case-function` / `mixed-case-variable` (the spec mandates `setNAV`
and `reportedAUM`) and ignores `test/**/*.sol` (cheatcode idioms such as `vm.expectEmit` + `emit` and
`vm.expectRevert` on value-returning calls trip lints that have no meaning in tests). `src/` is linted in full;
the three remaining `forge-lint: disable-next-line` comments each carry the reason (timestamp comparison for the
rail and faucet windows, the allocation that must multiply the *truncated* per-token increment, and the
constructor blocklist loop that must revert on an invalid code).

## Contracts

### IdentityRegistry

Storage: `Identity { bool verified; uint16 country; uint8 investorType; uint64 verifiedAt; }` per account and a
`country => blocked` map. The blocklist is **not a contract constant**: it is passed to the constructor by the
deployer (`script/Deploy.s.sol` in Phase 3 passes `[840, 792]`: United States, US securities law; Türkiye, product
not offered to Turkish residents in phase one) and the admin can change it at any time with `setCountryBlocked`.

Country codes are ISO 3166-1 numeric and must be in `1..999` everywhere (constructor, `addVerified`,
`setCountryBlocked`); `0` and anything above `999` revert `InvalidCountry(code)`. `0` is rejected because an unset
country would otherwise escape the blocklist. Only `investorType == 1` (professional) can be verified; `2` (retail)
reverts `RetailNotAllowed()` and anything else reverts `InvalidInvestorType(type)`. Re-verifying overwrites the
record. `canHold(account)` is `verified && !blocked[country]` and is what `HBToken` consults; blocking a country
after verification flips `canHold` to false without deleting the record. A zero admin reverts `ZeroAddress()`.

### HBToken (`hbTRS`, 18 decimals)

Units: `nav` is USDC (6 decimals) per `1e18` tokens, initial `1_000_000` (1.00 USDC).

```
tokens  (1e18) = usdcAmount (1e6) * 1e18 / nav (1e6)      // subscribe / previewSubscribe
usdcOut (1e6)  = tokenAmount (1e18) * nav (1e6) / 1e18    // redeem / previewRedeem
```

Defaults: `maxNavMoveBps = 500` (5 % per 24 h rail window), `minSubscription = 100e6` (100 USDC). Both
admin-settable. The constructor emits `NAVUpdated(0, 1_000_000, 0, now)`, `MaxNavMoveBpsUpdated(0, 500)` and
`MinSubscriptionUpdated(0, 100e6)` so an indexer sees every configuration value from the deployment block.
A zero registry, USDC or admin address reverts `ZeroAddress()`.

**Input bounds (D28).** Every amount, NAV and reported-AUM input is bounded by `MAX_INPUT = type(uint128).max`:
`subscribe` / `previewSubscribe` / `redeem` / `previewRedeem` / `distributeCoupon` / `mint` revert
`AmountTooLarge(amount)`, `setNAV` reverts `InvalidNav()` for `0` or above the bound and `AmountTooLarge` for the
reported AUM. `totalSupply()` is assumed to stay below `2^128` (each operational mint is bounded per call). Under
these bounds every product fits in `uint256`, so no revert path is a `Panic`
(`redeem(type(uint256).max)` from an empty account reverts `AmountTooLarge`, tested).

**Coupon index (no holder iteration).** `distributeCoupon(usdc)` pulls USDC from the issuer and raises
`couponIndex` by `perToken = usdc * 1e18 / totalSupply()`. Every balance change settles both sides first
(`accrued += balance * (couponIndex - userIndex) / 1e18`), so a transfer between two distributions never double
counts and a subscriber after a distribution receives nothing from it. `CouponDistributed(id, usdcAmount,
usdcAllocated, couponIndex, totalSupply)` reports both the USDC pulled and the part attributable to holders.

**Ex-distribution NAV drop (D26).** The same call lowers `nav` by `perToken` (and `reportedAUM` by the USDC
pulled, floored at zero) and emits `NAVUpdated`, exactly as a fund's NAV drops on the ex-distribution date.
`navUpdatedAt` is not touched (it tracks the oracle). The rail anchor is reduced by `perToken` too (floored at 1),
so distributions never consume the oracle's rail budget. The demo numbers: A 1000 USDC, B 500 USDC at NAV 1.00
and a 12 USDC coupon give `perToken = 8000`, NAV `992_000`, A 8 USDC and B 4 USDC. A wallet that subscribes right
before a distribution, claims and redeems gets back exactly what it put in (tested; it cannot capture the coupon
from existing holders).

**Distribution accounting (D29).** `distributeCoupon` reverts `DistributionTooSmall(usdc, ceil(supply / 1e18))`
when `perToken` would truncate to zero (the whole amount would otherwise be locked) and
`DistributionExceedsNav(perToken, nav)` when the per-token amount is not strictly below NAV (so NAV never reaches
zero). `totalAllocated` accumulates `ceil(perToken * supply / 1e18)` (never more than the USDC pulled) separately
from `totalDistributed`; `couponReserve() = totalAllocated - totalClaimed`, so the truncation remainder of each
distribution (up to `ceil(supply / 1e18) - 1` USDC units) is ordinary vault liquidity from the start rather than a
permanently locked reserve. The allocation is rounded **up** because a holder who sits through several
distributions before settling is paid `floor(balance * sumOfIncrements / 1e18)`, which can exceed the sum of
per-distribution floors by up to one unit each; rounding up is what makes `couponReserve()` provably never
underflow (tested with a 0.6-token supply and two 1-unit coupons).

### MockUSDC (Testnet)

`faucet(to, amount)`: anyone may call, for any address; at most 10,000 USDC per call and per address per **fixed
24 h window that starts at the address's first use** (`windowStart` / `mintedInWindow`; the next call at or after
`windowStart + 1 days` starts a new window, calls inside a window never extend it). `faucetRemaining(account)`
shows the current allowance. No roles at all. Because anyone can call it for any address, the per-address cap is a
convenience against accidental over-minting on a testnet, not an economic bound.

## Roles

| Contract | Role | Functions |
|---|---|---|
| IdentityRegistry | `DEFAULT_ADMIN_ROLE` | `setCountryBlocked`, `grantRole` / `revokeRole` |
| IdentityRegistry | `REGISTRAR_ROLE` | `addVerified`, `removeVerified` (reverts `NotRegistrar()` otherwise) |
| HBToken | `DEFAULT_ADMIN_ROLE` | `setNAV(..., force = true)`, `setMaxNavMoveBps`, `setMinSubscription`, `grantRole` / `revokeRole` |
| HBToken | `ORACLE_ROLE` | `setNAV(..., force = false)` (rail enforced) |
| HBToken | `ISSUER_ROLE` | `distributeCoupon`, `mint`, `burn`, `pause`, `unpause` |
| HBToken | none (any eligible holder) | `subscribe`, `redeem`, `claimCoupon`, `transfer` |
| MockUSDC | none | `faucet` |

The constructors grant only `DEFAULT_ADMIN_ROLE`. `REGISTRAR_ROLE`, `ISSUER_ROLE` and `ORACLE_ROLE` are granted
by the admin (the deploy script in Phase 3). Unauthorised calls revert with OpenZeppelin's
`AccessControlUnauthorizedAccount(account, role)`, except registrar functions which use the registry's own
`NotRegistrar()`.

## Decisions (numbered as in `PLAN.md`)

**D3 Pause semantics.** `pause()` (issuer) blocks `transfer`, `mint`, `burn`, `subscribe`, `redeem`,
`distributeCoupon` and `claimCoupon`; every path reverts with OpenZeppelin's `EnforcedPause()`. Issuer burns are
not exempt: to correct a position while paused the issuer unpauses, corrects and re-pauses, which keeps the audit
trail simple. `setNAV` (both oracle and admin force) and all registry changes keep working while paused.

**D4 Burns and `canHold(from)`.** `_update` requires `registry.canHold(to)` for every mint and transfer and
`registry.canHold(from)` for transfers, but **not** for burns. A holder who is de-verified, or whose country is
blocked after verification, can no longer send or receive `hbTRS`, but can still `redeem` (exit to cash), can still
`claimCoupon` for what already accrued, and can be force-burned by the issuer. Receiving is the restriction that
matters; trapping funds is never desirable. See *Known limitations* for the founder confirmation this needs.

**D5 / D27 NAV rail window.** `setNAV(newNav, reportedAUM, force)`. With `force = false` the caller needs
`ORACLE_ROLE` and `|newNav - railAnchorNav| * 10_000 <= railAnchorNav * maxNavMoveBps` must hold, where
`railAnchorNav` is the NAV at the start of the current 24 h window (`railWindowStart`, `RAIL_WINDOW = 1 days`).
When a full window has elapsed the next non-forced update first re-anchors at the current NAV and restarts the
window at that timestamp. Chained in-rail updates therefore cannot compound past the rail within a day: two +5 %
steps in one block leave the anchor unchanged and the second reverts
`NavMoveExceedsRail(anchorNav, newNav, maxBps)`; the same step passes a day later. With `force = true` the caller
needs `DEFAULT_ADMIN_ROLE`, the rail is skipped, `NAVForced(old, new, by)` is emitted after `NAVUpdated`, and the
window restarts anchored at `newNav`. Distributions reduce the anchor by their per-token amount (D26). The rail is
an oracle safety net: a compromised or buggy oracle key cannot move the NAV by more than the rail per day; large
legitimate moves need the admin key.

**D6 Redemption liquidity.** Coupon money is never used for redemptions.
`couponReserve() = totalAllocated - totalClaimed`, `availableLiquidity() = vaultBalance() - couponReserve()`
(floored at zero), and `redeem` reverts `InsufficientLiquidity(available, requested)` against *available*
liquidity. Invariant: `usdc.balanceOf(token) >= sum over holders of pendingCoupon(holder)` (`pendingCoupon`
already includes the settled `accrued` part). With only coupon money in the vault no redemption can go through,
while every claim can.

**D20 `supplyBackedRatio()`.** `(availableLiquidity() + reportedAUM) * 1e18 / (totalSupply * nav / 1e18)`. The
coupon reserve is owed to holders and is excluded from the numerator, so an unclaimed distribution never inflates
the ratio (tested: a coupon into a portfolio-backed supply leaves the ratio at exactly `1e18`). Returns `1e18` when
liabilities round to zero: no supply, or a dust supply below `1e18 / nav` wei whose value is less than one USDC
unit (tested at the `999_999_999_999` / `1e12` wei boundary). Illustrative on testnet: subscription USDC sits in the
vault while the portfolio is simulated.

## Production uses only `subscribe` and `redeem`

Issuance and exit in production go exclusively through `subscribe` (USDC in at NAV) and `redeem` (USDC out at
NAV). `mint(to, amount)` and `burn(from, amount)` exist for operational corrections by the issuer (for example
reversing a mistaken subscription) and emit dedicated `OperationalMint` / `OperationalBurn` events so that any use
is visible on-chain and in the event history. They obey the same whitelist and pause rules as everything else.

## Known limitations

- **NAV timing.** The engine publishes `nav.json` before the oracle push lands on-chain, so for a short interval
  the site can show a NAV that is not yet the settlement NAV; a subscriber who watches the feed can time a
  subscription or redemption around a known move. A production fund uses request / settle-at-next-NAV
  (subscriptions and redemptions queued and priced at the next published NAV) rather than instant settlement at
  the current on-chain value.
- **Issuer key powers.** `mint`, `burn`, `pause` and `distributeCoupon` are hot-key powers of a single
  `ISSUER_ROLE` address on this testnet, and `setNAV(force = true)` is a hot-key power of `DEFAULT_ADMIN_ROLE`.
  Production puts these behind a multisig with a timelock, keeps the oracle key separate from both, and monitors
  `OperationalMint` / `OperationalBurn` / `NAVForced`.
- **Burns and redemptions of de-verified holders (D4).** BUILD_PROMPT 5.2 asks `_update` to require
  `canHold(from)` whenever `from != 0`, which would also block burns and therefore trap a de-verified holder's
  funds. This implementation deviates: burns (issuer corrections and `redeem`) and `claimCoupon` skip the `from`
  eligibility check so that a de-verified or newly blocked holder can always exit to cash. Pending founder
  confirmation; reverting to the literal rule is a one-line change in `_update`.
- **Coupon dust.** `perToken` truncates, leaving up to `ceil(supply / 1e18) - 1` USDC units per distribution
  unallocated (ordinary vault liquidity, see D29), and each holder's settlement truncates less than one USDC unit,
  which stays inside `couponReserve()` (after every holder has claimed, the reserve is at most the number of
  holders in USDC units). Neither is recoverable by holders; both are far below one cent for any realistic supply.
- **Rail anchor floor.** If a single coupon's per-token amount is at least the window-start NAV (a >100 % payout
  in one go), the rail anchor floors at `1` and every oracle update reverts until the window rolls or the admin
  forces a NAV. Documented in `distributeCoupon`; not reachable with normal coupon sizes.

## Deployment and addresses

Deploy and seed scripts, `deployments/<chain>.json` and explorer links are added in Phase 3.
