// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

/// @title Config
/// @notice Shared environment handling for `Deploy.s.sol` and `Seed.s.sol`: the chain guard, the deployer and the
///         four role addresses, the per-chain RPC endpoint and the path of the deployment record.
/// @dev Two rules drive every helper here.
///
///      1. **Testnet only.** `_requireTestnetChain()` accepts chain id 31337 (Anvil) and 84532 (Base Sepolia) and
///         nothing else. A known mainnet id is named in the revert reason. This is BUILD_PROMPT Section 2 and
///         PLAN.md D32 enforced in the tool rather than in the runbook, so no sequence of flags can point a deploy
///         at a production network.
///      2. **No silent defaults.** Every value that must be supplied is read, trimmed and validated; when it is
///         missing or malformed the script reverts with a message naming the variable and what was expected. The
///         only defaults are the ones `.env.example` documents: the four role addresses fall back to the deployer,
///         the role signing keys fall back to `DEPLOYER_PRIVATE_KEY`, and `ANVIL_RPC_URL` falls back to
///         `http://127.0.0.1:8545`. Each of those is printed when it is used.
///
///      Signing: when `DEPLOYER_PRIVATE_KEY` (or a role key) is set, the scripts sign with it through
///      `vm.startBroadcast(key)`. When it is not set, they broadcast from `--sender`, which is how the local Anvil
///      flow works (`forge script --unlocked --sender <anvil account>`) and how a hardware wallet or a
///      `--account` keystore entry is used. `_senderOf` reports whichever of the two is in force so the role
///      checks in `Seed.s.sol` test the address that will actually sign.
abstract contract Config is Script {
    // ------------------------------------------------------------------ constants
    /// @notice Local Anvil chain id.
    uint256 internal constant ANVIL_CHAIN_ID = 31_337;

    /// @notice Base Sepolia chain id: the only public network this MVP targets (BUILD_PROMPT Section 2).
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;

    /// @notice Endpoint used for `CHAIN=anvil` when `ANVIL_RPC_URL` is unset, as documented in `.env.example`.
    string internal constant DEFAULT_ANVIL_RPC_URL = "http://127.0.0.1:8545";

    // Chain ids that must never be deployed to. See {_mainnetNote}.
    uint256 private constant CHAIN_ID_OP_MAINNET = 10;
    uint256 private constant CHAIN_ID_BNB = 56;
    uint256 private constant CHAIN_ID_GNOSIS = 100;
    uint256 private constant CHAIN_ID_POLYGON = 137;
    uint256 private constant CHAIN_ID_ZKSYNC_ERA = 324;
    uint256 private constant CHAIN_ID_BASE = 8453;
    uint256 private constant CHAIN_ID_ARBITRUM_ONE = 42_161;
    uint256 private constant CHAIN_ID_AVALANCHE_C = 43_114;
    uint256 private constant CHAIN_ID_LINEA = 59_144;
    uint256 private constant CHAIN_ID_SCROLL = 534_352;

    /// @notice Addresses that receive the roles granted by `Deploy.s.sol`.
    /// @param deployer Signs the deployment; holds DEFAULT_ADMIN_ROLE while the script runs.
    /// @param admin Final DEFAULT_ADMIN_ROLE holder (`ADMIN_ADDRESS`, defaults to the deployer).
    /// @param registrar REGISTRAR_ROLE on the registry (`REGISTRAR_ADDRESS`, defaults to the deployer).
    /// @param issuer ISSUER_ROLE on the token (`ISSUER_ADDRESS`, defaults to the deployer).
    /// @param oracle ORACLE_ROLE on the token (`ORACLE_ADDRESS`, defaults to the deployer).
    struct Roles {
        address deployer;
        address admin;
        address registrar;
        address issuer;
        address oracle;
    }

    // ------------------------------------------------------------------ chain
    /// @notice Aborts unless the connected chain is one of the two testnets this repository supports.
    /// @dev Also cross-checks the `CHAIN` environment variable when it is set, so `make deploy CHAIN=base-sepolia`
    ///      pointed at a local node (or the reverse) fails before anything is broadcast.
    /// @return name `"anvil"` for chain id 31337, `"base-sepolia"` for 84532.
    function _requireTestnetChain() internal view returns (string memory name) {
        uint256 id = block.chainid;
        if (id == ANVIL_CHAIN_ID) {
            name = "anvil";
        } else if (id == BASE_SEPOLIA_CHAIN_ID) {
            name = "base-sepolia";
        } else {
            _fail(
                string.concat(
                    "refusing to run against chain id ",
                    vm.toString(id),
                    _mainnetNote(id),
                    ". HitBite is testnet only (BUILD_PROMPT Section 2, PLAN.md D32): use 31337 (anvil) or 84532",
                    " (base-sepolia)."
                )
            );
        }

        string memory declared = _env("CHAIN");
        if (bytes(declared).length != 0 && !_eq(declared, name)) {
            _fail(
                string.concat(
                    "CHAIN=",
                    declared,
                    " but the RPC reports chain id ",
                    vm.toString(id),
                    " (",
                    name,
                    "). Point --rpc-url at the chain you named, or unset CHAIN."
                )
            );
        }
    }

    /// @notice Endpoint configured for `name` in the environment.
    /// @dev This is the URL the Makefile passes to `--rpc-url`; a script started by hand receives its endpoint from
    ///      the command line instead, which is why `_requireTestnetChain` compares chain ids rather than strings.
    ///      Printed by `Deploy.s.sol` so an operator can see which endpoint the current `CHAIN` is configured for.
    /// @param name `"anvil"` or `"base-sepolia"`.
    /// @return url The configured endpoint.
    function _rpcUrl(string memory name) internal view returns (string memory url) {
        if (_eq(name, "anvil")) {
            url = _env("ANVIL_RPC_URL");
            if (bytes(url).length == 0) url = DEFAULT_ANVIL_RPC_URL;
        } else {
            url = _env("BASE_SEPOLIA_RPC_URL");
            if (bytes(url).length == 0) {
                _fail("BASE_SEPOLIA_RPC_URL is not set. Copy .env.example to .env and fill it in.");
            }
        }
    }

    /// @notice Path of the deployment record for `name`, relative to `contracts/`.
    /// @param name Chain name from `_requireTestnetChain`.
    /// @return path e.g. `deployments/anvil.json`.
    function _deploymentPath(string memory name) internal pure returns (string memory path) {
        return string.concat("deployments/", name, ".json");
    }

    // ------------------------------------------------------------------ signers and roles
    /// @notice Private key for `name`, falling back to `DEPLOYER_PRIVATE_KEY`.
    /// @dev Returns 0 when neither is set, which means "sign with `--sender`" (Anvil's unlocked accounts, a
    ///      keystore entry or a hardware wallet). Never returns a hard-coded key.
    /// @param name Environment variable holding the key, e.g. `REGISTRAR_PRIVATE_KEY`.
    /// @return key The private key, or 0 when the transaction is signed by `--sender`.
    function _keyOr(string memory name) internal view returns (uint256 key) {
        if (bytes(_env(name)).length != 0) return vm.envUint(name);
        if (bytes(_env("DEPLOYER_PRIVATE_KEY")).length != 0) return vm.envUint("DEPLOYER_PRIVATE_KEY");
        return 0;
    }

    /// @notice Starts a broadcast signed by `key`, or by `--sender` when `key` is 0.
    /// @param key Private key from `_keyOr`.
    function _broadcastAs(uint256 key) internal {
        if (key == 0) {
            vm.startBroadcast();
        } else {
            vm.startBroadcast(key);
        }
    }

    /// @notice Address that will sign when `key` is used.
    /// @param key Private key, or 0 for the `--sender` path.
    /// @return signer `vm.addr(key)`, or `--sender`.
    function _senderOf(uint256 key) internal view returns (address signer) {
        return key == 0 ? _sender() : vm.addr(key);
    }

    /// @notice The address that signs the deployment.
    /// @dev `DEPLOYER_PRIVATE_KEY` when set, otherwise `--sender`. Aborts when neither is given, rather than
    ///      silently deploying from Foundry's default sender, which holds no funds anywhere.
    /// @return deployer The deploying address.
    function _deployer() internal view returns (address deployer) {
        uint256 key = _keyOr("DEPLOYER_PRIVATE_KEY");
        if (key != 0) return vm.addr(key);
        deployer = _sender();
        if (deployer == DEFAULT_SENDER) {
            _fail(
                string.concat(
                    "no deployer configured: set DEPLOYER_PRIVATE_KEY, or pass --sender (with --unlocked on Anvil,",
                    " or --account/--ledger elsewhere)."
                )
            );
        }
    }

    /// @notice Role addresses from the environment, each defaulting to the deployer as `.env.example` documents.
    /// @return roles Deployer plus the admin, registrar, issuer and oracle addresses.
    function _roles() internal view returns (Roles memory roles) {
        address deployer = _deployer();
        roles = Roles({
            deployer: deployer,
            admin: _addressOr("ADMIN_ADDRESS", deployer),
            registrar: _addressOr("REGISTRAR_ADDRESS", deployer),
            issuer: _addressOr("ISSUER_ADDRESS", deployer),
            oracle: _addressOr("ORACLE_ADDRESS", deployer)
        });
    }

    /// @notice Prints the resolved configuration so a run is self-documenting in CI logs and terminal scrollback.
    /// @param name Chain name.
    /// @param roles Resolved role addresses.
    function _logConfig(string memory name, Roles memory roles) internal view {
        console2.log("chain            ", name, block.chainid);
        console2.log("configured rpc   ", _rpcUrl(name));
        console2.log("deployer         ", roles.deployer);
        console2.log("admin            ", roles.admin, _defaulted(roles.admin, roles.deployer));
        console2.log("registrar        ", roles.registrar, _defaulted(roles.registrar, roles.deployer));
        console2.log("issuer           ", roles.issuer, _defaulted(roles.issuer, roles.deployer));
        console2.log("oracle           ", roles.oracle, _defaulted(roles.oracle, roles.deployer));
    }

    // ------------------------------------------------------------------ env primitives
    /// @notice Trimmed value of environment variable `name`, or `""` when unset or blank.
    /// @param name Variable name.
    /// @return value Trimmed value.
    function _env(string memory name) internal view returns (string memory value) {
        return _trim(vm.envOr(name, string("")));
    }

    /// @notice Address from environment variable `name`, or `fallbackAddress` when unset.
    /// @dev Rejects a malformed or zero address with a message naming the variable.
    /// @param name Variable name.
    /// @param fallbackAddress Value used when the variable is unset or blank.
    /// @return value The resolved address.
    function _addressOr(string memory name, address fallbackAddress) internal view returns (address value) {
        string memory raw = _env(name);
        if (bytes(raw).length == 0) return fallbackAddress;
        if (bytes(raw).length != 42) {
            _fail(string.concat(name, "=", raw, " is not a 0x-prefixed 20-byte address."));
        }
        value = vm.parseAddress(raw);
        if (value == address(0)) _fail(string.concat(name, " is the zero address."));
    }

    /// @notice Unsigned integer from environment variable `name`, or `fallbackValue` when unset.
    /// @param name Variable name.
    /// @param fallbackValue Value used when the variable is unset or blank.
    /// @return value The resolved integer.
    function _uintOr(string memory name, uint256 fallbackValue) internal view returns (uint256 value) {
        return bytes(_env(name)).length == 0 ? fallbackValue : vm.envUint(name);
    }

    /// @notice Reverts with a `hitbite:`-prefixed reason.
    /// @param message What went wrong and what to do about it.
    function _fail(string memory message) internal pure {
        revert(string.concat("hitbite: ", message));
    }

    // ------------------------------------------------------------------ internals
    /// @dev `--sender`, or Foundry's default sender when the flag was omitted.
    function _sender() private view returns (address) {
        return msg.sender;
    }

    /// @dev Says so when `id` is a chain id this project must never touch. The allowlist in
    ///      `_requireTestnetChain` already refuses every id that is not 31337 or 84532, mainnets included; this
    ///      only sharpens the message for the most likely fat-finger. The list matches the one the engine refuses
    ///      in `nav_engine/push_nav.py` (PLAN.md D32): Ethereum, OP, BNB, Gnosis, Polygon, zkSync Era, Base,
    ///      Arbitrum One, Avalanche C-Chain, Linea, Scroll.
    function _mainnetNote(uint256 id) private pure returns (string memory) {
        uint256[11] memory mainnets = [
            uint256(1),
            CHAIN_ID_OP_MAINNET,
            CHAIN_ID_BNB,
            CHAIN_ID_GNOSIS,
            CHAIN_ID_POLYGON,
            CHAIN_ID_ZKSYNC_ERA,
            CHAIN_ID_BASE,
            CHAIN_ID_ARBITRUM_ONE,
            CHAIN_ID_AVALANCHE_C,
            CHAIN_ID_LINEA,
            CHAIN_ID_SCROLL
        ];
        for (uint256 i = 0; i < mainnets.length; ++i) {
            if (mainnets[i] == id) return " (a public mainnet)";
        }
        return "";
    }

    /// @dev "(default: deployer)" when `value` fell back to the deployer, otherwise "".
    function _defaulted(address value, address deployer) private pure returns (string memory) {
        return value == deployer ? "(default: deployer)" : "";
    }

    /// @dev Case-sensitive string equality.
    function _eq(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    /// @dev Strips leading and trailing spaces, tabs, CR and LF. A `.env` written on Windows, or edited with a
    ///      trailing space, must not turn into an unparseable address.
    function _trim(string memory raw) private pure returns (string memory) {
        bytes memory data = bytes(raw);
        uint256 start = 0;
        uint256 end = data.length;
        while (start < end && _isSpace(data[start])) {
            ++start;
        }
        while (end > start && _isSpace(data[end - 1])) {
            --end;
        }
        bytes memory out = new bytes(end - start);
        for (uint256 i = 0; i < out.length; ++i) {
            out[i] = data[start + i];
        }
        return string(out);
    }

    /// @dev ASCII whitespace: space, tab, line feed, carriage return.
    function _isSpace(bytes1 char) private pure returns (bool) {
        bytes memory whitespace = bytes(" \t\n\r");
        for (uint256 i = 0; i < whitespace.length; ++i) {
            if (whitespace[i] == char) return true;
        }
        return false;
    }
}
