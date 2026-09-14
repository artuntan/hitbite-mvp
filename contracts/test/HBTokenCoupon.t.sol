// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IHBToken} from "../src/interfaces/IHBToken.sol";
import {BaseTest} from "./utils/BaseTest.sol";

/// @notice Coupon index pass-through (BUILD_PROMPT 5.3): pro-rata split, no double counting across transfers, late
///         subscribers, claims after burns, the ex-distribution NAV drop (D26), reserve protection and dust
///         accounting (D6 / D29). All numbers are worked by hand in comments.
contract HBTokenCouponTest is BaseTest {
    function setUp() public override {
        super.setUp();
        _verify(alice, COUNTRY_DE);
        _verify(bob, COUNTRY_AE);
        _fund(alice, 5000e6);
        _fund(bob, 5000e6);
    }

    // ------------------------------------------------------------------ 70 / 30 split
    function test_split70_30() public {
        _subscribe(alice, 700e6); // 700e18 tokens
        _subscribe(bob, 300e6); // 300e18 tokens, supply 1000e18

        // index += 100e6 * 1e18 / 1000e18 = 100_000 ; allocated = 100_000 * 1000e18 / 1e18 = 100e6 (exact)
        // nav 1_000_000 -> 900_000 (ex-distribution drop of 0.10 USDC per token, D26)
        _fund(issuer, 100e6);
        vm.startPrank(issuer);
        usdc.approve(address(token), 100e6);
        vm.expectEmit(address(token));
        emit IHBToken.CouponDistributed(1, 100e6, 100e6, 100_000, 1000e18);
        vm.expectEmit(address(token));
        emit IHBToken.NAVUpdated(NAV_1_00, 900_000, 0, block.timestamp);
        uint256 id = token.distributeCoupon(100e6);
        vm.stopPrank();
        assertEq(id, 1);
        assertEq(token.couponIndex(), 100_000);
        assertEq(token.totalDistributed(), 100e6);
        assertEq(token.totalAllocated(), 100e6);
        assertEq(token.distributionCount(), 1);
        assertEq(token.couponReserve(), 100e6);
        assertEq(token.nav(), 900_000);
        assertEq(token.railAnchorNav(), 900_000);
        assertEq(token.navUpdatedAt(), uint64(START_TIMESTAMP)); // distributions do not touch it

        // alice: 700e18 * 100_000 / 1e18 = 70e6 ; bob: 300e18 * 100_000 / 1e18 = 30e6
        assertEq(token.pendingCoupon(alice), 70e6);
        assertEq(token.pendingCoupon(bob), 30e6);

        vm.expectEmit(address(token));
        emit IHBToken.CouponClaimed(alice, 70e6);
        vm.prank(alice);
        uint256 alicePaid = token.claimCoupon();

        vm.expectEmit(address(token));
        emit IHBToken.CouponClaimed(bob, 30e6);
        vm.prank(bob);
        uint256 bobPaid = token.claimCoupon();

        assertEq(alicePaid, 70e6);
        assertEq(bobPaid, 30e6);
        assertEq(usdc.balanceOf(alice), 5000e6 - 700e6 + 70e6);
        assertEq(usdc.balanceOf(bob), 5000e6 - 300e6 + 30e6);
        assertEq(token.accrued(alice), 0);
        assertEq(token.accrued(bob), 0);
        assertEq(token.userIndex(alice), 100_000);
        assertEq(token.userIndex(bob), 100_000);
        assertEq(token.pendingCoupon(alice), 0);
        assertEq(token.pendingCoupon(bob), 0);
        assertEq(token.totalClaimed(), 100e6);
        assertEq(token.couponReserve(), 0);
        assertEq(token.vaultBalance(), 1000e6); // subscription money untouched
    }

    // ------------------------------------------------------------------ no double counting across a transfer
    function test_transferBetweenDistributions_doesNotDoubleCount() public {
        _subscribe(alice, 700e6);
        _subscribe(bob, 300e6);

        // Distribution 1: 100 USDC over 1000e18 -> index 100_000. alice 70, bob 30. nav 900_000.
        _distribute(100e6);

        // alice moves 200e18 to bob. Both settle at index 100_000 *before* balances change:
        //   alice.accrued = 700e18 * 100_000 / 1e18 = 70e6, bob.accrued = 300e18 * 100_000 / 1e18 = 30e6.
        // Balances afterwards: alice 500e18, bob 500e18.
        vm.prank(alice);
        assertTrue(token.transfer(bob, 200e18));
        assertEq(token.accrued(alice), 70e6);
        assertEq(token.accrued(bob), 30e6);
        assertEq(token.userIndex(alice), 100_000);
        assertEq(token.userIndex(bob), 100_000);
        assertEq(token.pendingCoupon(alice), 70e6);
        assertEq(token.pendingCoupon(bob), 30e6);

        // Distribution 2: another 100 USDC over 1000e18 -> index 200_000, nav 800_000.
        //   alice = 70e6 + 500e18 * (200_000 - 100_000) / 1e18 = 70e6 + 50e6 = 120e6
        //   bob   = 30e6 + 500e18 * (200_000 - 100_000) / 1e18 = 30e6 + 50e6 =  80e6
        // Total 200e6 == total distributed: nothing counted twice, nothing lost.
        _distribute(100e6);
        assertEq(token.couponIndex(), 200_000);
        assertEq(token.nav(), 800_000);
        assertEq(token.pendingCoupon(alice), 120e6);
        assertEq(token.pendingCoupon(bob), 80e6);

        vm.prank(alice);
        assertEq(token.claimCoupon(), 120e6);
        vm.prank(bob);
        assertEq(token.claimCoupon(), 80e6);
        assertEq(token.totalClaimed(), 200e6);
        assertEq(token.totalDistributed(), 200e6);
        assertEq(token.totalAllocated(), 200e6);
        assertEq(token.couponReserve(), 0);
    }

    function test_transferAfterClaim_receiverDoesNotInheritSenderShare() public {
        _subscribe(alice, 1000e6);
        _distribute(100e6); // index 100_000, alice pending 100e6

        vm.prank(alice);
        token.claimCoupon();

        // bob receives tokens after the distribution: settled at index 100_000 with balance 0 -> owes nothing.
        vm.prank(alice);
        assertTrue(token.transfer(bob, 500e18));
        assertEq(token.pendingCoupon(bob), 0);
        assertEq(token.pendingCoupon(alice), 0);
        assertEq(token.userIndex(bob), 100_000);

        vm.expectRevert(abi.encodeWithSelector(IHBToken.NothingToClaim.selector));
        vm.prank(bob);
        token.claimCoupon();
    }

    // ------------------------------------------------------------------ late subscriber
    function test_subscriberAfterDistribution_receivesNothingFromIt() public {
        _subscribe(alice, 1000e6);
        _distribute(100e6); // index 100_000; alice pending 100e6; nav 900_000

        // bob mints at index 100_000: settle with balance 0 sets userIndex = 100_000 and accrues nothing.
        // 900 USDC at NAV 0.90 = exactly 1000e18 tokens, so the two hold 50/50 from here on.
        _subscribe(bob, 900e6);
        assertEq(token.balanceOf(bob), 1000e18);
        assertEq(token.userIndex(bob), 100_000);
        assertEq(token.accrued(bob), 0);
        assertEq(token.pendingCoupon(bob), 0);
        assertEq(token.pendingCoupon(alice), 100e6);

        vm.expectRevert(abi.encodeWithSelector(IHBToken.NothingToClaim.selector));
        vm.prank(bob);
        token.claimCoupon();

        // Next distribution over 2000e18: index += 100e6 * 1e18 / 2000e18 = 50_000 -> 150_000; nav 850_000.
        //   alice = 1000e18 * 150_000 / 1e18 = 150e6 ; bob = 1000e18 * (150_000 - 100_000) / 1e18 = 50e6
        _distribute(100e6);
        assertEq(token.couponIndex(), 150_000);
        assertEq(token.nav(), 850_000);
        assertEq(token.pendingCoupon(alice), 150e6);
        assertEq(token.pendingCoupon(bob), 50e6);
    }

    // ------------------------------------------------------------------ claims survive burns
    function test_claimAfterRedeem_accruedSurvivesBurn() public {
        _subscribe(alice, 1000e6);
        _distribute(100e6); // vault 1100, reserve 100, available 1000; nav 900_000

        // Redeem everything at the ex-distribution NAV: the burn settles alice first (accrued = 100e6), then
        // removes the balance. 1000e18 * 900_000 / 1e18 = 900e6.
        vm.prank(alice);
        assertEq(token.redeem(1000e18), 900e6);
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.accrued(alice), 100e6);
        assertEq(token.pendingCoupon(alice), 100e6);
        assertEq(token.vaultBalance(), 200e6);
        assertEq(token.couponReserve(), 100e6);
        assertEq(token.availableLiquidity(), 100e6);

        vm.prank(alice);
        assertEq(token.claimCoupon(), 100e6);
        assertEq(usdc.balanceOf(alice), 5000e6); // 900 principal at the lower NAV + 100 coupon = what went in
        assertEq(token.vaultBalance(), 100e6);
        assertEq(token.couponReserve(), 0);
    }

    function test_claimAfterDeverification_thenIssuerBurn_D4() public {
        _subscribe(alice, 1000e6);
        _distribute(100e6);

        // De-verify first, then the issuer force-burns the de-verified holder (burns skip canHold(from)).
        vm.prank(registrar);
        registry.removeVerified(alice);
        assertFalse(registry.canHold(alice));
        vm.prank(issuer);
        token.burn(alice, 1000e18);
        assertEq(token.balanceOf(alice), 0);

        // The accrued coupon survives both and is claimable by the de-verified holder.
        assertEq(token.pendingCoupon(alice), 100e6);
        vm.prank(alice);
        assertEq(token.claimCoupon(), 100e6);
    }

    // ------------------------------------------------------------------ reverts
    function test_distribute_revertsNoSupply() public {
        _fund(issuer, 100e6);
        vm.startPrank(issuer);
        usdc.approve(address(token), 100e6);
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NoSupply.selector));
        token.distributeCoupon(100e6);
        vm.stopPrank();
        assertEq(usdc.balanceOf(issuer), 100e6); // the pull is rolled back with the revert
    }

    function test_distribute_revertsZeroAmount() public {
        _subscribe(alice, 1000e6);
        vm.expectRevert(abi.encodeWithSelector(IHBToken.ZeroAmount.selector));
        vm.prank(issuer);
        token.distributeCoupon(0);
    }

    function test_distribute_revertsAmountTooLarge() public {
        _subscribe(alice, 1000e6);
        vm.expectRevert(abi.encodeWithSelector(IHBToken.AmountTooLarge.selector, MAX_INPUT + 1));
        vm.prank(issuer);
        token.distributeCoupon(MAX_INPUT + 1);
    }

    function test_distribute_revertsNotIssuer() public {
        _subscribe(alice, 1000e6);
        _expectUnauthorized(stranger, ISSUER_ROLE);
        vm.prank(stranger);
        token.distributeCoupon(100e6);

        _expectUnauthorized(admin, ISSUER_ROLE);
        vm.prank(admin);
        token.distributeCoupon(100e6);
    }

    function test_distribute_revertsWithoutAllowance() public {
        _subscribe(alice, 1000e6);
        _fund(issuer, 100e6);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(token), 0, 100e6)
        );
        vm.prank(issuer);
        token.distributeCoupon(100e6);
        assertEq(token.distributionCount(), 0);
    }

    function test_distribute_revertsWithoutUsdcBalance() public {
        _subscribe(alice, 1000e6);
        vm.startPrank(issuer);
        usdc.approve(address(token), 100e6);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, issuer, 0, 100e6));
        token.distributeCoupon(100e6);
        vm.stopPrank();
    }

    function test_distribute_revertsDistributionTooSmall_D29() public {
        _subscribe(alice, 1000e6); // supply 1000e18 -> minimum ceil(1000e18 / 1e18) = 1000 units
        _fund(issuer, 3000);
        vm.startPrank(issuer);
        usdc.approve(address(token), 3000);

        // 999 * 1e18 / 1000e18 = 0 -> the whole amount would be locked; rejected with the minimum.
        vm.expectRevert(abi.encodeWithSelector(IHBToken.DistributionTooSmall.selector, 999, 1000));
        token.distributeCoupon(999);

        // Exactly the minimum: perToken 1, allocated ceil(1 * 1000e18 / 1e18) = 1000, nav 999_999.
        token.distributeCoupon(1000);
        assertEq(token.couponIndex(), 1);
        assertEq(token.totalAllocated(), 1000);
        assertEq(token.nav(), 999_999);

        // A supply that is not a whole number of tokens rounds the minimum up: 1000e18 + 1 wei -> 1001.
        token.mint(alice, 1);
        vm.expectRevert(abi.encodeWithSelector(IHBToken.DistributionTooSmall.selector, 1000, 1001));
        token.distributeCoupon(1000);
        vm.stopPrank();
    }

    function test_distribute_revertsDistributionTooSmall_maxSupply() public {
        // The largest single mint (D28): 10,000 USDC over 2^128 - 1 wei still truncates to zero, and the reported
        // minimum is ceil((2^128 - 1) / 1e18) = 340_282_366_920_938_463_464 USDC units.
        vm.prank(issuer);
        token.mint(alice, MAX_INPUT);
        _fund(issuer, 10_000e6);
        uint256 minimum = (MAX_INPUT + 1e18 - 1) / 1e18;
        assertEq(minimum, 340_282_366_920_938_463_464);
        vm.startPrank(issuer);
        usdc.approve(address(token), 10_000e6);
        vm.expectRevert(abi.encodeWithSelector(IHBToken.DistributionTooSmall.selector, 10_000e6, minimum));
        token.distributeCoupon(10_000e6);
        vm.stopPrank();
    }

    function test_distribute_revertsDistributionExceedsNav_D29() public {
        _subscribe(alice, 1000e6); // supply 1000e18 at NAV 1_000_000
        _fund(issuer, 2000e6);
        vm.startPrank(issuer);
        usdc.approve(address(token), 2000e6);

        // 1000 USDC over 1000 tokens is 1.00 per token: not below NAV, rejected.
        vm.expectRevert(abi.encodeWithSelector(IHBToken.DistributionExceedsNav.selector, 1_000_000, 1_000_000));
        token.distributeCoupon(1000e6);

        // One unit per token less is accepted and leaves NAV at exactly 1 unit (never zero).
        // perToken = 999_999_999 * 1e18 / 1000e18 = 999_999 ; allocated = 999_999 * 1000e18 / 1e18 = 999_999_000
        token.distributeCoupon(999_999_999);
        vm.stopPrank();
        assertEq(token.nav(), 1);
        assertEq(token.railAnchorNav(), 1);
        assertEq(token.couponIndex(), 999_999);
        assertEq(token.totalDistributed(), 999_999_999);
        assertEq(token.totalAllocated(), 999_999_000);
        assertEq(token.pendingCoupon(alice), 999_999_000);
        assertEq(token.availableLiquidity(), 1000e6 + 999); // the 999-unit truncation remainder is liquidity
    }

    function test_claim_revertsNothingToClaim() public {
        // Never held anything.
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NothingToClaim.selector));
        vm.prank(alice);
        token.claimCoupon();

        // Holds tokens but no distribution yet.
        _subscribe(alice, 1000e6);
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NothingToClaim.selector));
        vm.prank(alice);
        token.claimCoupon();

        // Claimed already.
        _distribute(100e6);
        vm.prank(alice);
        token.claimCoupon();
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NothingToClaim.selector));
        vm.prank(alice);
        token.claimCoupon();
    }

    // ------------------------------------------------------------------ pendingCoupon before / after settle
    function test_pendingCoupon_beforeAndAfterSettle() public {
        _subscribe(alice, 1000e6);
        _distribute(100e6);

        // Not settled yet: everything is still "unsettled index growth".
        assertEq(token.accrued(alice), 0);
        assertEq(token.userIndex(alice), 0);
        assertEq(token.pendingCoupon(alice), 100e6);

        // Any balance change settles: accrued moves to storage, pending is unchanged.
        vm.prank(alice);
        assertTrue(token.transfer(bob, 1e18));
        assertEq(token.accrued(alice), 100e6);
        assertEq(token.userIndex(alice), 100_000);
        assertEq(token.pendingCoupon(alice), 100e6);
    }

    // ------------------------------------------------------------------ multiple distributions accumulate
    function test_multipleDistributionsAccumulate() public {
        _subscribe(alice, 1000e6);

        // 100 -> +100_000 ; 50 -> +50_000 ; 25 -> +25_000 ; index 175_000 ; alice 175e6 ; nav 825_000
        assertEq(_distribute(100e6), 1);
        assertEq(_distribute(50e6), 2);
        assertEq(_distribute(25e6), 3);

        assertEq(token.couponIndex(), 175_000);
        assertEq(token.distributionCount(), 3);
        assertEq(token.totalDistributed(), 175e6);
        assertEq(token.totalAllocated(), 175e6);
        assertEq(token.nav(), 825_000);
        assertEq(token.pendingCoupon(alice), 175e6);

        vm.prank(alice);
        assertEq(token.claimCoupon(), 175e6);
        assertEq(token.totalClaimed(), 175e6);
    }

    // ------------------------------------------------------------------ ex-distribution NAV drop (D26)
    function test_navDrop_demoNumbers_D26() public {
        // Demo scenario: A 1000 USDC, B 500 USDC at NAV 1.00, 12 USDC coupon.
        _subscribe(alice, 1000e6);
        _subscribe(bob, 500e6); // supply 1500e18
        vm.warp(START_TIMESTAMP + 1 hours);

        // perToken = 12e6 * 1e18 / 1500e18 = 8000 ; allocated = 8000 * 1500e18 / 1e18 = 12e6 ; nav 992_000
        _fund(issuer, 12e6);
        vm.startPrank(issuer);
        usdc.approve(address(token), 12e6);
        vm.expectEmit(address(token));
        emit IHBToken.CouponDistributed(1, 12e6, 12e6, 8000, 1500e18);
        vm.expectEmit(address(token));
        emit IHBToken.NAVUpdated(NAV_1_00, 992_000, 0, START_TIMESTAMP + 1 hours);
        token.distributeCoupon(12e6);
        vm.stopPrank();

        assertEq(token.nav(), 992_000);
        assertEq(token.nav(), NAV_1_00 - 12e6 * 1e18 / 1500e18);
        assertEq(token.railAnchorNav(), 992_000);
        assertEq(token.railWindowStart(), uint64(START_TIMESTAMP)); // window untouched
        assertEq(token.navUpdatedAt(), uint64(START_TIMESTAMP)); // oracle timestamp untouched
        assertEq(token.reportedAUM(), 0);
        assertEq(token.pendingCoupon(alice), 8e6);
        assertEq(token.pendingCoupon(bob), 4e6);
        assertEq(token.previewRedeem(1000e18), 992e6);
        assertEq(token.previewRedeem(500e18), 496e6);
    }

    function test_navDrop_reducesReportedAUM_flooredAtZero() public {
        _subscribe(alice, 1000e6);
        _subscribe(bob, 500e6);
        _setNav(NAV_1_00, 1500e6);

        // AUM 1500 - 12 = 1488 alongside the NAV drop to 992_000.
        _fund(issuer, 24e6);
        vm.startPrank(issuer);
        usdc.approve(address(token), 24e6);
        vm.expectEmit(address(token));
        emit IHBToken.NAVUpdated(NAV_1_00, 992_000, 1488e6, block.timestamp);
        token.distributeCoupon(12e6);
        vm.stopPrank();
        assertEq(token.reportedAUM(), 1488e6);

        // A reported AUM smaller than the coupon floors at zero instead of underflowing.
        _setNav(992_000, 5e6);
        vm.startPrank(issuer);
        vm.expectEmit(address(token));
        emit IHBToken.NAVUpdated(992_000, 984_000, 0, block.timestamp);
        token.distributeCoupon(12e6);
        vm.stopPrank();
        assertEq(token.reportedAUM(), 0);
        assertEq(token.nav(), 984_000);
    }

    function test_navDrop_sandwichSubscriberGainsNothing() public {
        _subscribe(alice, 1000e6); // long-standing holder

        // bob subscribes right before the coupon, claims, and redeems immediately after.
        uint256 bobUsdcBefore = usdc.balanceOf(bob);
        _subscribe(bob, 1000e6); // supply 2000e18
        _distribute(12e6); // perToken 6000 ; nav 994_000

        vm.prank(bob);
        uint256 claimed = token.claimCoupon(); // 1000e18 * 6000 / 1e18 = 6e6
        vm.prank(bob);
        uint256 redeemed = token.redeem(1000e18); // 1000e18 * 994_000 / 1e18 = 994e6
        assertEq(claimed, 6e6);
        assertEq(redeemed, 994e6);
        assertLe(claimed + redeemed, 1000e6);
        assertEq(usdc.balanceOf(bob), bobUsdcBefore); // exactly what went in, nothing captured from alice

        // alice's position is worth what it was before the sandwich: 994 principal + 6 coupon.
        assertEq(token.pendingCoupon(alice), 6e6);
        assertEq(token.previewRedeem(token.balanceOf(alice)), 994e6);
        assertEq(token.pendingCoupon(alice) + token.previewRedeem(token.balanceOf(alice)), 1000e6);
    }

    function test_navDrop_reducesRailAnchor() public {
        _subscribe(alice, 1000e6);
        _distribute(12e6); // perToken 12_000 ; nav and anchor 988_000

        // +5% of the reduced anchor is 1_037_400. One unit more reverts *against the reduced anchor*, although it
        // would have passed against the original 1_000_000 (1_050_000 band).
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NavMoveExceedsRail.selector, 988_000, 1_037_401, 500));
        vm.prank(oracle);
        token.setNAV(1_037_401, 0, false);

        _setNav(1_037_400, 0);
        assertEq(token.nav(), 1_037_400);
        assertEq(token.railAnchorNav(), 988_000);
    }

    function test_navDrop_anchorFloorsAtOne_untilAdminForces() public {
        _subscribe(alice, 1000e6);
        _setNav(1_050_000, 0); // nav 1_050_000, anchor still 1_000_000

        // A coupon of 1.02 per token is below NAV but above the anchor: nav 30_000, anchor floored at 1.
        _distribute(1020e6);
        assertEq(token.nav(), 30_000);
        assertEq(token.railAnchorNav(), 1);

        // Any oracle move is now outside the (1 +- 5%) band until the window rolls or the admin forces a NAV.
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NavMoveExceedsRail.selector, 1, 30_000, 500));
        vm.prank(oracle);
        token.setNAV(30_000, 0, false);

        vm.prank(admin);
        token.setNAV(30_000, 0, true);
        assertEq(token.railAnchorNav(), 30_000);
        _setNav(31_500, 0); // +5%
        assertEq(token.nav(), 31_500);
    }

    // ------------------------------------------------------------------ reserve protects redemptions (D6)
    function test_couponReserveProtectsRedemptions() public {
        vm.prank(issuer);
        token.mint(alice, 1000e18); // tokens without subscription money
        _distribute(100e6); // the only USDC in the vault is coupon money; nav 900_000

        assertEq(token.vaultBalance(), 100e6);
        assertEq(token.couponReserve(), 100e6);
        assertEq(token.availableLiquidity(), 0);

        vm.expectRevert(abi.encodeWithSelector(IHBToken.InsufficientLiquidity.selector, 0, 900_000));
        vm.prank(alice);
        token.redeem(1e18);

        // The coupon itself is still fully claimable.
        vm.prank(alice);
        assertEq(token.claimCoupon(), 100e6);
        assertEq(token.vaultBalance(), 0);
    }

    function test_couponReserve_partialClaimsKeepRemainderReserved() public {
        _subscribe(alice, 700e6);
        _subscribe(bob, 300e6);
        _distribute(100e6); // nav 900_000

        vm.prank(alice);
        token.claimCoupon(); // 70 out; 30 still reserved for bob
        assertEq(token.vaultBalance(), 1030e6);
        assertEq(token.couponReserve(), 30e6);
        assertEq(token.availableLiquidity(), 1000e6);

        // alice redeems her full 700e18 at 0.90 = 630 (<= 1000 available): vault 400, available 370.
        vm.prank(alice);
        assertEq(token.redeem(700e18), 630e6);
        assertEq(token.availableLiquidity(), 370e6);

        // bob is topped up to 500e18 without USDC behind it (settles his 30 first); 500e18 at 0.90 = 450 > 370:
        // the vault can never dip into his reserved 30.
        vm.prank(issuer);
        token.mint(bob, 200e18);
        assertEq(token.accrued(bob), 30e6);
        vm.expectRevert(abi.encodeWithSelector(IHBToken.InsufficientLiquidity.selector, 370e6, 450e6));
        vm.prank(bob);
        token.redeem(500e18);

        vm.prank(bob);
        assertEq(token.claimCoupon(), 30e6);
        assertEq(token.couponReserve(), 0);
        assertEq(token.availableLiquidity(), 370e6);
        vm.prank(bob);
        assertEq(token.redeem(400e18), 360e6);
        assertEq(token.vaultBalance(), 10e6);
    }

    // ------------------------------------------------------------------ dust (D29)
    function test_couponIndexDust_remainderIsLiquidityNotReserve() public {
        // NAV 50.00 so that a 100 USDC coupon over 3 tokens stays below NAV. 100e6 * 1e18 / 3e18 truncates:
        //   perToken  = 33_333_333 (floor of 33_333_333.33...)
        //   allocated = ceil(33_333_333 * 3e18 / 1e18) = 99_999_999 -> 1 unit (0.000001 USDC) is never allocated
        vm.prank(admin);
        token.setNAV(50_000_000, 0, true);
        vm.prank(issuer);
        token.mint(alice, 3e18);

        _fund(issuer, 100e6);
        vm.startPrank(issuer);
        usdc.approve(address(token), 100e6);
        vm.expectEmit(address(token));
        emit IHBToken.CouponDistributed(1, 100e6, 99_999_999, 33_333_333, 3e18);
        token.distributeCoupon(100e6);
        vm.stopPrank();

        assertEq(token.couponIndex(), 33_333_333);
        assertEq(token.totalDistributed(), 100e6);
        assertEq(token.totalAllocated(), 99_999_999);
        assertEq(token.couponReserve(), 99_999_999);
        assertEq(token.vaultBalance(), 100e6);
        assertEq(token.availableLiquidity(), 1); // the remainder is ordinary liquidity from the start
        assertEq(token.nav(), 50_000_000 - 33_333_333);
        assertEq(token.pendingCoupon(alice), 99_999_999);

        vm.prank(alice);
        assertEq(token.claimCoupon(), 99_999_999);

        // After the only holder claimed: reserve 0 (<= 1 holder), the 1 unit of remainder is NOT in the reserve.
        assertEq(token.couponReserve(), 0);
        assertEq(token.vaultBalance(), 1);
        assertEq(token.availableLiquidity(), 1);
    }

    function test_settlementDust_staysInReserve_boundedByHolders() public {
        // Fractional balances: alice 1.5 tokens, bob 0.5 tokens (supply 2e18, minimum coupon 2 units).
        vm.startPrank(issuer);
        token.mint(alice, 1.5e18);
        token.mint(bob, 0.5e18);
        vm.stopPrank();

        // 3 units: perToken = 3e18 / 2e18 = 1 ; allocated = ceil(1 * 2e18 / 1e18) = 2 ; remainder 1 -> liquidity.
        _distribute(3);
        assertEq(token.couponIndex(), 1);
        assertEq(token.totalAllocated(), 2);
        assertEq(token.couponReserve(), 2);
        assertEq(token.vaultBalance(), 3);
        assertEq(token.availableLiquidity(), 1);

        // Settlement truncates per holder: alice floor(1.5) = 1, bob floor(0.5) = 0.
        assertEq(token.pendingCoupon(alice), 1);
        assertEq(token.pendingCoupon(bob), 0);
        vm.prank(alice);
        assertEq(token.claimCoupon(), 1);
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NothingToClaim.selector));
        vm.prank(bob);
        token.claimCoupon();

        // Everyone has claimed: the settlement dust (1 unit) stays in the reserve, bounded by the holder count (2),
        // and the distribution remainder (1 unit) is still available liquidity, not reserve.
        assertEq(token.couponReserve(), 1);
        assertLe(token.couponReserve(), 2);
        assertEq(token.vaultBalance(), 2);
        assertEq(token.availableLiquidity(), 1);
    }

    function test_allocationRoundsUp_reserveNeverUnderflows() public {
        // 0.6 tokens outstanding. Two 1-unit coupons each give perToken = 1e18 / 0.6e18 = 1.
        // Rounding the allocation DOWN would record 0 + 0 allocated, yet the holder's combined settlement is
        // floor(0.6e18 * 2 / 1e18) = 1, and the reserve would underflow on the claim. Rounding up records 1 + 1.
        vm.prank(issuer);
        token.mint(alice, 0.6e18);
        _distribute(1);
        _distribute(1);
        assertEq(token.couponIndex(), 2);
        assertEq(token.totalDistributed(), 2);
        assertEq(token.totalAllocated(), 2);
        assertEq(token.pendingCoupon(alice), 1);

        vm.prank(alice);
        assertEq(token.claimCoupon(), 1);
        assertEq(token.totalClaimed(), 1);
        assertEq(token.couponReserve(), 1);
        assertEq(token.vaultBalance(), 1);
        assertEq(token.availableLiquidity(), 0);
    }
}
