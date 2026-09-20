// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {HBToken} from "../src/HBToken.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/// @notice The TypeScript wrapper verifies broadcast receipts before publishing deployment JSON.
contract Deploy is Script {
    error UnsupportedChain();

    function run() external returns (IdentityRegistry registry, HBToken token) {
        if (block.chainid != 5042002 && block.chainid != 84532 && block.chainid != 31337) revert UnsupportedChain();
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(key);
        address admin = vm.envOr("ADMIN_ADDRESS", deployer);
        address issuer = vm.envOr("ISSUER_ADDRESS", deployer);
        address oracle = vm.envOr("ORACLE_ADDRESS", deployer);
        address registrar = vm.envOr("REGISTRAR_ADDRESS", deployer);
        vm.startBroadcast(key);
        address usdc =
            block.chainid == 5042002 ? address(0x3600000000000000000000000000000000000000) : address(new MockUSDC());
        registry = new IdentityRegistry(admin, registrar);
        token = new HBToken(address(registry), usdc, admin, issuer, oracle, 1e6);
        vm.stopBroadcast();
    }
}
