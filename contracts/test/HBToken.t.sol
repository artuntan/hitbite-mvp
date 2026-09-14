// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {HBToken} from "../src/HBToken.sol";
import {IHBToken} from "../src/interfaces/IHBToken.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";
import {BaseTest} from "./utils/BaseTest.sol";

/// @notice Core HBToken behaviour: constructor (genesis events, zero-address checks), subscribe / redeem math
///         (BUILD_PROMPT 16.4), input bounds (D28), transfer restrictions (D4), pause (D3), NAV rail window (D5/D27),
///         admin setters, roles and views (D6, D20).
contract HBTokenTest is BaseTest {
    // 1000 USDC at each NAV, from 16.4: tokens = usdc * 1e18 / nav (floor).
    uint256 internal constant TOKENS_1000_AT_1_00 = 1000e18;
    uint256 internal constant TOKENS_1000_AT_1_0043 = 995_718_410_833_416_309_867;
    uint256 internal constant TOKENS_1000_AT_0_98 = 1_020_408_163_265_306_122_448;

    function setUp() public override {
        super.setUp();
        _verify(alice, COUNTRY_DE);
        _verify(bob, COUNTRY_AE);
        // carol and stranger stay unverified; carol is funded so eligibility, not USDC, is what fails.
        _fund(alice, 5000e6);
        _fund(bob, 5000e6);
        _fund(carol, 5000e6);
    }

    // ------------------------------------------------------------------ constructor
    function test_constructor_defaults() public view {
        assertEq(token.name(), unicode"HitBite Türkiye Sovereign (Testnet)");
        assertEq(token.symbol(), "hbTRS");
        assertEq(token.decimals(), 18);
        assertEq(token.nav(), NAV_1_00);
        assertEq(token.reportedAUM(), 0);
        assertEq(token.navUpdatedAt(), uint64(START_TIMESTAMP));
        assertEq(token.maxNavMoveBps(), 500);
        assertEq(token.railAnchorNav(), NAV_1_00);
        assertEq(token.railWindowStart(), uint64(START_TIMESTAMP));
        assertEq(token.minSubscription(), 100e6);
        assertEq(token.NAV_SCALE(), 1e6);
        assertEq(token.TOKEN_SCALE(), 1e18);
        assertEq(token.MAX_INPUT(), type(uint128).max);
        assertEq(token.RAIL_WINDOW(), 1 days);
        assertEq(token.MAX_BPS(), 10_000);
        assertEq(token.DEFAULT_MAX_NAV_MOVE_BPS(), 500);
        assertEq(token.DEFAULT_MIN_SUBSCRIPTION(), 100e6);
        assertEq(token.ISSUER_ROLE(), keccak256("ISSUER_ROLE"));
        assertEq(token.ORACLE_ROLE(), keccak256("ORACLE_ROLE"));
        assertEq(address(token.registry()), address(registry));
        assertEq(token.usdc(), address(usdc));
        assertEq(token.totalSupply(), 0);
        assertEq(token.couponIndex(), 0);
        assertEq(token.totalDistributed(), 0);
        assertEq(token.totalAllocated(), 0);
        assertEq(token.totalClaimed(), 0);
        assertEq(token.distributionCount(), 0);
        assertFalse(token.paused());
    }

    function test_constructor_grantsOnlyAdminRole() public {
        assertTrue(token.hasRole(DEFAULT_ADMIN_ROLE, admin));
        assertTrue(token.hasRole(ISSUER_ROLE, issuer));
        assertTrue(token.hasRole(ORACLE_ROLE, oracle));

        HBToken fresh = new HBToken(registry, IERC20(address(usdc)), admin);
        assertTrue(fresh.hasRole(DEFAULT_ADMIN_ROLE, admin));
        assertFalse(fresh.hasRole(ISSUER_ROLE, admin));
        assertFalse(fresh.hasRole(ORACLE_ROLE, admin));
        assertFalse(fresh.hasRole(ISSUER_ROLE, issuer));
        assertFalse(fresh.hasRole(ORACLE_ROLE, oracle));
        assertEq(fresh.nav(), NAV_1_00);
    }

    function test_constructor_emitsGenesisEvents() public {
        vm.warp(START_TIMESTAMP + 12 hours);
        vm.expectEmit();
        emit IHBToken.NAVUpdated(0, NAV_1_00, 0, block.timestamp);
        vm.expectEmit();
        emit IHBToken.MaxNavMoveBpsUpdated(0, 500);
        vm.expectEmit();
        emit IHBToken.MinSubscriptionUpdated(0, 100e6);
        HBToken fresh = new HBToken(registry, IERC20(address(usdc)), admin);

        assertEq(fresh.navUpdatedAt(), uint64(START_TIMESTAMP + 12 hours));
        assertEq(fresh.railWindowStart(), uint64(START_TIMESTAMP + 12 hours));
        assertEq(fresh.railAnchorNav(), NAV_1_00);
    }

    function test_constructor_revertsZeroAddress_registry() public {
        vm.expectRevert(abi.encodeWithSelector(IHBToken.ZeroAddress.selector));
        new HBToken(IIdentityRegistry(address(0)), IERC20(address(usdc)), admin);
    }

    function test_constructor_revertsZeroAddress_usdc() public {
        vm.expectRevert(abi.encodeWithSelector(IHBToken.ZeroAddress.selector));
        new HBToken(registry, IERC20(address(0)), admin);
    }

    function test_constructor_revertsZeroAddress_admin() public {
        vm.expectRevert(abi.encodeWithSelector(IHBToken.ZeroAddress.selector));
        new HBToken(registry, IERC20(address(usdc)), address(0));
    }

    // ------------------------------------------------------------------ subscribe
    function test_subscribe_atNav1_00() public {
        vm.startPrank(alice);
        usdc.approve(address(token), 1000e6);
        vm.expectEmit(address(token));
        emit IERC20.Transfer(address(0), alice, TOKENS_1000_AT_1_00);
        vm.expectEmit(address(token));
        emit IHBToken.Subscribed(alice, 1000e6, TOKENS_1000_AT_1_00, NAV_1_00);
        uint256 out = token.subscribe(1000e6);
        vm.stopPrank();

        assertEq(out, TOKENS_1000_AT_1_00);
        assertEq(out, 1000e6 * 1e18 / NAV_1_00);
        assertEq(token.previewSubscribe(1000e6), out);
        assertEq(token.balanceOf(alice), out);
        assertEq(token.totalSupply(), out);
        assertEq(usdc.balanceOf(alice), 4000e6);
        assertEq(token.vaultBalance(), 1000e6);
    }

    function test_subscribe_atNav1_0043() public {
        _setNav(NAV_1_0043, 0);
        uint256 out = _subscribe(alice, 1000e6);

        assertEq(out, TOKENS_1000_AT_1_0043);
        assertEq(out, 1000e6 * 1e18 / NAV_1_0043);
        assertEq(token.previewSubscribe(1000e6), out);
        assertEq(token.balanceOf(alice), out);
        assertEq(token.vaultBalance(), 1000e6);
    }

    function test_subscribe_atNav0_98() public {
        _setNav(NAV_0_98, 0);
        uint256 out = _subscribe(alice, 1000e6);

        assertEq(out, TOKENS_1000_AT_0_98);
        assertEq(out, 1000e6 * 1e18 / NAV_0_98);
        assertEq(token.previewSubscribe(1000e6), out);
        assertEq(token.balanceOf(alice), out);
    }

    function test_subscribe_twiceAccumulates() public {
        _subscribe(alice, 1000e6);
        _setNav(NAV_0_98, 0);
        _subscribe(alice, 1000e6);
        assertEq(token.balanceOf(alice), TOKENS_1000_AT_1_00 + TOKENS_1000_AT_0_98);
        assertEq(token.vaultBalance(), 2000e6);
    }

    function test_subscribe_revertsZeroAmount() public {
        vm.expectRevert(abi.encodeWithSelector(IHBToken.ZeroAmount.selector));
        vm.prank(alice);
        token.subscribe(0);
    }

    function test_subscribe_revertsAmountTooLarge_beforeEligibilityAndAllowance() public {
        // carol is unverified and has approved nothing: the bound is the first thing checked after ZeroAmount.
        vm.expectRevert(abi.encodeWithSelector(IHBToken.AmountTooLarge.selector, MAX_INPUT + 1));
        vm.prank(carol);
        token.subscribe(MAX_INPUT + 1);

        vm.expectRevert(abi.encodeWithSelector(IHBToken.AmountTooLarge.selector, type(uint256).max));
        vm.prank(carol);
        token.subscribe(type(uint256).max);

        // MAX_INPUT itself passes the bound and fails on the next check (eligibility).
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NotEligible.selector, carol));
        vm.prank(carol);
        token.subscribe(MAX_INPUT);
    }

    function test_subscribe_revertsBelowMinimum() public {
        vm.expectRevert(abi.encodeWithSelector(IHBToken.BelowMinimum.selector, 100e6, 99e6));
        vm.prank(alice);
        token.subscribe(99e6);
    }

    function test_subscribe_exactMinimumPasses() public {
        uint256 out = _subscribe(alice, 100e6);
        assertEq(out, 100e18);
    }

    function test_subscribe_revertsNotEligible_unverified() public {
        vm.startPrank(carol);
        usdc.approve(address(token), 1000e6);
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NotEligible.selector, carol));
        token.subscribe(1000e6);
        vm.stopPrank();
        assertEq(usdc.balanceOf(carol), 5000e6);
    }

    function test_subscribe_revertsNotEligible_blockedCountry() public {
        vm.prank(admin);
        registry.setCountryBlocked(COUNTRY_DE, true);

        vm.startPrank(alice);
        usdc.approve(address(token), 1000e6);
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NotEligible.selector, alice));
        token.subscribe(1000e6);
        vm.stopPrank();
    }

    function test_subscribe_revertsZeroTokens() public {
        vm.startPrank(admin);
        token.setMinSubscription(1);
        token.setNAV(2e18, 0, true); // 1 USDC unit * 1e18 / 2e18 = 0 tokens
        vm.stopPrank();

        vm.startPrank(alice);
        usdc.approve(address(token), 1);
        vm.expectRevert(abi.encodeWithSelector(IHBToken.ZeroTokens.selector));
        token.subscribe(1);
        vm.stopPrank();
    }

    function test_subscribe_revertsWhenPaused() public {
        vm.prank(issuer);
        token.pause();

        vm.startPrank(alice);
        usdc.approve(address(token), 1000e6);
        vm.expectRevert(abi.encodeWithSelector(Pausable.EnforcedPause.selector));
        token.subscribe(1000e6);
        vm.stopPrank();
    }

    function test_subscribe_revertsWithoutAllowance() public {
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(token), 0, 1000e6)
        );
        vm.prank(alice);
        token.subscribe(1000e6);
    }

    function test_subscribe_revertsWithoutUsdcBalance() public {
        vm.startPrank(alice);
        usdc.approve(address(token), 6000e6);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 5000e6, 6000e6));
        token.subscribe(6000e6);
        vm.stopPrank();
        assertEq(token.balanceOf(alice), 0);
    }

    // ------------------------------------------------------------------ redeem
    function test_redeem_atNav1_00() public {
        _subscribe(alice, 1000e6);

        assertEq(token.previewRedeem(500e18), 500e6);
        vm.expectEmit(address(token));
        emit IERC20.Transfer(alice, address(0), 500e18);
        vm.expectEmit(address(token));
        emit IHBToken.Redeemed(alice, 500e18, 500e6, NAV_1_00);
        vm.prank(alice);
        uint256 out = token.redeem(500e18);

        assertEq(out, 500e6);
        assertEq(out, 500e18 * NAV_1_00 / 1e18);
        assertEq(token.balanceOf(alice), 500e18);
        assertEq(token.totalSupply(), 500e18);
        assertEq(usdc.balanceOf(alice), 4500e6);
        assertEq(token.vaultBalance(), 500e6);
    }

    function test_redeem_atNav1_0043() public {
        _subscribe(alice, 1000e6);
        _setNav(NAV_1_0043, 0);

        uint256 preview = token.previewRedeem(500e18);
        assertEq(preview, 502_150_000);
        vm.expectEmit(address(token));
        emit IHBToken.Redeemed(alice, 500e18, 502_150_000, NAV_1_0043);
        vm.prank(alice);
        uint256 out = token.redeem(500e18);

        assertEq(out, preview);
        assertEq(out, 500e18 * NAV_1_0043 / 1e18);
        assertEq(usdc.balanceOf(alice), 4000e6 + 502_150_000);
        assertEq(token.vaultBalance(), 1000e6 - 502_150_000);
    }

    function test_redeem_atNav0_98() public {
        _subscribe(alice, 1000e6);
        _setNav(NAV_0_98, 0);

        uint256 preview = token.previewRedeem(500e18);
        assertEq(preview, 490_000_000);
        vm.prank(alice);
        uint256 out = token.redeem(500e18);

        assertEq(out, preview);
        assertEq(out, 500e18 * NAV_0_98 / 1e18);
        assertEq(usdc.balanceOf(alice), 4000e6 + 490_000_000);
    }

    function test_redeem_fullPosition() public {
        _subscribe(alice, 1000e6);
        vm.prank(alice);
        uint256 out = token.redeem(1000e18);
        assertEq(out, 1000e6);
        assertEq(token.totalSupply(), 0);
        assertEq(token.vaultBalance(), 0);
        assertEq(usdc.balanceOf(alice), 5000e6);
    }

    function test_previewRoundTrip_neverMintsValue() public {
        _setNav(NAV_1_0043, 0);
        uint256 tokens = token.previewSubscribe(1000e6);
        uint256 back = token.previewRedeem(tokens);
        assertEq(back, 999_999_999); // one unit of rounding lost to the vault, never gained
        assertLe(back, 1000e6);
    }

    function test_preview_revertsAmountTooLarge() public {
        vm.expectRevert(abi.encodeWithSelector(IHBToken.AmountTooLarge.selector, MAX_INPUT + 1));
        token.previewSubscribe(MAX_INPUT + 1);

        vm.expectRevert(abi.encodeWithSelector(IHBToken.AmountTooLarge.selector, MAX_INPUT + 1));
        token.previewRedeem(MAX_INPUT + 1);
    }

    function test_bounds_extremeInputsNeverPanic_D28() public {
        // Largest NAV, largest reported AUM, largest single mint: every product still fits in uint256.
        vm.prank(admin);
        token.setNAV(MAX_INPUT, MAX_INPUT, true);
        assertEq(token.previewRedeem(MAX_INPUT), MAX_INPUT * MAX_INPUT / 1e18);
        assertEq(token.previewSubscribe(MAX_INPUT), 1e18);
        assertEq(token.supplyBackedRatio(), 1e18); // no supply

        vm.prank(issuer);
        token.mint(alice, MAX_INPUT);
        uint256 liabilities = MAX_INPUT * MAX_INPUT / 1e18;
        assertEq(token.supplyBackedRatio(), MAX_INPUT * 1e18 / liabilities);
        assertEq(token.pendingCoupon(alice), 0);

        // Smallest NAV with the largest amounts.
        vm.prank(admin);
        token.setNAV(1, 0, true);
        assertEq(token.previewSubscribe(MAX_INPUT), MAX_INPUT * 1e18);
        assertEq(token.previewRedeem(MAX_INPUT), MAX_INPUT / 1e18);
        assertEq(token.supplyBackedRatio(), 0);
    }

    function test_redeem_revertsZeroAmount() public {
        _subscribe(alice, 1000e6);
        vm.expectRevert(abi.encodeWithSelector(IHBToken.ZeroAmount.selector));
        vm.prank(alice);
        token.redeem(0);
    }

    function test_redeem_revertsZeroAmount_whenUsdcRoundsToZero() public {
        _subscribe(alice, 1000e6);
        // 1 wei of token * 1e6 / 1e18 = 0 USDC units.
        vm.expectRevert(abi.encodeWithSelector(IHBToken.ZeroAmount.selector));
        vm.prank(alice);
        token.redeem(1);
    }

    function test_redeem_revertsAmountTooLarge_neverPanics() public {
        // A zero-balance caller passing the largest possible value gets the bound error, not a Panic.
        vm.expectRevert(abi.encodeWithSelector(IHBToken.AmountTooLarge.selector, type(uint256).max));
        vm.prank(stranger);
        token.redeem(type(uint256).max);

        vm.expectRevert(abi.encodeWithSelector(IHBToken.AmountTooLarge.selector, MAX_INPUT + 1));
        vm.prank(stranger);
        token.redeem(MAX_INPUT + 1);

        // MAX_INPUT itself passes the bound; the empty vault is the next check.
        uint256 usdcOut = MAX_INPUT * NAV_1_00 / 1e18;
        vm.expectRevert(abi.encodeWithSelector(IHBToken.InsufficientLiquidity.selector, 0, usdcOut));
        vm.prank(stranger);
        token.redeem(MAX_INPUT);
    }

    function test_redeem_revertsInsufficientLiquidity() public {
        vm.prank(issuer);
        token.mint(alice, 1000e18); // no USDC behind it
        _subscribe(alice, 100e6); // vault now holds exactly 100 USDC
        assertEq(token.availableLiquidity(), 100e6);

        vm.expectRevert(abi.encodeWithSelector(IHBToken.InsufficientLiquidity.selector, 100e6, 200e6));
        vm.prank(alice);
        token.redeem(200e18);

        // Up to the available liquidity is fine.
        vm.prank(alice);
        assertEq(token.redeem(100e18), 100e6);
        assertEq(token.availableLiquidity(), 0);
    }

    function test_redeem_revertsERC20InsufficientBalance() public {
        _subscribe(alice, 1000e6);
        _subscribe(bob, 1000e6); // vault liquidity exceeds alice's position

        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 1000e18, 1001e18));
        vm.prank(alice);
        token.redeem(1001e18);
    }

    function test_redeem_revertsWhenPaused() public {
        _subscribe(alice, 1000e6);
        vm.prank(issuer);
        token.pause();

        vm.expectRevert(abi.encodeWithSelector(Pausable.EnforcedPause.selector));
        vm.prank(alice);
        token.redeem(1e18);
    }

    function test_redeem_allowedForDeverifiedHolder_D4() public {
        _subscribe(alice, 1000e6);
        vm.prank(registrar);
        registry.removeVerified(alice);
        assertFalse(registry.canHold(alice));

        vm.prank(alice);
        uint256 out = token.redeem(1000e18);
        assertEq(out, 1000e6);
        assertEq(token.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(alice), 5000e6);
    }

    // ------------------------------------------------------------------ transfer restrictions
    function test_transfer_betweenVerifiedHolders() public {
        _subscribe(alice, 1000e6);
        vm.expectEmit(address(token));
        emit IERC20.Transfer(alice, bob, 100e18);
        vm.prank(alice);
        assertTrue(token.transfer(bob, 100e18));
        assertEq(token.balanceOf(alice), 900e18);
        assertEq(token.balanceOf(bob), 100e18);
    }

    function test_transfer_aboveBalance_revertsAndRollsBackSettlement() public {
        _subscribe(alice, 1000e6);
        _distribute(100e6); // index 100_000; alice is not settled yet
        assertEq(token.accrued(alice), 0);
        assertEq(token.userIndex(alice), 0);

        // _update settles both sides before super._update rejects the amount; the revert undoes the settlement.
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 1000e18, 1001e18));
        vm.prank(alice);
        token.transfer(bob, 1001e18);

        assertEq(token.accrued(alice), 0);
        assertEq(token.userIndex(alice), 0);
        assertEq(token.accrued(bob), 0);
        assertEq(token.userIndex(bob), 0);
        assertEq(token.pendingCoupon(alice), 100e6);
        assertEq(token.balanceOf(alice), 1000e18);
    }

    function test_transfer_revertsUnverifiedReceiver() public {
        _subscribe(alice, 1000e6);
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NotEligible.selector, carol));
        vm.prank(alice);
        token.transfer(carol, 100e18);
    }

    function test_transfer_revertsUnverifiedSender() public {
        _subscribe(alice, 1000e6);
        vm.prank(registrar);
        registry.removeVerified(alice);

        vm.expectRevert(abi.encodeWithSelector(IHBToken.NotEligible.selector, alice));
        vm.prank(alice);
        token.transfer(bob, 100e18);
    }

    function test_transferFrom_revertsUnverifiedReceiver() public {
        _subscribe(alice, 1000e6);
        vm.prank(alice);
        token.approve(bob, 100e18);

        vm.expectRevert(abi.encodeWithSelector(IHBToken.NotEligible.selector, carol));
        vm.prank(bob);
        token.transferFrom(alice, carol, 100e18);
    }

    function test_transferFrom_revertsInsufficientAllowance() public {
        _subscribe(alice, 1000e6);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, bob, 0, 100e18));
        vm.prank(bob);
        token.transferFrom(alice, bob, 100e18);
    }

    function test_blockedCountryHolder_cannotSendOrReceive_butCanRedeemAndBeBurned_D4() public {
        _subscribe(alice, 1000e6);
        _subscribe(bob, 1000e6);

        vm.prank(admin);
        registry.setCountryBlocked(COUNTRY_DE, true);
        assertFalse(registry.canHold(alice));
        assertTrue(registry.isVerified(alice));

        // Cannot send.
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NotEligible.selector, alice));
        vm.prank(alice);
        token.transfer(bob, 100e18);

        // Cannot receive.
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NotEligible.selector, alice));
        vm.prank(bob);
        token.transfer(alice, 100e18);

        // Cannot be minted to.
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NotEligible.selector, alice));
        vm.prank(issuer);
        token.mint(alice, 1e18);

        // Can redeem (exit to cash).
        vm.prank(alice);
        assertEq(token.redeem(400e18), 400e6);
        assertEq(token.balanceOf(alice), 600e18);

        // Can be burned by the issuer.
        vm.expectEmit(address(token));
        emit IHBToken.OperationalBurn(alice, 600e18);
        vm.prank(issuer);
        token.burn(alice, 600e18);
        assertEq(token.balanceOf(alice), 0);
    }

    // ------------------------------------------------------------------ mint / burn
    function test_mint_happyPath() public {
        vm.expectEmit(address(token));
        emit IERC20.Transfer(address(0), alice, 10e18);
        vm.expectEmit(address(token));
        emit IHBToken.OperationalMint(alice, 10e18);
        vm.prank(issuer);
        token.mint(alice, 10e18);

        assertEq(token.balanceOf(alice), 10e18);
        assertEq(token.totalSupply(), 10e18);
        assertEq(token.vaultBalance(), 0);
    }

    function test_mint_revertsNotEligible_unverified() public {
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NotEligible.selector, carol));
        vm.prank(issuer);
        token.mint(carol, 10e18);
    }

    function test_mint_revertsAmountTooLarge() public {
        vm.expectRevert(abi.encodeWithSelector(IHBToken.AmountTooLarge.selector, MAX_INPUT + 1));
        vm.prank(issuer);
        token.mint(alice, MAX_INPUT + 1);

        vm.prank(issuer);
        token.mint(alice, MAX_INPUT);
        assertEq(token.balanceOf(alice), MAX_INPUT);
    }

    function test_mint_revertsNotIssuer() public {
        _expectUnauthorized(stranger, ISSUER_ROLE);
        vm.prank(stranger);
        token.mint(alice, 1e18);

        _expectUnauthorized(admin, ISSUER_ROLE);
        vm.prank(admin);
        token.mint(alice, 1e18);
    }

    function test_burn_happyPath() public {
        vm.prank(issuer);
        token.mint(alice, 10e18);

        vm.expectEmit(address(token));
        emit IERC20.Transfer(alice, address(0), 4e18);
        vm.expectEmit(address(token));
        emit IHBToken.OperationalBurn(alice, 4e18);
        vm.prank(issuer);
        token.burn(alice, 4e18);

        assertEq(token.balanceOf(alice), 6e18);
        assertEq(token.totalSupply(), 6e18);
    }

    function test_burn_revertsInsufficientBalance() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 0, 1));
        vm.prank(issuer);
        token.burn(alice, 1);
    }

    function test_burn_revertsNotIssuer() public {
        vm.prank(issuer);
        token.mint(alice, 10e18);

        _expectUnauthorized(stranger, ISSUER_ROLE);
        vm.prank(stranger);
        token.burn(alice, 1e18);
    }

    // ------------------------------------------------------------------ pause (D3)
    function test_pause_blocksEverything_andSetNavStillWorks() public {
        _subscribe(alice, 1000e6);
        _distribute(100e6); // alice now has 100 USDC pending; nav and rail anchor dropped to 900_000 (D26)
        assertEq(token.nav(), 900_000);
        _fund(issuer, 50e6);
        vm.prank(issuer);
        usdc.approve(address(token), 50e6);

        vm.expectEmit(address(token));
        emit Pausable.Paused(issuer);
        vm.prank(issuer);
        token.pause();
        assertTrue(token.paused());

        bytes memory paused = abi.encodeWithSelector(Pausable.EnforcedPause.selector);

        vm.expectRevert(paused);
        vm.prank(alice);
        token.transfer(bob, 1e18);

        vm.startPrank(alice);
        usdc.approve(address(token), 1000e6);
        vm.expectRevert(paused);
        token.subscribe(1000e6);
        vm.expectRevert(paused);
        token.redeem(1e18);
        vm.expectRevert(paused);
        token.claimCoupon();
        vm.stopPrank();

        vm.startPrank(issuer);
        vm.expectRevert(paused);
        token.mint(alice, 1e18);
        vm.expectRevert(paused);
        token.burn(alice, 1e18);
        vm.expectRevert(paused);
        token.distributeCoupon(50e6);
        vm.stopPrank();

        // NAV updates keep working while paused (oracle inside the rail from the 900_000 anchor, and admin force).
        _setNav(940_000, 123e6);
        assertEq(token.nav(), 940_000);
        vm.prank(admin);
        token.setNAV(2_000_000, 456e6, true);
        assertEq(token.nav(), 2_000_000);
        assertEq(token.reportedAUM(), 456e6);

        // Registry changes are independent of the token pause.
        _verify(carol, COUNTRY_GB);
        assertTrue(registry.canHold(carol));

        // Unpause restores every path.
        vm.expectEmit(address(token));
        emit Pausable.Unpaused(issuer);
        vm.prank(issuer);
        token.unpause();
        assertFalse(token.paused());

        vm.prank(alice);
        assertTrue(token.transfer(bob, 1e18));
        vm.prank(alice);
        assertEq(token.claimCoupon(), 100e6);
        vm.prank(issuer);
        token.mint(carol, 1e18);
        assertEq(token.balanceOf(carol), 1e18);
    }

    function test_pause_revertsNotIssuer() public {
        _expectUnauthorized(stranger, ISSUER_ROLE);
        vm.prank(stranger);
        token.pause();

        _expectUnauthorized(admin, ISSUER_ROLE);
        vm.prank(admin);
        token.pause();
        assertFalse(token.paused());
    }

    function test_unpause_revertsNotIssuer() public {
        vm.prank(issuer);
        token.pause();

        _expectUnauthorized(stranger, ISSUER_ROLE);
        vm.prank(stranger);
        token.unpause();
        assertTrue(token.paused());
    }

    function test_pause_revertsWhenAlreadyPaused() public {
        vm.prank(issuer);
        token.pause();
        vm.expectRevert(abi.encodeWithSelector(Pausable.EnforcedPause.selector));
        vm.prank(issuer);
        token.pause();
    }

    function test_unpause_revertsWhenNotPaused() public {
        vm.expectRevert(abi.encodeWithSelector(Pausable.ExpectedPause.selector));
        vm.prank(issuer);
        token.unpause();
    }

    // ------------------------------------------------------------------ setNAV (D5 / D27)
    function test_setNAV_exactlyPlusFivePercentPasses() public {
        vm.warp(block.timestamp + 1 days);
        vm.expectEmit(address(token));
        emit IHBToken.NAVUpdated(NAV_1_00, 1_050_000, 42e6, block.timestamp);
        _setNav(1_050_000, 42e6);

        assertEq(token.nav(), 1_050_000);
        assertEq(token.reportedAUM(), 42e6);
        assertEq(token.navUpdatedAt(), uint64(block.timestamp));
        assertEq(token.navUpdatedAt(), uint64(START_TIMESTAMP + 1 days));
        // The window rolled (a full day elapsed): anchored at the pre-update NAV, started now.
        assertEq(token.railAnchorNav(), NAV_1_00);
        assertEq(token.railWindowStart(), uint64(START_TIMESTAMP + 1 days));
    }

    function test_setNAV_plusFivePercentPlusOneReverts() public {
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NavMoveExceedsRail.selector, NAV_1_00, 1_050_001, 500));
        vm.prank(oracle);
        token.setNAV(1_050_001, 0, false);
        assertEq(token.nav(), NAV_1_00);
    }

    function test_setNAV_minusFivePercentPasses() public {
        _setNav(950_000, 0);
        assertEq(token.nav(), 950_000);
    }

    function test_setNAV_minusFivePercentMinusOneReverts() public {
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NavMoveExceedsRail.selector, NAV_1_00, 949_999, 500));
        vm.prank(oracle);
        token.setNAV(949_999, 0, false);
    }

    function test_setNAV_railIsAnchoredToWindowStart_D27() public {
        // Step 1: +5% passes. The anchor stays at the window-start NAV; only `nav` moves.
        _setNav(1_050_000, 0);
        assertEq(token.nav(), 1_050_000);
        assertEq(token.railAnchorNav(), NAV_1_00);
        assertEq(token.railWindowStart(), uint64(START_TIMESTAMP));

        // Step 2 in the same window: another +5% (compounding to 1_102_500) is rejected against the anchor.
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NavMoveExceedsRail.selector, NAV_1_00, 1_102_500, 500));
        vm.prank(oracle);
        token.setNAV(1_102_500, 0, false);
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NavMoveExceedsRail.selector, NAV_1_00, 1_050_001, 500));
        vm.prank(oracle);
        token.setNAV(1_050_001, 0, false);
        assertEq(token.nav(), 1_050_000);
        assertEq(token.railAnchorNav(), NAV_1_00);

        // Moves back inside the band are fine, even if they are >5% away from the *previous* value.
        _setNav(950_000, 0); // -9.5% from 1_050_000 but -5% from the anchor
        assertEq(token.nav(), 950_000);
        _setNav(1_050_000, 0);
        assertEq(token.nav(), 1_050_000);

        // A day later the window rolls: anchor := current nav (1_050_000) and +5% from there passes.
        vm.warp(START_TIMESTAMP + 1 days);
        _setNav(1_102_500, 0);
        assertEq(token.nav(), 1_102_500);
        assertEq(token.railAnchorNav(), 1_050_000);
        assertEq(token.railWindowStart(), uint64(START_TIMESTAMP + 1 days));

        vm.expectRevert(abi.encodeWithSelector(IHBToken.NavMoveExceedsRail.selector, 1_050_000, 1_102_501, 500));
        vm.prank(oracle);
        token.setNAV(1_102_501, 0, false);
    }

    function test_setNAV_windowBoundaryIsExact() public {
        _setNav(1_050_000, 0);

        // One second before the boundary the old anchor still applies.
        vm.warp(START_TIMESTAMP + 1 days - 1);
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NavMoveExceedsRail.selector, NAV_1_00, 1_050_001, 500));
        vm.prank(oracle);
        token.setNAV(1_050_001, 0, false);
        assertEq(token.railAnchorNav(), NAV_1_00);
        assertEq(token.railWindowStart(), uint64(START_TIMESTAMP));

        // At the boundary the window rolls, anchored at the current nav and started at *this* timestamp.
        vm.warp(START_TIMESTAMP + 1 days);
        _setNav(1_050_001, 0);
        assertEq(token.railAnchorNav(), 1_050_000);
        assertEq(token.railWindowStart(), uint64(START_TIMESTAMP + 1 days));

        // A late update after the next boundary starts the window at the update time, not at the old boundary.
        vm.warp(START_TIMESTAMP + 2 days + 5);
        _setNav(1_100_000, 0); // 1_050_001 * 1.05 = 1_102_501.05
        assertEq(token.railAnchorNav(), 1_050_001);
        assertEq(token.railWindowStart(), uint64(START_TIMESTAMP + 2 days + 5));
    }

    function test_setNAV_forceRestartsWindowAtNewNav() public {
        _setNav(1_050_000, 0);
        vm.warp(START_TIMESTAMP + 1 hours);

        vm.prank(admin);
        token.setNAV(2_000_000, 0, true);
        assertEq(token.railAnchorNav(), 2_000_000);
        assertEq(token.railWindowStart(), uint64(START_TIMESTAMP + 1 hours));

        // The oracle's band is now +-5% around 2_000_000 for the next 24 h.
        _setNav(2_100_000, 0);
        assertEq(token.nav(), 2_100_000);
        _setNav(1_900_000, 0);
        assertEq(token.nav(), 1_900_000);
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NavMoveExceedsRail.selector, 2_000_000, 2_100_001, 500));
        vm.prank(oracle);
        token.setNAV(2_100_001, 0, false);
    }

    function test_setNAV_sameValuePasses() public {
        _setNav(NAV_1_00, 10e6);
        assertEq(token.nav(), NAV_1_00);
        assertEq(token.reportedAUM(), 10e6);
    }

    function test_setNAV_railFollowsMaxNavMoveBps() public {
        vm.prank(admin);
        token.setMaxNavMoveBps(1000);

        _setNav(1_100_000, 0); // +10% now allowed
        assertEq(token.nav(), 1_100_000);

        vm.expectRevert(abi.encodeWithSelector(IHBToken.NavMoveExceedsRail.selector, NAV_1_00, 1_100_001, 1000));
        vm.prank(oracle);
        token.setNAV(1_100_001, 0, false);
    }

    function test_setNAV_oracleCannotForce() public {
        _expectUnauthorized(oracle, DEFAULT_ADMIN_ROLE);
        vm.prank(oracle);
        token.setNAV(2_000_000, 0, true);
        assertEq(token.nav(), NAV_1_00);
    }

    function test_setNAV_adminCannotUseOracleRail() public {
        _expectUnauthorized(admin, ORACLE_ROLE);
        vm.prank(admin);
        token.setNAV(1_010_000, 0, false);
    }

    function test_setNAV_adminForceBypassesRailAndEmits() public {
        vm.expectEmit(address(token));
        emit IHBToken.NAVUpdated(NAV_1_00, 2_000_000, 777e6, block.timestamp);
        vm.expectEmit(address(token));
        emit IHBToken.NAVForced(NAV_1_00, 2_000_000, admin);
        vm.prank(admin);
        token.setNAV(2_000_000, 777e6, true);

        assertEq(token.nav(), 2_000_000);
        assertEq(token.reportedAUM(), 777e6);
        assertEq(token.navUpdatedAt(), uint64(block.timestamp));
    }

    function test_setNAV_revertsInvalidNav() public {
        vm.expectRevert(abi.encodeWithSelector(IHBToken.InvalidNav.selector));
        vm.prank(oracle);
        token.setNAV(0, 0, false);
        vm.expectRevert(abi.encodeWithSelector(IHBToken.InvalidNav.selector));
        vm.prank(admin);
        token.setNAV(0, 0, true);

        vm.expectRevert(abi.encodeWithSelector(IHBToken.InvalidNav.selector));
        vm.prank(oracle);
        token.setNAV(MAX_INPUT + 1, 0, false);
        vm.expectRevert(abi.encodeWithSelector(IHBToken.InvalidNav.selector));
        vm.prank(admin);
        token.setNAV(MAX_INPUT + 1, 0, true);

        // Validated before the role check: a stranger sees InvalidNav, not an access error.
        vm.expectRevert(abi.encodeWithSelector(IHBToken.InvalidNav.selector));
        vm.prank(stranger);
        token.setNAV(0, 0, false);
        assertEq(token.nav(), NAV_1_00);
    }

    function test_setNAV_revertsAmountTooLarge_reportedAUM() public {
        vm.expectRevert(abi.encodeWithSelector(IHBToken.AmountTooLarge.selector, MAX_INPUT + 1));
        vm.prank(oracle);
        token.setNAV(NAV_1_00, MAX_INPUT + 1, false);

        vm.expectRevert(abi.encodeWithSelector(IHBToken.AmountTooLarge.selector, MAX_INPUT + 1));
        vm.prank(admin);
        token.setNAV(NAV_1_00, MAX_INPUT + 1, true);

        _setNav(NAV_1_00, MAX_INPUT);
        assertEq(token.reportedAUM(), MAX_INPUT);
    }

    function test_setNAV_revertsForStranger() public {
        _expectUnauthorized(stranger, ORACLE_ROLE);
        vm.prank(stranger);
        token.setNAV(1_010_000, 0, false);

        _expectUnauthorized(stranger, DEFAULT_ADMIN_ROLE);
        vm.prank(stranger);
        token.setNAV(1_010_000, 0, true);
    }

    // ------------------------------------------------------------------ setMaxNavMoveBps / setMinSubscription
    function test_setMaxNavMoveBps_happyPath() public {
        vm.expectEmit(address(token));
        emit IHBToken.MaxNavMoveBpsUpdated(500, 1000);
        vm.prank(admin);
        token.setMaxNavMoveBps(1000);
        assertEq(token.maxNavMoveBps(), 1000);

        vm.prank(admin);
        token.setMaxNavMoveBps(10_000); // 100% is the ceiling
        assertEq(token.maxNavMoveBps(), 10_000);

        vm.prank(admin);
        token.setMaxNavMoveBps(0); // freezes oracle updates to the anchor value
        vm.expectRevert(abi.encodeWithSelector(IHBToken.NavMoveExceedsRail.selector, NAV_1_00, 1_000_001, 0));
        vm.prank(oracle);
        token.setNAV(1_000_001, 0, false);
    }

    function test_setMaxNavMoveBps_revertsInvalidBps() public {
        vm.expectRevert(abi.encodeWithSelector(IHBToken.InvalidBps.selector, 10_001));
        vm.prank(admin);
        token.setMaxNavMoveBps(10_001);
        assertEq(token.maxNavMoveBps(), 500);
    }

    function test_setMaxNavMoveBps_revertsNotAdmin() public {
        _expectUnauthorized(stranger, DEFAULT_ADMIN_ROLE);
        vm.prank(stranger);
        token.setMaxNavMoveBps(1000);

        _expectUnauthorized(oracle, DEFAULT_ADMIN_ROLE);
        vm.prank(oracle);
        token.setMaxNavMoveBps(1000);
    }

    function test_setMinSubscription_happyPath() public {
        vm.expectEmit(address(token));
        emit IHBToken.MinSubscriptionUpdated(100e6, 50e6);
        vm.prank(admin);
        token.setMinSubscription(50e6);
        assertEq(token.minSubscription(), 50e6);

        assertEq(_subscribe(alice, 50e6), 50e18);

        vm.expectRevert(abi.encodeWithSelector(IHBToken.BelowMinimum.selector, 50e6, 49e6));
        vm.prank(alice);
        token.subscribe(49e6);
    }

    function test_setMinSubscription_revertsNotAdmin() public {
        _expectUnauthorized(stranger, DEFAULT_ADMIN_ROLE);
        vm.prank(stranger);
        token.setMinSubscription(1);

        _expectUnauthorized(issuer, DEFAULT_ADMIN_ROLE);
        vm.prank(issuer);
        token.setMinSubscription(1);
    }

    // ------------------------------------------------------------------ role matrix from `stranger`
    function test_roles_strangerCannotCallAnyRestrictedFunction() public {
        vm.startPrank(stranger);

        _expectUnauthorized(stranger, ORACLE_ROLE);
        token.setNAV(1_010_000, 0, false);
        _expectUnauthorized(stranger, DEFAULT_ADMIN_ROLE);
        token.setNAV(1_010_000, 0, true);
        _expectUnauthorized(stranger, DEFAULT_ADMIN_ROLE);
        token.setMaxNavMoveBps(1);
        _expectUnauthorized(stranger, DEFAULT_ADMIN_ROLE);
        token.setMinSubscription(1);
        _expectUnauthorized(stranger, ISSUER_ROLE);
        token.distributeCoupon(1e6);
        _expectUnauthorized(stranger, ISSUER_ROLE);
        token.mint(alice, 1);
        _expectUnauthorized(stranger, ISSUER_ROLE);
        token.burn(alice, 1);
        _expectUnauthorized(stranger, ISSUER_ROLE);
        token.pause();
        _expectUnauthorized(stranger, ISSUER_ROLE);
        token.unpause();
        _expectUnauthorized(stranger, DEFAULT_ADMIN_ROLE);
        token.grantRole(ISSUER_ROLE, stranger);

        vm.stopPrank();
    }

    function test_roles_adminCanGrantAndRevoke() public {
        vm.startPrank(admin);
        token.grantRole(ORACLE_ROLE, carol);
        assertTrue(token.hasRole(ORACLE_ROLE, carol));
        token.revokeRole(ORACLE_ROLE, oracle);
        vm.stopPrank();

        _expectUnauthorized(oracle, ORACLE_ROLE);
        vm.prank(oracle);
        token.setNAV(1_010_000, 0, false);

        vm.prank(carol);
        token.setNAV(1_010_000, 0, false);
        assertEq(token.nav(), 1_010_000);
    }

    // ------------------------------------------------------------------ supplyBackedRatio (D20)
    function test_supplyBackedRatio_zeroSupply() public {
        assertEq(token.supplyBackedRatio(), 1e18);
        _setNav(NAV_1_0043, 500e6);
        assertEq(token.supplyBackedRatio(), 1e18);
    }

    function test_supplyBackedRatio_withSupplyVaultAndReportedAUM() public {
        _subscribe(alice, 1000e6);
        // liabilities = 1000e18 * 1e6 / 1e18 = 1000e6; assets = 1000e6 available + 0 AUM.
        assertEq(token.supplyBackedRatio(), 1e18);

        _setNav(NAV_1_0043, 500e6);
        // liabilities = 1000e18 * 1_004_300 / 1e18 = 1_004_300_000
        // ratio = (1_000e6 + 500e6) * 1e18 / 1_004_300_000 = 1.493577616250124464e18
        uint256 liabilities = 1000e18 * NAV_1_0043 / 1e18;
        assertEq(liabilities, 1_004_300_000);
        assertEq(token.supplyBackedRatio(), 1_493_577_616_250_124_464);
        assertEq(token.supplyBackedRatio(), (1000e6 + 500e6) * 1e18 / liabilities);
    }

    function test_supplyBackedRatio_underBacked() public {
        vm.prank(issuer);
        token.mint(alice, 1000e18); // liabilities 1000 USDC, nothing in the vault
        assertEq(token.supplyBackedRatio(), 0);

        _setNav(NAV_1_00, 500e6);
        assertEq(token.supplyBackedRatio(), 0.5e18);
    }

    function test_supplyBackedRatio_excludesCouponReserve() public {
        vm.prank(issuer);
        token.mint(alice, 1000e18); // no subscription USDC: the portfolio is the only backing
        _setNav(NAV_1_00, 1000e6);
        assertEq(token.supplyBackedRatio(), 1e18);

        // A 100 USDC coupon lands in the vault (all of it reserved), AUM drops by 100 and NAV by 0.10 (D26):
        // liabilities 900e6, available 0, AUM 900e6 -> still exactly 1e18. Counting the vault would show 1000/900.
        _distribute(100e6);
        assertEq(token.vaultBalance(), 100e6);
        assertEq(token.couponReserve(), 100e6);
        assertEq(token.availableLiquidity(), 0);
        assertEq(token.reportedAUM(), 900e6);
        uint256 liabilities = 1000e18 * 900_000 / 1e18;
        assertEq(liabilities, 900e6);
        assertEq(token.supplyBackedRatio(), 1e18);
        assertLt(token.supplyBackedRatio(), (token.vaultBalance() + token.reportedAUM()) * 1e18 / liabilities);

        // Claiming moves the reserve out of the vault; the ratio is unchanged.
        vm.prank(alice);
        token.claimCoupon();
        assertEq(token.vaultBalance(), 0);
        assertEq(token.supplyBackedRatio(), 1e18);
    }

    function test_supplyBackedRatio_dustSupplyReturnsOne() public {
        // 999_999_999_999 wei at NAV 1.00 is worth 0.999999 micro-USDC: liabilities round to zero -> 1e18 by
        // definition, even with an empty vault. One more wei makes liabilities 1 unit and the ratio 0.
        vm.prank(issuer);
        token.mint(alice, 999_999_999_999);
        assertEq(token.totalSupply() * NAV_1_00 / 1e18, 0);
        assertEq(token.supplyBackedRatio(), 1e18);

        vm.prank(issuer);
        token.mint(alice, 1);
        assertEq(token.totalSupply() * NAV_1_00 / 1e18, 1);
        assertEq(token.supplyBackedRatio(), 0);
    }

    // ------------------------------------------------------------------ liquidity views (D6)
    function test_views_vaultAvailableAndReserve() public {
        assertEq(token.vaultBalance(), 0);
        assertEq(token.couponReserve(), 0);
        assertEq(token.availableLiquidity(), 0);

        _subscribe(alice, 1000e6);
        assertEq(token.vaultBalance(), 1000e6);
        assertEq(token.couponReserve(), 0);
        assertEq(token.availableLiquidity(), 1000e6);

        _distribute(100e6);
        assertEq(token.vaultBalance(), 1100e6);
        assertEq(token.totalAllocated(), 100e6);
        assertEq(token.couponReserve(), 100e6);
        assertEq(token.availableLiquidity(), 1000e6);

        vm.prank(alice);
        token.claimCoupon();
        assertEq(token.vaultBalance(), 1000e6);
        assertEq(token.couponReserve(), 0);
        assertEq(token.availableLiquidity(), 1000e6);
    }
}
