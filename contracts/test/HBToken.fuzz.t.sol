// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {HBToken} from "../src/HBToken.sol";
import {IHBToken} from "../src/interfaces/IHBToken.sol";
import {BaseTest} from "./utils/BaseTest.sol";

/// @notice Property (fuzz) tests for `HBToken` — BUILD_PROMPT 5.5, PLAN.md Phase 2.
///
///         The unit suites already pin the worked examples (`HBToken.t.sol`, `HBTokenCoupon.t.sol`). This file
///         proves the properties that have to hold for *every* input in the legal range:
///
///         1. a subscribe/redeem round trip never mints value, at NAV 1.00 and across the whole NAV range, with the
///            exact rounding bound asserted rather than an inequality;
///         2. `previewSubscribe` / `previewRedeem` are byte-exact predictions of `subscribe` / `redeem`;
///         3. coupon accounting conserves USDC over a fuzzed sequence of distributions, transfers and claims, with
///            the shortfall bounded by the two dust terms D29 names;
///         4. D28 input bounds: above `MAX_INPUT` every entry point reverts with a named custom error, and at the
///            extremes of the legal range nothing reverts with an arithmetic `Panic(0x11)` or a division
///            `Panic(0x12)`;
///         5. D5 / D27 rail: no chain of in-rail oracle updates inside one 24 h window moves NAV further than
///            `maxNavMoveBps` from the window anchor.
contract HBTokenFuzzTest is BaseTest {
    // ------------------------------------------------------------------ constants
    /// @dev `Panic(uint256)`; 0x11 is arithmetic over/underflow, 0x12 division or modulo by zero.
    bytes4 internal constant PANIC_SELECTOR = 0x4e487b71;
    /// @dev `Error(string)` — the contract uses custom errors only, so a string revert is a failure too.
    bytes4 internal constant ERROR_STRING_SELECTOR = 0x08c379b0;

    uint256 internal constant TOKEN_SCALE = 1e18;

    /// @dev Largest fuzzed subscription: 1e18 USDC units = 1,000,000,000,000 USDC. Far beyond any plausible fund
    ///      and still 20 orders of magnitude below the `MAX_INPUT` ceiling that D28 rejects.
    uint256 internal constant MAX_USDC_IN = 1e18;
    /// @dev Legal NAV range used by the round-trip properties: 0.001 USDC to 1,000,000 USDC per token. The exact
    ///      rounding bound proved below (at most one USDC unit) holds for every NAV up to 1e18.
    uint256 internal constant MIN_NAV = 1000;
    uint256 internal constant MAX_NAV = 1e12;

    /// @dev Every error `HBToken` (or a base contract it inherits) can raise. Used by the no-`Panic` property: a
    ///      revert must always be one of these, never a `Panic` and never an empty or string revert.
    bytes4[] internal namedErrors;

    function setUp() public override {
        super.setUp();
        _verify(alice, COUNTRY_DE);
        _verify(bob, COUNTRY_AE);
        _verify(carol, COUNTRY_GB);
        // The 100 USDC minimum is unit-tested; switching it off here lets the fuzzer explore the whole amount range
        // down to a single USDC unit, where the rounding edges live.
        vm.prank(admin);
        token.setMinSubscription(0);

        namedErrors = [
            IHBToken.NotEligible.selector,
            IHBToken.InvalidNav.selector,
            IHBToken.NavMoveExceedsRail.selector,
            IHBToken.InvalidBps.selector,
            IHBToken.ZeroAmount.selector,
            IHBToken.ZeroTokens.selector,
            IHBToken.AmountTooLarge.selector,
            IHBToken.BelowMinimum.selector,
            IHBToken.InsufficientLiquidity.selector,
            IHBToken.NoSupply.selector,
            IHBToken.DistributionTooSmall.selector,
            IHBToken.DistributionExceedsNav.selector,
            IHBToken.NothingToClaim.selector,
            IHBToken.ZeroAddress.selector,
            IERC20Errors.ERC20InsufficientBalance.selector,
            IERC20Errors.ERC20InsufficientAllowance.selector,
            Pausable.EnforcedPause.selector,
            Pausable.ExpectedPause.selector,
            IAccessControl.AccessControlUnauthorizedAccount.selector
        ];
    }

    // ==================================================================
    // 1. Round trip never mints value
    // ==================================================================

    /// @dev At NAV 1.00 the round trip is **exact**, not merely non-profitable: `tokens = usdcIn * 1e18 / 1e6`
    ///      divides evenly (1e18 is a multiple of 1e6), so no remainder is lost on the way in and
    ///      `usdcOut == usdcIn` for every input. Anything less would mean subscription rounding is losing money
    ///      that the fund keeps; anything more would mean the round trip mints value.
    function testFuzz_roundTripAtNavOne_isExact(uint256 usdcIn) public {
        usdcIn = bound(usdcIn, 1, MAX_USDC_IN);
        deal(address(usdc), alice, usdcIn);

        uint256 tokens = _subscribe(alice, usdcIn);
        vm.prank(alice);
        uint256 usdcOut = token.redeem(tokens);

        assertLe(usdcOut, usdcIn, "round trip minted value");
        assertEq(usdcOut, usdcIn, "round trip is exact at NAV 1.00");
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.vaultBalance(), 0);
    }

    /// @dev Across the whole legal NAV range the bound is exactly one USDC unit (1e-6 USDC) and it is *provably
    ///      exactly* `1` iff the subscription leg truncated:
    ///
    ///        tokens   = (usdcIn * 1e18 - r) / nav      with r = (usdcIn * 1e18) mod nav, 0 <= r < nav
    ///        usdcOut  = floor(tokens * nav / 1e18) = floor(usdcIn - r / 1e18) = usdcIn - ceil(r / 1e18)
    ///
    ///      and `ceil(r / 1e18)` is 0 when r == 0 and 1 otherwise for every nav <= 1e18. The loss is therefore
    ///      never more than one USDC unit and always accrues to the fund, never to the redeemer.
    function testFuzz_roundTripAtFuzzedNav_losesAtMostOneUsdcUnit(uint256 usdcIn, uint256 navRaw) public {
        uint256 newNav = bound(navRaw, MIN_NAV, MAX_NAV);
        vm.prank(admin);
        token.setNAV(newNav, 0, true);

        usdcIn = bound(usdcIn, 1, MAX_USDC_IN);
        deal(address(usdc), alice, usdcIn);
        uint256 tokens = _subscribe(alice, usdcIn);

        uint256 remainder = mulmod(usdcIn, TOKEN_SCALE, newNav);
        uint256 expected = remainder == 0 ? usdcIn : usdcIn - 1;

        if (expected == 0) {
            // The whole subscription rounded away: the position is worth less than one USDC unit and `redeem`
            // refuses to pay zero. Strictly stronger than the bound — no value can be extracted at all.
            vm.expectRevert(IHBToken.ZeroAmount.selector);
            vm.prank(alice);
            token.redeem(tokens);
            return;
        }

        vm.prank(alice);
        uint256 usdcOut = token.redeem(tokens);

        assertLe(usdcOut, usdcIn, "round trip minted value");
        assertLe(usdcIn - usdcOut, 1, "round trip lost more than one USDC unit");
        assertEq(usdcOut, expected, "round-trip rounding is not exactly one unit of subscription truncation");
    }

    // ==================================================================
    // 2. Previews are exact
    // ==================================================================

    /// @dev The UI quotes `previewSubscribe` / `previewRedeem` before the user signs. They must equal what the
    ///      state-changing call does, to the unit, at any NAV — including the balance actually moved, not just the
    ///      return value.
    function testFuzz_previewsMatchSubscribeAndRedeem(uint256 usdcIn, uint256 navRaw, uint256 partRaw) public {
        uint256 newNav = bound(navRaw, MIN_NAV, MAX_NAV);
        vm.prank(admin);
        token.setNAV(newNav, 0, true);

        usdcIn = bound(usdcIn, 1, MAX_USDC_IN);
        deal(address(usdc), alice, usdcIn);

        uint256 previewedTokens = token.previewSubscribe(usdcIn);
        if (previewedTokens == 0) {
            vm.startPrank(alice);
            usdc.approve(address(token), usdcIn);
            vm.expectRevert(IHBToken.ZeroTokens.selector);
            token.subscribe(usdcIn);
            vm.stopPrank();
            return;
        }

        uint256 usdcBefore = usdc.balanceOf(alice);
        uint256 mintedTokens = _subscribe(alice, usdcIn);
        assertEq(mintedTokens, previewedTokens, "previewSubscribe != subscribe");
        assertEq(token.balanceOf(alice), previewedTokens, "minted balance != previewSubscribe");
        assertEq(usdcBefore - usdc.balanceOf(alice), usdcIn, "subscribe moved a different amount of USDC");

        uint256 part = bound(partRaw, 1, mintedTokens);
        uint256 previewedUsdc = token.previewRedeem(part);
        if (previewedUsdc == 0) {
            vm.expectRevert(IHBToken.ZeroAmount.selector);
            vm.prank(alice);
            token.redeem(part);
            return;
        }

        usdcBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 usdcOut = token.redeem(part);
        assertEq(usdcOut, previewedUsdc, "previewRedeem != redeem");
        assertEq(usdc.balanceOf(alice) - usdcBefore, previewedUsdc, "redeem paid a different amount than previewed");
        assertEq(token.balanceOf(alice), mintedTokens - part, "redeem burned a different amount than requested");
    }

    // ==================================================================
    // 3. Coupon conservation
    // ==================================================================

    /// @dev Three holders, up to four fuzzed distributions, with a fuzzed transfer and a fuzzed early claim between
    ///      them, then everybody claims. Conservation must hold with a shortfall bounded by exactly the two dust
    ///      terms D29 names and nothing else:
    ///
    ///        totalDistributed - totalAllocated <= sum over distributions of ceil(supply / 1e18)
    ///              (the per-token increment truncates; the remainder is ordinary vault liquidity, never locked)
    ///        totalAllocated   - totalClaimed   <= holders * distributions
    ///              (each holder's settlement truncates below one USDC unit, and a holder settles at most once per
    ///               index change however many times it transfers in between)
    ///
    ///      With three holders and four distributions that is at most 12 USDC units = 0.000012 USDC of settlement
    ///      dust in total, plus at most `ceil(supply / 1e18)` units per distribution.
    function testFuzz_couponConservation(uint256 subA, uint256 subB, uint256 subC, uint256 couponSeed, uint256 actSeed)
        public
    {
        address[3] memory holders = [alice, bob, carol];
        uint256 subscribedTotal;
        for (uint256 i; i < 3; ++i) {
            uint256 amount = bound(uint256(keccak256(abi.encode(subA, subB, subC, i))), 100e6, 1e12);
            deal(address(usdc), holders[i], amount);
            _subscribe(holders[i], amount);
            subscribedTotal += amount;
        }

        uint256 distributions;
        uint256 unallocatedBound;
        for (uint256 round; round < 4; ++round) {
            uint256 supply = token.totalSupply();
            uint256 minCoupon = (supply + TOKEN_SCALE - 1) / TOKEN_SCALE; // perToken >= 1 (D29)
            // Cap each coupon at a quarter of NAV per token: a realistic payout, and it keeps NAV well clear of the
            // `DistributionExceedsNav` floor across four rounds.
            uint256 maxCoupon = (token.nav() / 4) * supply / TOKEN_SCALE;
            if (minCoupon == 0 || maxCoupon < minCoupon) break;

            uint256 amount = bound(uint256(keccak256(abi.encode(couponSeed, round))), minCoupon, maxCoupon);
            deal(address(usdc), issuer, amount);
            vm.startPrank(issuer);
            usdc.approve(address(token), amount);
            token.distributeCoupon(amount);
            vm.stopPrank();
            ++distributions;
            unallocatedBound += minCoupon;

            uint256 action = uint256(keccak256(abi.encode(actSeed, round)));
            if (action & 1 == 1) {
                address from = holders[action % 3];
                address to = holders[(action >> 2) % 3];
                uint256 balance = token.balanceOf(from);
                if (from != to && balance > 0) {
                    vm.prank(from);
                    token.transfer(to, bound(action >> 8, 1, balance));
                }
            }
            if (action & 2 == 2) {
                address claimer = holders[(action >> 4) % 3];
                if (token.pendingCoupon(claimer) > 0) {
                    vm.prank(claimer);
                    token.claimCoupon();
                }
            }
        }
        assertGt(distributions, 0, "fuzz produced no distribution");

        uint256 claimedByHolders;
        for (uint256 i; i < 3; ++i) {
            if (token.pendingCoupon(holders[i]) > 0) {
                vm.prank(holders[i]);
                claimedByHolders += token.claimCoupon();
            }
            assertEq(token.pendingCoupon(holders[i]), 0, "holder still owed after claiming");
        }

        uint256 claimed = token.totalClaimed();
        uint256 allocated = token.totalAllocated();
        uint256 distributed = token.totalDistributed();

        assertLe(claimed, allocated, "claimed above allocated");
        assertLe(allocated, distributed, "allocated above distributed");
        assertLe(claimed, distributed, "sum of claims above total distributed");
        assertLe(distributed - allocated, unallocatedBound, "unallocated dust above ceil(supply/1e18) per round");
        assertLe(allocated - claimed, 3 * distributions, "settlement dust above one unit per holder per round");
        assertLe(claimedByHolders, claimed, "holders claimed more than the contract recorded");
        // Every USDC that entered the vault is still accounted for: subscriptions plus coupons minus claims.
        assertEq(token.vaultBalance(), subscribedTotal + distributed - claimed, "vault balance unaccounted");
        assertEq(token.availableLiquidity() + token.couponReserve(), token.vaultBalance(), "liquidity split broken");
    }

    // ==================================================================
    // 4. D28 input bounds — named errors, never a Panic
    // ==================================================================

    /// @dev Above `MAX_INPUT` every entry point must reject the input itself, with the exact named error and its
    ///      arguments — never an arithmetic `Panic(0x11)` from an intermediate product.
    function testFuzz_aboveMaxInput_revertsNamedError_neverPanics(uint256 raw) public {
        uint256 amount = bound(raw, MAX_INPUT + 1, type(uint256).max);
        bytes memory tooLarge = abi.encodeWithSelector(IHBToken.AmountTooLarge.selector, amount);

        _assertRevertsWith(alice, abi.encodeCall(HBToken.subscribe, (amount)), tooLarge);
        _assertRevertsWith(alice, abi.encodeCall(HBToken.redeem, (amount)), tooLarge);
        _assertRevertsWith(alice, abi.encodeCall(HBToken.previewSubscribe, (amount)), tooLarge);
        _assertRevertsWith(alice, abi.encodeCall(HBToken.previewRedeem, (amount)), tooLarge);
        _assertRevertsWith(issuer, abi.encodeCall(HBToken.distributeCoupon, (amount)), tooLarge);
        _assertRevertsWith(issuer, abi.encodeCall(HBToken.mint, (alice, amount)), tooLarge);
        _assertRevertsWith(
            oracle,
            abi.encodeCall(HBToken.setNAV, (amount, 0, false)),
            abi.encodeWithSelector(IHBToken.InvalidNav.selector)
        );
        _assertRevertsWith(oracle, abi.encodeCall(HBToken.setNAV, (NAV_1_00, amount, false)), tooLarge);
    }

    /// @dev At the top of the *legal* range (`MAX_INPUT / 2 .. MAX_INPUT`, with NAV anywhere in its own legal
    ///      range and a supply at the ceiling) no call may revert with a `Panic`: either it succeeds or it reverts
    ///      with one of the named errors. This is the property D28's bound exists to guarantee — every
    ///      intermediate product stays inside uint256.
    function testFuzz_legalRangeExtremes_neverPanic(uint256 raw, uint256 navRaw) public {
        uint256 newNav = bound(navRaw, 1, MAX_INPUT);
        vm.prank(admin);
        token.setNAV(newNav, MAX_INPUT, true);

        uint256 amount = bound(raw, MAX_INPUT / 2, MAX_INPUT);

        // Views take the largest legal argument against the largest legal NAV and must not revert at all.
        token.previewSubscribe(amount);
        token.previewRedeem(amount);
        token.supplyBackedRatio();
        token.availableLiquidity();
        token.pendingCoupon(alice);

        // A supply at the D28 ceiling against a NAV at the D28 ceiling: `totalSupply * nav` is the largest product
        // the contract ever forms, and it still fits ((2^128 - 1)^2 < 2^256).
        vm.prank(issuer);
        token.mint(alice, MAX_INPUT);
        assertEq(token.totalSupply(), MAX_INPUT);
        token.supplyBackedRatio();
        token.pendingCoupon(alice);
        token.previewRedeem(MAX_INPUT);

        _assertNoPanic(alice, abi.encodeCall(HBToken.subscribe, (amount)));
        _assertNoPanic(alice, abi.encodeCall(HBToken.redeem, (amount)));
        _assertNoPanic(alice, abi.encodeCall(HBToken.claimCoupon, ()));

        // Fund and approve the issuer so the distribution reaches its arithmetic instead of stopping at the
        // allowance check: `perToken`, the rounded-up `allocated`, the index update and the ex-distribution NAV
        // drop all run against a supply and a NAV at the ceiling.
        deal(address(usdc), issuer, MAX_INPUT);
        vm.prank(issuer);
        usdc.approve(address(token), MAX_INPUT);
        _assertNoPanic(issuer, abi.encodeCall(HBToken.distributeCoupon, (amount)));
        token.pendingCoupon(alice);
        token.supplyBackedRatio();
        token.couponReserve();

        _assertNoPanic(issuer, abi.encodeCall(HBToken.mint, (alice, amount)));
        _assertNoPanic(issuer, abi.encodeCall(HBToken.burn, (alice, amount)));
        _assertNoPanic(oracle, abi.encodeCall(HBToken.setNAV, (amount, amount, false)));
        _assertNoPanic(admin, abi.encodeCall(HBToken.setNAV, (amount, amount, true)));
        _assertNoPanic(alice, abi.encodeCall(IERC20.transfer, (bob, amount)));
    }

    // ==================================================================
    // 5. D5 / D27 NAV rail
    // ==================================================================

    /// @dev Eight fuzzed oracle updates, each after a fuzzed wait short enough that the 24 h window never rolls
    ///      (8 x at most 2 h = 16 h). Whatever the sequence, the window anchor must not move and NAV must never end
    ///      up further than `maxNavMoveBps` from it: in-rail steps cannot be chained into a larger move. Updates
    ///      outside the band must revert with `NavMoveExceedsRail` and leave NAV untouched.
    function testFuzz_navRail_inWindowUpdatesCannotCompound(uint256[8] memory navRaw, uint16[8] memory waitRaw) public {
        uint256 anchor = token.railAnchorNav();
        uint64 windowStart = token.railWindowStart();
        uint256 bps = token.maxNavMoveBps();
        assertEq(anchor, token.nav());

        uint256 landed;
        uint256 rejected;
        for (uint256 i; i < 8; ++i) {
            vm.warp(block.timestamp + bound(uint256(waitRaw[i]), 0, 2 hours));

            // Proposals spread over +/-10% of the anchor, so roughly half fall inside the 5% rail and half outside.
            uint256 proposed = bound(navRaw[i], anchor - anchor / 10, anchor + anchor / 10);
            uint256 navBefore = token.nav();

            vm.prank(oracle);
            try token.setNAV(proposed, 0, false) {
                uint256 move = proposed > anchor ? proposed - anchor : anchor - proposed;
                assertLe(move * 10_000, anchor * bps, "an update landed outside the rail band");
                assertEq(token.nav(), proposed);
                ++landed;
            } catch (bytes memory err) {
                assertEq(
                    err,
                    abi.encodeWithSelector(IHBToken.NavMoveExceedsRail.selector, anchor, proposed, bps),
                    "rejected update raised the wrong error"
                );
                assertEq(token.nav(), navBefore, "a rejected update moved NAV");
                ++rejected;
            }

            // The anchor is the NAV at the start of the window and stays put until the window rolls (D27).
            assertEq(token.railAnchorNav(), anchor, "anchor moved inside the window");
            assertEq(token.railWindowStart(), windowStart, "window restarted early");

            uint256 drift = token.nav() > anchor ? token.nav() - anchor : anchor - token.nav();
            assertLe(drift * 10_000, anchor * bps, "chained in-rail updates compounded past the rail");
        }
        assertEq(landed + rejected, 8);
    }

    // ==================================================================
    // helpers
    // ==================================================================

    /// @dev Raw call so the revert data can be inspected: assert it failed, that it is not a `Panic` (or an empty
    ///      or string revert), and that it is exactly `expected`.
    function _assertRevertsWith(address caller, bytes memory data, bytes memory expected) internal {
        vm.prank(caller);
        (bool ok, bytes memory ret) = address(token).call(data);
        assertFalse(ok, "call unexpectedly succeeded");
        _assertNamedError(ret);
        assertEq(ret, expected, "wrong revert data");
    }

    /// @dev The call may succeed or fail; if it fails it must carry one of the contract's named errors.
    function _assertNoPanic(address caller, bytes memory data) internal {
        vm.prank(caller);
        (bool ok, bytes memory ret) = address(token).call(data);
        if (!ok) _assertNamedError(ret);
    }

    function _assertNamedError(bytes memory ret) internal view {
        assertGe(ret.length, 4, "empty revert (no named error)");
        bytes4 selector = bytes4(ret);
        assertTrue(selector != PANIC_SELECTOR, "reverted with Panic instead of a named error");
        assertTrue(selector != ERROR_STRING_SELECTOR, "reverted with a string instead of a named error");
        bool known;
        for (uint256 i; i < namedErrors.length; ++i) {
            if (namedErrors[i] == selector) known = true;
        }
        assertTrue(known, "revert selector is not a declared error of HBToken");
    }
}
