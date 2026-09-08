// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IIdentityRegistry
/// @notice On-chain whitelist consulted by HBToken on every mint and transfer.
/// @dev Testnet reference implementation. In production the licensed partner's KYC vendor writes to this registry.
interface IIdentityRegistry {
    /// @dev investorType: 1 = professional, 2 = retail (retail cannot be verified in phase one).
    struct Identity {
        bool verified;
        uint16 country; // ISO 3166-1 numeric
        uint8 investorType;
        uint64 verifiedAt;
    }

    // ------------------------------------------------------------------ events
    event IdentityVerified(address indexed account, uint16 indexed country, uint8 investorType, uint64 verifiedAt);
    event IdentityRemoved(address indexed account);
    event CountryBlockStatusChanged(uint16 indexed country, bool blocked);

    // ------------------------------------------------------------------ errors
    error NotRegistrar();
    error CountryBlocked(uint16 country);
    error RetailNotAllowed();
    error InvalidInvestorType(uint8 investorType);
    error NotVerified(address account);
    error ZeroAddress();

    // ------------------------------------------------------------------ constants
    function REGISTRAR_ROLE() external view returns (bytes32);
    function INVESTOR_PROFESSIONAL() external view returns (uint8);
    function INVESTOR_RETAIL() external view returns (uint8);

    // ------------------------------------------------------------------ registrar
    /// @notice Verify (or re-verify, overwriting) an account. Reverts CountryBlocked / RetailNotAllowed /
    // InvalidInvestorType.
    function addVerified(address account, uint16 country, uint8 investorType) external;
    /// @notice Remove verification. Reverts NotVerified if the account is not verified.
    function removeVerified(address account) external;

    // ------------------------------------------------------------------ admin
    function setCountryBlocked(uint16 country, bool blocked) external;

    // ------------------------------------------------------------------ views
    function isVerified(address account) external view returns (bool);
    function identityOf(address account) external view returns (Identity memory);
    /// @notice verified AND country not currently blocked.
    function canHold(address account) external view returns (bool);
    function isCountryBlocked(uint16 country) external view returns (bool);
}
