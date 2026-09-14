/**
 * `GET /api/stats` — everything that can be derived from the published documents, plus the
 * on-chain figures when a deployment exists on the configured chain.
 *
 * The published half (NAV, portfolio analytics, distribution yield, fee schedule, the NAV history
 * series) is always present: it comes from files in the repository. The chain half is a
 * discriminated union — `status: "ok"` with the contract's own integers, or `status:
 * "unavailable"` with the reason. A stats endpoint that invents a zero when an RPC times out is
 * worse than one that says the RPC timed out.
 *
 * `nav_agreement` is the check BUILD_PROMPT.md section 13 asks for: the NAV the engine published
 * and the NAV the contract holds, as integers, and whether they are equal. Comparing the two
 * six-decimal integers is the whole test — no float ever enters it.
 *
 * Every on-chain amount is a decimal **string** of the integer the contract stores. JSON has no
 * BigInt, and an 18-decimal supply does not survive a JSON number.
 *
 *   curl -s https://<host>/api/stats | jq '{nav: .data.nav.per_token_usd, chain: .data.chain.status}'
 */

import {
  ACTIVE_CHAIN,
  ACTIVE_CHAIN_ID,
  assertRpcIsConfiguredChain,
  getDeployment,
  getPublicClient,
} from "@/lib/chains";
import {
  getNavDocument,
  getNavHistoryDocument,
  jsonInternalError,
  jsonOkValidated,
} from "@/lib/data";
import { formatPlain, TOKEN_DECIMALS, USDC_DECIMALS } from "@/lib/format";
import { hbTokenAbi } from "@/lib/generated/abis";
import { statsResponseSchema, type ChainStats } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Facts this endpoint cannot state yet, said out loud rather than approximated. */
const NOTES: readonly string[] = [
  "Portfolio figures are computed from a simulated reference book; positions are illustrative and labelled as such in /api/holdings.",
  "Holder count is not reported: counting holders means indexing Transfer logs, which is the Phase 8 event indexer (PLAN.md D10). It is null here rather than guessed.",
  "Subscriptions, redemptions and distributions over time are not aggregated here for the same reason; /api/events returns the raw logs it can reach in the meantime.",
  "supply_backed_ratio_1e18 is illustrative: on a testnet the subscription USDC sits in the vault while the portfolio it represents is simulated (PLAN.md D20).",
];

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readChainStats(): Promise<ChainStats> {
  const chainId = ACTIVE_CHAIN_ID;
  const network = ACTIVE_CHAIN.key;
  const deployment = getDeployment(chainId);

  if (!deployment) {
    return {
      status: "unavailable",
      chain_id: chainId,
      network,
      reason: `No deployment is recorded for ${ACTIVE_CHAIN.label} (chain ${chainId}). Run \`make deploy CHAIN=${network}\` and re-run \`pnpm sync:contracts\`.`,
    };
  }

  try {
    // Refuse to read from an RPC that is not the configured testnet, whatever the URL claims.
    await assertRpcIsConfiguredChain(chainId);

    const client = getPublicClient(chainId);
    const token = { address: deployment.addresses.HBToken, abi: hbTokenAbi } as const;

    const [
      paused,
      totalSupply,
      nav,
      navUpdatedAt,
      reportedAum,
      vaultBalance,
      availableLiquidity,
      couponReserve,
      totalDistributed,
      totalClaimed,
      distributionCount,
      supplyBackedRatio,
      minSubscription,
      maxNavMoveBps,
    ] = await Promise.all([
      client.readContract({ ...token, functionName: "paused" }),
      client.readContract({ ...token, functionName: "totalSupply" }),
      client.readContract({ ...token, functionName: "nav" }),
      client.readContract({ ...token, functionName: "navUpdatedAt" }),
      client.readContract({ ...token, functionName: "reportedAUM" }),
      client.readContract({ ...token, functionName: "vaultBalance" }),
      client.readContract({ ...token, functionName: "availableLiquidity" }),
      client.readContract({ ...token, functionName: "couponReserve" }),
      client.readContract({ ...token, functionName: "totalDistributed" }),
      client.readContract({ ...token, functionName: "totalClaimed" }),
      client.readContract({ ...token, functionName: "distributionCount" }),
      client.readContract({ ...token, functionName: "supplyBackedRatio" }),
      client.readContract({ ...token, functionName: "minSubscription" }),
      client.readContract({ ...token, functionName: "maxNavMoveBps" }),
    ]);

    return {
      status: "ok",
      chain_id: chainId,
      network,
      token_address: deployment.addresses.HBToken,
      registry_address: deployment.addresses.IdentityRegistry,
      usdc_address: deployment.addresses.MockUSDC,
      deploy_block: deployment.deployBlock,
      paused,
      total_supply_wei: totalSupply.toString(),
      total_supply_tokens: formatPlain(totalSupply, TOKEN_DECIMALS),
      nav_usdc_6dec: nav.toString(),
      nav_per_token_usd: formatPlain(nav, USDC_DECIMALS),
      nav_updated_at: Number(navUpdatedAt),
      reported_aum_usdc_6dec: reportedAum.toString(),
      vault_balance_usdc_6dec: vaultBalance.toString(),
      available_liquidity_usdc_6dec: availableLiquidity.toString(),
      coupon_reserve_usdc_6dec: couponReserve.toString(),
      total_distributed_usdc_6dec: totalDistributed.toString(),
      total_claimed_usdc_6dec: totalClaimed.toString(),
      distribution_count: Number(distributionCount),
      supply_backed_ratio_1e18: supplyBackedRatio.toString(),
      min_subscription_usdc_6dec: minSubscription.toString(),
      max_nav_move_bps: Number(maxNavMoveBps),
      holders: null,
    };
  } catch (error) {
    return {
      status: "unavailable",
      chain_id: chainId,
      network,
      reason: `Could not read ${ACTIVE_CHAIN.label} at the configured RPC: ${describe(error)}`,
    };
  }
}

export async function GET(): Promise<Response> {
  try {
    const navDocument = getNavDocument();
    const history = getNavHistoryDocument();
    const chain = await readChainStats();

    const published = navDocument.nav.usdc_6dec;
    const onchain = chain.status === "ok" ? chain.nav_usdc_6dec : null;
    const entries = history.entries;

    return jsonOkValidated(
      statsResponseSchema,
      {
        generated_at: navDocument.generated_at,
        as_of: navDocument.as_of,
        simulated: true,
        source_note: navDocument.source_note,
        nav: navDocument.nav,
        portfolio: navDocument.portfolio,
        distribution_yield: navDocument.distribution_yield,
        fees: navDocument.fees,
        history: {
          entries,
          first_date: entries[0]?.date ?? null,
          last_date: entries[entries.length - 1]?.date ?? null,
          count: entries.length,
        },
        chain,
        nav_agreement: {
          published_usdc_6dec: published,
          onchain_usdc_6dec: onchain,
          matches: onchain === null ? null : BigInt(onchain) === BigInt(published),
          note:
            onchain === null
              ? "Nothing to compare against: no deployment on the configured chain, or the RPC did not answer. This is not a failed check."
              : "Six-decimal integers compared directly; the engine and the contract store the same number (PLAN.md D22).",
        },
        notes: NOTES,
      },
      "Check the published documents in web/public/data/ and the RPC configured by SERVER_RPC_URL / NEXT_PUBLIC_RPC_URL.",
    );
  } catch (error) {
    return jsonInternalError(
      error,
      "The published documents could not be read. Re-run `make nav`; on-chain failures are reported inside the response, not as a 500.",
    );
  }
}
