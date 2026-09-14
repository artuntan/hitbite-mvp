// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC (Testnet)
/// @notice Six-decimal stand-in for USDC used only on test networks. Anyone can mint from the faucet, subject to a
///         per-call cap and a per-address cap per fixed 24-hour window that starts at the address's first use. There
///         are no roles: nothing here is meant to hold value.
/// @dev TESTNET ONLY. Never deploy to a mainnet. Not the Circle USDC contract and not backed by anything. Anyone may
///      call the faucet for any address, so the per-address cap is a convenience against accidental over-minting on
///      a testnet, not an economic bound: a caller who wants more test USDC simply uses more addresses.
contract MockUSDC is ERC20 {
    // ------------------------------------------------------------------ events
    /// @notice Emitted on every successful faucet mint.
    event Faucet(address indexed to, uint256 amount);

    // ------------------------------------------------------------------ errors
    error ZeroAmount();
    error FaucetAmountTooLarge(uint256 amount, uint256 cap);
    error FaucetDailyCapExceeded(uint256 remaining);

    // ------------------------------------------------------------------ constants
    /// @notice Maximum amount per faucet call and per address per 24-hour window (10,000 USDC).
    uint256 public constant FAUCET_CAP = 10_000e6;
    /// @notice Length of the per-address faucet window. The window is fixed, not sliding: it starts at the first
    ///         faucet call for an address and the next call at or after `windowStart + FAUCET_WINDOW` starts a new one.
    uint256 public constant FAUCET_WINDOW = 1 days;

    // ------------------------------------------------------------------ storage
    /// @notice Start of the current faucet window for an address (0 if never used).
    mapping(address account => uint256 start) public windowStart;
    /// @notice Amount minted to an address inside its current window.
    mapping(address account => uint256 minted) public mintedInWindow;

    // ------------------------------------------------------------------ constructor
    constructor() ERC20("MockUSDC (Testnet)", "mUSDC") {}

    // ------------------------------------------------------------------ faucet
    /// @notice Mint test USDC to `to`. Anyone may call.
    /// @dev Reverts ZeroAmount, FaucetAmountTooLarge(amount, FAUCET_CAP) or FaucetDailyCapExceeded(remaining).
    ///      Fixed window from first use: once `FAUCET_WINDOW` has elapsed since `windowStart[to]` the next call starts
    ///      a new window at the current block timestamp with a fresh allowance; calls inside a window never extend it.
    /// @param to Recipient of the minted tokens.
    /// @param amount Amount in 6-decimal units (1 USDC = 1e6).
    function faucet(address to, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (amount > FAUCET_CAP) revert FaucetAmountTooLarge(amount, FAUCET_CAP);

        // A faucet window is timestamp-based by definition; validator drift of a few seconds only shifts when a
        // testnet allowance refreshes and can never mint above FAUCET_CAP per window.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= windowStart[to] + FAUCET_WINDOW) {
            windowStart[to] = block.timestamp;
            mintedInWindow[to] = 0;
        }
        uint256 minted = mintedInWindow[to];
        if (minted + amount > FAUCET_CAP) revert FaucetDailyCapExceeded(FAUCET_CAP - minted);
        mintedInWindow[to] = minted + amount;

        _mint(to, amount);
        emit Faucet(to, amount);
    }

    // ------------------------------------------------------------------ views
    /// @notice Amount `account` can still mint from the faucet before its window resets.
    function faucetRemaining(address account) external view returns (uint256) {
        // Same window comparison as `faucet`; see the note there.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= windowStart[account] + FAUCET_WINDOW) return FAUCET_CAP;
        return FAUCET_CAP - mintedInWindow[account];
    }

    /// @notice USDC uses 6 decimals; this mock matches so that HBToken math is identical on testnet and mainnet.
    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
