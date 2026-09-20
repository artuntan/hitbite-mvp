// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IdentityRegistry} from "./IdentityRegistry.sol";

/// @notice Testnet units of a simulated bond portfolio, settled in 6-decimal USDC.
/// @dev Coupons are externally funded. Their unpaid reserve is never redemption liquidity.
contract HBToken is ERC20, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    uint256 public constant NAV_RAIL_BPS = 500;
    uint256 public constant TOKEN_SCALE = 1e18;
    uint256 public constant INDEX_SCALE = 1e36;
    uint256 public constant MAX_INPUT = type(uint128).max;
    IdentityRegistry public immutable registry;
    IERC20 private immutable asset;
    uint256 public navPerToken;
    uint256 public navUpdatedAt;
    uint256 public navUpdatedBlock;
    uint256 public couponIndex;
    uint256 public couponReserve;
    uint256 public totalDistributed;
    uint256 public totalClaimed;
    mapping(address => uint256) public userIndex;
    mapping(address => uint256) private accrued;
    mapping(address => uint256) private remainder;

    error ZeroAddress();
    error InvalidSettlementDecimals();
    error InvalidNAV();
    error NAVMoveExceedsRail(uint256 previous, uint256 proposed);
    error NotVerified(address account);
    error ZeroAmount();
    error ZeroOutput();
    error AmountTooLarge();
    error InsufficientVaultLiquidity(uint256 available, uint256 requested);
    error NoSupply();
    error DistributionTooSmall();
    error NothingToClaim();
    event NAVUpdated(uint256 nav, uint256 timestamp, uint256 blockNumber);
    event NAVForced(uint256 previous, uint256 nav, address indexed issuer);
    event Subscribed(address indexed account, uint256 usdcIn, uint256 tokensOut, uint256 nav);
    event Redeemed(address indexed account, uint256 tokensIn, uint256 usdcOut, uint256 nav);
    event CouponDistributed(uint256 usdcAmount, uint256 index);
    event CouponClaimed(address indexed account, uint256 usdcAmount);

    constructor(
        address registry_,
        address settlementAsset_,
        address admin,
        address issuer,
        address oracle,
        uint256 initialNAV
    ) ERC20(unicode"HitBite Türkiye Sovereign (Testnet)", "hbTRS") {
        if (
            registry_ == address(0) || settlementAsset_ == address(0) || admin == address(0) || issuer == address(0)
                || oracle == address(0)
        ) revert ZeroAddress();
        if (IERC20Metadata(settlementAsset_).decimals() != 6) revert InvalidSettlementDecimals();
        registry = IdentityRegistry(registry_);
        asset = IERC20(settlementAsset_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ROLE, issuer);
        _grantRole(ORACLE_ROLE, oracle);
        _writeNAV(initialNAV);
    }

    function settlementAsset() external view returns (address) {
        return address(asset);
    }

    function setNAV(uint256 value) external onlyRole(ORACLE_ROLE) {
        _setNAV(value, false);
    }

    function setNAV(uint256 value, bool force) external {
        _checkRole(force ? ISSUER_ROLE : ORACLE_ROLE);
        _setNAV(value, force);
    }

    function _setNAV(uint256 value, bool force) private {
        if (value == 0 || value > MAX_INPUT) revert InvalidNAV();
        uint256 previous = navPerToken;
        uint256 delta = value > previous ? value - previous : previous - value;
        if (!force && delta * 10_000 > previous * NAV_RAIL_BPS) revert NAVMoveExceedsRail(previous, value);
        _writeNAV(value);
        if (force) emit NAVForced(previous, value, msg.sender);
    }

    function _writeNAV(uint256 value) private {
        if (value == 0 || value > MAX_INPUT) revert InvalidNAV();
        navPerToken = value;
        navUpdatedAt = block.timestamp;
        navUpdatedBlock = block.number;
        emit NAVUpdated(value, block.timestamp, block.number);
    }

    function subscribe(uint256 usdcAmount) external nonReentrant whenNotPaused returns (uint256 tokensOut) {
        _amount(usdcAmount);
        _eligible(msg.sender);
        uint256 nav = navPerToken;
        tokensOut = Math.mulDiv(usdcAmount, TOKEN_SCALE, nav);
        if (tokensOut == 0) revert ZeroOutput();
        asset.safeTransferFrom(msg.sender, address(this), usdcAmount);
        _mint(msg.sender, tokensOut);
        emit Subscribed(msg.sender, usdcAmount, tokensOut, nav);
    }

    function redeem(uint256 tokensIn) external nonReentrant whenNotPaused returns (uint256 usdcOut) {
        _amount(tokensIn);
        uint256 nav = navPerToken;
        usdcOut = Math.mulDiv(tokensIn, nav, TOKEN_SCALE);
        if (usdcOut == 0) revert ZeroOutput();
        uint256 available = availableLiquidity();
        if (usdcOut > available) revert InsufficientVaultLiquidity(available, usdcOut);
        _burn(msg.sender, tokensIn);
        asset.safeTransfer(msg.sender, usdcOut);
        emit Redeemed(msg.sender, tokensIn, usdcOut, nav);
    }

    function distributeCoupon(uint256 usdcAmount) external nonReentrant onlyRole(ISSUER_ROLE) whenNotPaused {
        _amount(usdcAmount);
        uint256 supply = totalSupply();
        if (supply == 0) revert NoSupply();
        uint256 increment = Math.mulDiv(usdcAmount, INDEX_SCALE, supply);
        if (increment == 0) revert DistributionTooSmall();
        asset.safeTransferFrom(msg.sender, address(this), usdcAmount);
        couponReserve += usdcAmount;
        totalDistributed += usdcAmount;
        couponIndex += increment;
        emit CouponDistributed(usdcAmount, couponIndex);
    }

    function accruedCoupon(address account) public view returns (uint256) {
        (uint256 whole,) = _pending(account);
        return accrued[account] + whole;
    }

    function claimCoupon() external nonReentrant whenNotPaused returns (uint256 usdcOut) {
        _settle(msg.sender);
        usdcOut = accrued[msg.sender];
        if (usdcOut == 0) revert NothingToClaim();
        accrued[msg.sender] = 0;
        couponReserve -= usdcOut;
        totalClaimed += usdcOut;
        asset.safeTransfer(msg.sender, usdcOut);
        emit CouponClaimed(msg.sender, usdcOut);
    }

    function availableLiquidity() public view returns (uint256) {
        uint256 cash = asset.balanceOf(address(this));
        return cash > couponReserve ? cash - couponReserve : 0;
    }

    function mint(address to, uint256 amount) external onlyRole(ISSUER_ROLE) {
        _amount(amount);
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyRole(ISSUER_ROLE) {
        _amount(amount);
        _burn(from, amount);
    }

    function pause() external onlyRole(ISSUER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ISSUER_ROLE) {
        _unpause();
    }

    function _update(address from, address to, uint256 value) internal override whenNotPaused {
        if (to != address(0)) {
            _eligible(to);
            if (from != address(0)) _eligible(from);
        }
        if (from == address(0) && (value > MAX_INPUT || totalSupply() > MAX_INPUT - value)) revert AmountTooLarge();
        if (from != address(0)) _settle(from);
        if (to != address(0) && to != from) _settle(to);
        super._update(from, to, value);
    }

    function _pending(address account) private view returns (uint256 whole, uint256 fraction) {
        uint256 delta = couponIndex - userIndex[account];
        uint256 balance = balanceOf(account);
        whole = Math.mulDiv(balance, delta, INDEX_SCALE);
        fraction = mulmod(balance, delta, INDEX_SCALE) + remainder[account];
        whole += fraction / INDEX_SCALE;
        fraction %= INDEX_SCALE;
    }

    function _settle(address account) private {
        (uint256 whole, uint256 fraction) = _pending(account);
        accrued[account] += whole;
        remainder[account] = fraction;
        userIndex[account] = couponIndex;
    }

    function _eligible(address account) private view {
        if (!registry.isVerified(account)) revert NotVerified(account);
    }

    function _amount(uint256 value) private pure {
        if (value == 0) revert ZeroAmount();
        if (value > MAX_INPUT) revert AmountTooLarge();
    }
}
