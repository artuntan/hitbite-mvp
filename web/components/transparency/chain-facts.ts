/**
 * The on-chain half of the transparency page.
 *
 * Server-only: it imports `lib/chains`, which builds a viem public client. Nothing here reaches a
 * browser, and no wallet code is involved — these are plain `eth_call` reads.
 *
 * The result is a three-way union rather than "data or null", because the three outcomes are
 * genuinely different facts and the page has to be able to say which one it is:
 *
 *   - `ok`            — the contract answered; the NAV check can be performed.
 *   - `no-deployment` — nothing is deployed on the configured chain, so there is nothing to read.
 *   - `unreachable`   — a deployment is recorded but the RPC did not answer.
 *
 * Collapsing the last two into "unavailable" would hide the difference between "we never deployed
 * here" and "the node is down", and collapsing either into a pass would be a lie.
 */

import type { Address } from "viem";

import {
  ACTIVE_CHAIN,
  ACTIVE_CHAIN_ID,
  assertRpcIsConfiguredChain,
  getDeployment,
  getPublicClient,
  type ChainKey,
  type SupportedChainId,
} from "@/lib/chains";
import { hbTokenAbi } from "@/lib/generated/abis";

interface ChainIdentity {
  readonly chainId: SupportedChainId;
  readonly network: ChainKey;
  /** "Base Sepolia" / "Anvil (local)". */
  readonly label: string;
}

export interface ChainFactsOk extends ChainIdentity {
  readonly status: "ok";
  readonly tokenAddress: Address;
  readonly registryAddress: Address;
  readonly usdcAddress: Address;
  readonly deployBlock: number;
  readonly paused: boolean;
  /** `nav()` — USDC per token, 6 decimals, as an integer. */
  readonly nav: bigint;
  /** `navUpdatedAt()` — unix seconds of the last oracle push. */
  readonly navUpdatedAt: bigint;
  readonly totalSupply: bigint;
  readonly reportedAum: bigint;
  readonly vaultBalance: bigint;
  readonly availableLiquidity: bigint;
  readonly couponReserve: bigint;
  /** `supplyBackedRatio()` — 1e18-scaled (PLAN.md D20). */
  readonly supplyBackedRatio: bigint;
}

export interface ChainFactsMissing extends ChainIdentity {
  readonly status: "no-deployment" | "unreachable";
  readonly reason: string;
}

export type ChainFacts = ChainFactsOk | ChainFactsMissing;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read every figure the transparency page quotes from `HBToken`, in one batched round trip.
 *
 * Never throws: a chain that cannot be read is a state this page renders, not an error that takes
 * the page down. The published documents are the part that must always be visible.
 */
export async function readChainFacts(): Promise<ChainFacts> {
  const identity: ChainIdentity = {
    chainId: ACTIVE_CHAIN_ID,
    network: ACTIVE_CHAIN.key,
    label: ACTIVE_CHAIN.label,
  };

  const deployment = getDeployment(ACTIVE_CHAIN_ID);
  if (!deployment) {
    return {
      ...identity,
      status: "no-deployment",
      // Plain prose, no backticks: this string is rendered as text in an Alert, where a stray
      // markdown fence would just look like a stray markdown fence.
      reason:
        `No deployment is recorded for ${identity.label} (chain ${identity.chainId}). ` +
        `The deploy step (make deploy CHAIN=${identity.network}) and the address sync ` +
        "(pnpm sync:contracts) are what fill this in.",
    };
  }

  try {
    // Refuse to read from an RPC that is not the configured testnet, whatever its URL claims.
    await assertRpcIsConfiguredChain(ACTIVE_CHAIN_ID);

    const client = getPublicClient(ACTIVE_CHAIN_ID);
    const token = { address: deployment.addresses.HBToken, abi: hbTokenAbi } as const;

    const [
      paused,
      nav,
      navUpdatedAt,
      totalSupply,
      reportedAum,
      vaultBalance,
      availableLiquidity,
      couponReserve,
      supplyBackedRatio,
    ] = await Promise.all([
      client.readContract({ ...token, functionName: "paused" }),
      client.readContract({ ...token, functionName: "nav" }),
      client.readContract({ ...token, functionName: "navUpdatedAt" }),
      client.readContract({ ...token, functionName: "totalSupply" }),
      client.readContract({ ...token, functionName: "reportedAUM" }),
      client.readContract({ ...token, functionName: "vaultBalance" }),
      client.readContract({ ...token, functionName: "availableLiquidity" }),
      client.readContract({ ...token, functionName: "couponReserve" }),
      client.readContract({ ...token, functionName: "supplyBackedRatio" }),
    ]);

    return {
      ...identity,
      status: "ok",
      tokenAddress: deployment.addresses.HBToken,
      registryAddress: deployment.addresses.IdentityRegistry,
      usdcAddress: deployment.addresses.MockUSDC,
      deployBlock: deployment.deployBlock,
      paused,
      nav: BigInt(nav),
      navUpdatedAt: BigInt(navUpdatedAt),
      totalSupply: BigInt(totalSupply),
      reportedAum: BigInt(reportedAum),
      vaultBalance: BigInt(vaultBalance),
      availableLiquidity: BigInt(availableLiquidity),
      couponReserve: BigInt(couponReserve),
      supplyBackedRatio: BigInt(supplyBackedRatio),
    };
  } catch (error) {
    return {
      ...identity,
      status: "unreachable",
      reason:
        `${identity.label} is deployed at ${deployment.addresses.HBToken} but the configured RPC ` +
        `did not answer: ${describe(error)}`,
    };
  }
}

/**
 * Liabilities as `supplyBackedRatio()` counts them: every token outstanding valued at the current
 * on-chain NAV, `totalSupply * nav / 1e18`, truncated exactly as the EVM truncates.
 */
export function tokensOutstandingValueUsdc6(facts: ChainFactsOk): bigint {
  return (facts.totalSupply * facts.nav) / 10n ** 18n;
}

/** Assets as `supplyBackedRatio()` counts them: payable USDC plus the reported book. */
export function backingAssetsUsdc6(facts: ChainFactsOk): bigint {
  return facts.availableLiquidity + facts.reportedAum;
}
