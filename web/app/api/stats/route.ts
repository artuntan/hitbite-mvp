/**
 * `GET /api/stats` — everything that can be derived from the published documents, plus the
 * on-chain figures when a deployment exists on the configured chain, plus everything the event
 * index can fold (BUILD_PROMPT.md 7.2: holders, supply, distributions to date, NAV history, and
 * subscriptions and redemptions over time).
 *
 * The published half (NAV, portfolio analytics, distribution yield, fee schedule, the NAV history
 * series) is always present: it comes from files in the repository. The chain half and the
 * activity half are each a discriminated union — `status: "ok"` with the contract's own integers,
 * or `status: "unavailable"` with the reason. A stats endpoint that invents a zero when an RPC
 * times out is worse than one that says the RPC timed out.
 *
 * `nav_agreement` is the check BUILD_PROMPT.md section 13 asks for: the NAV the engine published
 * and the NAV the contract holds, as integers, and whether they are equal. Comparing the two
 * six-decimal integers is the whole test — no float ever enters it.
 *
 * Three things in `activity` are easy to misread and are therefore labelled in the payload:
 *
 *   - **holders** counts addresses with a non-zero balance folded from `Transfer` logs, and
 *     `excludes_zero_address: true` says out loud that the ERC-20 mint/burn sentinel is not one of
 *     them. `complete: false` means the index has a gap and the count is a floor.
 *   - **distributions** carries both `usdc_amount_6dec` (what the issuer paid in) and
 *     `usdc_allocated_6dec` (what the cumulative index attributed to holders). They differ by the
 *     PLAN.md D29 truncation remainder, which stays as ordinary vault liquidity.
 *   - **daily** is bucketed by UTC day in integer arithmetic; a day with no activity is a zero
 *     row, and an event whose block timestamp is not resolved is in `undated_events`, in no day.
 *
 * Every on-chain amount is a decimal **string** of the integer the contract stores. JSON has no
 * BigInt, and an 18-decimal supply does not survive a JSON number.
 *
 *   curl -s https://<host>/api/stats | jq '{nav: .data.nav.per_token_usd, holders: .data.chain.holders}'
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
import {
  aggregate,
  isoDateFromDayIndex,
  isoTimestampFromSeconds,
  dayIndex,
  type ActivityAggregate,
} from "@/lib/server/events";
import {
  coverageLimitations,
  getEventIndex,
  noDeploymentReason,
  toWireCoverage,
  type CacheMeta,
  type EventIndex,
} from "@/lib/server/indexer";
import { statsResponseSchema, type ChainStats, type EventActivity } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** At most this many on-chain NAV points are returned; the rest are older and are flagged. */
const MAX_NAV_POINTS = 500;

/** Facts this endpoint cannot state, said out loud rather than approximated. */
const NOTES: readonly string[] = [
  "Portfolio figures are computed from a simulated reference book; positions are illustrative and labelled as such in /api/holdings.",
  "`chain.holders` and everything in `activity` are folded from contract logs by the event indexer (PLAN.md D10), not read from a contract view: the token keeps no holder list, by design, because iterating one would not scale.",
  "The holder count is the number of addresses with a non-zero balance and it excludes the zero address, which is the ERC-20 mint and burn sentinel rather than an account.",
  "Distribution totals report both what the issuer paid in (`usdc_amount_6dec`) and what the cumulative index attributed to holders (`usdc_allocated_6dec`); the difference is the D29 index truncation remainder and is ordinary vault liquidity, not a liability.",
  "supply_backed_ratio_1e18 is illustrative: on a testnet the subscription USDC sits in the vault while the portfolio it represents is simulated (PLAN.md D20).",
];

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readChainStats(holders: number | null): Promise<ChainStats> {
  const chainId = ACTIVE_CHAIN_ID;
  const network = ACTIVE_CHAIN.key;
  const deployment = getDeployment(chainId);

  if (!deployment) {
    return {
      status: "unavailable",
      chain_id: chainId,
      network,
      reason: noDeploymentReason(chainId, network),
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
      holders,
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

function buildActivity(
  index: EventIndex,
  cache: CacheMeta,
  folded: ActivityAggregate,
  chainSupplyWei: bigint | null,
): EventActivity {
  const navPoints = folded.navPoints.slice(-MAX_NAV_POINTS);

  return {
    status: "ok",
    chain_id: index.chainId,
    network: index.network,
    token_address: index.tokenAddress,
    registry_address: index.registryAddress,
    deploy_block: Number(index.deployBlock),
    from_block: Number(index.fromBlock),
    to_block: Number(index.toBlock),
    event_count: index.events.length,
    event_counts: folded.eventCounts,
    holders: {
      count: folded.balances.holders,
      excludes_zero_address: true,
      source: "Transfer logs",
      basis:
        "Addresses with a strictly positive balance, folded from every `Transfer` the token has " +
        "emitted since its deploy block. Subscriptions, redemptions and the issuer's operational " +
        "mint and burn all emit a `Transfer` with the zero address on one side, so they are " +
        "counted once, through `Transfer`, and never twice. The zero address itself is never a " +
        "holder.",
      ever_held: folded.balances.everHeld,
      complete: index.complete && folded.balances.negative.length === 0,
    },
    supply_from_events: {
      wei: folded.balances.supplyWei < 0n ? "0" : folded.balances.supplyWei.toString(),
      minted_wei: folded.balances.mintedWei.toString(),
      burned_wei: folded.balances.burnedWei.toString(),
      matches_chain: chainSupplyWei === null ? null : chainSupplyWei === folded.balances.supplyWei,
      note:
        "Mints minus burns from `Transfer` logs. It is compared with the contract's own " +
        "`totalSupply()` as an integer; a mismatch means the index has a hole, not that the " +
        "contract is wrong.",
    },
    subscriptions: {
      count: folded.subscriptions.count,
      accounts: folded.subscriptions.accounts,
      usdc_6dec: folded.subscriptions.usdc6.toString(),
      tokens_wei: folded.subscriptions.tokensWei.toString(),
    },
    redemptions: {
      count: folded.redemptions.count,
      accounts: folded.redemptions.accounts,
      usdc_6dec: folded.redemptions.usdc6.toString(),
      tokens_wei: folded.redemptions.tokensWei.toString(),
    },
    distributions: {
      count: folded.distributions.count,
      usdc_amount_6dec: folded.distributions.usdcAmount6.toString(),
      usdc_allocated_6dec: folded.distributions.usdcAllocated6.toString(),
      truncation_remainder_6dec: folded.distributions.truncationRemainder6.toString(),
      latest_distribution_id: folded.distributions.latestDistributionId?.toString() ?? null,
      latest_at:
        folded.distributions.latestTimestamp === null
          ? null
          : isoTimestampFromSeconds(folded.distributions.latestTimestamp),
      note:
        "`usdc_amount_6dec` is what the issuer paid into the vault; `usdc_allocated_6dec` is the " +
        "part the cumulative coupon index attributed to holders. The difference is the PLAN.md " +
        "D29 truncation remainder and stays as ordinary vault liquidity rather than being locked " +
        "in the coupon reserve. Distributions **to date** means the sum over every " +
        "`CouponDistributed` in the indexed range.",
    },
    claims: {
      count: folded.claims.count,
      accounts: folded.claims.accounts,
      usdc_6dec: folded.claims.usdc6.toString(),
      tokens_wei: "0",
    },
    verifications: {
      verified_events: folded.verifications.verified,
      removed_events: folded.verifications.removed,
      currently_verified: folded.verifications.currentlyVerified,
    },
    pauses: { paused: folded.pauseCount, unpaused: folded.unpauseCount },
    daily: folded.daily.buckets.map((bucket) => ({
      date: bucket.date,
      subscriptions_count: bucket.subscriptionsCount,
      subscriptions_usdc_in_6dec: bucket.subscriptionsUsdcIn6.toString(),
      subscriptions_tokens_out_wei: bucket.subscriptionsTokensOutWei.toString(),
      redemptions_count: bucket.redemptionsCount,
      redemptions_tokens_in_wei: bucket.redemptionsTokensInWei.toString(),
      redemptions_usdc_out_6dec: bucket.redemptionsUsdcOut6.toString(),
      distributions_count: bucket.distributionsCount,
      distributions_usdc_amount_6dec: bucket.distributionsUsdcAmount6.toString(),
      distributions_usdc_allocated_6dec: bucket.distributionsUsdcAllocated6.toString(),
      claims_count: bucket.claimsCount,
      claims_usdc_6dec: bucket.claimsUsdc6.toString(),
      nav_close_usdc_6dec: bucket.navCloseUsdc6?.toString() ?? null,
    })),
    undated_events: folded.daily.undated,
    nav_history_onchain: navPoints.map((point) => ({
      block_number: Number(point.blockNumber),
      timestamp: point.timestamp,
      time: point.timestamp === null ? null : isoTimestampFromSeconds(point.timestamp),
      date: point.timestamp === null ? null : isoDateFromDayIndex(dayIndex(point.timestamp)),
      previous_nav_usdc_6dec: point.previousNavUsdc6.toString(),
      nav_usdc_6dec: point.navUsdc6.toString(),
      reported_aum_usdc_6dec: point.reportedAumUsdc6.toString(),
      forced: point.forced,
      transaction_hash: point.transactionHash,
    })),
    nav_history_truncated: folded.navPoints.length > navPoints.length,
    coverage: toWireCoverage(index, cache),
    limitations: [
      ...coverageLimitations(index, cache),
      ...(folded.balances.negative.length > 0
        ? [
            `${folded.balances.negative.length} address(es) fold to a negative balance, which is arithmetically impossible on a complete log set. The index is missing transfers and the holder count is a floor, not an answer.`,
          ]
        : []),
      ...(folded.daily.filled
        ? []
        : [
            "Days with no activity are omitted from `daily` rather than returned as zero rows, because the span between the first and last event is too long to enumerate.",
          ]),
      ...(folded.navPoints.length > navPoints.length
        ? [
            `\`nav_history_onchain\` holds the most recent ${MAX_NAV_POINTS} of ${folded.navPoints.length} NAV changes; older ones are on chain and are not in this response.`,
          ]
        : []),
    ],
  };
}

export async function GET(): Promise<Response> {
  try {
    const navDocument = getNavDocument();
    const history = getNavHistoryDocument();

    const indexResult = await getEventIndex();
    const folded = indexResult.status === "ok" ? aggregate(indexResult.index.events) : null;

    const chain = await readChainStats(folded ? folded.balances.holders : null);
    const chainSupplyWei = chain.status === "ok" ? BigInt(chain.total_supply_wei) : null;

    const activity: EventActivity =
      indexResult.status === "ok" && folded
        ? buildActivity(indexResult.index, indexResult.cache, folded, chainSupplyWei)
        : {
            status: "unavailable",
            chain_id: ACTIVE_CHAIN_ID,
            network: ACTIVE_CHAIN.key,
            reason:
              indexResult.status === "unavailable"
                ? indexResult.reason
                : "the event index could not be built",
            limitations: [
              "Holders, distributions to date and the subscription and redemption series all come from contract logs. With no index there is nothing to report, and a zero would be a claim rather than a measurement.",
              "There is no database (PLAN.md D10): the index is read from the chain on demand and cached for 60 seconds, so it is only ever as available as the RPC.",
            ],
          };

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
        activity,
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
