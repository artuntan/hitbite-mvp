// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";
import {BaseTest} from "./utils/BaseTest.sol";

contract IdentityRegistryTest is BaseTest {
    // ------------------------------------------------------------------ constructor / constants
    function test_constructor_grantsAdminAndBlocksInitialCountries() public view {
        assertTrue(registry.hasRole(DEFAULT_ADMIN_ROLE, admin));
        assertTrue(registry.isCountryBlocked(COUNTRY_US));
        assertTrue(registry.isCountryBlocked(COUNTRY_TR));
        assertFalse(registry.isCountryBlocked(COUNTRY_DE));
        assertFalse(registry.isCountryBlocked(COUNTRY_AE));
    }

    function test_constructor_emitsCountryBlockStatusChanged() public {
        uint16[] memory blocked = new uint16[](2);
        blocked[0] = COUNTRY_US;
        blocked[1] = COUNTRY_TR;

        vm.expectEmit();
        emit IIdentityRegistry.CountryBlockStatusChanged(COUNTRY_US, true);
        vm.expectEmit();
        emit IIdentityRegistry.CountryBlockStatusChanged(COUNTRY_TR, true);
        IdentityRegistry fresh = new IdentityRegistry(admin, blocked);

        assertTrue(fresh.isCountryBlocked(COUNTRY_US));
        assertTrue(fresh.isCountryBlocked(COUNTRY_TR));
        assertFalse(fresh.hasRole(REGISTRAR_ROLE, admin));
    }

    function test_constructor_emptyBlocklist() public {
        IdentityRegistry fresh = new IdentityRegistry(admin, new uint16[](0));
        assertFalse(fresh.isCountryBlocked(COUNTRY_US));
        assertTrue(fresh.hasRole(DEFAULT_ADMIN_ROLE, admin));
    }

    function test_constructor_revertsZeroAddress() public {
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.ZeroAddress.selector));
        new IdentityRegistry(address(0), new uint16[](0));
    }

    function test_constructor_revertsInvalidCountry() public {
        uint16[] memory blocked = new uint16[](1);

        blocked[0] = 0;
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.InvalidCountry.selector, uint16(0)));
        new IdentityRegistry(admin, blocked);

        blocked[0] = 1000;
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.InvalidCountry.selector, uint16(1000)));
        new IdentityRegistry(admin, blocked);
    }

    function test_constants() public view {
        assertEq(registry.REGISTRAR_ROLE(), keccak256("REGISTRAR_ROLE"));
        assertEq(registry.INVESTOR_PROFESSIONAL(), 1);
        assertEq(registry.INVESTOR_RETAIL(), 2);
        assertEq(registry.MAX_COUNTRY(), 999);
        assertTrue(registry.hasRole(REGISTRAR_ROLE, registrar));
    }

    // ------------------------------------------------------------------ addVerified
    function test_addVerified_storesIdentityAndEmits() public {
        uint64 expectedAt = uint64(block.timestamp);

        vm.expectEmit(address(registry));
        emit IIdentityRegistry.IdentityVerified(alice, COUNTRY_DE, 1, expectedAt);
        vm.prank(registrar);
        registry.addVerified(alice, COUNTRY_DE, 1);

        assertTrue(registry.isVerified(alice));
        assertTrue(registry.canHold(alice));
        IIdentityRegistry.Identity memory id = registry.identityOf(alice);
        assertTrue(id.verified);
        assertEq(id.country, COUNTRY_DE);
        assertEq(id.investorType, 1);
        assertEq(id.verifiedAt, expectedAt);
    }

    function test_addVerified_reverifyOverwrites() public {
        _verify(alice, COUNTRY_DE);
        uint64 firstAt = registry.identityOf(alice).verifiedAt;

        vm.warp(block.timestamp + 3 days);
        vm.expectEmit(address(registry));
        emit IIdentityRegistry.IdentityVerified(alice, COUNTRY_AE, 1, uint64(block.timestamp));
        _verify(alice, COUNTRY_AE);

        IIdentityRegistry.Identity memory id = registry.identityOf(alice);
        assertTrue(id.verified);
        assertEq(id.country, COUNTRY_AE);
        assertEq(id.verifiedAt, firstAt + 3 days);
        assertTrue(registry.canHold(alice));
    }

    function test_addVerified_boundaryCountryCodes() public {
        _verify(alice, 1);
        assertEq(registry.identityOf(alice).country, 1);
        _verify(bob, 999);
        assertEq(registry.identityOf(bob).country, 999);
        assertTrue(registry.canHold(alice));
        assertTrue(registry.canHold(bob));
    }

    function test_addVerified_revertsNotRegistrar() public {
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.NotRegistrar.selector));
        vm.prank(stranger);
        registry.addVerified(alice, COUNTRY_DE, 1);

        // The admin is not a registrar by default either.
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.NotRegistrar.selector));
        vm.prank(admin);
        registry.addVerified(alice, COUNTRY_DE, 1);
    }

    function test_addVerified_revertsZeroAddress() public {
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.ZeroAddress.selector));
        vm.prank(registrar);
        registry.addVerified(address(0), COUNTRY_DE, 1);

        // Checked before the country: a zero account with an invalid country still reports ZeroAddress.
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.ZeroAddress.selector));
        vm.prank(registrar);
        registry.addVerified(address(0), 0, 1);
    }

    function test_addVerified_revertsInvalidCountry_zero() public {
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.InvalidCountry.selector, uint16(0)));
        vm.prank(registrar);
        registry.addVerified(alice, 0, 1);
        assertFalse(registry.isVerified(alice));
    }

    function test_addVerified_revertsInvalidCountry_1000() public {
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.InvalidCountry.selector, uint16(1000)));
        vm.prank(registrar);
        registry.addVerified(alice, 1000, 1);

        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.InvalidCountry.selector, type(uint16).max));
        vm.prank(registrar);
        registry.addVerified(alice, type(uint16).max, 1);
        assertFalse(registry.isVerified(alice));
    }

    function test_addVerified_revertsInvalidCountry_beforeInvestorType() public {
        // Country is validated before the investor type: retail with country 0 reports InvalidCountry.
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.InvalidCountry.selector, uint16(0)));
        vm.prank(registrar);
        registry.addVerified(alice, 0, 2);
    }

    function test_addVerified_revertsRetailNotAllowed() public {
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.RetailNotAllowed.selector));
        vm.prank(registrar);
        registry.addVerified(alice, COUNTRY_DE, 2);
    }

    function test_addVerified_revertsInvalidInvestorType_zero() public {
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.InvalidInvestorType.selector, uint8(0)));
        vm.prank(registrar);
        registry.addVerified(alice, COUNTRY_DE, 0);
    }

    function test_addVerified_revertsInvalidInvestorType_three() public {
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.InvalidInvestorType.selector, uint8(3)));
        vm.prank(registrar);
        registry.addVerified(alice, COUNTRY_DE, 3);
    }

    function test_addVerified_revertsCountryBlocked_US() public {
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.CountryBlocked.selector, COUNTRY_US));
        vm.prank(registrar);
        registry.addVerified(alice, COUNTRY_US, 1);
        assertFalse(registry.isVerified(alice));
    }

    function test_addVerified_revertsCountryBlocked_TR() public {
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.CountryBlocked.selector, COUNTRY_TR));
        vm.prank(registrar);
        registry.addVerified(alice, COUNTRY_TR, 1);
        assertFalse(registry.isVerified(alice));
    }

    // ------------------------------------------------------------------ removeVerified
    function test_removeVerified_deletesAndEmits() public {
        _verify(alice, COUNTRY_DE);

        vm.expectEmit(address(registry));
        emit IIdentityRegistry.IdentityRemoved(alice);
        vm.prank(registrar);
        registry.removeVerified(alice);

        assertFalse(registry.isVerified(alice));
        assertFalse(registry.canHold(alice));
        IIdentityRegistry.Identity memory id = registry.identityOf(alice);
        assertFalse(id.verified);
        assertEq(id.country, 0);
        assertEq(id.investorType, 0);
        assertEq(id.verifiedAt, 0);
    }

    function test_removeVerified_revertsNotVerified() public {
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.NotVerified.selector, alice));
        vm.prank(registrar);
        registry.removeVerified(alice);
    }

    function test_removeVerified_revertsNotVerified_afterRemoval() public {
        _verify(alice, COUNTRY_DE);
        vm.prank(registrar);
        registry.removeVerified(alice);

        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.NotVerified.selector, alice));
        vm.prank(registrar);
        registry.removeVerified(alice);
    }

    function test_removeVerified_revertsNotRegistrar() public {
        _verify(alice, COUNTRY_DE);
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.NotRegistrar.selector));
        vm.prank(stranger);
        registry.removeVerified(alice);
        assertTrue(registry.isVerified(alice));
    }

    // ------------------------------------------------------------------ setCountryBlocked
    function test_setCountryBlocked_adminOnly() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, DEFAULT_ADMIN_ROLE
            )
        );
        vm.prank(stranger);
        registry.setCountryBlocked(COUNTRY_DE, true);

        // Registrar role does not include blocklist management.
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, registrar, DEFAULT_ADMIN_ROLE
            )
        );
        vm.prank(registrar);
        registry.setCountryBlocked(COUNTRY_DE, true);

        assertFalse(registry.isCountryBlocked(COUNTRY_DE));
    }

    function test_setCountryBlocked_revertsInvalidCountry() public {
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.InvalidCountry.selector, uint16(0)));
        registry.setCountryBlocked(0, true);
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.InvalidCountry.selector, uint16(1000)));
        registry.setCountryBlocked(1000, true);
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.InvalidCountry.selector, uint16(0)));
        registry.setCountryBlocked(0, false);

        // The boundaries themselves are valid.
        registry.setCountryBlocked(1, true);
        registry.setCountryBlocked(999, true);
        vm.stopPrank();
        assertTrue(registry.isCountryBlocked(1));
        assertTrue(registry.isCountryBlocked(999));
        assertFalse(registry.isCountryBlocked(0));
        assertFalse(registry.isCountryBlocked(1000));
    }

    function test_setCountryBlocked_emitsAndFlipsCanHold() public {
        _verify(alice, COUNTRY_DE);
        assertTrue(registry.canHold(alice));

        vm.expectEmit(address(registry));
        emit IIdentityRegistry.CountryBlockStatusChanged(COUNTRY_DE, true);
        vm.prank(admin);
        registry.setCountryBlocked(COUNTRY_DE, true);

        // Verification record survives; only eligibility flips.
        assertTrue(registry.isCountryBlocked(COUNTRY_DE));
        assertTrue(registry.isVerified(alice));
        assertFalse(registry.canHold(alice));

        vm.expectEmit(address(registry));
        emit IIdentityRegistry.CountryBlockStatusChanged(COUNTRY_DE, false);
        vm.prank(admin);
        registry.setCountryBlocked(COUNTRY_DE, false);

        assertFalse(registry.isCountryBlocked(COUNTRY_DE));
        assertTrue(registry.canHold(alice));
    }

    function test_setCountryBlocked_unblockAllowsVerification() public {
        vm.prank(admin);
        registry.setCountryBlocked(COUNTRY_US, false);

        _verify(alice, COUNTRY_US);
        assertTrue(registry.canHold(alice));
    }

    function test_setCountryBlocked_blockedCountryHolderCannotHoldOthersUnaffected() public {
        _verify(alice, COUNTRY_DE);
        _verify(bob, COUNTRY_AE);

        vm.prank(admin);
        registry.setCountryBlocked(COUNTRY_DE, true);

        assertFalse(registry.canHold(alice));
        assertTrue(registry.canHold(bob));
    }

    // ------------------------------------------------------------------ views
    function test_views_unknownAccount() public view {
        assertFalse(registry.isVerified(stranger));
        assertFalse(registry.canHold(stranger));
        IIdentityRegistry.Identity memory id = registry.identityOf(stranger);
        assertFalse(id.verified);
        assertEq(id.verifiedAt, 0);
    }
}
