// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IHBToken} from "./interfaces/IHBToken.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/// @title HBToken — hbTRS (HitBite Türkiye Sovereign, Testnet)
/// @notice Whitelisted ERC-20 (18 decimals) with NAV-based subscription and redemption in USDC (6 decimals) and
///         pro-rata coupon pass-through via a cumulative index. Testnet demonstration; simulated portfolio; not an
///         offer of securities.
/// @dev Design decisions (numbered as in PLAN.md):
///      - D3 Pause: `pause()` blocks transfer, mint, burn, subscribe, redeem, distributeCoupon and claimCoupon.
///        Issuer burns are not exempt (unpause, correct, re-pause). `setNAV` keeps working while paused.
///      - D4 Burns and `canHold(from)`: `_update` requires `registry.canHold(to)` for every mint and transfer and
///        `registry.canHold(from)` for transfers, but not for burns. A de-verified or newly blocked holder can still
///        redeem (exit to cash), still claim accrued coupons, and can be force-burned by the issuer. Receiving is the
///        restriction that matters; trapping funds is never desirable.
///      - D5 / D27 NAV rail window: non-forced oracle updates are checked against `railAnchorNav`, the NAV at the
///        start of the current `RAIL_WINDOW` (24 h), so chained in-rail updates cannot compound past
///        `maxNavMoveBps` within a window. A forced admin update bypasses the rail, emits `NAVForced` and restarts
///        the window anchored at the new NAV.
///      - D6 / D29 Redemption liquidity: coupon money is never used for redemptions. `couponReserve()` is
///        `totalAllocated - totalClaimed` and `availableLiquidity()` is the vault balance minus that reserve;
///        `redeem` reverts `InsufficientLiquidity(available, requested)` against available liquidity.
///      - D26 Ex-distribution NAV drop: `distributeCoupon` lowers `nav` by the per-token amount it distributes and
///        `reportedAUM` by the USDC pulled (both floored so they never reach zero / go negative), emitting
///        `NAVUpdated`, exactly as a fund's NAV drops on the ex-distribution date. Without it a wallet could
///        subscribe just before a distribution, claim, and redeem at an unchanged NAV. The rail anchor is reduced
///        by the same per-token amount so distributions never consume the oracle's rail budget.
///      - D28 Input bounds: every amount, NAV and reported-AUM input is bounded by `MAX_INPUT` (type(uint128).max)
///        and rejected with `AmountTooLarge` / `InvalidNav`. `totalSupply()` is assumed to stay below 2^128 (each
///        operational mint is bounded by `MAX_INPUT`; subscriptions mint at most `MAX_INPUT * 1e18 / nav`). Under
///        these bounds every product in this contract fits in uint256 and no revert is a `Panic`.
///
///      Invariant (D6): `usdc.balanceOf(this) >= sum over holders of pendingCoupon(holder)`. `pendingCoupon`
///      already includes the settled `accrued` part. It holds because (a) redemptions are limited to
///      `availableLiquidity()`, (b) `couponReserve()` never underflows and always covers what holders can still
///      claim: each distribution allocates `ceil(perToken * supply / 1e18)` (rounded UP, at most `usdcAmount`),
///      and the sum of every holder's `floor(balance * indexDelta / 1e18)` over any settlement schedule is at most
///      `sum(perToken * supply / 1e18)` exactly (the real number), hence at most `totalAllocated`.
///
///      Coupon dust (D29): `perToken = usdcAmount * 1e18 / supply` truncates, so up to `ceil(supply / 1e18) - 1`
///      USDC units per distribution are never allocated; that remainder is ordinary vault liquidity (it is not in
///      `couponReserve()`). Per-holder settlement truncates less than one USDC unit per holder per settlement; that
///      dust stays inside the reserve, so after every holder has claimed `couponReserve()` is at most the number of
///      holders (in USDC units) and is never redeemable.
///
///      Production uses only `subscribe` and `redeem`. `mint` and `burn` exist for operational corrections by the
///      issuer (for example reversing a mistaken subscription) and emit dedicated events so they are auditable.
contract HBToken is IHBToken, ERC20, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ constants
    /// @inheritdoc IHBToken
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    /// @inheritdoc IHBToken
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    /// @inheritdoc IHBToken
    uint256 public constant NAV_SCALE = 1e6;
    /// @inheritdoc IHBToken
    uint256 public constant TOKEN_SCALE = 1e18;
    /// @inheritdoc IHBToken
    uint256 public constant MAX_INPUT = type(uint128).max;
    /// @inheritdoc IHBToken
    uint64 public constant RAIL_WINDOW = 1 days;
    /// @notice Basis-point denominator (100%).
    uint256 public constant MAX_BPS = 10_000;
    /// @notice Rail width at deployment: 500 bps (5% per 24 h window).
    uint256 public constant DEFAULT_MAX_NAV_MOVE_BPS = 500;
    /// @notice Minimum subscription at deployment: 100 USDC (6 decimals).
    uint256 public constant DEFAULT_MIN_SUBSCRIPTION = 100e6;

    // ------------------------------------------------------------------ immutables
    IIdentityRegistry private immutable REGISTRY;
    IERC20 private immutable USDC;

    // ------------------------------------------------------------------ NAV state
    /// @inheritdoc IHBToken
    uint256 public nav;
    /// @inheritdoc IHBToken
    uint256 public reportedAUM;
    /// @inheritdoc IHBToken
    uint64 public navUpdatedAt;
    /// @inheritdoc IHBToken
    uint256 public maxNavMoveBps;
    /// @inheritdoc IHBToken
    uint256 public railAnchorNav;
    /// @inheritdoc IHBToken
    uint64 public railWindowStart;
    /// @inheritdoc IHBToken
    uint256 public minSubscription;

    // ------------------------------------------------------------------ coupon state
    /// @inheritdoc IHBToken
    uint256 public couponIndex;
    /// @inheritdoc IHBToken
    mapping(address account => uint256 index) public userIndex;
    /// @inheritdoc IHBToken
    mapping(address account => uint256 usdcAmount) public accrued;
    /// @inheritdoc IHBToken
    uint256 public totalDistributed;
    /// @inheritdoc IHBToken
    uint256 public totalAllocated;
    /// @inheritdoc IHBToken
    uint256 public totalClaimed;
    /// @inheritdoc IHBToken
    uint256 public distributionCount;

    // ------------------------------------------------------------------ constructor
    /// @notice Deploys hbTRS at NAV 1.000000 with the default rail (5% per 24 h window) and minimum subscription
    ///         (100 USDC). Emits the genesis `NAVUpdated(0, 1_000_000, 0, now)`, `MaxNavMoveBpsUpdated(0, 500)` and
    ///         `MinSubscriptionUpdated(0, 100e6)` so indexers see every configuration value from block one.
    /// @dev Only DEFAULT_ADMIN_ROLE is granted here; ISSUER_ROLE and ORACLE_ROLE are granted by the admin
    ///      (deploy script) afterwards. Reverts ZeroAddress if any address is zero.
    /// @param registry_ Whitelist consulted on every mint and transfer.
    /// @param usdc_ Settlement asset (6 decimals).
    /// @param admin Receives DEFAULT_ADMIN_ROLE.
    constructor(IIdentityRegistry registry_, IERC20 usdc_, address admin)
        ERC20(unicode"HitBite Türkiye Sovereign (Testnet)", "hbTRS")
    {
        if (address(registry_) == address(0)) revert ZeroAddress();
        if (address(usdc_) == address(0)) revert ZeroAddress();
        if (admin == address(0)) revert ZeroAddress();
        REGISTRY = registry_;
        USDC = usdc_;

        uint64 nowTs = SafeCast.toUint64(block.timestamp);
        nav = NAV_SCALE;
        navUpdatedAt = nowTs;
        railAnchorNav = NAV_SCALE;
        railWindowStart = nowTs;
        maxNavMoveBps = DEFAULT_MAX_NAV_MOVE_BPS;
        minSubscription = DEFAULT_MIN_SUBSCRIPTION;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        emit NAVUpdated(0, NAV_SCALE, 0, block.timestamp);
        emit MaxNavMoveBpsUpdated(0, DEFAULT_MAX_NAV_MOVE_BPS);
        emit MinSubscriptionUpdated(0, DEFAULT_MIN_SUBSCRIPTION);
    }

    // ------------------------------------------------------------------ oracle / admin
    /// @inheritdoc IHBToken
    /// @dev Works while paused (D3). Order of checks: InvalidNav (0 or > MAX_INPUT), AmountTooLarge
    ///      (newReportedAUM > MAX_INPUT), then the role check. With `force = false` (ORACLE_ROLE) the window is
    ///      rolled first if `RAIL_WINDOW` has elapsed since `railWindowStart` (anchor := current nav), then
    ///      |newNav - railAnchorNav| * 10_000 must be <= railAnchorNav * maxNavMoveBps, otherwise
    ///      NavMoveExceedsRail(railAnchorNav, newNav, maxNavMoveBps) (D27). With `force = true`
    ///      (DEFAULT_ADMIN_ROLE) the rail is skipped, the window restarts anchored at `newNav`, and NAVForced is
    ///      emitted after NAVUpdated (D5).
    function setNAV(uint256 newNav, uint256 newReportedAUM, bool force) external {
        if (newNav == 0 || newNav > MAX_INPUT) revert InvalidNav();
        if (newReportedAUM > MAX_INPUT) revert AmountTooLarge(newReportedAUM);
        uint256 oldNav = nav;
        uint64 nowTs = SafeCast.toUint64(block.timestamp);
        if (force) {
            _checkRole(DEFAULT_ADMIN_ROLE);
            railAnchorNav = newNav;
            railWindowStart = nowTs;
        } else {
            _checkRole(ORACLE_ROLE);
            // The rail window is a 24 h period by definition; a few seconds of validator drift only move the
            // instant at which the anchor refreshes and can never widen the per-window band.
            // forge-lint: disable-next-line(block-timestamp)
            if (block.timestamp >= uint256(railWindowStart) + RAIL_WINDOW) {
                railAnchorNav = oldNav;
                railWindowStart = nowTs;
            }
            uint256 anchor = railAnchorNav;
            uint256 delta = newNav > anchor ? newNav - anchor : anchor - newNav;
            if (delta * MAX_BPS > anchor * maxNavMoveBps) revert NavMoveExceedsRail(anchor, newNav, maxNavMoveBps);
        }
        nav = newNav;
        reportedAUM = newReportedAUM;
        navUpdatedAt = nowTs;
        emit NAVUpdated(oldNav, newNav, newReportedAUM, block.timestamp);
        if (force) emit NAVForced(oldNav, newNav, _msgSender());
    }

    /// @inheritdoc IHBToken
    /// @dev DEFAULT_ADMIN_ROLE. Reverts InvalidBps(bps) above 10_000.
    function setMaxNavMoveBps(uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps > MAX_BPS) revert InvalidBps(bps);
        emit MaxNavMoveBpsUpdated(maxNavMoveBps, bps);
        maxNavMoveBps = bps;
    }

    /// @inheritdoc IHBToken
    /// @dev DEFAULT_ADMIN_ROLE. `minUsdc` is in 6-decimal units; zero disables the minimum.
    function setMinSubscription(uint256 minUsdc) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit MinSubscriptionUpdated(minSubscription, minUsdc);
        minSubscription = minUsdc;
    }

    // ------------------------------------------------------------------ investor
    /// @inheritdoc IHBToken
    /// @dev tokens = usdcAmount * 1e18 / nav. Checks in order: ZeroAmount, AmountTooLarge(usdcAmount) above
    ///      MAX_INPUT, BelowMinimum(minSubscription, usdcAmount), NotEligible(caller) when the registry says the
    ///      caller cannot hold, ZeroTokens when the amount rounds to nothing. Caller must have approved this
    ///      contract for `usdcAmount` USDC (ERC20InsufficientAllowance otherwise).
    function subscribe(uint256 usdcAmount) external nonReentrant whenNotPaused returns (uint256 tokensOut) {
        if (usdcAmount == 0) revert ZeroAmount();
        if (usdcAmount > MAX_INPUT) revert AmountTooLarge(usdcAmount);
        if (usdcAmount < minSubscription) revert BelowMinimum(minSubscription, usdcAmount);
        if (!REGISTRY.canHold(_msgSender())) revert NotEligible(_msgSender());
        tokensOut = usdcAmount * TOKEN_SCALE / nav;
        if (tokensOut == 0) revert ZeroTokens();

        USDC.safeTransferFrom(_msgSender(), address(this), usdcAmount);
        _mint(_msgSender(), tokensOut);
        emit Subscribed(_msgSender(), usdcAmount, tokensOut, nav);
    }

    /// @inheritdoc IHBToken
    /// @dev usdcOut = tokenAmount * nav / 1e18. Checks in order: ZeroAmount when `tokenAmount` is zero,
    ///      AmountTooLarge(tokenAmount) above MAX_INPUT, ZeroAmount when the payout rounds to zero USDC,
    ///      InsufficientLiquidity(available, usdcOut) when the vault minus the coupon reserve cannot cover it (D6),
    ///      then ERC20InsufficientBalance from the burn when the caller holds fewer tokens. Allowed for de-verified
    ///      holders (D4): a burn does not check `canHold(from)`.
    function redeem(uint256 tokenAmount) external nonReentrant whenNotPaused returns (uint256 usdcOut) {
        if (tokenAmount == 0) revert ZeroAmount();
        if (tokenAmount > MAX_INPUT) revert AmountTooLarge(tokenAmount);
        usdcOut = tokenAmount * nav / TOKEN_SCALE;
        if (usdcOut == 0) revert ZeroAmount();
        uint256 available = availableLiquidity();
        if (usdcOut > available) revert InsufficientLiquidity(available, usdcOut);

        _burn(_msgSender(), tokenAmount);
        USDC.safeTransfer(_msgSender(), usdcOut);
        emit Redeemed(_msgSender(), tokenAmount, usdcOut, nav);
    }

    /// @inheritdoc IHBToken
    /// @dev Settles the caller against the current index, then pays everything accrued. Reverts NothingToClaim when
    ///      nothing is owed. Allowed for de-verified holders (D4).
    function claimCoupon() external nonReentrant whenNotPaused returns (uint256 usdcPaid) {
        _settle(_msgSender());
        usdcPaid = accrued[_msgSender()];
        if (usdcPaid == 0) revert NothingToClaim();
        accrued[_msgSender()] = 0;
        totalClaimed += usdcPaid;

        USDC.safeTransfer(_msgSender(), usdcPaid);
        emit CouponClaimed(_msgSender(), usdcPaid);
    }

    // ------------------------------------------------------------------ issuer
    /// @inheritdoc IHBToken
    /// @dev ISSUER_ROLE. Checks in order: ZeroAmount, AmountTooLarge(usdcAmount) above MAX_INPUT; then the USDC is
    ///      pulled (the only external call, made before `totalSupply()` is read so a settlement asset with transfer
    ///      hooks cannot observe a half-computed distribution; the function is also nonReentrant); then NoSupply,
    ///      DistributionTooSmall(usdcAmount, ceil(supply / 1e18)) when `perToken = usdcAmount * 1e18 / supply`
    ///      truncates to zero, DistributionExceedsNav(perToken, nav) when `perToken >= nav`. Effects: couponIndex
    ///      += perToken; totalAllocated += ceil(perToken * supply / 1e18) (rounded up so the reserve always covers
    ///      every holder's floor-rounded share; never more than usdcAmount); nav -= perToken; railAnchorNav -=
    ///      perToken floored at 1 (an anchor of 1 freezes the oracle until the window rolls or the admin forces a
    ///      NAV, which only happens when a single coupon exceeds the window-start NAV); reportedAUM -= usdcAmount
    ///      floored at 0. `navUpdatedAt` is not touched. Blocked while paused (D3, D24). Holders are not iterated;
    ///      each account settles lazily on its next transfer, claim or `pendingCoupon`.
    function distributeCoupon(uint256 usdcAmount)
        external
        nonReentrant
        onlyRole(ISSUER_ROLE)
        whenNotPaused
        returns (uint256 distributionId)
    {
        if (usdcAmount == 0) revert ZeroAmount();
        if (usdcAmount > MAX_INPUT) revert AmountTooLarge(usdcAmount);

        USDC.safeTransferFrom(_msgSender(), address(this), usdcAmount);

        uint256 supply = totalSupply();
        if (supply == 0) revert NoSupply();
        uint256 perToken = usdcAmount * TOKEN_SCALE / supply;
        if (perToken == 0) revert DistributionTooSmall(usdcAmount, (supply + TOKEN_SCALE - 1) / TOKEN_SCALE);
        uint256 oldNav = nav;
        if (perToken >= oldNav) revert DistributionExceedsNav(perToken, oldNav);
        // The allocation must be computed from the truncated per-token increment, because that increment (not the
        // exact ratio) is what every holder is settled against; rounding up keeps the reserve >= every claim.
        // forge-lint: disable-next-line(divide-before-multiply)
        uint256 allocated = (perToken * supply + TOKEN_SCALE - 1) / TOKEN_SCALE;

        couponIndex += perToken;
        totalDistributed += usdcAmount;
        totalAllocated += allocated;
        distributionId = ++distributionCount;

        uint256 newNav = oldNav - perToken;
        nav = newNav;
        uint256 anchor = railAnchorNav;
        railAnchorNav = anchor > perToken ? anchor - perToken : 1;
        uint256 oldAum = reportedAUM;
        uint256 newAum = oldAum > usdcAmount ? oldAum - usdcAmount : 0;
        reportedAUM = newAum;

        emit CouponDistributed(distributionId, usdcAmount, allocated, couponIndex, supply);
        emit NAVUpdated(oldNav, newNav, newAum, block.timestamp);
    }

    /// @inheritdoc IHBToken
    /// @dev ISSUER_ROLE. Operational correction only; production issuance goes through `subscribe`. Reverts
    ///      AmountTooLarge(amount) above MAX_INPUT (bounds supply growth per call). Pause and `canHold(to)` are
    ///      enforced by `_update`.
    function mint(address to, uint256 amount) external onlyRole(ISSUER_ROLE) {
        if (amount > MAX_INPUT) revert AmountTooLarge(amount);
        _mint(to, amount);
        emit OperationalMint(to, amount);
    }

    /// @inheritdoc IHBToken
    /// @dev ISSUER_ROLE. Operational correction only; production exit goes through `redeem`. Works for de-verified
    ///      holders (D4) but not while paused (D3). Reverts ERC20InsufficientBalance above the holder's balance.
    function burn(address from, uint256 amount) external onlyRole(ISSUER_ROLE) {
        _burn(from, amount);
        emit OperationalBurn(from, amount);
    }

    /// @inheritdoc IHBToken
    /// @dev ISSUER_ROLE. See D3 for what is blocked.
    function pause() external onlyRole(ISSUER_ROLE) {
        _pause();
    }

    /// @inheritdoc IHBToken
    /// @dev ISSUER_ROLE.
    function unpause() external onlyRole(ISSUER_ROLE) {
        _unpause();
    }

    // ------------------------------------------------------------------ views
    /// @inheritdoc IHBToken
    function registry() external view returns (IIdentityRegistry) {
        return REGISTRY;
    }

    /// @inheritdoc IHBToken
    function usdc() external view returns (address) {
        return address(USDC);
    }

    /// @inheritdoc IHBToken
    function previewSubscribe(uint256 usdcAmount) external view returns (uint256 tokensOut) {
        if (usdcAmount > MAX_INPUT) revert AmountTooLarge(usdcAmount);
        return usdcAmount * TOKEN_SCALE / nav;
    }

    /// @inheritdoc IHBToken
    function previewRedeem(uint256 tokenAmount) external view returns (uint256 usdcOut) {
        if (tokenAmount > MAX_INPUT) revert AmountTooLarge(tokenAmount);
        return tokenAmount * nav / TOKEN_SCALE;
    }

    /// @inheritdoc IHBToken
    /// @dev accrued + balance * (couponIndex - userIndex) / 1e18; equals what `claimCoupon` would pay now.
    function pendingCoupon(address account) external view returns (uint256) {
        return accrued[account] + balanceOf(account) * (couponIndex - userIndex[account]) / TOKEN_SCALE;
    }

    /// @inheritdoc IHBToken
    function vaultBalance() public view returns (uint256) {
        return USDC.balanceOf(address(this));
    }

    /// @inheritdoc IHBToken
    /// @dev Never underflows: `totalAllocated` rounds every distribution up, and the sum of all floor-rounded holder
    ///      shares can never exceed the exact allocation (see the contract-level invariant note).
    function couponReserve() public view returns (uint256) {
        return totalAllocated - totalClaimed;
    }

    /// @inheritdoc IHBToken
    function availableLiquidity() public view returns (uint256) {
        uint256 vault = vaultBalance();
        uint256 reserve = couponReserve();
        return vault > reserve ? vault - reserve : 0;
    }

    /// @inheritdoc IHBToken
    /// @dev Illustrative on testnet (D20): subscription USDC sits in the vault while the portfolio is simulated.
    ///      The coupon reserve is owed to holders and is excluded from the numerator, so an unclaimed distribution
    ///      never inflates the ratio. Returns 1e18 when liabilities round to zero: no supply, or a dust supply below
    ///      `1e18 / nav` wei whose value is less than one USDC unit.
    function supplyBackedRatio() external view returns (uint256) {
        uint256 liabilities = totalSupply() * nav / TOKEN_SCALE;
        if (liabilities == 0) return TOKEN_SCALE;
        return (availableLiquidity() + reportedAUM) * TOKEN_SCALE / liabilities;
    }

    // ------------------------------------------------------------------ internal
    /// @dev Whitelist, pause and coupon settlement hook (D3, D4). Burns (`to == 0`) skip the `from` eligibility
    ///      check; mints (`from == 0`) skip the `from` settlement. `whenNotPaused` covers every mint, burn and
    ///      transfer, including `subscribe` and `redeem`. Settlement happens before the balance check inside
    ///      `super._update`, but a revert there (ERC20InsufficientBalance) rolls the settlement back too.
    function _update(address from, address to, uint256 value) internal override whenNotPaused {
        if (from != address(0) && to != address(0) && !REGISTRY.canHold(from)) revert NotEligible(from);
        if (to != address(0) && !REGISTRY.canHold(to)) revert NotEligible(to);
        if (from != address(0)) _settle(from);
        if (to != address(0)) _settle(to);
        super._update(from, to, value);
    }

    /// @dev Moves the account's share of index growth since its last settlement into `accrued`.
    function _settle(address account) internal {
        uint256 index = couponIndex;
        uint256 delta = index - userIndex[account];
        if (delta == 0) return;
        accrued[account] += balanceOf(account) * delta / TOKEN_SCALE;
        userIndex[account] = index;
    }
}
