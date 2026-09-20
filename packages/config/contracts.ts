import { isAddress, type Address } from "viem";
import { ARC_USDC_ADDRESS, chains, type ChainName } from "./chains.ts";
import manifest from "./deployments.json";

export type Deployment = {
  status: "confirmed";
  chainId: number;
  blockNumber: number;
  addresses: { IdentityRegistry: Address; HBToken: Address; USDC: Address };
  roles: { admin: Address; issuer: Address; oracle: Address; registrar: Address };
};

export function getDeployment(name: ChainName): Deployment | null {
  const item = (manifest as Record<string, Deployment | undefined>)[name];
  if (!item) return null;
  if (item.status !== "confirmed" || item.chainId !== chains[name].id || !Number.isSafeInteger(item.blockNumber) || item.blockNumber < 0) throw new Error("Deployment metadata does not match the selected chain.");
  for (const address of Object.values(item.addresses)) {
    if (!isAddress(address) || /^0x0{40}$/i.test(address)) throw new Error("Deployment contains an invalid address.");
  }
  if (name === "arc-testnet" && item.addresses.USDC.toLowerCase() !== ARC_USDC_ADDRESS.toLowerCase()) throw new Error("Arc must use its native USDC ERC-20 interface.");
  return item;
}
