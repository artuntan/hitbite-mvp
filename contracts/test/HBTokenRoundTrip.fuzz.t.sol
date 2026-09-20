// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./utils/BaseTest.sol";

contract RoundTripTest is BaseTest {
    function testFuzzSubscribeRedeemLosesAtMostOneMicroUSDC(uint96 amountSeed, uint96 navSeed) public {
        uint256 amount = bound(amountSeed, 2, 1_000_000e6);
        uint256 nav = bound(navSeed, 1, 1e12);
        token.setNAV(nav, true);
        uint256 tokens = subscribe(alice, amount);
        vm.prank(alice);
        uint256 returned = token.redeem(tokens);
        assertLe(returned, amount);
        assertLe(amount - returned, 1);
    }
}
