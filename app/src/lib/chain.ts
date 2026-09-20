import { rpcTransport } from "@hitbite/config/transport";
import {
  createPublicClient,
  erc20Abi,
  formatUnits,
  keccak256,
  stringToHex,
  type Address,
} from "viem";
import { readPublicConfig } from "@hitbite/config/env";
import { getDeployment } from "@hitbite/config/contracts";
import { hBTokenAbi, identityRegistryAbi } from "@hitbite/config/abi";

export const config = readPublicConfig({
  NEXT_PUBLIC_CHAIN: process.env.NEXT_PUBLIC_CHAIN,
  NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  NEXT_PUBLIC_ATTESTOR_ADDRESS: process.env.NEXT_PUBLIC_ATTESTOR_ADDRESS,
});
export const deployment = getDeployment(config.chainName);
export const client = createPublicClient({
  chain: config.chain,
  transport: rpcTransport(config.chainName, config.rpcUrl),
  batch: { multicall: { deployless: true, wait: 25, batchSize: 8192 } },
});
export const explorer = config.chain.blockExplorers?.default.url;
export const txUrl = (hash: string) =>
  explorer ? `${explorer}/tx/${hash}` : "#";
export const addressUrl = (address: string) =>
  explorer ? `${explorer}/address/${address}` : "#";
export const short = (value: string) =>
  `${value.slice(0, 6)}…${value.slice(-4)}`;
export function units(value: bigint | undefined, decimals = 6, places = 2) {
  if (value === undefined) return "—";
  const [whole, fraction = ""] = formatUnits(value, decimals).split(".");
  return `${BigInt(whole!).toLocaleString("en-US")}${places ? "." + fraction.padEnd(places, "0").slice(0, places) : ""}`;
}
export function amount(value: string, decimals = 6): bigint | null {
  if (
    !new RegExp(`^(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,${decimals}})?$`).test(value)
  )
    return null;
  const [whole, fraction = ""] = value.split(".");
  const result =
    BigInt(whole!) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0"));
  return result > 0n && result <= 2n ** 128n - 1n ? result : null;
}
export const roles = {
  issuer: keccak256(stringToHex("ISSUER_ROLE")),
  oracle: keccak256(stringToHex("ORACLE_ROLE")),
  registrar: keccak256(stringToHex("REGISTRAR_ROLE")),
};
// Public RPC endpoints can briefly report a head older than a confirmed receipt.
// Keep every balance read at or after the latest confirmation in this session.
let confirmedBlock = 0n;
export function recordConfirmedBlock(blockNumber: bigint) {
  if (blockNumber > confirmedBlock) confirmedBlock = blockNumber;
}
export async function snapshot(address?: Address) {
  if (!deployment)
    throw new Error("No confirmed deployment is configured for this testnet.");
  if ((await client.getChainId()) !== config.chain.id)
    throw new Error("RPC chain mismatch.");
  const head = await client.getBlockNumber({ cacheTime: 0 });
  const blockNumber = head > confirmedBlock ? head : confirmedBlock;
  const token = {
    address: deployment.addresses.HBToken,
    abi: hBTokenAbi,
    blockNumber,
  } as const;
  const registry = {
    address: deployment.addresses.IdentityRegistry,
    abi: identityRegistryAbi,
    blockNumber,
  } as const;
  const [nav, navTime, navBlock, supply, liquidity, reserve, paused, block] =
    await Promise.all([
      client.readContract({ ...token, functionName: "navPerToken" }),
      client.readContract({ ...token, functionName: "navUpdatedAt" }),
      client.readContract({ ...token, functionName: "navUpdatedBlock" }),
      client.readContract({ ...token, functionName: "totalSupply" }),
      client.readContract({ ...token, functionName: "availableLiquidity" }),
      client.readContract({ ...token, functionName: "couponReserve" }),
      client.readContract({ ...token, functionName: "paused" }),
      client.getBlock({ blockNumber }),
    ]);
  const position = address
    ? await Promise.all([
        client.readContract({
          address: deployment.addresses.USDC,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
          blockNumber,
        }),
        client.readContract({
          ...token,
          functionName: "balanceOf",
          args: [address],
        }),
        client.readContract({
          ...token,
          functionName: "accruedCoupon",
          args: [address],
        }),
        client.readContract({
          ...registry,
          functionName: "isVerified",
          args: [address],
        }),
        client.readContract({
          address: deployment.addresses.USDC,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, deployment.addresses.HBToken],
          blockNumber,
        }),
        client.readContract({
          ...token,
          functionName: "hasRole",
          args: [roles.issuer, address],
        }),
        client.readContract({
          ...token,
          functionName: "hasRole",
          args: [roles.oracle, address],
        }),
        client.readContract({
          ...registry,
          functionName: "hasRole",
          args: [roles.registrar, address],
        }),
        client.readContract({
          ...registry,
          functionName: "countryOf",
          args: [address],
        }),
      ])
    : undefined;
  return {
    nav,
    navTime,
    navBlock,
    supply,
    liquidity,
    reserve,
    paused,
    blockNumber,
    blockTime: block.timestamp,
    usdc: position?.[0],
    tokens: position?.[1],
    coupon: position?.[2],
    verified: position?.[3],
    allowance: position?.[4],
    issuer: position?.[5] ?? false,
    oracle: position?.[6] ?? false,
    registrar: position?.[7] ?? false,
    country: position?.[8] ?? 0,
  };
}
export type Snapshot = Awaited<ReturnType<typeof snapshot>>;
export type NavData = {
  simulated: boolean;
  timestamp: string;
  block_number: number;
  nav_per_token: string;
  nav_units: string;
  onchain_nav_units: string;
  next_simulated_coupon_date: string;
  cash: string;
  portfolio_value: string;
  net_assets: string;
  supply: string;
  model: string;
  day_count: string;
  vault_cash: string;
  available_liquidity: string;
  supply_backed_ratio: string | null;
  vault_coverage_ratio: string | null;
  weighted_simulated_ytm: string;
  simulated_distribution_yield_30d: string;
  distribution_yield_method: string;
  fees: {
    management_rate: string;
    expense_rate: string;
    management_accrued: string;
    expenses_accrued: string;
  };
  holdings: {
    id: string;
    name: string;
    weight: string;
    coupon: string;
    maturity: string;
    scaled_face: string;
    face: string;
    clean_price: string;
    dirty_price: string;
    value: string;
    price_date: string;
    price_source: string;
    simulated_ytm: string;
  }[];
  history: { date: string; nav: string; block: number }[];
  publication: { transaction_hash: string; block_number: number };
};
