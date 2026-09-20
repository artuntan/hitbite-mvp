import { defineChain } from "viem";

export const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
export const USDC_DECIMALS = 6;
export const HBTOKEN_DECIMALS = 18;
export const ARC_MIN_MAX_FEE_PER_GAS = 20_000_000_000n;

// Data only. Never import a production chain into the configured network list.
export const chains = {
  "arc-testnet": defineChain({
    id: 5042002,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"], webSocket: ["wss://rpc.testnet.arc.io"] } },
    blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" } },
    testnet: true,
  }),
  "base-sepolia": defineChain({
    id: 84532,
    name: "Base Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://sepolia.base.org"] } },
    blockExplorers: { default: { name: "Base Sepolia Explorer", url: "https://sepolia.basescan.org" } },
    testnet: true,
  }),
  local: defineChain({
    id: 31337,
    name: "Local Anvil",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
    testnet: true,
  }),
} as const;

export type ChainName = keyof typeof chains;
export const allowedChainIds = [5042002, 84532, 31337] as const;

export function parseChainName(value: string | undefined): ChainName {
  if (value === undefined || value === "") return "arc-testnet";
  if (Object.hasOwn(chains, value)) return value as ChainName;
  throw new Error("NEXT_PUBLIC_CHAIN must be arc-testnet, base-sepolia, or local.");
}

/** Every future RPC/signing client must check the node's chain against selection. */
export function assertChainId(actualId: number, selected: ChainName): void {
  if (!allowedChainIds.some((id) => id === actualId) || chains[selected].id !== actualId) {
    throw new Error("RPC chain ID does not match the selected allowlisted test network.");
  }
}
