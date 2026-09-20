// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice Simulated testnet verification. No personal data is stored on-chain.
contract IdentityRegistry is AccessControl {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    mapping(address => bool) private verified;
    mapping(address => uint16) public countryOf;
    mapping(uint16 => bool) public isCountryBlocked;

    error ZeroAddress();
    error InvalidCountry(uint16 country);
    error BlockedCountry(uint16 country);
    event Verified(address indexed account, uint16 country);
    event Revoked(address indexed account);
    event CountryBlocked(uint16 code, bool blocked);

    constructor(address admin, address registrar) {
        if (admin == address(0) || registrar == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, registrar);
        _block(840, true);
        _block(792, true);
    }

    function addVerified(address account, uint16 country) external onlyRole(REGISTRAR_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        _validateCountry(country);
        if (isCountryBlocked[country]) revert BlockedCountry(country);
        countryOf[account] = country;
        verified[account] = true;
        emit Verified(account, country);
    }

    function removeVerified(address account) external onlyRole(REGISTRAR_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        verified[account] = false;
        emit Revoked(account);
    }

    function isVerified(address account) external view returns (bool) {
        return verified[account] && !isCountryBlocked[countryOf[account]];
    }

    function setCountryBlocked(uint16 country, bool blocked) external onlyRole(REGISTRAR_ROLE) {
        _validateCountry(country);
        _block(country, blocked);
    }

    function _block(uint16 country, bool blocked) private {
        isCountryBlocked[country] = blocked;
        emit CountryBlocked(country, blocked);
    }

    function _validateCountry(uint16 country) private pure {
        if (country == 0 || country > 999) revert InvalidCountry(country);
    }
}
