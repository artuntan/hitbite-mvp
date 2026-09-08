// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIdentityRegistry} from "./IIdentityRegistry.sol";

/// @title IHBToken — hbTRS (HitBite Türkiye Sovereign, Testnet)
/// @notice Whitelisted ERC-20 (18 decimals) with NAV-based subscription/redemption in USDC (6 decimals)
///         and pro-rata coupon pass-through via a cumulative index (no holder iteration).
/// @dev Units: `nav` is USDC (1e6) per 1e18 tokens. tokens = usdc * 1e18 / nav ; usdc = tokens * nav / 1e18.
///      `couponIndex` is cumulative USDC (1e6) per token scaled by 1e18.
interface IHBToken {
    // ------------------------------------------------------------------ events
    event NAVUpdated(uint256 oldNav, uint256 newNav, uint256 reportedAUM, uint256 timestamp);
    /// @dev Emitted in addition to NAVUpdated when an admin bypasses the rail.
    event NAVForced(uint256 oldNav, uint256 newNav, address indexed by);
    event Subscribed(address indexed account, uint256 usdcIn, uint256 tokensOut, uint256 nav);
    event Redeemed(address indexed account, uint256 tokensIn, uint256 usdcOut, uint256 nav);
    event CouponDistributed(
        uint256 indexed distributionId, uint256 usdcAmount, uint256 couponIndex, uint256 totalSupply
    );
    event CouponClaimed(address indexed account, uint256 usdcAmount);
    event OperationalMint(address indexed to, uint256 amount);
    event OperationalBurn(address indexed from, uint256 amount);
    event MaxNavMoveBpsUpdated(uint256 oldBps, uint256 newBps);
    event MinSubscriptionUpdated(uint256 oldMin, uint256 newMin);

    // ------------------------------------------------------------------ errors
    /// @dev Account fails registry.canHold (unverified or blocked country).
    error NotEligible(address account);
    error InvalidNav();
    error NavMoveExceedsRail(uint256 oldNav, uint256 newNav, uint256 maxBps);
    error InvalidBps(uint256 bps);
    error ZeroAmount();
    error ZeroTokens();
    error BelowMinimum(uint256 minimum, uint256 given);
    error InsufficientLiquidity(uint256 available, uint256 requested);
    error NoSupply();
    error NothingToClaim();

    // ------------------------------------------------------------------ constants / config
    function ISSUER_ROLE() external view returns (bytes32);
    function ORACLE_ROLE() external view returns (bytes32);
    function NAV_SCALE() external view returns (uint256); // 1e6
    function TOKEN_SCALE() external view returns (uint256); // 1e18
    function registry() external view returns (IIdentityRegistry);
    function usdc() external view returns (address);
    function nav() external view returns (uint256);
    function reportedAUM() external view returns (uint256);
    function navUpdatedAt() external view returns (uint64);
    function maxNavMoveBps() external view returns (uint256); // default 500 (5%)
    function minSubscription() external view returns (uint256); // default 100e6

    // ------------------------------------------------------------------ oracle / admin
    /// @notice ORACLE_ROLE with force=false (rail enforced); DEFAULT_ADMIN_ROLE with force=true (rail bypassed,
    // NAVForced emitted).
    function setNAV(uint256 newNav, uint256 newReportedAUM, bool force) external;
    function setMaxNavMoveBps(uint256 bps) external; // admin, <= 10_000
    function setMinSubscription(uint256 minUsdc) external; // admin

    // ------------------------------------------------------------------ investor
    function subscribe(uint256 usdcAmount) external returns (uint256 tokensOut);
    function redeem(uint256 tokenAmount) external returns (uint256 usdcOut);
    function claimCoupon() external returns (uint256 usdcPaid);

    // ------------------------------------------------------------------ issuer
    function distributeCoupon(uint256 usdcAmount) external returns (uint256 distributionId);
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function pause() external;
    function unpause() external;

    // ------------------------------------------------------------------ views
    function previewSubscribe(uint256 usdcAmount) external view returns (uint256 tokensOut);
    function previewRedeem(uint256 tokenAmount) external view returns (uint256 usdcOut);
    function pendingCoupon(address account) external view returns (uint256);
    function couponIndex() external view returns (uint256);
    function totalDistributed() external view returns (uint256);
    function totalClaimed() external view returns (uint256);
    function distributionCount() external view returns (uint256);
    /// @notice USDC held by the contract.
    function vaultBalance() external view returns (uint256);
    /// @notice USDC distributed but not yet claimed; never available for redemptions.
    function couponReserve() external view returns (uint256);
    /// @notice vaultBalance() - couponReserve(); redemptions are limited to this.
    function availableLiquidity() external view returns (uint256);
    /// @notice (vaultBalance + reportedAUM) * 1e18 / (totalSupply * nav / 1e18); 1e18 when supply is 0. Illustrative on
    /// testnet.
    function supplyBackedRatio() external view returns (uint256);
}
