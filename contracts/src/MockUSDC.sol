// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Local/Base Sepolia faucet only. Arc always uses its native USDC interface.
contract MockUSDC is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 100e6;
    uint256 public constant COOLDOWN = 1 days;
    mapping(address => uint256) public nextClaimAt;
    error UnsupportedChain();
    error FaucetCooldown(uint256 availableAt);
    event FaucetClaimed(address indexed account, uint256 usdcAmount, uint256 nextClaimAt);

    constructor() ERC20("Test USDC", "USDC") {
        if (block.chainid != 31337 && block.chainid != 84532) revert UnsupportedChain();
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function faucet() external {
        // A few seconds of timestamp drift have no economic consequence for this test-only daily cap.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < nextClaimAt[msg.sender]) revert FaucetCooldown(nextClaimAt[msg.sender]);
        nextClaimAt[msg.sender] = block.timestamp + COOLDOWN;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT, nextClaimAt[msg.sender]);
    }
}
