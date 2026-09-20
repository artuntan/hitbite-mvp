// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest, IdentityRegistry} from "./utils/BaseTest.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract RegistryTest is BaseTest {
    function testInitialCountriesBlocked() public {
        assertTrue(registry.isCountryBlocked(840));
        assertTrue(registry.isCountryBlocked(792));
        vm.expectRevert(abi.encodeWithSelector(IdentityRegistry.BlockedCountry.selector, 840));
        registry.addVerified(carol, 840);
        vm.expectRevert(abi.encodeWithSelector(IdentityRegistry.BlockedCountry.selector, 792));
        registry.addVerified(carol, 792);
    }

    function testVerifyRevokeAndCountryChange() public {
        registry.addVerified(carol, 826);
        assertTrue(registry.isVerified(carol));
        assertEq(registry.countryOf(carol), 826);
        registry.removeVerified(carol);
        assertFalse(registry.isVerified(carol));
        registry.addVerified(carol, 784);
        assertEq(registry.countryOf(carol), 784);
        registry.setCountryBlocked(784, true);
        assertFalse(registry.isVerified(carol));
        registry.setCountryBlocked(784, false);
        assertTrue(registry.isVerified(carol));
    }

    function testRegistrarRoleRequired() public {
        vm.startPrank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, keccak256("REGISTRAR_ROLE")
            )
        );
        registry.addVerified(carol, 250);
        vm.expectRevert();
        registry.removeVerified(bob);
        vm.expectRevert();
        registry.setCountryBlocked(840, false);
        vm.stopPrank();
    }

    function testZeroAccountsAndInvalidCountries() public {
        vm.expectRevert(IdentityRegistry.ZeroAddress.selector);
        registry.addVerified(address(0), 250);
        vm.expectRevert(IdentityRegistry.ZeroAddress.selector);
        registry.removeVerified(address(0));
        vm.expectRevert(abi.encodeWithSelector(IdentityRegistry.InvalidCountry.selector, 0));
        registry.addVerified(carol, 0);
        vm.expectRevert(abi.encodeWithSelector(IdentityRegistry.InvalidCountry.selector, 1000));
        registry.setCountryBlocked(1000, true);
        vm.expectRevert(IdentityRegistry.ZeroAddress.selector);
        new IdentityRegistry(address(0), address(this));
        vm.expectRevert(IdentityRegistry.ZeroAddress.selector);
        new IdentityRegistry(address(this), address(0));
    }
}
