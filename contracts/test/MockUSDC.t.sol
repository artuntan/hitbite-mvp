// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest, MockUSDC} from "./utils/BaseTest.sol";

contract MockTest is BaseTest {
    function testFaucetCappedAndResetsAfterDay() public {
        vm.prank(carol);
        usdc.faucet();
        assertEq(usdc.balanceOf(carol), 100e6);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(MockUSDC.FaucetCooldown.selector, block.timestamp + 1 days));
        usdc.faucet();
        vm.warp(block.timestamp + 1 days);
        vm.prank(carol);
        usdc.faucet();
        assertEq(usdc.balanceOf(carol), 200e6);
    }

    function testArcAndProductionCannotDeployMock() public {
        vm.chainId(5042002);
        vm.expectRevert(MockUSDC.UnsupportedChain.selector);
        new MockUSDC();
        vm.chainId(1);
        vm.expectRevert(MockUSDC.UnsupportedChain.selector);
        new MockUSDC();
        vm.chainId(84532);
        MockUSDC fallbackAsset = new MockUSDC();
        assertEq(fallbackAsset.decimals(), 6);
    }
}
