// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IIdentityRegistry
/// @notice On-chain whitelist consulted by HBToken on every mint and transfer.
/// @dev Testnet reference implementation. In production the licensed partner's KYC vendor writes to this
///      registry. Country codes are ISO 3166-1 numeric (1..999); 0 is rejected because it would escape the
///      country blocklist.
interface IIdentityRegistry {
    /// @dev investorType: 1 = professional, 2 = retail (retail cannot be verified in phase one).
    struct Identity {
        bool verified;
        uint16 country; // ISO 3166-1 numeric
        uint8 investorType;
        uint64 verifiedAt;
    }

    // ------------------------------------------------------------------ events
    /// @notice Emitted when an account is verified or re-verified (overwrite).
    event IdentityVerified(address indexed account, uint16 indexed country, uint8 investorType, uint64 verifiedAt);
    /// @notice Emitted when an account's verification is removed.
    event IdentityRemoved(address indexed account);
    /// @notice Emitted when a country is blocked or unblocked (also from the constructor).
    event CountryBlockStatusChanged(uint16 indexed country, bool blocked);

    // ------------------------------------------------------------------ errors
    /// @dev Caller lacks REGISTRAR_ROLE.
    error NotRegistrar();
    /// @dev The country is on the blocklist.
    error CountryBlocked(uint16 country);
    /// @dev Retail investors (type 2) cannot be verified in phase one.
    error RetailNotAllowed();
    /// @dev investorType is neither 1 nor 2.
    error InvalidInvestorType(uint8 investorType);
    /// @dev Country code outside 1..999 (ISO 3166-1 numeric).
    error InvalidCountry(uint16 country);
    /// @dev Account is not currently verified.
    error NotVerified(address account);
    /// @dev Zero address given where an account or admin is required.
    error ZeroAddress();

    // ------------------------------------------------------------------ constants
    /// @notice Role allowed to add and remove verifications.
    function REGISTRAR_ROLE() external view returns (bytes32);
    /// @notice investorType value for professional investors (1).
    function INVESTOR_PROFESSIONAL() external view returns (uint8);
    /// @notice investorType value for retail investors (2); not verifiable in phase one.
    function INVESTOR_RETAIL() external view returns (uint8);

    // ------------------------------------------------------------------ registrar
    /// @notice Verify (or re-verify, overwriting) an account.
    /// @dev Reverts ZeroAddress, InvalidCountry, CountryBlocked, RetailNotAllowed or InvalidInvestorType.
    /// @param account The wallet to verify.
    /// @param country ISO 3166-1 numeric country code (1..999).
    /// @param investorType 1 = professional (only value accepted in phase one).
    function addVerified(address account, uint16 country, uint8 investorType) external;
    /// @notice Remove an account's verification.
    /// @dev Reverts NotVerified if the account is not verified.
    function removeVerified(address account) external;

    // ------------------------------------------------------------------ admin
    /// @notice Block or unblock a country. DEFAULT_ADMIN_ROLE only. Affects canHold of existing holders.
    function setCountryBlocked(uint16 country, bool blocked) external;

    // ------------------------------------------------------------------ views
    /// @notice True if the account is currently verified (regardless of country block status).
    function isVerified(address account) external view returns (bool);
    /// @notice Full identity record for an account.
    function identityOf(address account) external view returns (Identity memory);
    /// @notice True if verified AND the account's country is not currently blocked.
    function canHold(address account) external view returns (bool);
    /// @notice True if the country is currently blocked.
    function isCountryBlocked(uint16 country) external view returns (bool);
}
