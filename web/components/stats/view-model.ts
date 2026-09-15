/**
 * Turns the event index into the exact strings and integers `/stats` renders.
 *
 * Three rules shape everything here, and they are the same three the indexer and
 * `/api/stats` follow, which is why the page and the endpoint cannot disagree:
 *
 *  1. **Every figure is formatted from the integer the contract emitted**
 *     (PLAN.md D22). USDC is a 6-decimal integer, the token an 18-decimal one,
 *     and both are summed as `bigint` by `lib/server/events.ts` before anything
 *     here touches them. No float ever enters a money value.
 *  2. **Formatting happens on the server.** The charts are client components and
 *     receive strings; the only numbers that cross the boundary are chart
 *     geometry and integer axis ticks — the same 6-decimal integers, which stay
 *     exact as `number` until about nine billion USD (`components/charts/ticks.ts`).
 *  3. **A number that was not measured is not rendered as zero.** Where the
 *     index has a gap the count is a floor and is written as one; where the two
 *     sides of a comparison are not both present the verdict is "not checked",
 *     never a pass.
 *
 * Pure: no I/O, no chain, no `next/*`. `./source.ts` does the reading; this file
 * does the arithmetic, and `./view-model.test.ts` drives it from fixture events.
 */

import type { NavHistoryPoint } from "@/components/charts/nav-history-chart";
import { integerAxisScale, type AxisScale } from "@/components/charts/ticks";
import {
  formatDate,
  formatFixed,
  formatTokens,
  formatTokensExact,
  formatUnixSeconds,
  formatUsdc,
  formatUsdcExact,
  USDC_DECIMALS,
} from "@/lib/format";
import {
  dayIndex,
  isoDateFromDayIndex,
  isoTimestampFromSeconds,
  type ActivityAggregate,
  type DailyBucket,
  type NavPoint,
} from "@/lib/server/events";
import type { SupportedChainId } from "@/lib/chains";
import type { CacheMeta, EventIndex } from "@/lib/server/indexer";
import { EVENT_NAMES, type EventName } from "@/lib/schemas";

import type { FlowBar } from "./flow-chart";

/**
 * UTC days charted and tabulated, most recent last. The index itself fills every
 * empty day between the first and last event, so an eighteen-month-old testnet
 * would otherwise put five hundred rows in one table; the cap is stated on the
 * card whenever it bites and `/api/stats` still carries every day.
 */
export const MAX_CHART_DAYS = 90;

/** On-chain NAV changes charted. The same cap `/api/stats` applies, for the same reason. */
export const MAX_NAV_POINTS = 500;

/** `"2026-09-08"` -> `"8 Sep"`. The year is in the card's subtitle, not on every tick. */
function shortDate(isoDate: string): string {
  return formatDate(isoDate).replace(/\s\d{4}$/, "");
}

/** A whole number with thousands separators: block heights, counts, holders. */
function formatCount(value: number | bigint): string {
  return formatFixed(typeof value === "bigint" ? value : BigInt(Math.trunc(value)), 0);
}

function plural(count: number, noun: string, plural_ = `${noun}s`): string {
  return `${formatCount(count)} ${count === 1 ? noun : plural_}`;
}

// --------------------------------------------------------------------------- headline figures

export interface Figure {
  key: string;
  label: string;
  /** Already formatted. `≥` prefixes a count the index can only bound from below. */
  value: string;
  /** Unit, basis, or the reason the figure is a floor. */
  hint: string;
}

/**
 * The five figures BUILD_PROMPT 7.2 asks `/stats` to lead with.
 *
 * `holdersComplete` is `false` when the scan has a gap: the count is then a
 * floor, and it is written `≥ n` rather than left to look like an answer.
 */
export function buildFigures(
  folded: ActivityAggregate,
  chainSupplyWei: bigint | null,
  holdersComplete: boolean,
): Figure[] {
  const supplyWei = chainSupplyWei ?? folded.balances.supplyWei;
  const holders = folded.balances.holders;

  return [
    {
      key: "holders",
      label: "Holders",
      value: holdersComplete ? formatCount(holders) : `≥ ${formatCount(holders)}`,
      hint: holdersComplete
        ? "addresses with a non-zero balance · the zero address is never counted"
        : "at least this many — the scan has a gap, so the count is a floor",
    },
    {
      key: "supply",
      label: "Supply",
      value: formatTokens(supplyWei, 4),
      hint:
        chainSupplyWei === null
          ? "hbTRS · minted minus burned from Transfer logs; the contract was not read"
          : "hbTRS · totalSupply() on the token contract",
    },
    {
      key: "subscriptions",
      label: "Subscriptions",
      value: formatUsdc(folded.subscriptions.usdc6),
      hint: `USDC in · ${plural(folded.subscriptions.count, "subscription")} from ${plural(
        folded.subscriptions.accounts,
        "address",
        "addresses",
      )}`,
    },
    {
      key: "redemptions",
      label: "Redemptions",
      value: formatUsdc(folded.redemptions.usdc6),
      hint: `USDC out · ${plural(folded.redemptions.count, "redemption")} from ${plural(
        folded.redemptions.accounts,
        "address",
        "addresses",
      )}`,
    },
    {
      key: "distributions",
      label: "Distributions to date",
      value: formatUsdc(folded.distributions.usdcAmount6),
      hint: `USDC paid into the vault · ${plural(folded.distributions.count, "distribution")}`,
    },
  ];
}

// --------------------------------------------------------------------------- supply and holders

export type Agreement = "match" | "mismatch" | "unchecked";

export interface SupplyModel {
  /** `totalSupply()`, or `null` when the contract could not be read. */
  onchain: string | null;
  onchainExact: string | null;
  /** Mints minus burns, folded from `Transfer`. */
  fromEvents: string;
  fromEventsExact: string;
  minted: string;
  burned: string;
  agreement: Agreement;
  transfers: string;
  holders: string;
  everHeld: string;
  holdersComplete: boolean;
  /** Addresses that fold to a negative balance — impossible on a complete log set. */
  negative: number;
}

export function buildSupplyModel(
  folded: ActivityAggregate,
  chainSupplyWei: bigint | null,
  indexComplete: boolean,
): SupplyModel {
  const balances = folded.balances;
  const holdersComplete = indexComplete && balances.negative.length === 0;

  return {
    onchain: chainSupplyWei === null ? null : formatTokens(chainSupplyWei, 6),
    onchainExact: chainSupplyWei === null ? null : formatTokensExact(chainSupplyWei),
    fromEvents: formatTokens(balances.supplyWei, 6),
    fromEventsExact: formatTokensExact(balances.supplyWei),
    minted: formatTokens(balances.mintedWei, 6),
    burned: formatTokens(balances.burnedWei, 6),
    agreement:
      chainSupplyWei === null
        ? "unchecked"
        : chainSupplyWei === balances.supplyWei
          ? "match"
          : "mismatch",
    transfers: formatCount(balances.transferCount),
    holders: holdersComplete ? formatCount(balances.holders) : `≥ ${formatCount(balances.holders)}`,
    everHeld: formatCount(balances.everHeld),
    holdersComplete,
    negative: balances.negative.length,
  };
}

// --------------------------------------------------------------------------- distributions

export interface DistributionsModel {
  count: string;
  /** `CouponDistributed.usdcAmount` — the headline. Six decimals, exactly as emitted. */
  paidIn: string;
  /** `CouponDistributed.usdcAllocated` — what the cumulative index attributed to holders. */
  allocated: string;
  /** `paidIn - allocated`: the PLAN.md D29 truncation remainder. Sub-cent by nature. */
  remainder: string;
  latestId: string | null;
  latestAt: string | null;
  claims: string;
  claimed: string;
  claimAccounts: string;
  /** `allocated - claimed`, the contract's `couponReserve`. `null` if it folds negative. */
  unclaimed: string | null;
}

export function buildDistributionsModel(folded: ActivityAggregate): DistributionsModel {
  const distributions = folded.distributions;
  const unclaimed6 = distributions.usdcAllocated6 - folded.claims.usdc6;

  return {
    count: formatCount(distributions.count),
    paidIn: formatUsdcExact(distributions.usdcAmount6),
    allocated: formatUsdcExact(distributions.usdcAllocated6),
    remainder: formatUsdcExact(distributions.truncationRemainder6),
    latestId: distributions.latestDistributionId?.toString() ?? null,
    latestAt:
      distributions.latestTimestamp === null
        ? null
        : formatUnixSeconds(distributions.latestTimestamp),
    claims: formatCount(folded.claims.count),
    claimed: formatUsdcExact(folded.claims.usdc6),
    claimAccounts: formatCount(folded.claims.accounts),
    unclaimed: unclaimed6 < 0n ? null : formatUsdcExact(unclaimed6),
  };
}

// --------------------------------------------------------------------------- flows over time

export interface FlowRow extends FlowBar {
  /** ISO date, for `<time dateTime>`. */
  date: string;
  /** The day's closing NAV per token, when NAV moved that day. */
  navClose: string | null;
}

export interface FlowModel {
  rows: FlowRow[];
  scale: AxisScale;
  daysShown: number;
  daysTotal: number;
  /** True when older days exist that this page does not show. */
  truncated: boolean;
  /** True when at least one subscription or redemption falls inside the shown window. */
  hasActivity: boolean;
  /** True when there is no subscription or redemption anywhere in the index. */
  emptyEverywhere: boolean;
  /** `false` when empty days were left out because the span was too long to enumerate. */
  daysFilled: boolean;
  firstDate: string | null;
  lastDate: string | null;
}

/**
 * Subscriptions and redemptions by UTC day.
 *
 * `out` is carried as a **negative** integer: the chart's down arm is the sign,
 * not a second axis, and the table shows the magnitude with the direction in the
 * column heading. `net` is `in - out` as a bigint, so it is exact even when the
 * two sides differ by a single micro-USDC.
 */
export function buildFlowModel(
  buckets: readonly DailyBucket[],
  daysFilled = true,
  maxDays = MAX_CHART_DAYS,
): FlowModel {
  const shown = buckets.length > maxDays ? buckets.slice(buckets.length - maxDays) : [...buckets];

  const rows: FlowRow[] = shown.map((bucket) => {
    const net6 = bucket.subscriptionsUsdcIn6 - bucket.redemptionsUsdcOut6;
    return {
      key: bucket.date,
      date: bucket.date,
      label: shortDate(bucket.date),
      fullLabel: formatDate(bucket.date),
      in: Number(bucket.subscriptionsUsdcIn6),
      // `-0` would serialise as `0` anyway, but keeping it a plain zero makes the
      // fixture assertions read the way the data does.
      out: bucket.redemptionsUsdcOut6 === 0n ? 0 : -Number(bucket.redemptionsUsdcOut6),
      inAmount: formatUsdc(bucket.subscriptionsUsdcIn6),
      outAmount: formatUsdc(bucket.redemptionsUsdcOut6),
      netAmount: formatFixed(net6, USDC_DECIMALS, { displayDecimals: 2, signDisplay: "always" }),
      subscriptions: bucket.subscriptionsCount,
      redemptions: bucket.redemptionsCount,
      navClose: bucket.navCloseUsdc6 === null ? null : formatUsdcExact(bucket.navCloseUsdc6),
    };
  });

  const highest = rows.reduce((top, row) => Math.max(top, row.in), 0);
  const lowest = rows.reduce((bottom, row) => Math.min(bottom, row.out), 0);

  const first = rows[0];
  const last = rows[rows.length - 1];

  return {
    rows,
    // Bars grow from a baseline, so the axis must contain zero; `integerAxisScale`
    // lands its low end on a multiple of the step, which puts zero on a tick.
    scale: integerAxisScale(lowest, highest, { targetIntervals: 4 }),
    daysShown: rows.length,
    daysTotal: buckets.length,
    truncated: buckets.length > rows.length,
    hasActivity: rows.some((row) => row.subscriptions > 0 || row.redemptions > 0),
    emptyEverywhere: buckets.every(
      (bucket) => bucket.subscriptionsCount === 0 && bucket.redemptionsCount === 0,
    ),
    daysFilled,
    firstDate: first ? first.fullLabel : null,
    lastDate: last ? last.fullLabel : null,
  };
}

// --------------------------------------------------------------------------- NAV on chain

export interface OnchainNavRow extends NavHistoryPoint {
  key: string;
  blockNumber: string;
  /** `"14 Sep 2026, 21:18 UTC"`, or `null` when the block's timestamp is not resolved. */
  time: string | null;
  isoTime: string | null;
  previousAmount: string;
  /** Signed change in NAV per token, to six decimals. */
  changeAmount: string;
  reportedAum: string;
  /** `true` when `NAVForced` sat in the same transaction: an admin bypassed the rail. */
  forced: boolean;
}

export interface NavModel {
  rows: OnchainNavRow[];
  scale: AxisScale;
  shown: number;
  total: number;
  truncated: boolean;
  latest: string | null;
  /** Points whose block timestamp is not resolved; they are plotted by position, not by time. */
  undated: number;
  forced: number;
}

/**
 * Every `NAVUpdated` the token has emitted, in block order.
 *
 * The x-axis is the sequence of NAV changes, not a time scale: NAV is pushed by
 * the oracle whenever the engine runs and by `distributeCoupon` at an
 * ex-distribution drop (PLAN.md D26), so the points are not evenly spaced in
 * time and the card says so rather than letting an even axis imply they are.
 */
export function buildNavModel(points: readonly NavPoint[], maxPoints = MAX_NAV_POINTS): NavModel {
  const shown = points.length > maxPoints ? points.slice(points.length - maxPoints) : [...points];

  const rows: OnchainNavRow[] = shown.map((point) => {
    const isoDate =
      point.timestamp === null ? null : isoDateFromDayIndex(dayIndex(point.timestamp));
    const change6 = point.navUsdc6 - point.previousNavUsdc6;
    return {
      key: `${point.blockNumber.toString()}-${point.transactionHash}`,
      // `date` is the `NavHistoryPoint` key the shared chart carries through; a
      // point with no resolved timestamp has no date, and says so rather than
      // borrowing its neighbour's.
      date: isoDate ?? "",
      label: isoDate === null ? `#${point.blockNumber.toString()}` : shortDate(isoDate),
      fullLabel:
        point.timestamp === null
          ? `Block ${formatCount(point.blockNumber)}`
          : formatUnixSeconds(point.timestamp),
      value: Number(point.navUsdc6),
      amount: formatUsdcExact(point.navUsdc6),
      blockNumber: formatCount(point.blockNumber),
      time: point.timestamp === null ? null : formatUnixSeconds(point.timestamp),
      isoTime: point.timestamp === null ? null : isoTimestampFromSeconds(point.timestamp),
      previousAmount: formatUsdcExact(point.previousNavUsdc6),
      changeAmount: formatFixed(change6, USDC_DECIMALS, {
        displayDecimals: USDC_DECIMALS,
        signDisplay: "always",
      }),
      reportedAum: formatUsdc(point.reportedAumUsdc6),
      forced: point.forced,
    };
  });

  const values = rows.map((row) => row.value);
  const last = rows[rows.length - 1];

  return {
    rows,
    // A line, not a bar: the axis is zoomed to the observed range, and the card
    // says so, because a zoomed axis exaggerates movement.
    scale:
      values.length > 0
        ? integerAxisScale(Math.min(...values), Math.max(...values))
        : integerAxisScale(0, 1_000_000, { zeroBased: true }),
    shown: rows.length,
    total: points.length,
    truncated: points.length > rows.length,
    latest: last ? last.amount : null,
    undated: rows.filter((row) => row.time === null).length,
    forced: rows.filter((row) => row.forced).length,
  };
}

// --------------------------------------------------------------------------- what the index holds

export interface EventCountRow {
  name: EventName;
  count: string;
  zero: boolean;
}

export function buildEventCounts(folded: ActivityAggregate): EventCountRow[] {
  return EVENT_NAMES.map((name) => ({
    name,
    count: formatCount(folded.eventCounts[name]),
    zero: folded.eventCounts[name] === 0,
  }));
}

export interface GapRow {
  key: string;
  range: string;
  blocks: string;
  reason: string;
}

export interface CoverageModel {
  fromBlock: string;
  toBlock: string;
  headBlock: string;
  deployBlock: string;
  blocksScanned: string;
  complete: boolean;
  /** The node's head is below the deploy block: nothing was scanned, so nothing was measured. */
  headBehindDeploy: boolean;
  gaps: GapRow[];
  gapBlocks: string;
  logRequests: string;
  chunkSize: string;
  eventsIndexed: string;
  duplicates: string;
  reorgConflicts: string;
  removedLogs: string;
  undecodableLogs: string;
  blocksTimestamped: string;
  blocksWithoutTimestamp: string;
  indexedAt: string;
  cacheAgeSeconds: number;
  cacheTtlSeconds: number;
  stale: boolean;
  staleReason: string | null;
}

export function buildCoverageModel(index: EventIndex, cache: CacheMeta): CoverageModel {
  const scanned = index.toBlock >= index.fromBlock ? index.toBlock - index.fromBlock + 1n : 0n;
  const gapBlocks = index.gaps.reduce(
    (total, gap) => total + (gap.toBlock - gap.fromBlock + 1n),
    0n,
  );

  return {
    fromBlock: formatCount(index.fromBlock),
    toBlock: formatCount(index.toBlock),
    headBlock: formatCount(index.headBlock),
    deployBlock: formatCount(index.deployBlock),
    blocksScanned: formatCount(scanned),
    complete: index.complete,
    headBehindDeploy: index.headBlock < index.deployBlock,
    gaps: index.gaps.map((gap) => ({
      key: `${gap.fromBlock.toString()}-${gap.toBlock.toString()}`,
      range: `${formatCount(gap.fromBlock)} – ${formatCount(gap.toBlock)}`,
      blocks: formatCount(gap.toBlock - gap.fromBlock + 1n),
      reason: gap.reason,
    })),
    gapBlocks: formatCount(gapBlocks),
    logRequests: formatCount(index.logRequests),
    chunkSize: formatCount(index.chunkSize),
    eventsIndexed: formatCount(index.events.length),
    duplicates: formatCount(index.duplicates),
    reorgConflicts: formatCount(index.reorgConflicts),
    removedLogs: formatCount(index.removedLogs),
    undecodableLogs: formatCount(index.undecodableLogs),
    blocksTimestamped: formatCount(index.blocksTimestamped),
    blocksWithoutTimestamp: formatCount(index.blocksWithoutTimestamp),
    indexedAt: formatUnixSeconds(Math.floor(index.builtAtMs / 1000)),
    cacheAgeSeconds: cache.ageSeconds,
    cacheTtlSeconds: cache.ttlSeconds,
    stale: cache.stale,
    staleReason: cache.staleReason,
  };
}

// --------------------------------------------------------------------------- the whole page

export interface StatsModelInput {
  index: EventIndex;
  cache: CacheMeta;
  folded: ActivityAggregate;
  /** `totalSupply()`, or `null` when the token contract could not be read. */
  chainSupplyWei: bigint | null;
  /** `coverageLimitations(index, cache)` — facts about this build, rendered verbatim. */
  limitations: readonly string[];
}

export interface StatsModel {
  chainId: SupportedChainId;
  network: string;
  tokenAddress: string;
  registryAddress: string;
  /**
   * `false` when the scan covered no blocks at all, so every count would be a
   * zero nobody measured. The page renders an explanation instead of figures.
   */
  measurable: boolean;
  figures: Figure[];
  supply: SupplyModel;
  distributions: DistributionsModel;
  flows: FlowModel;
  nav: NavModel;
  eventCounts: EventCountRow[];
  totalEvents: string;
  coverage: CoverageModel;
  limitations: string[];
  /** Events with no resolved block timestamp, and therefore in no daily bucket. */
  undatedEvents: string;
  undatedEventCount: number;
  pauses: { paused: string; unpaused: string };
  verifications: { verified: string; removed: string; current: string };
}

export function buildStatsModel({
  index,
  cache,
  folded,
  chainSupplyWei,
  limitations,
}: StatsModelInput): StatsModel {
  const coverage = buildCoverageModel(index, cache);
  const supply = buildSupplyModel(folded, chainSupplyWei, index.complete);

  return {
    chainId: index.chainId,
    network: index.network,
    tokenAddress: index.tokenAddress,
    registryAddress: index.registryAddress,
    measurable: !coverage.headBehindDeploy,
    figures: buildFigures(folded, chainSupplyWei, supply.holdersComplete),
    supply,
    distributions: buildDistributionsModel(folded),
    flows: buildFlowModel(folded.daily.buckets, folded.daily.filled),
    nav: buildNavModel(folded.navPoints),
    eventCounts: buildEventCounts(folded),
    totalEvents: formatCount(index.events.length),
    coverage,
    limitations: [...limitations],
    undatedEvents: formatCount(folded.daily.undated),
    undatedEventCount: folded.daily.undated,
    pauses: {
      paused: formatCount(folded.pauseCount),
      unpaused: formatCount(folded.unpauseCount),
    },
    verifications: {
      verified: formatCount(folded.verifications.verified),
      removed: formatCount(folded.verifications.removed),
      current: formatCount(folded.verifications.currentlyVerified),
    },
  };
}
