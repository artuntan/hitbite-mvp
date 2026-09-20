// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest, HBToken, MockUSDC} from "../utils/BaseTest.sol";
import {Test} from "forge-std/Test.sol";

contract CouponHandler is Test {
    HBToken private token;
    MockUSDC private usdc;
    address private alice;
    address private bob;

    constructor(HBToken token_, MockUSDC usdc_, address alice_, address bob_) {
        token = token_;
        usdc = usdc_;
        alice = alice_;
        bob = bob_;
        usdc.approve(address(token), type(uint256).max);
    }

    function move(uint256 seed, uint256 amount) external {
        address from = seed % 2 == 0 ? alice : bob;
        address to = from == alice ? bob : alice;
        uint256 value = bound(amount, 0, token.balanceOf(from));
        vm.prank(from);
        token.transfer(to, value);
    }

    function distribute(uint256 amount) external {
        if (token.totalSupply() == 0 || usdc.balanceOf(address(this)) == 0) return;
        token.distributeCoupon(bound(amount, 1, usdc.balanceOf(address(this))));
    }

    function claim(uint256 seed) external {
        address account = seed % 2 == 0 ? alice : bob;
        if (token.accruedCoupon(account) == 0) return;
        vm.prank(account);
        token.claimCoupon();
    }

    function enter(uint256 seed, uint256 amount) external {
        address account = seed % 2 == 0 ? alice : bob;
        uint256 cash = usdc.balanceOf(account);
        if (cash < 2) return;
        vm.prank(account);
        token.subscribe(bound(amount, 2, cash));
    }

    function exit(uint256 seed, uint256 amount) external {
        address account = seed % 2 == 0 ? alice : bob;
        uint256 balance = token.balanceOf(account);
        if (balance < 1e12) return;
        vm.prank(account);
        token.redeem(bound(amount, 1e12, balance));
    }
}

contract CouponReserveInvariant is BaseTest {
    function setUp() public override {
        super.setUp();
        subscribe(alice, 70e6);
        subscribe(bob, 30e6);
        CouponHandler handler = new CouponHandler(token, usdc, alice, bob);
        token.grantRole(token.ISSUER_ROLE(), address(handler));
        deal(address(usdc), address(handler), 10_000e6);
        targetContract(address(handler));
    }

    function invariantReserveCoversAccruedAndIsFunded() public view {
        assertGe(token.couponReserve(), token.accruedCoupon(alice) + token.accruedCoupon(bob));
        assertGe(usdc.balanceOf(address(token)), token.couponReserve());
    }

    function invariantPaidPlusReservedEqualsDistributed() public view {
        assertEq(token.totalClaimed() + token.couponReserve(), token.totalDistributed());
        assertEq(token.totalSupply(), token.balanceOf(alice) + token.balanceOf(bob));
    }
}
