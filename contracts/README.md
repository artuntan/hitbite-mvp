# contracts/

Foundry project for the HitBite testnet MVP: `IdentityRegistry`, `HBToken` (`hbTRS`) and `MockUSDC`.

**Testnet only.** Never configured for a mainnet. Simulated portfolio. Not an offer of securities.

## Build and test

Toolchain: Foundry 1.8.x, solc 0.8.26, OpenZeppelin Contracts v5.7.0 and forge-std v1.11 as git submodules
(`git submodule update --init --recursive` or `make setup` from the repo root).

```bash
forge build --force                                          # compile; lint runs on src/ and must print zero notes
forge fmt --check                                            # formatting (forge fmt to fix)
forge test                                                   # everything: 161 tests across 6 suites
forge coverage --report summary --no-match-coverage test/    # coverage of src/ only: 100% lines / branches / funcs
forge inspect HBToken userdoc                                # every external function carries a @notice
forge snapshot --no-match-test "invariant|testFuzz"          # regenerate .gas-snapshot (deterministic tests only)
```

From the repo root the same steps are `make build-contracts`, `make lint-contracts`, `make test-contracts`.
Deploying is `make anvil` + `make deploy-local` + `make seed` locally and `make deploy CHAIN=base-sepolia`
on the testnet; see [Deployment](#deployment) for the runbook, the guard rails and the addresses.

Layout:

| Path | Purpose |
|---|---|
| `src/interfaces/IIdentityRegistry.sol`, `src/interfaces/IHBToken.sol` | Binding API (names, events, errors, NatSpec semantics). Partners integrate against these; implementations use `@inheritdoc`. |
| `src/IdentityRegistry.sol` | On-chain whitelist with a deployer-configured, admin-editable country blocklist. |
| `src/HBToken.sol` | `hbTRS`: whitelisted ERC-20, NAV subscription/redemption, coupon index, ex-distribution NAV drop, pause, NAV rail window, input bounds. |
| `src/MockUSDC.sol` | Six-decimal test USDC with a capped public faucet. No roles. |
| `test/utils/BaseTest.sol` | Shared fixture: deploys the three contracts, grants roles, `_verify` / `_fund` / `_fundAcrossWindows` / `_subscribe` / `_distribute` / `_setNav` helpers. `_fund` is a single faucet call and never warps time; `_fundAcrossWindows` warps and is used only by tests that opt in. |
| `test/IdentityRegistry.t.sol`, `test/HBToken.t.sol`, `test/HBTokenCoupon.t.sol`, `test/MockUSDC.t.sol` | Unit tests. Every custom error in `src/` (interfaces included) is hit by at least one `vm.expectRevert` with the exact selector and arguments; every reachable OpenZeppelin error (`ERC20InsufficientBalance`, `ERC20InsufficientAllowance`, `EnforcedPause`, `ExpectedPause`, `AccessControlUnauthorizedAccount`) likewise. |
| `test/HBToken.fuzz.t.sol` | Property tests: round-trip value, preview exactness, coupon conservation, D28 bounds, the D27 rail. |
| `test/invariant/HBTokenInvariant.t.sol`, `test/invariant/handlers/HBTokenHandler.sol` | Stateful invariants and the handler that drives them. |
| `.gas-snapshot`, `slither.config.json` | Committed gas measurements and the static-analysis configuration. |
| `script/Config.s.sol` | Shared environment handling: the testnet-only chain guard, deployer and role resolution, RPC endpoints, deployment paths. Fails with a named variable and a next action rather than defaulting silently. |
| `script/Deploy.s.sol` | `run()` deploys the three contracts, grants the roles and seeds the country blocklist; `record()` writes `deployments/<chain>.json`. |
| `script/Seed.s.sol` | Verifies and funds the two demo wallets and sets the opening NAV. Idempotent. |
| `deployments/` | `<chain>.json`: `chainId`, `addresses`, `deployBlock`, `txHashes`, `timestamp` (BUILD_PROMPT 5.6). `anvil.json` is committed (D15); `base-sepolia.json` lands with the founders' deploy run. |

Lint: `[lint]` in `foundry.toml` excludes `mixed-case-function` / `mixed-case-variable` (the spec mandates `setNAV`
and `reportedAUM`) and ignores `test/**/*.sol` (cheatcode idioms such as `vm.expectEmit` + `emit` and
`vm.expectRevert` on value-returning calls trip lints that have no meaning in tests). `src/` is linted in full;
the three remaining `forge-lint: disable-next-line` comments each carry the reason (timestamp comparison for the
rail and faucet windows, the allocation that must multiply the *truncated* per-token increment, and the
constructor blocklist loop that must revert on an invalid code).

## Testing

Four layers, each answering a different question. All 161 tests run in about 12 seconds.

```bash
forge test                                                   # all six suites
forge test --match-contract HBTokenCoupon -vvv               # one suite, with traces
FOUNDRY_PROFILE=ci forge test                                # deeper fuzz and invariant campaigns (as in CI)
```

### Unit — 151 tests

`test/IdentityRegistry.t.sol` (29), `test/HBToken.t.sol` (81), `test/HBTokenCoupon.t.sol` (30) and
`test/MockUSDC.t.sol` (11), all on the shared `test/utils/BaseTest.sol` fixture. Every function, every revert path
and every custom error with its exact arguments. The BUILD_PROMPT 5.3 cases are worked by hand in comments: the
70/30 split, a transfer between distributions that does not double count, a subscriber after a distribution who
receives nothing from it, a claim that survives a burn, a holder who exits completely and comes back, and the dust
arithmetic of D29.

### Fuzz — 7 properties

```bash
forge test --match-contract HBTokenFuzz
```

`test/HBToken.fuzz.t.sol`. 512 runs each by default, 2,048 under the `ci` profile, with a pinned seed so a failure
reproduces. Every input goes through `bound()`; the properties are:

| Property | What it proves |
|---|---|
| `testFuzz_roundTripAtNavOne_isExact` | Subscribe then redeem at NAV 1.00 returns **exactly** what went in — `1e18` is a multiple of `1e6`, so neither leg truncates |
| `testFuzz_roundTripAtFuzzedNav_losesAtMostOneUsdcUnit` | Across the whole legal NAV range the loss is at most one USDC unit (1e-6 USDC) and always accrues to the fund. The bound is asserted exactly, not as an inequality: `usdcOut == usdcIn - (((usdcIn * 1e18) mod nav) == 0 ? 0 : 1)` |
| `testFuzz_previewsMatchSubscribeAndRedeem` | `previewSubscribe` / `previewRedeem` equal what `subscribe` / `redeem` actually mint, burn and move |
| `testFuzz_couponConservation` | Over a fuzzed sequence of distributions, transfers and claims: `Σ claims ≤ totalAllocated ≤ totalDistributed`, with the shortfall bounded by exactly the two D29 dust terms — `ceil(supply / 1e18)` unallocated per distribution, and one USDC unit per holder per distribution of settlement truncation |
| `testFuzz_aboveMaxInput_revertsNamedError_neverPanics` | Above `MAX_INPUT` every entry point reverts with the exact named error, never an arithmetic `Panic(0x11)` or a division `Panic(0x12)` (D28) |
| `testFuzz_legalRangeExtremes_neverPanic` | At the top of the legal range — supply and NAV both at the `2^128` ceiling — nothing panics; a revert is always a declared error |
| `testFuzz_navRail_inWindowUpdatesCannotCompound` | Eight fuzzed oracle updates inside one 24 h window never move NAV further than `maxNavMoveBps` from the window anchor, and the anchor does not move (D27) |

### Invariants — 9 properties

```bash
forge test --match-contract HBTokenInvariant
```

`test/invariant/HBTokenInvariant.t.sol` drives `test/invariant/handlers/HBTokenHandler.sol` through 32,768 calls
(128 sequences of 256; 65,536 under the `ci` profile) over five actors — three verified at the start, two not, any
of them verified, de-verified or country-blocked mid-run. The handler exposes bounded `subscribe`, `redeem`,
`transfer`, `claimCoupon`, `distributeCoupon`, `mint`, `burn`, `pause`, `unpause`, `setNAV`, `addVerified`,
`removeVerified` and `setCountryBlocked` actions, tracks ghost totals for minted, burned, distributed and claimed
USDC, and counts how many calls actually changed state.

`fail_on_revert = true` is deliberate: the handler bounds every input and returns early when a precondition cannot
be met, so **no call it makes may revert** and a revert surfacing in the campaign is a finding rather than fuzzer
noise. `afterInvariant` asserts that a healthy sequence still changes state on at least a quarter of its calls, and
`test_handlerCoverage_everyActionLands` proves deterministically that all thirteen actions are reachable.

The properties (asserted after every single call) are listed with their reasoning in [`../SECURITY.md`](../SECURITY.md)
§3: the coupon reserve and the vault each cover every claimable coupon; supply equals minted minus burned;
liquidity plus reserve equals the vault; `totalClaimed ≤ totalAllocated ≤ totalDistributed`; actor balances sum to
`totalSupply`; NAV never reaches zero and `reportedAUM` never wraps; the ghost totals match the chain; and the
vault balance is fully accounted for end to end.

### Coverage

```bash
forge coverage --no-match-coverage script --report summary
```

`src/` is at **100% of lines, statements, branches and functions** and must stay there. The report also lists the
test helpers; only `src/` is a target.

### Gas snapshot

```bash
forge snapshot --no-match-test "invariant|testFuzz"                     # regenerate
forge snapshot --check --tolerance 10 --no-match-test "invariant|testFuzz"   # what CI runs
```

`.gas-snapshot` holds 153 measurements. Fuzz and invariant tests are excluded because their gas figures move with
the seed and the run count, which would make the diff meaningless. CI fails on a regression above 10%.

## Static analysis

```bash
uv tool install slither-analyzer        # or: pipx install slither-analyzer
slither . --config-file slither.config.json
```

`slither.config.json` points the analyser at `src/` only — `filter_paths` excludes `lib/` (OpenZeppelin, forge-std)
and `test/` and `script/`, where cheatcode idioms trip detectors that carry no production meaning. **No detector is
disabled**: informational, low, medium and high findings are all printed on every run. The run exits non-zero only
on a high-severity finding.

The current output is 15 findings — 0 high, 1 medium (`divide-before-multiply`, the deliberate truncation in
`distributeCoupon`), 3 low (`timestamp`, the rail and faucet windows) and 11 informational (`naming-convention`,
where Slither's style guide disagrees with `forge lint`). Each one is triaged individually, with its location and
a concrete argument, in [`../SECURITY.md`](../SECURITY.md) §5. Nothing is silenced to keep the output quiet; if the
output changes, re-triage it rather than extending the exclusion.

Note that Slither runs `forge clean` before compiling, so the next `forge build` after it is a full rebuild.

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

`script/Deploy.s.sol` grants every role in the deployment transaction batch. Each holder comes from an environment
variable that **defaults to the deployer** when it is unset, which is the single-key configuration `.env.example`
documents for the MVP; giving four different addresses is closer to production and is supported unchanged.

| Contract | Role | Granted to | What it can do | Governed by |
|---|---|---|---|---|
| IdentityRegistry | `DEFAULT_ADMIN_ROLE` | `ADMIN_ADDRESS` | `setCountryBlocked`, `grantRole` / `revokeRole` | BUILD_PROMPT 5.1 |
| IdentityRegistry | `REGISTRAR_ROLE` | `REGISTRAR_ADDRESS` | `addVerified`, `removeVerified` (reverts `NotRegistrar()` otherwise) | BUILD_PROMPT 5.1, D21 |
| HBToken | `DEFAULT_ADMIN_ROLE` | `ADMIN_ADDRESS` | `setNAV(..., force = true)`, `setMaxNavMoveBps`, `setMinSubscription`, `grantRole` / `revokeRole` | D5, D27 |
| HBToken | `ORACLE_ROLE` | `ORACLE_ADDRESS` | `setNAV(..., force = false)` (rail enforced) | D5, D27, D31 |
| HBToken | `ISSUER_ROLE` | `ISSUER_ADDRESS` | `distributeCoupon`, `mint`, `burn`, `pause`, `unpause` | D3, D24, D26, D29 |
| HBToken | none (any eligible holder) | — | `subscribe`, `redeem`, `claimCoupon`, `transfer` | D4, D6, D13 |
| MockUSDC | none (anyone) | — | `faucet` | D14 |

**Who ends up with `DEFAULT_ADMIN_ROLE`.** The constructors grant only `DEFAULT_ADMIN_ROLE`, and the deploy script
passes *itself* as that admin, because granting `REGISTRAR_ROLE` / `ISSUER_ROLE` / `ORACLE_ROLE` needs admin rights
in the same batch. What happens next depends on `ADMIN_ADDRESS`:

- **`ADMIN_ADDRESS` unset or equal to the deployer (the default).** The deployer keeps `DEFAULT_ADMIN_ROLE` on both
  contracts. The script prints `DEFAULT_ADMIN_ROLE kept by the deployer (ADMIN_ADDRESS unset)`.
- **`ADMIN_ADDRESS` set to a different account.** The script grants `DEFAULT_ADMIN_ROLE` to it on both contracts and
  then calls `renounceRole(DEFAULT_ADMIN_ROLE, deployer)` on both, so the deployer key keeps no power over the
  deployment at all. The script prints `DEFAULT_ADMIN_ROLE transferred to ADMIN_ADDRESS; deployer renounced it on
  both contracts`. Verified on a local Anvil run with `cast call <contract> 'hasRole(bytes32,address)(bool)'
  0x00..00 <deployer>` returning `false` on both contracts and `true` for `ADMIN_ADDRESS`.

Unauthorised calls revert with OpenZeppelin's `AccessControlUnauthorizedAccount(account, role)`, except registrar
functions which use the registry's own `NotRegistrar()`.

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

## Deployment

Three scripts, driven entirely by environment variables, refusing anything that is not a testnet.

| Script | Entry point | Broadcasts | What it does |
|---|---|---|---|
| `script/Config.s.sol` | — (inherited) | no | Chain guard, deployer and role resolution, RPC endpoints, deployment-record path |
| `script/Deploy.s.sol` | `run()` | yes | `MockUSDC` -> `IdentityRegistry` (blocklist `840`, `792`) -> `HBToken`; grants `REGISTRAR_ROLE`, `ISSUER_ROLE`, `ORACLE_ROLE`; hands over `DEFAULT_ADMIN_ROLE` when asked |
| `script/Deploy.s.sol` | `record()` | no | Writes `deployments/<chain>.json` from the broadcast Foundry just produced |
| `script/Seed.s.sol` | `run()` | yes | Verifies demo wallets A (784 UAE) and B (276 Germany) as professionals, tops them up from the faucet, sets the opening NAV |

### Guard rails

- **Testnet only.** `Config._requireTestnetChain()` accepts chain id `31337` and `84532` and aborts on everything
  else; a known mainnet id is named in the message. BUILD_PROMPT Section 2, PLAN.md D32.
  Run against a node reporting `8453` and both scripts stop before a single transaction:
  `hitbite: refusing to run against chain id 8453 (a public mainnet). HitBite is testnet only ...`
- **`CHAIN` must match the RPC.** `CHAIN=base-sepolia` pointed at a local node aborts with
  `hitbite: CHAIN=base-sepolia but the RPC reports chain id 31337 (anvil).`
- **No silent defaults.** A malformed `ADMIN_ADDRESS`, a missing deployer, a signer without the role it needs, or a
  seed run before a deploy all abort with a message that names the variable and the next action. The only defaults
  are the documented ones (role addresses fall back to the deployer, role keys fall back to `DEPLOYER_PRIVATE_KEY`,
  `ANVIL_RPC_URL` falls back to `http://127.0.0.1:8545`), and each is printed when it is used.
- **No key ever reaches a file.** Keys are read from the environment by `vm.envUint` and used only for
  `vm.startBroadcast`. `deployments/<chain>.json` holds addresses, transaction hashes, a block number and a
  timestamp, nothing else.

### Two steps, and why `--slow` is not optional

A transaction hash exists only after Foundry has broadcast the transaction and written
`broadcast/Deploy.s.sol/<chainId>/run-latest.json`, which happens after `run()` has already returned. So the deploy
is two forge invocations: `run()` deploys, then `record()` reads that file back through `vm.getBroadcasts` and
writes the deployment record with `vm.serializeX` / `vm.writeJson`. `make deploy` runs both.

`--slow` (one transaction at a time) is **required for the broadcast**: foundry 1.8.1 mis-associates hashes in
`run-latest.json` when it sends concurrently, so without it the recorded "creation" hash of a contract can be the
hash of an unrelated call. `make deploy` passes `--slow` and then re-checks every recorded hash with
`cast receipt <hash> contractAddress`, failing the target if a hash did not create the address recorded next to it:

```
verified MockUSDC         0x5FbDB2315678afecb367f032d93F642f64180aa3 created by 0x7cb11b44...
verified IdentityRegistry 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 created by 0x655a04e5...
verified HBToken          0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0 created by 0x5e8ed126...
```

`record()` additionally refuses to write a record whose addresses hold no code on the connected chain, or whose
`HBToken` does not point at exactly the registry and USDC recorded beside it — which is what stops a stale
broadcast from a previous Anvil instance being written as if it were live.

### Local Anvil (no keys, no accounts, no setup)

```bash
make anvil                 # terminal 1: a node on 127.0.0.1:8545 (ANVIL_HOST / ANVIL_PORT to change)
make deploy-local          # terminal 2: deploy + write contracts/deployments/anvil.json
make seed                  # verify + fund demo wallets A and B, set the opening NAV
make seed                  # again: every step is skipped, "Warning: No transactions to broadcast."
```

No private key is involved. Anvil keeps its ten development accounts unlocked, so the Makefile passes
`--unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (Anvil account #0) and the node signs. Anvil prints
the matching private keys at startup: **those are public test values from the Foundry documentation, shared by
every Anvil in the world. They are not secret, they are worth nothing, and they must never be put in `.env` or used
on Base Sepolia** (D18).

Accounts used by the local flow, all published Anvil addresses:

| Anvil account | Address | Used as |
|---|---|---|
| #0 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | deployer, admin, registrar, issuer, oracle |
| #1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | demo wallet A (784 UAE, professional) |
| #2 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | demo wallet B (276 Germany, professional) |

Set `DEMO_WALLET_A_ADDRESS` / `DEMO_WALLET_B_ADDRESS` to use different wallets; off Anvil both are required.

The raw commands behind `make deploy-local`, if you would rather not use `make`:

```bash
cd contracts
forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast --slow \
  --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
forge script script/Deploy.s.sol:Deploy --sig "record()" --rpc-url http://127.0.0.1:8545
forge script script/Seed.s.sol:Seed --rpc-url http://127.0.0.1:8545 --broadcast --slow \
  --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

### Seeding, and what "idempotent" means here

`make seed` reads the chain before each step and does nothing when the chain already agrees:

| Step | Skipped when | Otherwise |
|---|---|---|
| verify | already verified with the same country and investor type | `addVerified(wallet, country, 1)` as `REGISTRAR_ADDRESS` |
| fund | the wallet already holds 5,000 mUSDC | tops up to 5,000 from the faucet, never more than `faucetRemaining` allows |
| set NAV | `nav()` already equals `SEED_NAV` | `setNAV(SEED_NAV, reportedAUM, false)` as `ORACLE_ADDRESS` |

Funding tops **up** rather than adding a fixed amount, so a second run after the demo has spent USDC restores the
balance without ever minting twice for the same purpose. When the D14 24-hour faucet window is exhausted the step
prints `fund WARNING ... faucet window exhausted (D14 cap); balance left as is` and the run still succeeds: a re-run
inside the same window is a normal thing to do and must not fail the seed.

`SEED_NAV` defaults to `1000000` (1.000000 USDC), which is the inception NAV the `HBToken` constructor already
carries, so on a fresh deployment the NAV step correctly does nothing. Set it to the engine's `nav.usdc_6dec` to
open a deployment at the current book value; the 5 % rail (D5/D27) still applies.

### Base Sepolia — runbook for the founders

Everything below is copy-pasteable. Nothing here has been run yet: this repository has no Base Sepolia key, so the
addresses table is empty until you run it.

**1. Fill in `.env`** (copy from `.env.example`; it is git-ignored and must stay that way):

```bash
CHAIN=base-sepolia
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org       # or your own Alchemy/Infura endpoint
DEPLOYER_PRIVATE_KEY=0x...                          # funded with ~0.05 test ETH; this key signs everything
BASESCAN_API_KEY=...                                # from basescan.org, for explorer verification
# Optional. Each defaults to the deployer; setting ADMIN_ADDRESS makes the deployer renounce DEFAULT_ADMIN_ROLE.
ADMIN_ADDRESS=
REGISTRAR_ADDRESS=
ISSUER_ADDRESS=
ORACLE_ADDRESS=
# Required off Anvil: the two demo wallets `make seed` verifies and funds.
DEMO_WALLET_A_ADDRESS=0x...
DEMO_WALLET_B_ADDRESS=0x...
```

Fund the deployer with Base Sepolia test ETH from a public faucet before you start.

**2. Deploy, seed, verify** — from the repository root, in this order:

```bash
make deploy CHAIN=base-sepolia     # deploy + write contracts/deployments/base-sepolia.json
make seed   CHAIN=base-sepolia     # verify + fund demo wallets A and B, set the opening NAV
make verify CHAIN=base-sepolia     # submit sources to Basescan (needs BASESCAN_API_KEY)
```

`make deploy` prints the resolved configuration before it sends anything — read it and stop if an address is wrong.
It then prints the three addresses, the recorded transaction hashes and the `cast receipt` cross-check.

**3. Confirm on Basescan.** `make verify` runs, for each contract:

```bash
forge verify-contract <address> src/<Name>.sol:<Name> --chain 84532 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --guess-constructor-args \
  --etherscan-api-key "$BASESCAN_API_KEY" --watch
```

`--guess-constructor-args` reads the arguments back from the creation transaction, so you do not have to re-encode
`IdentityRegistry(admin, [840, 792])` or `HBToken(registry, usdc, admin)` by hand. `--watch` polls until Basescan
answers. **This step has not been exercised here:** there is no Basescan key on the build machine, so `make verify`
is written from the Foundry documentation and only its guard rails (wrong chain, missing `BASESCAN_API_KEY`,
missing deployment record) have actually been run. Expect to iterate on it the first time. When it succeeds, open `https://sepolia.basescan.org/address/<address>#code` and check the green
**Contract Source Code Verified** badge; then paste the three addresses into the table below and into the root
`README.md`, and commit `contracts/deployments/base-sepolia.json`.

If verification fails with a bytecode mismatch, confirm you are verifying the build that was deployed
(`forge build` with the committed `foundry.toml`: solc 0.8.26, optimizer on, 200 runs, `bytecode_hash = "none"`,
`cbor_metadata = false`) and re-run.

**4. Commit.** `contracts/deployments/base-sepolia.json` is the artifact the web app and the engine read; it holds
addresses and transaction hashes only.

### Deployed addresses

Local Anvil, from the committed `deployments/anvil.json`. These are deterministic: a fresh Anvil plus a deployer at
nonce 0 reproduces exactly these addresses, block and transaction hashes (only `timestamp` differs between runs).

| Contract | Anvil (31337) |
|---|---|
| `MockUSDC` | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| `IdentityRegistry` | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| `HBToken` | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |
| deploy block | `1` |

Base Sepolia (84532) — **not deployed yet.** This repository has no Base Sepolia key; the founders run step 2 above
and these cells are filled from `deployments/base-sepolia.json` in the same commit.

| Contract | Base Sepolia (84532) | Basescan |
|---|---|---|
| `MockUSDC` | _awaiting the founders' deploy run_ | _awaiting verification_ |
| `IdentityRegistry` | _awaiting the founders' deploy run_ | _awaiting verification_ |
| `HBToken` | _awaiting the founders' deploy run_ | _awaiting verification_ |
| deploy block | _awaiting the founders' deploy run_ | |

### The deployment record

`deployments/<chain>.json` holds exactly the five keys BUILD_PROMPT Section 5.6 asks for. `addresses` and
`txHashes` share the three contract names, so every address can be traced to the transaction that created it;
`deployBlock` is the earliest of the three creation blocks and is where the engine and the web indexer start
reading; `timestamp` is the chain's block time when the record was written, seconds after the deployment.

```json
{
  "addresses": {
    "HBToken": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    "IdentityRegistry": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    "MockUSDC": "0x5FbDB2315678afecb367f032d93F642f64180aa3"
  },
  "chainId": 31337,
  "deployBlock": 1,
  "txHashes": {
    "HBToken": "0x5e8ed126a35a187a3706300d6b4cf231dbac1942d71b22aa74a11955811872cb",
    "IdentityRegistry": "0x655a04e5c450053f20ab76c44e188ab99c5cb97bf79f17b24134d82cc74b578d",
    "MockUSDC": "0x7cb11b44d2b9c6042e400eee24161d536c5c628680d0680f65055ea21d1c63bd"
  },
  "timestamp": 1789420690
}
```

The role grants are not listed separately; they are `RoleGranted` events on the registry and the token from
`deployBlock` onwards, which is how an indexer should read them anyway.
