// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockUSDC} from "../src/MockUSDC.sol";
import {BaseTest} from "./utils/BaseTest.sol";

contract MockUSDCTest is BaseTest {
    uint256 internal constant CAP = 10_000e6;

    function test_metadata() public view {
        assertEq(usdc.name(), "MockUSDC (Testnet)");
        assertEq(usdc.symbol(), "mUSDC");
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.FAUCET_CAP(), CAP);
        assertEq(usdc.FAUCET_WINDOW(), 1 days);
        assertEq(usdc.totalSupply(), 0);
    }

    // ------------------------------------------------------------------ faucet
    function test_faucet_happyPath() public {
        vm.expectEmit(address(usdc));
        emit MockUSDC.Faucet(alice, 1000e6);
        vm.prank(stranger); // anyone may call, for anyone
        usdc.faucet(alice, 1000e6);

        assertEq(usdc.balanceOf(alice), 1000e6);
        assertEq(usdc.mintedInWindow(alice), 1000e6);
        assertEq(usdc.windowStart(alice), block.timestamp);
        assertEq(usdc.faucetRemaining(alice), 9000e6);
        assertEq(usdc.totalSupply(), 1000e6);
    }

    function test_faucet_fullCapInOneCall() public {
        usdc.faucet(alice, CAP);
        assertEq(usdc.balanceOf(alice), CAP);
        assertEq(usdc.faucetRemaining(alice), 0);
    }

    function test_faucet_revertsZeroAmount() public {
        vm.expectRevert(abi.encodeWithSelector(MockUSDC.ZeroAmount.selector));
        usdc.faucet(alice, 0);
    }

    function test_faucet_revertsFaucetAmountTooLarge() public {
        vm.expectRevert(abi.encodeWithSelector(MockUSDC.FaucetAmountTooLarge.selector, CAP + 1, CAP));
        usdc.faucet(alice, CAP + 1);
    }

    function test_faucet_revertsFaucetDailyCapExceeded_withRemaining() public {
        usdc.faucet(alice, 6000e6);
        assertEq(usdc.faucetRemaining(alice), 4000e6);

        vm.expectRevert(abi.encodeWithSelector(MockUSDC.FaucetDailyCapExceeded.selector, 4000e6));
        usdc.faucet(alice, 5000e6);

        // Exactly the remaining amount is fine.
        usdc.faucet(alice, 4000e6);
        assertEq(usdc.faucetRemaining(alice), 0);

        vm.expectRevert(abi.encodeWithSelector(MockUSDC.FaucetDailyCapExceeded.selector, 0));
        usdc.faucet(alice, 1);
    }

    function test_faucet_windowIsFixedFromFirstUse() public {
        // The window is anchored at the first call, not at the last one: later calls inside the window do not
        // extend it.
        uint256 start = block.timestamp;
        usdc.faucet(alice, CAP);
        assertEq(usdc.windowStart(alice), start);

        // One second before the window ends: still exhausted.
        vm.warp(start + 1 days - 1);
        assertEq(usdc.faucetRemaining(alice), 0);
        vm.expectRevert(abi.encodeWithSelector(MockUSDC.FaucetDailyCapExceeded.selector, 0));
        usdc.faucet(alice, 1);

        // Window boundary: fresh allowance, a new window starts now.
        vm.warp(start + 1 days);
        assertEq(usdc.faucetRemaining(alice), CAP);
        usdc.faucet(alice, 2500e6);
        assertEq(usdc.windowStart(alice), start + 1 days);
        assertEq(usdc.mintedInWindow(alice), 2500e6);
        assertEq(usdc.faucetRemaining(alice), 7500e6);
        assertEq(usdc.balanceOf(alice), CAP + 2500e6);

        // A second call 12 h into the new window keeps the same window start.
        vm.warp(start + 1 days + 12 hours);
        usdc.faucet(alice, 2500e6);
        assertEq(usdc.windowStart(alice), start + 1 days);
        assertEq(usdc.faucetRemaining(alice), 5000e6);
    }

    function test_faucet_windowsArePerAddress() public {
        usdc.faucet(alice, CAP);
        assertEq(usdc.faucetRemaining(alice), 0);
        assertEq(usdc.faucetRemaining(bob), CAP);

        usdc.faucet(bob, CAP);
        assertEq(usdc.balanceOf(bob), CAP);
    }

    function test_faucetRemaining_freshAddress() public view {
        assertEq(usdc.faucetRemaining(carol), CAP);
        assertEq(usdc.windowStart(carol), 0);
        assertEq(usdc.mintedInWindow(carol), 0);
    }

    // ------------------------------------------------------------------ fixture helpers
    function test_fundHelper_neverWarps() public {
        uint256 start = block.timestamp;
        _fund(alice, CAP);
        assertEq(block.timestamp, start);

        // Exceeding the window reverts loudly instead of silently moving time.
        vm.expectRevert(abi.encodeWithSelector(MockUSDC.FaucetDailyCapExceeded.selector, 0));
        _fund(alice, 1);
        vm.expectRevert(abi.encodeWithSelector(MockUSDC.FaucetAmountTooLarge.selector, CAP + 1, CAP));
        _fund(bob, CAP + 1);
        assertEq(block.timestamp, start);
    }

    function test_fundAcrossWindowsHelper_respectsCapAndWarps() public {
        uint256 start = block.timestamp;
        _fundAcrossWindows(alice, 25_000e6);
        assertEq(usdc.balanceOf(alice), 25_000e6);
        // 10k + 10k + 5k needs two extra windows.
        assertEq(block.timestamp, start + 2 days);
        assertEq(usdc.faucetRemaining(alice), 5000e6);
    }
}
