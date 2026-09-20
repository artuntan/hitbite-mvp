// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest, HBToken} from "./utils/BaseTest.sol";

contract CouponTest is BaseTest {
    function testTwoDistributionsAndTransferPreserveEarnedShare() public {
        subscribe(alice, 70e6);
        subscribe(bob, 30e6);
        token.distributeCoupon(10e6);
        vm.prank(alice);
        token.transfer(bob, 20e18);
        token.distributeCoupon(20e6);
        assertEq(token.accruedCoupon(alice), 17e6);
        assertEq(token.accruedCoupon(bob), 13e6);
        vm.prank(alice);
        assertEq(token.claimCoupon(), 17e6);
        vm.prank(bob);
        assertEq(token.claimCoupon(), 13e6);
        assertEq(token.couponReserve(), 0);
        assertEq(token.navPerToken(), 1e6, "externally funded coupons do not mutate NAV");
    }

    function testLateEntryNoHistoricalCouponsAndBurnPreservesClaim() public {
        subscribe(alice, 10e6);
        token.distributeCoupon(1e6);
        subscribe(bob, 10e6);
        assertEq(token.accruedCoupon(bob), 0);
        token.burn(alice, 10e18);
        assertEq(token.accruedCoupon(alice), 1e6);
        vm.prank(alice);
        token.claimCoupon();
        assertEq(token.totalClaimed(), 1e6);
    }

    function testFractionalCouponSurvivesRepeatedSelfTransfers() public {
        token.mint(alice, 1e18);
        token.mint(bob, 1e18);
        for (uint256 i; i < 10; ++i) {
            token.distributeCoupon(1);
            vm.prank(alice);
            token.transfer(alice, 0);
        }
        assertEq(token.accruedCoupon(alice), 5);
        assertEq(token.accruedCoupon(bob), 5);
    }

    function testCouponReserveCannotFundRedemptions() public {
        subscribe(alice, 10e6);
        token.distributeCoupon(2e6);
        token.setNAV(1_100_000, true);
        assertEq(usdc.balanceOf(address(token)), 12e6);
        assertEq(token.availableLiquidity(), 10e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(HBToken.InsufficientVaultLiquidity.selector, 10e6, 11e6));
        token.redeem(10e18);
        vm.prank(alice);
        assertEq(token.claimCoupon(), 2e6);
    }

    function testDistributionTooSmallAndSupplyCap() public {
        token.mint(alice, type(uint128).max);
        vm.expectRevert(HBToken.DistributionTooSmall.selector);
        token.distributeCoupon(1);
        vm.expectRevert(HBToken.AmountTooLarge.selector);
        token.mint(bob, 1);
    }

    function testFuzzCouponConservation(uint96 first, uint96 second, uint96 moved) public {
        uint256 one = bound(first, 1e6, 1_000e6);
        uint256 two = bound(second, 1e6, 1_000e6);
        subscribe(alice, 7e6);
        subscribe(bob, 3e6);
        token.distributeCoupon(one);
        vm.prank(alice);
        token.transfer(bob, bound(moved, 0, 7e18));
        token.distributeCoupon(two);
        uint256 aliceOwed = token.accruedCoupon(alice);
        uint256 bobOwed = token.accruedCoupon(bob);
        assertLe(aliceOwed + bobOwed, one + two);
        assertLe(one + two - aliceOwed - bobOwed, 2);
        vm.prank(alice);
        token.claimCoupon();
        vm.prank(bob);
        token.claimCoupon();
        assertGe(usdc.balanceOf(address(token)), token.couponReserve());
        assertEq(token.totalClaimed() + token.couponReserve(), token.totalDistributed());
    }
}
