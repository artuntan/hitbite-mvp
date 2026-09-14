// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIdentityRegistry} from "./IIdentityRegistry.sol";

/// @title IHBToken — hbTRS (HitBite Türkiye Sovereign, Testnet)
/// @notice Whitelisted ERC-20 (18 decimals) with NAV-based subscription/redemption in USDC (6 decimals)
///         and pro-rata coupon pass-through via a cumulative index (no holder iteration).
/// @dev Units: `nav` is USDC (1e6) per 1e18 tokens, i.e. USDC per whole token.
///      tokens = usdc * 1e18 / nav ; usdc = tokens * nav / 1e18.
///      `couponIndex` is cumulative USDC (1e6) per whole token, scaled by 1e18.
///      Inputs (USDC amounts, token amounts, NAV, reported AUM) are bounded by MAX_INPUT = type(uint128).max so
///      that every intermediate product fits in uint256 and reverts are always custom errors, never Panic.
interface IHBToken {
    // ------------------------------------------------------------------ events
    /// @notice Emitted on every NAV change: oracle/admin updates AND the mechanical ex-distribution drop
    ///         applied by distributeCoupon (PLAN.md D26). Also emitted once by the constructor (genesis).
    event NAVUpdated(uint256 oldNav, uint256 newNav, uint256 reportedAUM, uint256 timestamp);
    /// @dev Emitted in addition to NAVUpdated when an admin bypasses the rail.
    event NAVForced(uint256 oldNav, uint256 newNav, address indexed by);
    /// @notice Subscription settled at `nav`.
    event Subscribed(address indexed account, uint256 usdcIn, uint256 tokensOut, uint256 nav);
    /// @notice Redemption settled at `nav`.
    event Redeemed(address indexed account, uint256 tokensIn, uint256 usdcOut, uint256 nav);
    /// @notice Coupon distributed. `usdcAmount` was pulled from the issuer; `usdcAllocated` (<= usdcAmount) is the
    ///         part attributable to holders after index truncation; the remainder stays as vault liquidity.
    event CouponDistributed(
        uint256 indexed distributionId,
        uint256 usdcAmount,
        uint256 usdcAllocated,
        uint256 couponIndex,
        uint256 totalSupply
    );
    /// @notice Coupon paid out to a holder.
    event CouponClaimed(address indexed account, uint256 usdcAmount);
    /// @notice Issuer operational mint (never used in production flows).
    event OperationalMint(address indexed to, uint256 amount);
    /// @notice Issuer operational burn (never used in production flows).
    event OperationalBurn(address indexed from, uint256 amount);
    /// @notice Rail width changed (also emitted once by the constructor).
    event MaxNavMoveBpsUpdated(uint256 oldBps, uint256 newBps);
    /// @notice Minimum subscription changed (also emitted once by the constructor).
    event MinSubscriptionUpdated(uint256 oldMin, uint256 newMin);

    // ------------------------------------------------------------------ errors
    /// @dev Account fails registry.canHold (unverified or blocked country).
    error NotEligible(address account);
    /// @dev NAV must be > 0 and <= MAX_INPUT.
    error InvalidNav();
    /// @dev Non-forced update would move NAV more than maxNavMoveBps away from the 24h window anchor.
    error NavMoveExceedsRail(uint256 anchorNav, uint256 newNav, uint256 maxBps);
    /// @dev bps > 10_000.
    error InvalidBps(uint256 bps);
    /// @dev Amount is zero, or the computed payout is zero.
    error ZeroAmount();
    /// @dev Subscription would mint zero tokens.
    error ZeroTokens();
    /// @dev Input exceeds MAX_INPUT (type(uint128).max).
    error AmountTooLarge(uint256 amount);
    /// @dev Subscription below the configured minimum.
    error BelowMinimum(uint256 minimum, uint256 given);
    /// @dev Redemption exceeds availableLiquidity() (vault USDC minus the coupon reserve).
    error InsufficientLiquidity(uint256 available, uint256 requested);
    /// @dev Distribution with no tokens outstanding.
    error NoSupply();
    /// @dev Distribution so small that the per-token index increment truncates to zero.
    error DistributionTooSmall(uint256 usdcAmount, uint256 minimum);
    /// @dev Distribution per token would be >= the current NAV per token.
    error DistributionExceedsNav(uint256 perToken, uint256 nav);
    /// @dev Nothing accrued for the caller.
    error NothingToClaim();
    /// @dev Zero address given for registry, usdc or admin.
    error ZeroAddress();

    // ------------------------------------------------------------------ constants / config
    /// @notice Role for mint, burn, distributeCoupon, pause, unpause.
    function ISSUER_ROLE() external view returns (bytes32);
    /// @notice Role for non-forced setNAV.
    function ORACLE_ROLE() external view returns (bytes32);
    /// @notice 1e6 (USDC decimals).
    function NAV_SCALE() external view returns (uint256);
    /// @notice 1e18 (token decimals).
    function TOKEN_SCALE() external view returns (uint256);
    /// @notice Upper bound for every amount/NAV input: type(uint128).max.
    function MAX_INPUT() external view returns (uint256);
    /// @notice Length of the NAV rail window (1 day).
    function RAIL_WINDOW() external view returns (uint64);
    /// @notice Identity registry consulted on mint and transfer.
    function registry() external view returns (IIdentityRegistry);
    /// @notice Settlement asset (6 decimals).
    function usdc() external view returns (address);
    /// @notice Current NAV in USDC (1e6) per whole token. 1_000_000 at deployment.
    function nav() external view returns (uint256);
    /// @notice Portfolio value reported by the oracle alongside NAV (USDC, 1e6). Illustrative on testnet.
    function reportedAUM() external view returns (uint256);
    /// @notice Timestamp of the last oracle/admin setNAV (not updated by distributions).
    function navUpdatedAt() external view returns (uint64);
    /// @notice Maximum cumulative NAV move per 24h window for non-forced updates, in bps (default 500).
    function maxNavMoveBps() external view returns (uint256);
    /// @notice NAV at the start of the current rail window (net of distribution drops).
    function railAnchorNav() external view returns (uint256);
    /// @notice Start timestamp of the current rail window.
    function railWindowStart() external view returns (uint64);
    /// @notice Minimum subscription in USDC (1e6); default 100e6.
    function minSubscription() external view returns (uint256);

    // ------------------------------------------------------------------ oracle / admin
    /// @notice Update NAV and reported AUM.
    /// @dev force=false: ORACLE_ROLE; reverts NavMoveExceedsRail if |newNav - railAnchorNav| exceeds
    ///      maxNavMoveBps. The anchor is the NAV at the start of the current 24h window, so consecutive
    ///      updates cannot compound past the rail within a window (PLAN.md D27).
    ///      force=true: DEFAULT_ADMIN_ROLE; bypasses the rail, emits NAVForced, and restarts the window
    ///      anchored at newNav. Works while paused. Reverts InvalidNav for 0 or > MAX_INPUT;
    ///      AmountTooLarge for newReportedAUM > MAX_INPUT.
    function setNAV(uint256 newNav, uint256 newReportedAUM, bool force) external;
    /// @notice Set the rail width in bps (<= 10_000). DEFAULT_ADMIN_ROLE.
    function setMaxNavMoveBps(uint256 bps) external;
    /// @notice Set the minimum subscription in USDC (1e6). DEFAULT_ADMIN_ROLE.
    function setMinSubscription(uint256 minUsdc) external;

    // ------------------------------------------------------------------ investor
    /// @notice Pull `usdcAmount` USDC (caller must have approved) and mint tokens at the current NAV.
    /// @dev Reverts ZeroAmount, AmountTooLarge, BelowMinimum, NotEligible, ZeroTokens; EnforcedPause when paused.
    function subscribe(uint256 usdcAmount) external returns (uint256 tokensOut);
    /// @notice Burn `tokenAmount` and pay USDC at the current NAV from available liquidity.
    /// @dev Allowed for de-verified holders (exit to cash, PLAN.md D4). Reverts ZeroAmount, AmountTooLarge,
    ///      InsufficientLiquidity, ERC20InsufficientBalance; EnforcedPause when paused.
    function redeem(uint256 tokenAmount) external returns (uint256 usdcOut);
    /// @notice Pay out the caller's accrued coupons. Allowed for de-verified holders.
    /// @dev Reverts NothingToClaim; EnforcedPause when paused.
    function claimCoupon() external returns (uint256 usdcPaid);

    // ------------------------------------------------------------------ issuer
    /// @notice Pull `usdcAmount` USDC from the issuer and credit holders pro-rata via the index.
    /// @dev Applies the mechanical ex-distribution NAV drop (nav -= per-token amount, PLAN.md D26) and emits
    ///      NAVUpdated. Reverts ZeroAmount, AmountTooLarge, NoSupply, DistributionTooSmall,
    ///      DistributionExceedsNav; EnforcedPause when paused.
    function distributeCoupon(uint256 usdcAmount) external returns (uint256 distributionId);
    /// @notice Operational correction: mint to an eligible account. Production uses only subscribe/redeem.
    function mint(address to, uint256 amount) external;
    /// @notice Operational correction: burn from any holder (no canHold check on burns, PLAN.md D4).
    function burn(address from, uint256 amount) external;
    /// @notice Pause transfers, mint, burn, subscribe, redeem, distributeCoupon and claimCoupon (PLAN.md D3).
    function pause() external;
    /// @notice Lift the pause.
    function unpause() external;

    // ------------------------------------------------------------------ views
    /// @notice Tokens minted for `usdcAmount` at the current NAV. Reverts AmountTooLarge above MAX_INPUT.
    function previewSubscribe(uint256 usdcAmount) external view returns (uint256 tokensOut);
    /// @notice USDC paid for `tokenAmount` at the current NAV. Reverts AmountTooLarge above MAX_INPUT.
    function previewRedeem(uint256 tokenAmount) external view returns (uint256 usdcOut);
    /// @notice Claimable USDC for `account` including the not-yet-settled part.
    function pendingCoupon(address account) external view returns (uint256);
    /// @notice Cumulative USDC per whole token scaled by 1e18.
    function couponIndex() external view returns (uint256);
    /// @notice Last settled index for `account`.
    function userIndex(address account) external view returns (uint256);
    /// @notice Settled, unclaimed USDC for `account`.
    function accrued(address account) external view returns (uint256);
    /// @notice Total USDC pulled from the issuer across all distributions.
    function totalDistributed() external view returns (uint256);
    /// @notice Total USDC attributed to holders (sum over distributions of increment * supply / 1e18).
    function totalAllocated() external view returns (uint256);
    /// @notice Total USDC paid out through claimCoupon.
    function totalClaimed() external view returns (uint256);
    /// @notice Number of distributions so far (the latest distributionId).
    function distributionCount() external view returns (uint256);
    /// @notice USDC held by the contract.
    function vaultBalance() external view returns (uint256);
    /// @notice totalAllocated - totalClaimed: USDC owed to holders; never available for redemptions.
    function couponReserve() external view returns (uint256);
    /// @notice vaultBalance() - couponReserve() (floored at 0); redemptions are limited to this.
    function availableLiquidity() external view returns (uint256);
    /// @notice (availableLiquidity + reportedAUM) * 1e18 / (totalSupply * nav / 1e18). Returns 1e18 when
    ///         liabilities round to zero (no supply, or dust below one micro-USDC). Illustrative on testnet.
    function supplyBackedRatio() external view returns (uint256);
}
