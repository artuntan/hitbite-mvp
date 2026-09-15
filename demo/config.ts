/**
 * config — everything the runner needs to know before it is allowed to send a transaction:
 * which chain, which endpoint, which contracts, which accounts.
 *
 * Three rules shape this file.
 *
 * 1. **Testnet only, checked twice.** `CHAIN` must be `anvil` or `base-sepolia`; the chain id the
 *    endpoint reports must be the matching 31337 or 84532; and the deployment record must name the
 *    same id. Any other id aborts before a client is built, and the eleven public mainnet ids are
 *    named explicitly so a misdirected endpoint says so (BUILD_PROMPT section 2, PLAN.md D32; the
 *    same list `contracts/script/Config.s.sol` and `engine/nav_engine/push_nav.py` refuse).
 * 2. **Keys come from the environment and are never written anywhere.** A key is read, turned into
 *    an account, and forgotten; only addresses leave this module. On Anvil (31337) and only there,
 *    an unset key falls back to one of the node's published, unlocked development accounts, which
 *    are used by *address* over `eth_sendTransaction` — the runner never holds the key at all.
 * 3. **No silent defaults off Anvil.** On Base Sepolia every wallet and role key must be given by
 *    name, and the error says which variable is missing.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { getAddress, isAddress, type Address, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil, baseSepolia } from "viem/chains";

// --------------------------------------------------------------------------------- chains

/** The only two chains this repository may touch, and the viem chain definition for each. */
const SUPPORTED = {
  anvil: { id: 31337, chain: anvil },
  "base-sepolia": { id: 84532, chain: baseSepolia },
} as const satisfies Record<string, { id: number; chain: Chain }>;

export type ChainName = keyof typeof SUPPORTED;

/**
 * Public mainnet chain ids, refused by name. The allowlist above already rejects every id that is
 * not 31337 or 84532; this only makes the most dangerous mistake legible in the error message.
 * Kept in lockstep with `contracts/script/Config.s.sol` and `engine/nav_engine/push_nav.py`.
 */
const MAINNET_CHAIN_IDS = new Map<number, string>([
  [1, "Ethereum"],
  [10, "OP Mainnet"],
  [56, "BNB Smart Chain"],
  [100, "Gnosis"],
  [137, "Polygon"],
  [324, "zkSync Era"],
  [8453, "Base"],
  [42161, "Arbitrum One"],
  [43114, "Avalanche C-Chain"],
  [59144, "Linea"],
  [534352, "Scroll"],
]);

// --------------------------------------------------------------------------------- failure

/** A configuration problem the operator has to fix; carries a hint instead of a stack trace. */
export class ConfigError extends Error {
  readonly hint: string;

  constructor(message: string, hint: string) {
    super(message);
    this.name = "ConfigError";
    this.hint = hint;
  }
}

// --------------------------------------------------------------------------------- environment

function env(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw === undefined || raw === "" ? undefined : raw;
}

/**
 * Anvil's published development accounts #0 to #3, as *addresses*. These are public values from
 * the Foundry documentation, not secrets: the node keeps them unlocked, so the runner can sign
 * through `eth_sendTransaction` and never sees a key. `contracts/script/Seed.s.sol` and the
 * Makefile carry the same addresses for the same reason. Used only when the chain id is 31337.
 */
const ANVIL_ACCOUNTS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
] as const satisfies readonly Address[];

/** How an actor's transactions are signed. */
export type SignerKind = "env-key" | "anvil-unlocked";

/** One participant in the demo: an address, how it signs, and where that came from. */
export type Actor = {
  /** Short identifier used in the report, e.g. `walletA`. */
  readonly id: string;
  /** Human label used in prose, e.g. `wallet A`. */
  readonly label: string;
  readonly address: Address;
  /** A viem local account, or a bare address for Anvil's unlocked `eth_sendTransaction` path. */
  readonly account: ReturnType<typeof privateKeyToAccount> | Address;
  readonly signer: SignerKind;
  /** Where the signer came from, for the report: an env var name or the Anvil account index. */
  readonly source: string;
};

function actorFromKey(id: string, label: string, variable: string, key: string): Actor {
  const normalised = key.startsWith("0x") ? key : `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalised)) {
    throw new ConfigError(
      `${variable} is not a 32-byte hex private key`,
      "Expected 64 hex characters, optionally 0x-prefixed. The value is never printed or written to any file.",
    );
  }
  const account = privateKeyToAccount(normalised as `0x${string}`);
  return { id, label, address: account.address, account, signer: "env-key", source: variable };
}

function actorFromAnvil(id: string, label: string, index: number): Actor {
  const address = ANVIL_ACCOUNTS[index];
  if (address === undefined)
    throw new ConfigError(`no Anvil account #${index}`, "index out of range");
  return {
    id,
    label,
    address: getAddress(address),
    account: getAddress(address),
    signer: "anvil-unlocked",
    source: `Anvil account #${index} (unlocked, public development address)`,
  };
}

/**
 * Resolves one actor: the named key wins, then the fallback keys in order, then — on Anvil only —
 * the node's unlocked account at `anvilIndex`.
 */
function resolveActor(
  id: string,
  label: string,
  chainId: number,
  variables: readonly string[],
  anvilIndex: number,
): Actor {
  for (const variable of variables) {
    const key = env(variable);
    if (key !== undefined) return actorFromKey(id, label, variable, key);
  }
  if (chainId === SUPPORTED.anvil.id) return actorFromAnvil(id, label, anvilIndex);
  throw new ConfigError(
    `${label} has no signing key`,
    `Set ${variables[0]} (see .env.example). Only chain id 31337 falls back to Anvil's unlocked accounts.`,
  );
}

// --------------------------------------------------------------------------------- deployment

/** The subset of `contracts/deployments/<chain>.json` the runner reads. */
export type Deployment = {
  readonly chainId: number;
  readonly deployBlock: bigint;
  readonly addresses: {
    readonly HBToken: Address;
    readonly IdentityRegistry: Address;
    readonly MockUSDC: Address;
  };
  readonly txHashes: Record<string, string>;
  readonly timestamp: number;
};

const CONTRACT_NAMES = ["HBToken", "IdentityRegistry", "MockUSDC"] as const;

function loadDeployment(file: string, chainName: ChainName, expectedChainId: number): Deployment {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new ConfigError(
      `no deployment record at ${file}`,
      `Run \`make deploy CHAIN=${chainName}\` first; it writes the addresses this runner reads.`,
    );
  }

  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new ConfigError(`${file} is not a JSON object`, "Re-run the deploy step to rewrite it.");
  }
  const record = parsed as Record<string, unknown>;

  if (record["chainId"] !== expectedChainId) {
    throw new ConfigError(
      `${file} records chain id ${String(record["chainId"])}, not ${expectedChainId}`,
      `The record belongs to a different chain than CHAIN=${chainName}. Re-deploy, or fix CHAIN.`,
    );
  }

  const addressRecord = (record["addresses"] ?? {}) as Record<string, unknown>;
  const addresses = {} as { HBToken: Address; IdentityRegistry: Address; MockUSDC: Address };
  for (const name of CONTRACT_NAMES) {
    const value = addressRecord[name];
    if (typeof value !== "string" || !isAddress(value)) {
      throw new ConfigError(
        `${file} has no valid address for ${name}`,
        "Re-run the deploy step; `record()` writes all three addresses together.",
      );
    }
    addresses[name] = getAddress(value);
  }

  const deployBlock = record["deployBlock"];
  if (typeof deployBlock !== "number" || !Number.isInteger(deployBlock) || deployBlock < 0) {
    throw new ConfigError(`${file} has no valid deployBlock`, "Re-run the deploy step.");
  }

  return {
    chainId: expectedChainId,
    deployBlock: BigInt(deployBlock),
    addresses,
    txHashes: (record["txHashes"] ?? {}) as Record<string, string>,
    timestamp: typeof record["timestamp"] === "number" ? record["timestamp"] : 0,
  };
}

// --------------------------------------------------------------------------------- endpoint

/**
 * The JSON-RPC endpoint for `chainName`. `DEMO_RPC_URL` wins (that is what `make demo` passes, so
 * the Makefile stays the single source of truth for endpoints); otherwise the same variables the
 * rest of the repository uses.
 */
function resolveRpcUrl(chainName: ChainName): string {
  const override = env("DEMO_RPC_URL");
  if (override !== undefined) return override;
  if (chainName === "anvil") {
    return (
      env("ANVIL_RPC_URL") ??
      `http://${env("ANVIL_HOST") ?? "127.0.0.1"}:${env("ANVIL_PORT") ?? "8545"}`
    );
  }
  const url = env("BASE_SEPOLIA_RPC_URL");
  if (url === undefined) {
    throw new ConfigError(
      "BASE_SEPOLIA_RPC_URL is not set",
      "Copy .env.example to .env and fill it in, or export BASE_SEPOLIA_RPC_URL.",
    );
  }
  return url;
}

/**
 * Host of an endpoint, for the report. A provider URL often carries an API key in its path or
 * query string, and the report is a committed artefact, so only the host is ever written down.
 */
export function endpointHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable endpoint)";
  }
}

// --------------------------------------------------------------------------------- config

/** Everything resolved from the environment, before any client is built. */
export type DemoConfig = {
  readonly chainName: ChainName;
  readonly chainId: number;
  readonly chain: Chain;
  readonly rpcUrl: string;
  readonly rpcHost: string;
  readonly explorerUrl: string | undefined;
  readonly repoRoot: string;
  readonly deploymentFile: string;
  readonly deployment: Deployment;
  readonly reportFile: string;
  readonly actors: {
    readonly walletA: Actor;
    readonly walletB: Actor;
    readonly walletC: Actor;
    readonly registrar: Actor;
    readonly issuer: Actor;
    readonly oracle: Actor;
    /** Only used to re-anchor the oracle rail in the preflight; absent when no admin key is given. */
    readonly admin: Actor | undefined;
  };
};

/** Reads and validates the environment. Throws {@link ConfigError} with a hint on any problem. */
export function loadConfig(): DemoConfig {
  const requested = env("CHAIN") ?? "anvil";
  if (!(requested in SUPPORTED)) {
    throw new ConfigError(
      `CHAIN=${requested} is not a supported testnet`,
      "HitBite is testnet only (BUILD_PROMPT section 2): use CHAIN=anvil or CHAIN=base-sepolia.",
    );
  }
  const chainName = requested as ChainName;
  const { id: chainId, chain } = SUPPORTED[chainName];
  assertNotMainnet(chainId, `CHAIN=${chainName}`);

  const rpcUrl = resolveRpcUrl(chainName);
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const deploymentFile = path.join(repoRoot, "contracts", "deployments", `${chainName}.json`);

  return {
    chainName,
    chainId,
    chain,
    rpcUrl,
    rpcHost: endpointHost(rpcUrl),
    explorerUrl: chain.blockExplorers?.default.url,
    repoRoot,
    deploymentFile,
    deployment: loadDeployment(deploymentFile, chainName, chainId),
    reportFile: path.join(repoRoot, "demo", "REPORT.md"),
    actors: {
      walletA: resolveActor("walletA", "wallet A", chainId, ["DEMO_WALLET_A_PRIVATE_KEY"], 1),
      walletB: resolveActor("walletB", "wallet B", chainId, ["DEMO_WALLET_B_PRIVATE_KEY"], 2),
      walletC: resolveActor("walletC", "wallet C", chainId, ["DEMO_WALLET_C_PRIVATE_KEY"], 3),
      registrar: resolveActor(
        "registrar",
        "registrar",
        chainId,
        ["REGISTRAR_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"],
        0,
      ),
      issuer: resolveActor(
        "issuer",
        "issuer",
        chainId,
        ["ISSUER_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"],
        0,
      ),
      oracle: resolveActor(
        "oracle",
        "oracle",
        chainId,
        ["ORACLE_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"],
        0,
      ),
      admin: resolveAdmin(chainId),
    },
  };
}

/**
 * The DEFAULT_ADMIN_ROLE signer, used for exactly one thing: re-anchoring the oracle rail window
 * in the preflight when repeated runs inside a single 24 h window have walked the anchor away from
 * the opening NAV (see `steps/preflight.ts`). Optional — the demo runs without it and says so.
 */
function resolveAdmin(chainId: number): Actor | undefined {
  const key = env("DEPLOYER_PRIVATE_KEY");
  if (key !== undefined) return actorFromKey("admin", "admin", "DEPLOYER_PRIVATE_KEY", key);
  return chainId === SUPPORTED.anvil.id ? actorFromAnvil("admin", "admin", 0) : undefined;
}

/** Aborts if `chainId` is a public mainnet. Called for the configured id and again for the live one. */
export function assertNotMainnet(chainId: number, where: string): void {
  const name = MAINNET_CHAIN_IDS.get(chainId);
  if (name !== undefined) {
    throw new ConfigError(
      `${where} resolves to chain id ${chainId} (${name}), a public mainnet`,
      "HitBite never touches a mainnet (BUILD_PROMPT section 2). Nothing was sent.",
    );
  }
}
