// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/// @title IdentityRegistry
/// @notice On-chain whitelist consulted by HBToken on every mint and transfer. Testnet reference implementation:
///         a REGISTRAR_ROLE key (the web app's simulated KYC worker) verifies accounts; DEFAULT_ADMIN_ROLE manages the
///         country blocklist. In production the licensed partner's KYC vendor writes to this registry.
/// @dev The blocklist is not a contract constant: it is passed to the constructor by the deployer
///      (`script/Deploy.s.sol` in Phase 3 passes `[840, 792]`: United States, US securities law; Türkiye, product
///      not offered to Turkish residents in phase one) and the admin can change it at any time with
///      `setCountryBlocked`. Country codes are ISO 3166-1 numeric and must be in 1..999 everywhere (constructor,
///      `addVerified`, `setCountryBlocked`): 0 is rejected because an unset country would otherwise escape the
///      blocklist. Only investorType 1 (professional) can be verified in phase one; 2 (retail) reverts
///      RetailNotAllowed (D21).
contract IdentityRegistry is IIdentityRegistry, AccessControl {
    // ------------------------------------------------------------------ constants
    /// @inheritdoc IIdentityRegistry
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    /// @inheritdoc IIdentityRegistry
    uint8 public constant INVESTOR_PROFESSIONAL = 1;
    /// @inheritdoc IIdentityRegistry
    uint8 public constant INVESTOR_RETAIL = 2;
    /// @notice Largest valid ISO 3166-1 numeric code (codes are 001..999).
    uint16 public constant MAX_COUNTRY = 999;

    // ------------------------------------------------------------------ storage
    mapping(address account => Identity identity) private _identities;
    mapping(uint16 country => bool blocked) private _blockedCountries;

    // ------------------------------------------------------------------ modifiers
    /// @dev Reverts NotRegistrar() (the registry's own error, not the OpenZeppelin one) for non-registrars.
    modifier onlyRegistrar() {
        _checkRegistrar();
        _;
    }

    // ------------------------------------------------------------------ constructor
    /// @notice Deploys the registry, grants DEFAULT_ADMIN_ROLE to `admin` and blocks each country in
    ///         `blockedCountries` (emitting CountryBlockStatusChanged for each).
    /// @dev Reverts ZeroAddress for a zero admin and InvalidCountry for any code outside 1..999.
    /// @param admin Receives DEFAULT_ADMIN_ROLE (manages the blocklist and grants REGISTRAR_ROLE).
    /// @param blockedCountries ISO 3166-1 numeric codes blocked at deployment (the deploy script passes 840, 792).
    constructor(address admin, uint16[] memory blockedCountries) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        uint256 length = blockedCountries.length;
        for (uint256 i = 0; i < length; ++i) {
            _setCountryBlocked(blockedCountries[i], true);
        }
    }

    // ------------------------------------------------------------------ registrar
    /// @inheritdoc IIdentityRegistry
    /// @dev Checks in order: ZeroAddress, InvalidCountry(country) outside 1..999, RetailNotAllowed,
    ///      InvalidInvestorType(investorType), CountryBlocked(country). Overwrites any existing record
    ///      (re-verification). `verifiedAt` is set to the current block timestamp.
    function addVerified(address account, uint16 country, uint8 investorType) external onlyRegistrar {
        if (account == address(0)) revert ZeroAddress();
        _checkCountry(country);
        if (investorType == INVESTOR_RETAIL) revert RetailNotAllowed();
        if (investorType != INVESTOR_PROFESSIONAL) revert InvalidInvestorType(investorType);
        if (_blockedCountries[country]) revert CountryBlocked(country);

        uint64 verifiedAt = SafeCast.toUint64(block.timestamp);
        _identities[account] =
            Identity({verified: true, country: country, investorType: investorType, verifiedAt: verifiedAt});
        emit IdentityVerified(account, country, investorType, verifiedAt);
    }

    /// @inheritdoc IIdentityRegistry
    function removeVerified(address account) external onlyRegistrar {
        if (!_identities[account].verified) revert NotVerified(account);
        delete _identities[account];
        emit IdentityRemoved(account);
    }

    // ------------------------------------------------------------------ admin
    /// @inheritdoc IIdentityRegistry
    /// @dev DEFAULT_ADMIN_ROLE only (reverts with OpenZeppelin's AccessControlUnauthorizedAccount). Reverts
    ///      InvalidCountry(country) outside 1..999. Blocking a country after verification does not delete the
    ///      record, but `canHold` becomes false for its holders.
    function setCountryBlocked(uint16 country, bool blocked) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setCountryBlocked(country, blocked);
    }

    // ------------------------------------------------------------------ views
    /// @inheritdoc IIdentityRegistry
    function isVerified(address account) external view returns (bool) {
        return _identities[account].verified;
    }

    /// @inheritdoc IIdentityRegistry
    function identityOf(address account) external view returns (Identity memory) {
        return _identities[account];
    }

    /// @inheritdoc IIdentityRegistry
    function canHold(address account) external view returns (bool) {
        Identity storage identity = _identities[account];
        return identity.verified && !_blockedCountries[identity.country];
    }

    /// @inheritdoc IIdentityRegistry
    function isCountryBlocked(uint16 country) external view returns (bool) {
        return _blockedCountries[country];
    }

    // ------------------------------------------------------------------ internal
    /// @dev Validates the code, then writes and emits. Shared by the constructor and `setCountryBlocked`.
    function _setCountryBlocked(uint16 country, bool blocked) internal {
        _checkCountry(country);
        _blockedCountries[country] = blocked;
        emit CountryBlockStatusChanged(country, blocked);
    }

    /// @dev ISO 3166-1 numeric codes are 001..999. Also reached from the constructor loop: an invalid code in the
    ///      deployer's blocklist must fail the whole deployment rather than be skipped silently.
    function _checkCountry(uint16 country) internal pure {
        // forge-lint: disable-next-line(require-revert-in-loop)
        if (country == 0 || country > MAX_COUNTRY) revert InvalidCountry(country);
    }

    function _checkRegistrar() internal view {
        if (!hasRole(REGISTRAR_ROLE, _msgSender())) revert NotRegistrar();
    }
}
