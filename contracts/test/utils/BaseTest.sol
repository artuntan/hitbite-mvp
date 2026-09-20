// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IdentityRegistry} from "../../src/IdentityRegistry.sol";
import {HBToken} from "../../src/HBToken.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";

abstract contract BaseTest is Test {
    IdentityRegistry internal registry;
    HBToken internal token;
    MockUSDC internal usdc;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal oracle = makeAddr("oracle");

    function setUp() public virtual {
        vm.chainId(31337);
        usdc = new MockUSDC();
        registry = new IdentityRegistry(address(this), address(this));
        token = new HBToken(address(registry), address(usdc), address(this), address(this), oracle, 1e6);
        registry.addVerified(alice, 250);
        registry.addVerified(bob, 276);
        deal(address(usdc), alice, 1_000_000e6);
        deal(address(usdc), bob, 1_000_000e6);
        deal(address(usdc), address(this), 1_000_000e6);
        vm.prank(alice);
        usdc.approve(address(token), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(token), type(uint256).max);
        usdc.approve(address(token), type(uint256).max);
    }

    function subscribe(address account, uint256 amount) internal returns (uint256) {
        vm.prank(account);
        return token.subscribe(amount);
    }
}
