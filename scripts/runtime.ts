import { config } from "dotenv";
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  assertChainId,
  chains,
  parseChainName,
  ARC_MIN_MAX_FEE_PER_GAS,
} from "../packages/config/chains.ts";

config({ path: ".env", quiet: true });

export async function context(selected?: string) {
  const name = parseChainName(selected ?? process.env.NEXT_PUBLIC_CHAIN);
  const chain = chains[name];
  const rpcUrl =
    process.env.RPC_URL ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    chain.rpcUrls.default.http[0];
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  assertChainId(await client.getChainId(), name);
  return { name, chain, rpcUrl, client };
}
export type Context = Awaited<ReturnType<typeof context>>;

export function accountFor(variable: string) {
  const value = process.env[variable];
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error(`${variable} is missing or invalid.`);
  try {
    return privateKeyToAccount(value as Hex);
  } catch {
    throw new Error(`${variable} is invalid.`);
  }
}

export async function fees(ctx: Context) {
  const estimate = await ctx.client.estimateFeesPerGas();
  const floor = ctx.name === "arc-testnet" ? ARC_MIN_MAX_FEE_PER_GAS : 0n;
  return {
    maxFeePerGas: estimate.maxFeePerGas > floor ? estimate.maxFeePerGas : floor,
    maxPriorityFeePerGas: estimate.maxPriorityFeePerGas,
  };
}

export async function transact(
  ctx: Context,
  variable: string,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
) {
  assertChainId(await ctx.client.getChainId(), ctx.name);
  const account = accountFor(variable);
  const data = encodeFunctionData({ abi, functionName, args });
  const fee = await fees(ctx);
  const gas = await ctx.client.estimateGas({
    account,
    to: address,
    data,
    ...fee,
  });
  const wallet = createWalletClient({
    account,
    chain: ctx.chain,
    transport: http(ctx.rpcUrl),
  });
  const hash = await wallet.sendTransaction({
    to: address,
    data,
    gas: (gas * 12n) / 10n,
    ...fee,
  });
  const receipt = await ctx.client.waitForTransactionReceipt({
    hash,
    timeout: 120_000,
  });
  if (receipt.status !== "success")
    throw new Error(`Transaction reverted: ${hash}`);
  return receipt;
}

export function readDeployment(name: string) {
  const data = JSON.parse(readFileSync(`deployments/${name}.json`, "utf8"));
  if (data.status !== "confirmed")
    throw new Error("Deployment has no confirmed receipts.");
  return data as {
    status: "confirmed";
    chainId: number;
    blockNumber: number;
    addresses: { IdentityRegistry: Address; HBToken: Address; USDC: Address };
    deployer: Address;
    timestamp: string;
    transactions: Record<string, Hex>;
    roles: {
      admin: Address;
      issuer: Address;
      oracle: Address;
      registrar: Address;
    };
    vaultFunding: {
      amount: string;
      transactionHash: Hex;
      blockNumber: number;
    }[];
    verification?: Record<string, string>;
  };
}

export const json = (value: unknown) =>
  JSON.stringify(
    value,
    (_, item) => (typeof item === "bigint" ? item.toString() : item),
    2,
  ) + "\n";

/** Last-resort boundary: never print an environment credential from a provider/tool error. */
export function safeError(error: unknown) {
  let message = error instanceof Error ? error.message : String(error);
  for (const [name, value] of Object.entries(process.env)) {
    if (
      value &&
      value.length > 6 &&
      /PRIVATE_KEY|TOKEN|SECRET|AUTH|RPC_URL/.test(name)
    )
      message = message.replaceAll(value, "[redacted]");
  }
  return message;
}
