// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest, HBToken} from "./utils/BaseTest.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract WrongDecimals is ERC20 {
    constructor() ERC20("Wrong", "BAD") {}
}

contract HBTokenTest is BaseTest {
    function testMetadataAndDecimals() public view {
        assertEq(token.name(), unicode"HitBite Türkiye Sovereign (Testnet)");
        assertEq(token.symbol(), "hbTRS");
        assertEq(token.decimals(), 18);
        assertEq(usdc.decimals(), 6);
        assertEq(token.settlementAsset(), address(usdc));
    }

    function testSubscribeMathAtThreeNAVs() public {
        uint256[3] memory navs = [uint256(950_000), 1_000_000, 1_050_000];
        for (uint256 i; i < navs.length; ++i) {
            token.setNAV(navs[i], true);
            uint256 before = token.balanceOf(alice);
            uint256 out = subscribe(alice, 10e6);
            assertEq(out, 10e6 * 1e18 / navs[i]);
            assertEq(token.balanceOf(alice) - before, out);
        }
    }

    function testRedeemMath() public {
        uint256 tokens = subscribe(alice, 10e6);
        token.setNAV(1_040_000, true);
        usdc.transfer(address(token), 1e6);
        vm.prank(alice);
        assertEq(token.redeem(tokens), 10_400_000);
        assertEq(token.balanceOf(alice), 0);
    }

    function testInsufficientVaultDoesNotBurn() public {
        subscribe(alice, 10e6);
        token.setNAV(1_050_000, true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(HBToken.InsufficientVaultLiquidity.selector, 10e6, 10_500_000));
        token.redeem(10e18);
        assertEq(token.balanceOf(alice), 10e18);
    }

    function testRestrictionsOnBothSidesAndMint() public {
        subscribe(alice, 10e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(HBToken.NotVerified.selector, carol));
        token.transfer(carol, 1e18);
        vm.expectRevert(abi.encodeWithSelector(HBToken.NotVerified.selector, carol));
        token.mint(carol, 1e18);
        registry.removeVerified(alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(HBToken.NotVerified.selector, alice));
        token.transfer(bob, 1e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(HBToken.NotVerified.selector, alice));
        token.subscribe(1e6);
    }

    function testTransferFromAndCountryBlockedAfterVerification() public {
        subscribe(alice, 10e6);
        vm.prank(alice);
        token.approve(bob, 2e18);
        vm.prank(bob);
        token.transferFrom(alice, bob, 1e18);
        registry.setCountryBlocked(250, true);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(HBToken.NotVerified.selector, alice));
        token.transferFrom(alice, bob, 1e18);
    }

    function testRevokedHolderCanExitAndClaim() public {
        subscribe(alice, 10e6);
        token.distributeCoupon(1e6);
        registry.removeVerified(alice);
        vm.prank(alice);
        assertEq(token.redeem(10e18), 10e6);
        vm.prank(alice);
        assertEq(token.claimCoupon(), 1e6);
    }

    function testNAVRailAndForcedIssuer() public {
        vm.prank(oracle);
        token.setNAV(1_050_000);
        assertEq(token.navPerToken(), 1_050_000);
        vm.prank(oracle);
        vm.expectRevert(abi.encodeWithSelector(HBToken.NAVMoveExceedsRail.selector, 1_050_000, 1_102_501));
        token.setNAV(1_102_501);
        vm.prank(oracle);
        token.setNAV(997_500, false);
        vm.prank(oracle);
        vm.expectRevert();
        token.setNAV(2e6, true);
        token.setNAV(2e6, true);
        assertEq(token.navUpdatedBlock(), block.number);
        assertEq(token.navUpdatedAt(), block.timestamp);
        vm.expectRevert(HBToken.InvalidNAV.selector);
        token.setNAV(0, true);
        vm.expectRevert(HBToken.InvalidNAV.selector);
        token.setNAV(type(uint256).max, true);
    }

    function testRoleEnforcement() public {
        vm.startPrank(alice);
        vm.expectRevert();
        token.setNAV(1e6);
        vm.expectRevert();
        token.setNAV(1e6, false);
        vm.expectRevert();
        token.setNAV(1e6, true);
        vm.expectRevert();
        token.mint(alice, 1e18);
        vm.expectRevert();
        token.burn(bob, 1e18);
        vm.expectRevert();
        token.pause();
        vm.expectRevert();
        token.unpause();
        vm.expectRevert();
        token.distributeCoupon(1e6);
        vm.stopPrank();
        // DEFAULT_ADMIN_ROLE is not itself permission to publish or force NAV.
        token.revokeRole(token.ISSUER_ROLE(), address(this));
        vm.expectRevert();
        token.setNAV(1e6, true);
    }

    function testPauseAllValueMovementAndRestore() public {
        subscribe(alice, 10e6);
        token.distributeCoupon(1e6);
        token.pause();
        vm.startPrank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        token.subscribe(1e6);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        token.redeem(1e18);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        token.transfer(bob, 1e18);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        token.claimCoupon();
        vm.stopPrank();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        token.mint(alice, 1e18);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        token.burn(alice, 1e18);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        token.distributeCoupon(1e6);
        vm.prank(oracle);
        token.setNAV(1e6);
        token.unpause();
        vm.prank(alice);
        token.transfer(bob, 1e18);
        assertEq(token.balanceOf(bob), 1e18);
    }

    function testInvalidAmountsAndMissingClaims() public {
        vm.startPrank(alice);
        vm.expectRevert(HBToken.ZeroAmount.selector);
        token.subscribe(0);
        vm.expectRevert(HBToken.AmountTooLarge.selector);
        token.subscribe(type(uint256).max);
        vm.expectRevert(HBToken.ZeroAmount.selector);
        token.redeem(0);
        vm.expectRevert(HBToken.AmountTooLarge.selector);
        token.redeem(type(uint256).max);
        vm.expectRevert(HBToken.ZeroOutput.selector);
        token.redeem(1);
        vm.expectRevert(HBToken.NothingToClaim.selector);
        token.claimCoupon();
        vm.stopPrank();
        vm.expectRevert(HBToken.NoSupply.selector);
        token.distributeCoupon(1);
        vm.expectRevert(HBToken.ZeroAmount.selector);
        token.distributeCoupon(0);
        token.setNAV(2e18, true);
        vm.prank(alice);
        vm.expectRevert(HBToken.ZeroOutput.selector);
        token.subscribe(1);
    }

    function testZeroUSDCRecipientImpossible() public {
        vm.prank(alice);
        vm.expectRevert();
        usdc.transfer(address(0), 1);
        vm.expectRevert();
        token.mint(address(0), 1);
        vm.expectRevert(HBToken.ZeroAddress.selector);
        new HBToken(address(registry), address(0), address(this), address(this), oracle, 1e6);
    }

    function testWrongSettlementDecimalsRejected() public {
        ERC20 wrong = new WrongDecimals();
        vm.expectRevert(HBToken.InvalidSettlementDecimals.selector);
        new HBToken(address(registry), address(wrong), address(this), address(this), oracle, 1e6);
    }
}
