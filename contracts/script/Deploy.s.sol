// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {Config} from "./Config.s.sol";
import {HBToken} from "../src/HBToken.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";

/// @title Deploy
/// @notice Deploys `MockUSDC`, `IdentityRegistry` and `HBToken`, grants the operational roles, seeds the country
///         blocklist and records the result in `deployments/<chain>.json` (BUILD_PROMPT Section 5.6).
/// @dev Two entry points, because a transaction hash only exists once Foundry has broadcast the transaction and
///      written `broadcast/Deploy.s.sol/<chainId>/run-latest.json` — which happens after `run()` returns:
///
///      ```
///      forge script script/Deploy.s.sol:Deploy --rpc-url <url> --broadcast    # 1. deploy
///      forge script script/Deploy.s.sol:Deploy --sig "record()" --rpc-url <url>  # 2. write the JSON
///      ```
///
///      `make deploy` (and `make deploy-local`) runs both in order; the runbook in `README.md` lists them
///      separately for anyone not using `make`. Step 2 re-reads the broadcast through `vm.getBroadcasts`, so the
///      hashes and addresses in the record are the ones the chain actually saw, never values the script guessed.
///      It also refuses to write a record whose addresses hold no code on the connected chain, which is what stops
///      a stale broadcast from an earlier Anvil instance being committed as if it were live.
contract Deploy is Config {
    // ------------------------------------------------------------------ constants
    /// @notice United States. Blocked because the token is not registered under US securities law
    ///         (BUILD_PROMPT Section 5.1).
    uint16 internal constant COUNTRY_UNITED_STATES = 840;

    /// @notice Türkiye. Blocked because the product is not offered to Turkish residents in phase one
    ///         (BUILD_PROMPT Section 5.1).
    uint16 internal constant COUNTRY_TURKIYE = 792;

    // ------------------------------------------------------------------ step 1: deploy
    /// @notice Deploys the three contracts and grants every role. Broadcasts.
    /// @dev Order is fixed: `MockUSDC`, then `IdentityRegistry` (with the blocklist in its constructor), then
    ///      `HBToken` (which takes both as immutables). The deployer is passed as the constructor admin of the
    ///      registry and the token because granting REGISTRAR/ISSUER/ORACLE needs DEFAULT_ADMIN_ROLE in the same
    ///      transaction batch. When `ADMIN_ADDRESS` names a different account the script then grants it
    ///      DEFAULT_ADMIN_ROLE on both contracts and the deployer renounces its own, so the deployer key keeps no
    ///      power over the deployment. When `ADMIN_ADDRESS` is unset (the documented default) the deployer keeps
    ///      DEFAULT_ADMIN_ROLE; both outcomes are printed and both are in the roles table in `README.md`.
    function run() external {
        string memory chain = _requireTestnetChain();
        Roles memory roles = _roles();
        _logConfig(chain, roles);

        _broadcastAs(_keyOr("DEPLOYER_PRIVATE_KEY"));

        MockUSDC usdc = new MockUSDC();
        IdentityRegistry registry = new IdentityRegistry(roles.deployer, _initialBlocklist());
        HBToken token = new HBToken(IIdentityRegistry(address(registry)), IERC20(address(usdc)), roles.deployer);

        registry.grantRole(registry.REGISTRAR_ROLE(), roles.registrar);
        token.grantRole(token.ISSUER_ROLE(), roles.issuer);
        token.grantRole(token.ORACLE_ROLE(), roles.oracle);

        bool adminHandedOver = roles.admin != roles.deployer;
        if (adminHandedOver) {
            bytes32 adminRole = token.DEFAULT_ADMIN_ROLE();
            registry.grantRole(adminRole, roles.admin);
            token.grantRole(adminRole, roles.admin);
            registry.renounceRole(adminRole, roles.deployer);
            token.renounceRole(adminRole, roles.deployer);
        }

        vm.stopBroadcast();

        console2.log("MockUSDC         ", address(usdc));
        console2.log("IdentityRegistry ", address(registry));
        console2.log("HBToken          ", address(token));
        console2.log("blocked countries ", uint256(COUNTRY_UNITED_STATES), uint256(COUNTRY_TURKIYE));
        console2.log(
            adminHandedOver
                ? "DEFAULT_ADMIN_ROLE transferred to ADMIN_ADDRESS; deployer renounced it on both contracts"
                : "DEFAULT_ADMIN_ROLE kept by the deployer (ADMIN_ADDRESS unset)"
        );
        console2.log("next: forge script script/Deploy.s.sol:Deploy --sig \"record()\" --rpc-url <same url>");
    }

    // ------------------------------------------------------------------ step 2: record
    /// @notice Writes `deployments/<chain>.json` from the broadcast Foundry just wrote. Does not broadcast.
    /// @dev The document holds exactly the five keys BUILD_PROMPT Section 5.6 asks for:
    ///      `chainId`, `addresses`, `deployBlock`, `txHashes`, `timestamp`. `addresses` and `txHashes` share the
    ///      three contract names, so every address can be traced to the transaction that created it. `deployBlock`
    ///      is the earliest of the three creation blocks and is what the web indexer and the engine start from.
    ///      `timestamp` is the block time of the connected chain when the record was written, seconds after the
    ///      deployment itself.
    ///
    ///      Before writing, the record is checked against the chain: each address must hold code, and `HBToken`
    ///      must point at exactly the registry and USDC recorded next to it. Only `addresses`, hashes and block
    ///      numbers are written — never a key, and never anything derived from one.
    function record() external {
        string memory chain = _requireTestnetChain();
        uint64 chainId = SafeCast.toUint64(block.chainid);

        VmSafe.BroadcastTxSummary memory usdcTx = _creation("MockUSDC", chainId);
        VmSafe.BroadcastTxSummary memory registryTx = _creation("IdentityRegistry", chainId);
        VmSafe.BroadcastTxSummary memory tokenTx = _creation("HBToken", chainId);

        HBToken token = HBToken(tokenTx.contractAddress);
        if (address(token.registry()) != registryTx.contractAddress) {
            _fail("recorded HBToken does not point at the recorded IdentityRegistry: re-run the deploy step.");
        }
        if (token.usdc() != usdcTx.contractAddress) {
            _fail("recorded HBToken does not point at the recorded MockUSDC: re-run the deploy step.");
        }

        uint256 deployBlock = _min(_min(usdcTx.blockNumber, registryTx.blockNumber), tokenTx.blockNumber);

        // Each vm.serializeX returns the object built so far; the last one in a group is the finished child.
        string memory addressesKey = "hitbite.addresses";
        string memory addresses = vm.serializeAddress(addressesKey, "MockUSDC", usdcTx.contractAddress);
        addresses = vm.serializeAddress(addressesKey, "IdentityRegistry", registryTx.contractAddress);
        addresses = vm.serializeAddress(addressesKey, "HBToken", tokenTx.contractAddress);

        string memory hashesKey = "hitbite.txHashes";
        string memory txHashes = vm.serializeBytes32(hashesKey, "MockUSDC", usdcTx.txHash);
        txHashes = vm.serializeBytes32(hashesKey, "IdentityRegistry", registryTx.txHash);
        txHashes = vm.serializeBytes32(hashesKey, "HBToken", tokenTx.txHash);

        string memory rootKey = "hitbite.deployment";
        string memory document = vm.serializeUint(rootKey, "chainId", block.chainid);
        document = vm.serializeString(rootKey, "addresses", addresses);
        document = vm.serializeUint(rootKey, "deployBlock", deployBlock);
        document = vm.serializeString(rootKey, "txHashes", txHashes);
        document = vm.serializeUint(rootKey, "timestamp", block.timestamp);

        string memory path = _deploymentPath(chain);
        vm.writeJson(document, path);

        console2.log("wrote contracts/%s at block %s", path, vm.toString(deployBlock));
        console2.log(document);
    }

    // ------------------------------------------------------------------ internals
    /// @dev Initial blocklist passed to the registry constructor (BUILD_PROMPT Section 5.1). The admin can change
    ///      it at any time with `setCountryBlocked`; this is only where the list starts.
    function _initialBlocklist() private pure returns (uint16[] memory codes) {
        codes = new uint16[](2);
        codes[0] = COUNTRY_UNITED_STATES;
        codes[1] = COUNTRY_TURKIYE;
    }

    /// @dev Most recent successful CREATE of `name` on `chainId`, cross-checked against the connected chain.
    function _creation(string memory name, uint64 chainId)
        private
        view
        returns (VmSafe.BroadcastTxSummary memory summary)
    {
        VmSafe.BroadcastTxSummary[] memory all = vm.getBroadcasts(name, chainId, VmSafe.BroadcastTxType.Create);
        if (all.length == 0) {
            _fail(
                string.concat(
                    "no broadcast recorded for ",
                    name,
                    " on chain id ",
                    vm.toString(uint256(chainId)),
                    ": run the deploy step before record()."
                )
            );
        }
        summary = all[0];
        if (!summary.success) {
            _fail(string.concat("the last recorded deployment of ", name, " reverted: re-run the deploy step."));
        }
        if (summary.contractAddress.code.length == 0) {
            _fail(
                string.concat(
                    name,
                    " at ",
                    vm.toString(summary.contractAddress),
                    " holds no code on this chain: the broadcast is from an earlier chain instance. Re-run the",
                    " deploy step."
                )
            );
        }
    }

    /// @dev Smaller of two block numbers.
    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
