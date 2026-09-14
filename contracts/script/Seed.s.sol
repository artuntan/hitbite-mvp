// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/Script.sol";

import {Config} from "./Config.s.sol";
import {HBToken} from "../src/HBToken.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";

/// @title Seed
/// @notice Brings a fresh deployment to the state the demo starts from: demo wallet A verified as a professional
///         investor in the UAE (784), demo wallet B in Germany (276), both funded from the `MockUSDC` faucet, and
///         the opening NAV set on chain (BUILD_PROMPT Sections 5.6 and 9).
/// @dev **Idempotent by construction.** Every step reads the chain first and does nothing when the chain already
///      says what the step would say:
///
///      | Step | Skipped when |
///      |---|---|
///      | verify | the wallet is already verified with the same country and investor type |
///      | fund | the wallet already holds `SEED_USDC_TARGET` |
///      | set NAV | `nav()` already equals `SEED_NAV` |
///
///      Funding tops up to the target rather than adding a fixed amount, so a second run after the demo has spent
///      USDC restores the balance without ever minting twice for the same purpose, and it never asks the faucet
///      for more than `faucetRemaining` allows under the D14 per-address 24-hour cap (it warns and moves on
///      instead of reverting, because a re-run inside the same window is a normal thing to do).
///
///      Addresses come from `deployments/<chain>.json`, which `Deploy.s.sol` wrote; the file's `chainId` is
///      checked against the connected chain before anything is sent.
contract Seed is Config {
    // ------------------------------------------------------------------ constants
    /// @notice Demo wallet A: United Arab Emirates (ISO 3166-1 numeric 784), BUILD_PROMPT Section 9.
    uint16 internal constant COUNTRY_UAE = 784;

    /// @notice Demo wallet B: Germany (ISO 3166-1 numeric 276), BUILD_PROMPT Section 9.
    uint16 internal constant COUNTRY_GERMANY = 276;

    /// @notice Professional investor. Retail (2) cannot be verified in phase one (PLAN.md D21).
    uint8 internal constant INVESTOR_PROFESSIONAL = 1;

    /// @notice Test USDC each demo wallet is topped up to: enough for the Section 9 demo (1,000 + 500 USDC of
    ///         subscriptions) with room to re-run, and half of the 10,000 USDC per-address faucet cap (D14).
    uint256 internal constant SEED_USDC_TARGET = 5000e6;

    /// @notice Anvil's published account #1 address. A public development address, not a key, and used only on
    ///         chain id 31337; off Anvil `DEMO_WALLET_A_ADDRESS` is required.
    address internal constant ANVIL_ACCOUNT_1 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    /// @notice Anvil's published account #2 address. Same caveat as {ANVIL_ACCOUNT_1}.
    address internal constant ANVIL_ACCOUNT_2 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    // ------------------------------------------------------------------ state
    /// @dev Set by `run()` from the deployment record before any step executes.
    MockUSDC private usdc;
    IdentityRegistry private registry;
    HBToken private token;

    // ------------------------------------------------------------------ entry point
    /// @notice Verifies, funds and prices the demo deployment. Broadcasts. Safe to run repeatedly.
    function run() external {
        string memory chain = _requireTestnetChain();
        // Resolves the signing account up front so a run with no key and no `--sender` fails with "no deployer
        // configured" instead of a role check against Foundry's default sender.
        console2.log("chain            ", chain, block.chainid);
        console2.log("signer           ", _deployer());
        _load(chain);

        address walletA = _demoWallet("DEMO_WALLET_A_ADDRESS", ANVIL_ACCOUNT_1);
        address walletB = _demoWallet("DEMO_WALLET_B_ADDRESS", ANVIL_ACCOUNT_2);
        console2.log("wallet A         ", walletA, "country 784 (UAE), professional");
        console2.log("wallet B         ", walletB, "country 276 (Germany), professional");

        _verify(walletA, COUNTRY_UAE);
        _verify(walletB, COUNTRY_GERMANY);
        _fund(walletA);
        _fund(walletB);
        _setInitialNav();

        console2.log("seed complete. nav", token.nav(), "(6 decimals)");
    }

    // ------------------------------------------------------------------ steps
    /// @dev Reads the deployment record and binds the three contracts.
    function _load(string memory chain) private {
        string memory path = _deploymentPath(chain);
        if (!vm.exists(path)) {
            _fail(
                string.concat("contracts/", path, " not found: run `make deploy CHAIN=", chain, "` before `make seed`.")
            );
        }
        // Reading the deployment record is the whole point of the step; `fs_permissions` in foundry.toml scopes
        // the script to ./deployments, and nothing read here is ever signed with or turned into a key.
        // forge-lint: disable-next-line(unsafe-cheatcode)
        string memory document = vm.readFile(path);
        uint256 recordedChainId = vm.parseJsonUint(document, ".chainId");
        if (recordedChainId != block.chainid) {
            _fail(
                string.concat(
                    "contracts/",
                    path,
                    " records chain id ",
                    vm.toString(recordedChainId),
                    " but the RPC reports ",
                    vm.toString(block.chainid),
                    "."
                )
            );
        }
        usdc = MockUSDC(vm.parseJsonAddress(document, ".addresses.MockUSDC"));
        registry = IdentityRegistry(vm.parseJsonAddress(document, ".addresses.IdentityRegistry"));
        token = HBToken(vm.parseJsonAddress(document, ".addresses.HBToken"));

        console2.log("MockUSDC         ", address(usdc));
        console2.log("IdentityRegistry ", address(registry));
        console2.log("HBToken          ", address(token));
    }

    /// @dev Verifies `wallet` as a professional investor in `country`, unless the registry already says so.
    function _verify(address wallet, uint16 country) private {
        IIdentityRegistry.Identity memory identity = registry.identityOf(wallet);
        if (identity.verified && identity.country == country && identity.investorType == INVESTOR_PROFESSIONAL) {
            console2.log("verify   skipped ", wallet, "already verified with the same country and investor type");
            return;
        }

        uint256 key = _keyOr("REGISTRAR_PRIVATE_KEY");
        _requireRole(registry.hasRole(registry.REGISTRAR_ROLE(), _senderOf(key)), _senderOf(key), "REGISTRAR_ROLE");

        _broadcastAs(key);
        registry.addVerified(wallet, country, INVESTOR_PROFESSIONAL);
        vm.stopBroadcast();
        console2.log("verified         ", wallet, uint256(country));
    }

    /// @dev Tops `wallet` up to {SEED_USDC_TARGET} from the faucet, within whatever the D14 window still allows.
    function _fund(address wallet) private {
        uint256 balance = usdc.balanceOf(wallet);
        if (balance >= SEED_USDC_TARGET) {
            console2.log("fund     skipped ", wallet, balance);
            return;
        }

        uint256 wanted = SEED_USDC_TARGET - balance;
        uint256 allowed = usdc.faucetRemaining(wallet);
        if (allowed == 0) {
            console2.log("fund     WARNING ", wallet, "faucet window exhausted (D14 cap); balance left as is");
            return;
        }
        uint256 amount = wanted < allowed ? wanted : allowed;
        if (amount < wanted) {
            console2.log("fund     partial ", wallet, "faucet window allows less than the target top-up");
        }

        _broadcastAs(_keyOr("DEPLOYER_PRIVATE_KEY"));
        usdc.faucet(wallet, amount);
        vm.stopBroadcast();
        console2.log("funded           ", wallet, amount);
    }

    /// @dev Sets the opening NAV. `SEED_NAV` defaults to `NAV_SCALE` (1.000000 USDC), the inception NAV the token
    ///      constructor already carries, so on a fresh deployment this step correctly does nothing.
    function _setInitialNav() private {
        uint256 target = _uintOr("SEED_NAV", token.NAV_SCALE());
        uint256 current = token.nav();
        if (current == target) {
            console2.log("setNAV   skipped ", target, "already the on-chain NAV");
            return;
        }

        uint256 key = _keyOr("ORACLE_PRIVATE_KEY");
        _requireRole(token.hasRole(token.ORACLE_ROLE(), _senderOf(key)), _senderOf(key), "ORACLE_ROLE");

        _broadcastAs(key);
        token.setNAV(target, token.reportedAUM(), false);
        vm.stopBroadcast();
        console2.log("nav set          ", current, target);
    }

    // ------------------------------------------------------------------ internals
    /// @dev Demo wallet address from the environment, defaulting to an Anvil account on chain id 31337 only.
    function _demoWallet(string memory name, address anvilAccount) private view returns (address wallet) {
        wallet = _addressOr(name, block.chainid == ANVIL_CHAIN_ID ? anvilAccount : address(0));
        if (wallet == address(0)) {
            _fail(string.concat(name, " is not set. Off Anvil the demo wallets must be given explicitly."));
        }
    }

    /// @dev Fails with the signer and the role it is missing, rather than letting the transaction revert with a
    ///      raw `AccessControlUnauthorizedAccount`.
    function _requireRole(bool held, address signer, string memory role) private pure {
        if (held) return;
        _fail(
            string.concat(
                "signer ",
                vm.toString(signer),
                " does not hold ",
                role,
                ". Set the matching *_PRIVATE_KEY, or re-deploy with the matching *_ADDRESS."
            )
        );
    }
}
