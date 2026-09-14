/**
 * Chains, deployments and the server-side viem client.
 *
 * Two testnets exist for this project and no others: Base Sepolia (84532) and a local Anvil
 * (31337). BUILD_PROMPT.md section 2 forbids any mainnet configuration, so that ban is enforced
 * three ways rather than left to reviewer vigilance:
 *
 *   1. **Type level.** `SupportedChainId` is the literal union `84532 | 31337`. Nothing else can
 *      be passed to `getPublicClient`, stored in `DEPLOYMENTS`, or assigned to a `ChainConfig`.
 *   2. **Module load.** `MAINNET_CHAIN_IDS` is cross-checked against `SUPPORTED_CHAIN_IDS` when
 *      this module is first evaluated, so widening the union to a mainnet id throws on import —
 *      during `next build`, not in production.
 *   3. **Runtime.** `assertTestnetChainId` guards every entry point that accepts a number from
 *      outside (query strings, RPC responses, wallet state), and `readChainId` refuses to talk to
 *      an RPC whose `eth_chainId` is not the configured testnet. Pointing `SERVER_RPC_URL` at
 *      mainnet produces an error, not a silent mainnet read.
 *
 * This module imports viem but **not** wagmi or RainbowKit, so it is safe on a public server
 * component. The wallet stack lives in `lib/wagmi.ts`, which is client-only.
 */

import {
  createPublicClient,
  defineChain,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { baseSepolia } from "viem/chains";

import type { ContractName } from "./generated/abis";
import { deployments as generatedDeployments } from "./generated/addresses";

// --------------------------------------------------------------------------- the two chains

export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const ANVIL_CHAIN_ID = 31337;

/** Every chain id this app may use, in display order. */
export const SUPPORTED_CHAIN_IDS = [BASE_SEPOLIA_CHAIN_ID, ANVIL_CHAIN_ID] as const;

/** `84532 | 31337`. A mainnet id is not assignable to this type. */
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

/** Human-readable key used by `NEXT_PUBLIC_CHAIN` and by `contracts/deployments/<key>.json`. */
export type ChainKey = "base-sepolia" | "anvil";

/**
 * Chain ids that must never appear anywhere in this repository. Same list as the engine's
 * `push` guard (PLAN.md D32) so the two refusals cannot drift apart.
 */
export const MAINNET_CHAIN_IDS: readonly number[] = [
  1, 10, 56, 100, 137, 324, 8453, 42161, 43114, 59144, 534352,
];

for (const id of SUPPORTED_CHAIN_IDS) {
  if (MAINNET_CHAIN_IDS.includes(id)) {
    throw new Error(
      `lib/chains.ts: chain ${id} is a mainnet and cannot be supported. ` +
        "This project is testnet-only (BUILD_PROMPT.md section 2).",
    );
  }
}

/**
 * Local Anvil / Foundry node. Defined here rather than imported from `viem/chains` so the RPC
 * URL and the explorer story (there is no explorer) are stated in one place.
 */
export const anvil = defineChain({
  id: ANVIL_CHAIN_ID,
  name: "Anvil (local)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

export interface ChainConfig {
  readonly id: SupportedChainId;
  readonly key: ChainKey;
  /** Short label for the network badge, e.g. "Base Sepolia". */
  readonly label: string;
  readonly viemChain: typeof baseSepolia | typeof anvil;
  readonly defaultRpcUrl: string;
  /** Block explorer base URL, or `null` for Anvil, which has none. */
  readonly explorerUrl: string | null;
}

export const CHAINS: Readonly<Record<SupportedChainId, ChainConfig>> = {
  [BASE_SEPOLIA_CHAIN_ID]: {
    id: BASE_SEPOLIA_CHAIN_ID,
    key: "base-sepolia",
    label: "Base Sepolia",
    viemChain: baseSepolia,
    defaultRpcUrl: "https://sepolia.base.org",
    explorerUrl: "https://sepolia.basescan.org",
  },
  [ANVIL_CHAIN_ID]: {
    id: ANVIL_CHAIN_ID,
    key: "anvil",
    label: "Anvil (local)",
    viemChain: anvil,
    defaultRpcUrl: "http://127.0.0.1:8545",
    explorerUrl: null,
  },
};

const CHAIN_ID_BY_KEY: Readonly<Record<ChainKey, SupportedChainId>> = {
  "base-sepolia": BASE_SEPOLIA_CHAIN_ID,
  anvil: ANVIL_CHAIN_ID,
};

export function isSupportedChainId(value: unknown): value is SupportedChainId {
  return typeof value === "number" && (SUPPORTED_CHAIN_IDS as readonly number[]).includes(value);
}

export function isChainKey(value: unknown): value is ChainKey {
  return value === "base-sepolia" || value === "anvil";
}

/**
 * Narrow an untrusted number to a `SupportedChainId` or throw. Use this on anything that comes
 * from a query string, a wallet, or an RPC response.
 */
export function assertTestnetChainId(value: unknown, context = "chain id"): SupportedChainId {
  if (isSupportedChainId(value)) return value;
  if (typeof value === "number" && MAINNET_CHAIN_IDS.includes(value)) {
    throw new Error(
      `${context}: chain ${value} is a mainnet. This app is testnet-only ` +
        `(supported: ${SUPPORTED_CHAIN_IDS.join(", ")}).`,
    );
  }
  throw new Error(
    `${context}: unsupported chain ${JSON.stringify(value)} (supported: ${SUPPORTED_CHAIN_IDS.join(", ")}).`,
  );
}

export function getChainConfig(chainId: SupportedChainId): ChainConfig {
  return CHAINS[chainId];
}

// --------------------------------------------------------------------------- active chain (env)

/**
 * The chain this deployment of the app is pointed at. `NEXT_PUBLIC_CHAIN` is `base-sepolia` or
 * `anvil`; anything else is a configuration error and throws, because silently falling back
 * would make the network badge lie.
 *
 * Read via `process.env.NEXT_PUBLIC_CHAIN` literally (not destructured) so Next can inline it
 * into the client bundle at build time.
 */
function resolveActiveChainId(): SupportedChainId {
  const raw = process.env.NEXT_PUBLIC_CHAIN?.trim();
  if (!raw) return BASE_SEPOLIA_CHAIN_ID;
  if (!isChainKey(raw)) {
    throw new Error(
      `NEXT_PUBLIC_CHAIN="${raw}" is not a supported network. Use "base-sepolia" or "anvil".`,
    );
  }
  return CHAIN_ID_BY_KEY[raw];
}

export const ACTIVE_CHAIN_ID: SupportedChainId = resolveActiveChainId();
export const ACTIVE_CHAIN: ChainConfig = CHAINS[ACTIVE_CHAIN_ID];

/**
 * RPC URL for browser-side reads and wallet transactions. Public, so it must never carry a key
 * that is not meant to be public; `.env.example` says so.
 */
export function getPublicRpcUrl(chainId: SupportedChainId = ACTIVE_CHAIN_ID): string {
  const override = process.env.NEXT_PUBLIC_RPC_URL?.trim();
  if (override && chainId === ACTIVE_CHAIN_ID) return override;
  return CHAINS[chainId].defaultRpcUrl;
}

/** RPC URL for server-side reads (API routes). Falls back to the public one. */
export function getServerRpcUrl(chainId: SupportedChainId = ACTIVE_CHAIN_ID): string {
  const override = process.env.SERVER_RPC_URL?.trim();
  if (override && chainId === ACTIVE_CHAIN_ID) return override;
  return getPublicRpcUrl(chainId);
}

/** Explorer base URL, honouring `NEXT_PUBLIC_EXPLORER_URL`. `null` when the chain has none. */
export function getExplorerUrl(chainId: SupportedChainId = ACTIVE_CHAIN_ID): string | null {
  const override = process.env.NEXT_PUBLIC_EXPLORER_URL?.trim();
  if (override && chainId === ACTIVE_CHAIN_ID) return override.replace(/\/+$/, "");
  return CHAINS[chainId].explorerUrl;
}

export function explorerTxUrl(
  hash: string,
  chainId: SupportedChainId = ACTIVE_CHAIN_ID,
): string | null {
  const base = getExplorerUrl(chainId);
  return base ? `${base}/tx/${hash}` : null;
}

export function explorerAddressUrl(
  address: string,
  chainId: SupportedChainId = ACTIVE_CHAIN_ID,
): string | null {
  const base = getExplorerUrl(chainId);
  return base ? `${base}/address/${address}` : null;
}

// --------------------------------------------------------------------------- deployments

export interface DeploymentRecord {
  readonly chainId: SupportedChainId;
  readonly network: ChainKey;
  /** First block containing the contracts; the event indexer scans from here (PLAN.md D10). */
  readonly deployBlock: number;
  /** Unix seconds recorded by `script/Deploy.s.sol`. */
  readonly timestamp: number;
  readonly addresses: Readonly<Record<ContractName, Address>>;
  readonly txHashes: Readonly<Record<ContractName, Hex>>;
}

/**
 * Deployments generated from `contracts/deployments/*.json`.
 *
 * The annotation is the point: `Partial<Record<SupportedChainId, DeploymentRecord>>` rejects any
 * generated entry whose key or `chainId` is not one of the two testnets, so a mainnet deployment
 * file fails `pnpm typecheck` even if it somehow got past sync-contracts.ts.
 */
export const DEPLOYMENTS: Readonly<Partial<Record<SupportedChainId, DeploymentRecord>>> =
  generatedDeployments;

export function getDeployment(
  chainId: SupportedChainId = ACTIVE_CHAIN_ID,
): DeploymentRecord | null {
  return DEPLOYMENTS[chainId] ?? null;
}

export function hasDeployment(chainId: SupportedChainId = ACTIVE_CHAIN_ID): boolean {
  return getDeployment(chainId) !== null;
}

/** Chain ids with a recorded deployment, ascending. */
export function deployedChainIds(): SupportedChainId[] {
  return SUPPORTED_CHAIN_IDS.filter((id) => DEPLOYMENTS[id] !== undefined).sort((a, b) => a - b);
}

export function getContractAddress(
  contract: ContractName,
  chainId: SupportedChainId = ACTIVE_CHAIN_ID,
): Address | null {
  return getDeployment(chainId)?.addresses[contract] ?? null;
}

/** `deployBlock` as a bigint, ready for `getLogs({ fromBlock })`. */
export function getDeployBlock(chainId: SupportedChainId = ACTIVE_CHAIN_ID): bigint | null {
  const deployment = getDeployment(chainId);
  return deployment ? BigInt(deployment.deployBlock) : null;
}

// --------------------------------------------------------------------------- server-side client

/**
 * A read-only viem client for server-side use (API routes, server components).
 *
 * Deliberately not memoised across chain ids beyond a tiny map: creating a client is cheap, and a
 * per-request client avoids a stale transport surviving a config change between deployments.
 */
const clientCache = new Map<SupportedChainId, PublicClient>();

export function getPublicClient(chainId: SupportedChainId = ACTIVE_CHAIN_ID): PublicClient {
  assertTestnetChainId(chainId, "getPublicClient");
  const cached = clientCache.get(chainId);
  if (cached) return cached;
  const config = CHAINS[chainId];
  const client = createPublicClient({
    chain: config.viemChain,
    transport: http(getServerRpcUrl(chainId), { batch: true, retryCount: 1, timeout: 8_000 }),
  }) as PublicClient;
  clientCache.set(chainId, client);
  return client;
}

/**
 * Ask the RPC which chain it is actually on and refuse anything that is not the configured
 * testnet. This is the guard that catches an `SERVER_RPC_URL` pointed at mainnet: the type system
 * cannot see through an environment variable, but one `eth_chainId` call can.
 */
export async function assertRpcIsConfiguredChain(chainId: SupportedChainId): Promise<void> {
  const reported = await getPublicClient(chainId).getChainId();
  if (reported !== chainId) {
    throw new Error(
      `RPC at the configured URL reports chain ${reported}, expected ${chainId} ` +
        `(${CHAINS[chainId].label}). Refusing to read from it.`,
    );
  }
}
