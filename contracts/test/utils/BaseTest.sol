// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HBToken} from "../../src/HBToken.sol";
import {IdentityRegistry} from "../../src/IdentityRegistry.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";

/// @notice Shared fixture: MockUSDC, IdentityRegistry(admin, [840, 792]) and HBToken(registry, usdc, admin) with the
///         registrar / issuer / oracle roles granted by the admin. Every test file inherits this.
abstract contract BaseTest is Test {
    // ------------------------------------------------------------------ constants
    uint16 internal constant COUNTRY_US = 840; // blocked at deployment
    uint16 internal constant COUNTRY_TR = 792; // blocked at deployment
    uint16 internal constant COUNTRY_DE = 276;
    uint16 internal constant COUNTRY_AE = 784;
    uint16 internal constant COUNTRY_GB = 826;

    uint256 internal constant NAV_1_00 = 1_000_000;
    uint256 internal constant NAV_1_0043 = 1_004_300;
    uint256 internal constant NAV_0_98 = 980_000;

    /// @dev Mirrors HBToken.MAX_INPUT (D28).
    uint256 internal constant MAX_INPUT = type(uint128).max;

    /// @dev 2026-09-08T00:00:00Z. A realistic timestamp so faucet windows and `verifiedAt` behave as on a real chain.
    uint256 internal constant START_TIMESTAMP = 1_757_289_600;

    // ------------------------------------------------------------------ actors
    address internal admin = address(0xA0);
    address internal registrar = address(0xA1);
    address internal issuer = address(0xA2);
    address internal oracle = address(0xA3);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA201);
    address internal stranger = address(0x5712);

    // ------------------------------------------------------------------ contracts
    MockUSDC internal usdc;
    IdentityRegistry internal registry;
    HBToken internal token;

    bytes32 internal DEFAULT_ADMIN_ROLE;
    bytes32 internal REGISTRAR_ROLE;
    bytes32 internal ISSUER_ROLE;
    bytes32 internal ORACLE_ROLE;

    // ------------------------------------------------------------------ setup
    function setUp() public virtual {
        vm.warp(START_TIMESTAMP);

        vm.label(admin, "admin");
        vm.label(registrar, "registrar");
        vm.label(issuer, "issuer");
        vm.label(oracle, "oracle");
        vm.label(alice, "alice");
        vm.label(bob, "bob");
        vm.label(carol, "carol");
        vm.label(stranger, "stranger");

        usdc = new MockUSDC();
        vm.label(address(usdc), "MockUSDC");

        uint16[] memory blocked = new uint16[](2);
        blocked[0] = COUNTRY_US;
        blocked[1] = COUNTRY_TR;
        registry = new IdentityRegistry(admin, blocked);
        vm.label(address(registry), "IdentityRegistry");

        token = new HBToken(registry, IERC20(address(usdc)), admin);
        vm.label(address(token), "HBToken");

        DEFAULT_ADMIN_ROLE = token.DEFAULT_ADMIN_ROLE();
        REGISTRAR_ROLE = registry.REGISTRAR_ROLE();
        ISSUER_ROLE = token.ISSUER_ROLE();
        ORACLE_ROLE = token.ORACLE_ROLE();

        vm.startPrank(admin);
        registry.grantRole(REGISTRAR_ROLE, registrar);
        token.grantRole(ISSUER_ROLE, issuer);
        token.grantRole(ORACLE_ROLE, oracle);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ helpers
    /// @dev Verify `account` as a professional investor from `country`.
    function _verify(address account, uint16 country) internal {
        vm.prank(registrar);
        registry.addVerified(account, country, 1);
    }

    /// @dev Fund `account` with `usdcAmount` in a single faucet call. Never warps time: if the amount does not fit
    ///      in the address's current 24 h window the faucet reverts (FaucetAmountTooLarge / FaucetDailyCapExceeded)
    ///      and so does the test. Use `_fundAcrossWindows` only when a test deliberately opts into time travel.
    function _fund(address account, uint256 usdcAmount) internal {
        usdc.faucet(account, usdcAmount);
    }

    /// @dev Fund `account` with more than one faucet window allows, warping one day forward whenever the window is
    ///      exhausted. `block.timestamp` moves: only for tests that opt in.
    function _fundAcrossWindows(address account, uint256 usdcAmount) internal {
        uint256 remaining = usdcAmount;
        while (remaining > 0) {
            uint256 allowance = usdc.faucetRemaining(account);
            if (allowance == 0) {
                vm.warp(block.timestamp + 1 days);
                continue;
            }
            uint256 chunk = remaining < allowance ? remaining : allowance;
            usdc.faucet(account, chunk);
            remaining -= chunk;
        }
    }

    /// @dev Approve and subscribe as `account`.
    function _subscribe(address account, uint256 usdcAmount) internal returns (uint256 tokensOut) {
        vm.startPrank(account);
        usdc.approve(address(token), usdcAmount);
        tokensOut = token.subscribe(usdcAmount);
        vm.stopPrank();
    }

    /// @dev Fund the issuer (single faucet call) and distribute `usdcAmount` as a coupon.
    function _distribute(uint256 usdcAmount) internal returns (uint256 distributionId) {
        _fund(issuer, usdcAmount);
        vm.startPrank(issuer);
        usdc.approve(address(token), usdcAmount);
        distributionId = token.distributeCoupon(usdcAmount);
        vm.stopPrank();
    }

    /// @dev Oracle NAV update inside the rail.
    function _setNav(uint256 newNav, uint256 newReportedAUM) internal {
        vm.prank(oracle);
        token.setNAV(newNav, newReportedAUM, false);
    }

    /// @dev Expect OpenZeppelin's AccessControlUnauthorizedAccount(account, role).
    function _expectUnauthorized(address account, bytes32 role) internal {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, account, role));
    }
}
