/**
 * context — the live chain handles every step shares, plus the three primitives they are built
 * from: send a transaction and record it, expect a transaction to revert and record *that*, and
 * photograph the balances that matter.
 *
 * `expectRevert` deserves a word. Two of the eight steps exist to show a rule being enforced: the
 * registrar cannot verify a United States wallet, and a holder cannot transfer to an unverified
 * one. A revert there is the *result*, not a failure, so the runner proves it twice — it simulates
 * the call to decode the custom error by name and arguments, then sends the transaction anyway
 * with an explicit gas limit so the chain records a real reverted transaction the report can point
 * at. Gas estimation is skipped deliberately: estimating a call that must revert is what would
 * fail.
 */

import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { hbTokenAbi, identityRegistryAbi, mockUsdcAbi } from "./abi.ts";
import { assertNotMainnet, ConfigError, type Actor, type DemoConfig } from "./config.ts";
import { Recorder, type Snapshot } from "./report.ts";

/**
 * Gas limit for every transaction the runner sends.
 *
 * Fixed rather than estimated, on purpose. The heaviest call in the scenario
 * (`distributeCoupon`) uses about 152,000 gas, so 500,000 is generous headroom, and letting the
 * node fill the limit instead makes the run flaky: an estimate is computed against the state
 * before the transaction is mined and can come back short — an Anvil run of this demo was handed
 * 62,790 for a `setNAV` that needs 65,315 and died `OutOfGas` on a call that had just simulated
 * cleanly. The two deliberate reverts need an explicit limit anyway, because estimating a call
 * that must revert is exactly what fails. Only gas actually burned is ever paid for, and the
 * report shows the real `gasUsed` from each receipt.
 */
const GAS_LIMIT = 500_000n;

/**
 * How often to ask whether a transaction has been mined. viem's 4 s default is tuned for a public
 * network and makes an eighteen-transaction run against an instant-mining local node take over a
 * minute of pure waiting; 1 s is still polite to a shared Base Sepolia endpoint.
 */
const POLLING_INTERVAL_MS = { anvil: 50, "base-sepolia": 1_000 } as const;

/** Everything a step needs. Built once by {@link createContext}. */
export type DemoContext = {
  readonly config: DemoConfig;
  readonly recorder: Recorder;
  readonly publicClient: PublicClient;
  readonly wallet: WalletClient;
  readonly token: { readonly address: Address; readonly abi: typeof hbTokenAbi };
  readonly registry: { readonly address: Address; readonly abi: typeof identityRegistryAbi };
  readonly usdc: { readonly address: Address; readonly abi: typeof mockUsdcAbi };
};

/** Connects to the endpoint, re-checks the chain id against the configuration, and binds the ABIs. */
export async function createContext(config: DemoConfig, recorder: Recorder): Promise<DemoContext> {
  const transport = http(config.rpcUrl);
  const publicClient = createPublicClient({
    chain: config.chain,
    transport,
    pollingInterval: POLLING_INTERVAL_MS[config.chainName],
  });

  let liveChainId: number;
  try {
    liveChainId = await publicClient.getChainId();
  } catch (error) {
    throw new ConfigError(
      `cannot reach the ${config.chainName} endpoint at ${config.rpcHost}`,
      `Is the node running? (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  assertNotMainnet(liveChainId, `the endpoint at ${config.rpcHost}`);
  if (liveChainId !== config.chainId) {
    throw new ConfigError(
      `CHAIN=${config.chainName} expects chain id ${config.chainId}, but ${config.rpcHost} reports ${liveChainId}`,
      "Point the endpoint at the chain you named, or change CHAIN. Nothing was sent.",
    );
  }

  return {
    config,
    recorder,
    publicClient,
    wallet: createWalletClient({ chain: config.chain, transport }),
    token: { address: config.deployment.addresses.HBToken, abi: hbTokenAbi },
    registry: { address: config.deployment.addresses.IdentityRegistry, abi: identityRegistryAbi },
    usdc: { address: config.deployment.addresses.MockUSDC, abi: mockUsdcAbi },
  };
}

/** viem's parameter type for `writeContract`, which is also the shape `simulateContract` returns. */
type WriteRequest = Parameters<WalletClient["writeContract"]>[0];

/**
 * Sends the request `simulateContract` validated, under the fixed {@link GAS_LIMIT}. Every write in
 * the demo goes through here so that no transaction depends on a node's gas estimate.
 */
export async function submit(ctx: DemoContext, request: WriteRequest): Promise<Hash> {
  return ctx.wallet.writeContract({ ...request, gas: GAS_LIMIT });
}

/**
 * Waits for `hash`, records it in the report, and fails the run if it did not succeed. Callers
 * simulate first (which is where a revert would normally surface), so a failure here means the
 * transaction reverted between simulation and inclusion — worth stopping for.
 */
export async function confirm(
  ctx: DemoContext,
  label: string,
  hash: Hash,
  from: Address,
  note?: string,
): Promise<void> {
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  ctx.recorder.tx({
    label,
    hash,
    from,
    status: receipt.status,
    gasUsed: receipt.gasUsed,
    blockNumber: receipt.blockNumber,
    ...(note === undefined ? {} : { note }),
  });
  if (receipt.status !== "success") {
    throw new Error(`${label} reverted on chain (tx ${hash})`);
  }
}

/** A decoded custom error: `CountryBlocked(840)`. */
export type DecodedRevert = {
  readonly errorName: string;
  readonly args: readonly unknown[];
  readonly signature: string;
};

function decodeRevert(error: unknown): DecodedRevert | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const revert = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
  if (!(revert instanceof ContractFunctionRevertedError)) return undefined;
  const errorName = revert.data?.errorName ?? revert.reason ?? "unknown";
  const args = revert.data?.args ?? [];
  return {
    errorName,
    args,
    signature: `${errorName}(${args.map((arg) => String(arg)).join(", ")})`,
  };
}

/**
 * Proves that a call the compliance rules must reject really is rejected: simulates it to decode
 * the custom error, then sends it so the chain holds a reverted transaction with a hash.
 *
 * @returns the decoded revert, so the caller can assert on the error name and its arguments.
 */
export async function expectRevert(
  ctx: DemoContext,
  options: {
    readonly label: string;
    readonly actor: Actor;
    readonly to: Address;
    readonly data: Hex;
    readonly simulate: () => Promise<unknown>;
  },
): Promise<DecodedRevert> {
  let decoded: DecodedRevert | undefined;
  try {
    await options.simulate();
  } catch (error) {
    decoded = decodeRevert(error);
    if (decoded === undefined) throw error;
  }
  if (decoded === undefined) {
    throw new Error(`${options.label} was expected to revert, but the call succeeded`);
  }

  const hash = await ctx.wallet.sendTransaction({
    account: options.actor.account,
    chain: ctx.config.chain,
    to: options.to,
    data: options.data,
    gas: GAS_LIMIT,
  });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  ctx.recorder.tx({
    label: options.label,
    hash,
    from: options.actor.address,
    status: receipt.status,
    gasUsed: receipt.gasUsed,
    blockNumber: receipt.blockNumber,
    note: `reverted with ${decoded.signature} — this is the expected result`,
  });
  if (receipt.status !== "reverted") {
    throw new Error(
      `${options.label} was expected to revert on chain, but the transaction succeeded (${hash})`,
    );
  }
  return decoded;
}

/** Reads the balances and fund state the report tabulates before and after the run. */
export async function snapshot(ctx: DemoContext): Promise<Snapshot> {
  const { walletA, walletB, walletC } = ctx.config.actors;
  const token = ctx.token;
  const usdcToken = ctx.usdc;
  const read = ctx.publicClient;

  const [
    nav,
    totalSupply,
    vaultUsdc,
    couponReserve,
    availableLiquidity,
    distributionCount,
    tokenA,
    tokenB,
    tokenC,
    usdcA,
    usdcB,
    usdcC,
    pendingA,
    pendingB,
  ] = await Promise.all([
    read.readContract({ ...token, functionName: "nav" }),
    read.readContract({ ...token, functionName: "totalSupply" }),
    read.readContract({ ...token, functionName: "vaultBalance" }),
    read.readContract({ ...token, functionName: "couponReserve" }),
    read.readContract({ ...token, functionName: "availableLiquidity" }),
    read.readContract({ ...token, functionName: "distributionCount" }),
    read.readContract({ ...token, functionName: "balanceOf", args: [walletA.address] }),
    read.readContract({ ...token, functionName: "balanceOf", args: [walletB.address] }),
    read.readContract({ ...token, functionName: "balanceOf", args: [walletC.address] }),
    read.readContract({ ...usdcToken, functionName: "balanceOf", args: [walletA.address] }),
    read.readContract({ ...usdcToken, functionName: "balanceOf", args: [walletB.address] }),
    read.readContract({ ...usdcToken, functionName: "balanceOf", args: [walletC.address] }),
    read.readContract({ ...token, functionName: "pendingCoupon", args: [walletA.address] }),
    read.readContract({ ...token, functionName: "pendingCoupon", args: [walletB.address] }),
  ]);

  return {
    nav,
    totalSupply,
    vaultUsdc,
    couponReserve,
    availableLiquidity,
    distributionCount,
    tokenA,
    tokenB,
    tokenC,
    usdcA,
    usdcB,
    usdcC,
    pendingA,
    pendingB,
  };
}

/** USDC balance of `account`, read fresh. Used either side of a transfer to prove the amount moved. */
export async function usdcBalance(ctx: DemoContext, account: Address): Promise<bigint> {
  return ctx.publicClient.readContract({ ...ctx.usdc, functionName: "balanceOf", args: [account] });
}

/** hbTRS balance of `account`, read fresh. */
export async function tokenBalance(ctx: DemoContext, account: Address): Promise<bigint> {
  return ctx.publicClient.readContract({
    ...ctx.token,
    functionName: "balanceOf",
    args: [account],
  });
}
