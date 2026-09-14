// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "../utils/BaseTest.sol";
import {HBTokenHandler} from "./handlers/HBTokenHandler.sol";

/// @notice Stateful invariant suite for `HBToken` (BUILD_PROMPT 5.5, PLAN.md Phase 2).
///
///         `HBTokenHandler` drives the system through bounded subscribe / redeem / transfer / distribute / claim /
///         setNAV / pause / unpause / mint / burn / addVerified / removeVerified / setCountryBlocked sequences over
///         a five-actor set whose eligibility changes mid-run. The properties below must hold after every single
///         call of every sequence.
///
///         Run with `fail_on_revert = true` (see `foundry.toml`): the handler is written so that no call it makes
///         can revert, so a revert surfacing here is a finding in its own right rather than fuzzer noise.
contract HBTokenInvariantTest is BaseTest {
    HBTokenHandler internal handler;

    /// @dev USDC the handler hands out to actors and to the issuer. Far above anything a run can spend.
    uint256 internal constant HANDLER_USDC = 1e33;
    /// @dev At least this share of the fuzzer's calls must actually change state rather than return early. It is
    ///      the guard against a handler that silently stops exercising the contract: a run that drifted into a
    ///      state where nothing lands (everyone de-verified, vault empty, token left paused) would still pass every
    ///      invariant while proving nothing. Healthy full-depth runs land 47-65% of their calls; the floor is set
    ///      at half that so it can only fire on a real collapse. Some early returns are structural and can never
    ///      be removed honestly: `unpause` when the token is not paused, `claimCoupon` when nobody is owed,
    ///      `redeem` when the vault holds only coupon reserve. Per-action reachability is proved deterministically
    ///      by `test_handlerCoverage_everyActionLands` instead of statistically here.
    uint256 internal constant MIN_LANDED_PCT = 25;
    /// @dev Sequences shorter than this are shrunk replays of a failing sequence, not campaign runs; the shrinker
    ///      minimises call counts by construction, so the coverage floor does not apply to them.
    uint256 internal constant MIN_SEQUENCE_FOR_COVERAGE = 64;

    function setUp() public override {
        super.setUp();

        handler = new HBTokenHandler(token, usdc, registry, admin, issuer, oracle, registrar);
        vm.label(address(handler), "HBTokenHandler");
        deal(address(usdc), address(handler), HANDLER_USDC);

        // Three of the five actors start verified in three different countries; the other two start outside the
        // whitelist and only get in if the fuzzer calls `addVerified`.
        address[] memory actors = handler.actorList();
        _verify(actors[0], COUNTRY_DE);
        _verify(actors[1], COUNTRY_AE);
        _verify(actors[2], COUNTRY_GB);

        bytes4[] memory selectors = new bytes4[](13);
        selectors[0] = HBTokenHandler.subscribe.selector;
        selectors[1] = HBTokenHandler.redeem.selector;
        selectors[2] = HBTokenHandler.transfer.selector;
        selectors[3] = HBTokenHandler.claimCoupon.selector;
        selectors[4] = HBTokenHandler.distributeCoupon.selector;
        selectors[5] = HBTokenHandler.mint.selector;
        selectors[6] = HBTokenHandler.burn.selector;
        selectors[7] = HBTokenHandler.pause.selector;
        selectors[8] = HBTokenHandler.unpause.selector;
        selectors[9] = HBTokenHandler.setNAV.selector;
        selectors[10] = HBTokenHandler.addVerified.selector;
        selectors[11] = HBTokenHandler.removeVerified.selector;
        selectors[12] = HBTokenHandler.setCountryBlocked.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    // ==================================================================
    // invariants
    // ==================================================================

    /// @notice D6: the coupon money holders can still claim is always actually sitting in the vault.
    /// @dev BUILD_PROMPT 5.5 states this as `usdc.balanceOf(token) >= sum(accrued)`; `pendingCoupon` is the
    ///      stronger sum — settled `accrued` plus the part that has not been settled yet.
    function invariant_vaultCoversEveryPendingCoupon() public view {
        assertGe(usdc.balanceOf(address(token)), handler.totalPendingCoupon(), "vault below claimable coupons");
    }

    /// @notice D6/D29: the reserve itself — not merely the vault — covers every claim that can still be made, which
    ///         is what stops a redemption from spending coupon money.
    function invariant_couponReserveCoversEveryPendingCoupon() public view {
        assertGe(token.couponReserve(), handler.totalPendingCoupon(), "coupon reserve below claimable coupons");
    }

    /// @notice BUILD_PROMPT 5.5: `totalSupply` matches minted - burned, counted independently by the handler.
    function invariant_totalSupplyEqualsMintedMinusBurned() public view {
        assertGe(handler.ghostMinted(), handler.ghostBurned(), "burned more than was ever minted");
        assertEq(token.totalSupply(), handler.ghostMinted() - handler.ghostBurned(), "supply != minted - burned");
    }

    /// @notice D6: the vault splits exactly into redeemable liquidity and the coupon reserve, with no third bucket
    ///         and no overlap. The `>=` half is what keeps `availableLiquidity()` from flooring at zero.
    function invariant_availableLiquidityPlusReserveEqualsVault() public view {
        assertGe(token.vaultBalance(), token.couponReserve(), "vault below the coupon reserve");
        assertEq(
            token.availableLiquidity() + token.couponReserve(), token.vaultBalance(), "liquidity split does not close"
        );
    }

    /// @notice D29: claims never run ahead of the allocation, and the allocation never runs ahead of the USDC that
    ///         was actually pulled in.
    function invariant_claimedLeAllocatedLeDistributed() public view {
        assertLe(token.totalClaimed(), token.totalAllocated(), "claimed above allocated");
        assertLe(token.totalAllocated(), token.totalDistributed(), "allocated above distributed");
    }

    /// @notice Every token in existence is held by a known actor: no balance leaks to an address the whitelist
    ///         never approved.
    function invariant_actorBalancesSumToTotalSupply() public view {
        assertEq(handler.totalActorBalance(), token.totalSupply(), "sum of balances != totalSupply");
    }

    /// @notice D5/D26/D28: NAV is never zero once set, the rail anchor never floors below 1, and `reportedAUM`
    ///         never wraps around (the distribution subtraction is floored, so an underflow would show up as a
    ///         value far above the D28 ceiling).
    function invariant_navAndReportedAumStaySane() public view {
        assertGt(token.nav(), 0, "nav reached zero");
        assertLe(token.nav(), MAX_INPUT, "nav above the D28 ceiling");
        assertGe(token.railAnchorNav(), 1, "rail anchor reached zero");
        assertLe(token.reportedAUM(), MAX_INPUT, "reportedAUM underflowed or exceeded the D28 ceiling");
    }

    /// @notice The contract's own coupon totals agree with the handler's independent count of what it sent in and
    ///         what actors were paid out.
    function invariant_ghostCouponTotalsMatchChain() public view {
        assertEq(token.totalDistributed(), handler.ghostDistributed(), "totalDistributed != ghost");
        assertEq(token.totalClaimed(), handler.ghostClaimed(), "totalClaimed != ghost");
    }

    /// @notice Full USDC accounting: the vault holds exactly what went in minus what went out.
    function invariant_vaultBalanceIsFullyAccountedFor() public view {
        uint256 inflow = handler.ghostSubscribedUsdc() + handler.ghostDistributed();
        uint256 outflow = handler.ghostClaimed() + handler.ghostRedeemedUsdc();
        assertEq(token.vaultBalance(), inflow - outflow, "vault balance unaccounted for");
    }

    /// @dev Runs once at the end of each sequence: proves the sequence actually did something, so the invariants
    ///      above were checked against live state rather than an inert one. Shrunk replays of a failing sequence
    ///      are short by construction and are exempt — the coverage claim is about full-depth runs.
    function afterInvariant() public view {
        uint256 total = handler.totalCalls();
        assertGt(total, 0, "the fuzzer made no calls");
        if (total < MIN_SEQUENCE_FOR_COVERAGE) return;
        assertGe(handler.landedCalls() * 100, total * MIN_LANDED_PCT, "too few fuzzer calls changed state");
    }

    // ==================================================================
    // handler self-test
    // ==================================================================

    /// @notice Every handler action must be reachable: a handler action that can never land is dead weight that
    ///         silently narrows the invariant suite. This drives each one deterministically and checks it lands.
    function test_handlerCoverage_everyActionLands() public {
        handler.addVerified(3, 0); // actor 3 joins the whitelist mid-run
        handler.subscribe(0, 1000e6);
        handler.subscribe(1, 500e6);
        handler.setNAV(type(uint256).max, 1 hours);
        handler.distributeCoupon(type(uint256).max);
        handler.claimCoupon(0);
        handler.transfer(0, 1, type(uint256).max);
        handler.redeem(1, type(uint256).max);
        handler.mint(2, 10e18);
        handler.burn(2, type(uint256).max);
        handler.removeVerified(3);
        handler.setCountryBlocked(0, true);
        handler.setCountryBlocked(0, false);
        handler.pause(0);
        handler.unpause();

        string[13] memory actions = [
            "subscribe",
            "redeem",
            "transfer",
            "claimCoupon",
            "distributeCoupon",
            "mint",
            "burn",
            "pause",
            "unpause",
            "setNAV",
            "addVerified",
            "removeVerified",
            "setCountryBlocked"
        ];
        for (uint256 i; i < actions.length; ++i) {
            assertGt(handler.landed(bytes32(bytes(actions[i]))), 0, actions[i]);
        }
        assertEq(handler.landedCalls(), 15, "an action was attempted twice without landing");
        assertEq(handler.totalCalls(), 15);
    }

    /// @notice A paused contract must stop the handler's investor and issuer actions from landing — proof that the
    ///         early returns track the contract's real state instead of guessing.
    function test_handlerCoverage_pausedActionsDoNotLand() public {
        handler.subscribe(0, 1000e6);
        handler.pause(0);
        assertTrue(token.paused());

        uint256 landedBefore = handler.landedCalls();
        handler.subscribe(0, 1000e6);
        handler.redeem(0, 1e18);
        handler.transfer(0, 1, 1e18);
        handler.claimCoupon(0);
        handler.distributeCoupon(1e6);
        handler.mint(0, 1e18);
        handler.burn(0, 1e18);
        assertEq(handler.landedCalls(), landedBefore, "an action landed while the contract was paused");
        assertEq(handler.totalCalls(), 9, "attempts were not counted while paused");

        handler.unpause();
        handler.subscribe(0, 1000e6);
        assertEq(handler.landedCalls(), landedBefore + 2, "actions did not resume after unpause");
    }
}
