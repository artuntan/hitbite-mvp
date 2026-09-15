import { describe, expect, it } from "vitest";

import {
  aggregate,
  isoDateFromDayIndex,
  SECONDS_PER_DAY,
  type IndexedEvent,
} from "@/lib/server/events";
import type { CacheMeta, EventIndex } from "@/lib/server/indexer";
import type { EventName, EventSource } from "@/lib/schemas";
import type { Address, Hex } from "viem";

import {
  buildCoverageModel,
  buildDistributionsModel,
  buildFigures,
  buildFlowModel,
  buildNavModel,
  buildStatsModel,
  buildSupplyModel,
} from "./view-model";

/**
 * The view model is the only place between the chain and the page where a number
 * can change, so every one of these asserts on a string a reader would see,
 * computed from the integer a contract would emit.
 *
 * Fixtures are `IndexedEvent`s rather than raw logs: decoding is
 * `lib/server/__tests__/events.test.ts`'s job, and repeating it here would test
 * viem instead of this file.
 */

const TOKEN = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" as Address;
const REGISTRY = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;
const ZERO = "0x0000000000000000000000000000000000000000";
const ALICE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BOB = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

/** Day 20,300 since the epoch, midday, so nothing sits on a bucket boundary. */
const DAY_ONE = 20_300;
const NOON = SECONDS_PER_DAY / 2;

let nextLogIndex = 0;

function event(
  name: EventName,
  blockNumber: number,
  args: Record<string, string>,
  options: {
    timestamp?: number | null;
    source?: EventSource;
    transactionHash?: string;
  } = {},
): IndexedEvent {
  nextLogIndex += 1;
  return {
    name,
    source: options.source ?? "token",
    address: options.source === "registry" ? REGISTRY : TOKEN,
    blockNumber: BigInt(blockNumber),
    blockHash: `0x${blockNumber.toString(16).padStart(64, "0")}` as Hex,
    logIndex: nextLogIndex,
    transactionHash: (options.transactionHash ??
      `0x${nextLogIndex.toString(16).padStart(64, "0")}`) as Hex,
    transactionIndex: 0,
    args,
    accounts: [],
    blockTimestamp:
      options.timestamp === undefined ? DAY_ONE * SECONDS_PER_DAY + NOON : options.timestamp,
  };
}

function transfer(
  from: string,
  to: string,
  valueWei: bigint,
  blockNumber: number,
  timestamp?: number | null,
): IndexedEvent {
  return event("Transfer", blockNumber, { from, to, value: valueWei.toString() }, { timestamp });
}

const TOKENS = 1_000_000_000_000_000_000n;

/** A small but complete history: one subscription, a NAV push, a coupon, a claim, a redemption. */
function history(): IndexedEvent[] {
  const day1 = DAY_ONE * SECONDS_PER_DAY + NOON;
  const day3 = (DAY_ONE + 2) * SECONDS_PER_DAY + NOON;

  return [
    // Day 1 — Alice subscribes 1,000.00 USDC at NAV 1.000000 and gets 1,000 hbTRS.
    transfer(ZERO, ALICE, 1_000n * TOKENS, 10, day1),
    event(
      "Subscribed",
      10,
      {
        account: ALICE,
        usdcIn: "1000000000",
        tokensOut: (1_000n * TOKENS).toString(),
        nav: "1000000",
      },
      { timestamp: day1 },
    ),
    // Day 1 — the oracle pushes NAV to 1.004300.
    event(
      "NAVUpdated",
      11,
      { oldNav: "1000000", newNav: "1004300", reportedAUM: "1004300", by: ALICE },
      { timestamp: day1 },
    ),
    // Day 3 — a 12.000000 USDC coupon; 0.000001 truncates away and stays vault liquidity (D29).
    event(
      "CouponDistributed",
      20,
      {
        distributionId: "1",
        usdcAmount: "12000000",
        usdcAllocated: "11999999",
        indexIncrement: "11999",
        newIndex: "11999",
      },
      { timestamp: day3 },
    ),
    event("CouponClaimed", 21, { account: ALICE, usdcAmount: "11999999" }, { timestamp: day3 }),
    // Day 3 — Alice redeems 200 hbTRS for 200.860000 USDC.
    transfer(ALICE, ZERO, 200n * TOKENS, 22, day3),
    event(
      "Redeemed",
      22,
      {
        account: ALICE,
        tokensIn: (200n * TOKENS).toString(),
        usdcOut: "200860000",
        nav: "1004300",
      },
      { timestamp: day3 },
    ),
    // Day 3 — Alice sends 100 hbTRS to Bob, so there are two holders.
    transfer(ALICE, BOB, 100n * TOKENS, 23, day3),
  ];
}

function index(overrides: Partial<EventIndex> = {}): EventIndex {
  return {
    chainId: 31337,
    network: "anvil",
    tokenAddress: TOKEN,
    registryAddress: REGISTRY,
    deployBlock: 1n,
    fromBlock: 1n,
    toBlock: 100n,
    headBlock: 100n,
    events: [],
    complete: true,
    gaps: [],
    chunkSize: 10_000n,
    logRequests: 1,
    duplicates: 0,
    reorgConflicts: 0,
    removedLogs: 0,
    undecodableLogs: 0,
    problems: [],
    blocksTimestamped: 4,
    blocksWithoutTimestamp: 0,
    builtAtMs: 1_789_420_690_000,
    ...overrides,
  };
}

const cache: CacheMeta = {
  hit: false,
  ageSeconds: 0,
  ttlSeconds: 60,
  stale: false,
  staleReason: null,
};

describe("headline figures", () => {
  it("formats every figure from the integer the contract emitted", () => {
    const folded = aggregate(history());
    const figures = buildFigures(folded, 700n * TOKENS, true);
    const byKey = Object.fromEntries(figures.map((figure) => [figure.key, figure]));

    // 1,000 minted - 200 burned = 800 on chain... but the chain is the authority,
    // and here it is told 700, so the figure follows the chain, not the fold.
    expect(byKey.supply?.value).toBe("700.0000");
    expect(byKey.holders?.value).toBe("2");
    expect(byKey.subscriptions?.value).toBe("1,000.00");
    expect(byKey.redemptions?.value).toBe("200.86");
    expect(byKey.distributions?.value).toBe("12.00");
    expect(byKey.distributions?.hint).toContain("paid into the vault");
  });

  it("writes a holder count the index can only bound from below as a floor", () => {
    const folded = aggregate(history());

    expect(buildFigures(folded, null, true)[0]?.value).toBe("2");
    expect(buildFigures(folded, null, false)[0]?.value).toBe("≥ 2");
    expect(buildFigures(folded, null, false)[0]?.hint).toContain("floor");
  });

  it("names the source of the supply figure, so a folded one is never mistaken for the contract's", () => {
    const folded = aggregate(history());

    expect(buildFigures(folded, 800n * TOKENS, true)[1]?.hint).toContain("totalSupply()");
    expect(buildFigures(folded, null, true)[1]?.hint).toContain("Transfer logs");
    // With no contract read the figure falls back to the fold: 1,000 minted - 200 burned.
    expect(buildFigures(folded, null, true)[1]?.value).toBe("800.0000");
  });
});

describe("supply and holders", () => {
  it("compares the folded supply with the contract as integers", () => {
    const folded = aggregate(history());

    expect(buildSupplyModel(folded, 800n * TOKENS, true).agreement).toBe("match");
    expect(buildSupplyModel(folded, 800n * TOKENS + 1n, true).agreement).toBe("mismatch");
    expect(buildSupplyModel(folded, null, true).agreement).toBe("unchecked");
  });

  it("never counts the zero address as a holder", () => {
    // Every mint and burn above has the zero address on one side; only Alice and
    // Bob hold anything at the end.
    const model = buildSupplyModel(aggregate(history()), 800n * TOKENS, true);

    expect(model.holders).toBe("2");
    expect(model.everHeld).toBe("2");
    expect(model.minted).toBe("1,000.000000");
    expect(model.burned).toBe("200.000000");
    expect(model.fromEvents).toBe("800.000000");
  });

  it("treats an incomplete scan, and a negative fold, as a floor", () => {
    const folded = aggregate(history());
    expect(buildSupplyModel(folded, null, false).holders).toBe("≥ 2");
    expect(buildSupplyModel(folded, null, false).holdersComplete).toBe(false);

    // A burn with no matching mint can only mean the index is missing transfers.
    const holed = aggregate([transfer(ALICE, ZERO, 5n * TOKENS, 10)]);
    const model = buildSupplyModel(holed, null, true);
    expect(model.negative).toBe(1);
    expect(model.holdersComplete).toBe(false);
    expect(model.holders).toBe("≥ 0");
  });
});

describe("distributions to date", () => {
  it("shows what was paid in, what was allocated, and the D29 remainder between them", () => {
    const model = buildDistributionsModel(aggregate(history()));

    expect(model.paidIn).toBe("12.000000");
    expect(model.allocated).toBe("11.999999");
    // Sub-cent by construction: at two decimals this would read as 0.00 and look
    // like nothing, which is exactly the number this page must not hide.
    expect(model.remainder).toBe("0.000001");
    expect(model.count).toBe("1");
    expect(model.latestId).toBe("1");
  });

  it("derives the coupon reserve, and refuses to show it negative", () => {
    expect(buildDistributionsModel(aggregate(history())).unclaimed).toBe("0.000000");

    const claimsOnly = aggregate([event("CouponClaimed", 5, { account: ALICE, usdcAmount: "1" })]);
    expect(buildDistributionsModel(claimsOnly).unclaimed).toBeNull();
  });
});

describe("subscriptions and redemptions over time", () => {
  it("buckets by UTC day and carries redemptions as the negative arm", () => {
    const model = buildFlowModel(aggregate(history()).daily.buckets);

    // Day 1 and day 3 have activity; day 2 is filled in as a zero row by the index.
    expect(model.rows.map((row) => row.date)).toEqual([
      isoDateFromDayIndex(DAY_ONE),
      isoDateFromDayIndex(DAY_ONE + 1),
      isoDateFromDayIndex(DAY_ONE + 2),
    ]);

    const [first, middle, last] = model.rows;
    expect(first?.in).toBe(1_000_000_000);
    expect(first?.out).toBe(0);
    expect(first?.inAmount).toBe("1,000.00");
    expect(first?.netAmount).toBe("+1,000.00");

    expect(middle?.in).toBe(0);
    expect(middle?.out).toBe(0);
    expect(middle?.netAmount).toBe("0.00");

    // The sign is what puts the arm below the rule; the table shows the magnitude.
    expect(last?.out).toBe(-200_860_000);
    expect(last?.outAmount).toBe("200.86");
    expect(last?.netAmount).toBe("-200.86");
    expect(last?.navClose).toBeNull();
    expect(first?.navClose).toBe("1.004300");
  });

  it("gives the diverging axis a zero tick with both arms inside it", () => {
    const { scale } = buildFlowModel(aggregate(history()).daily.buckets);

    expect(scale.ticks).toContain(0);
    expect(scale.domain[0]).toBeLessThanOrEqual(-200_860_000);
    expect(scale.domain[1]).toBeGreaterThanOrEqual(1_000_000_000);
  });

  it("shows the most recent days and says when older ones are left out", () => {
    const buckets = aggregate(history()).daily.buckets;
    const model = buildFlowModel(buckets, true, 2);

    expect(model.daysShown).toBe(2);
    expect(model.daysTotal).toBe(3);
    expect(model.truncated).toBe(true);
    expect(model.rows[0]?.date).toBe(isoDateFromDayIndex(DAY_ONE + 1));
  });

  it("distinguishes an empty window from an empty history", () => {
    const quiet = aggregate([
      event("NAVUpdated", 5, { oldNav: "1000000", newNav: "1000001", reportedAUM: "0", by: ALICE }),
    ]);
    const model = buildFlowModel(quiet.daily.buckets);

    expect(model.hasActivity).toBe(false);
    expect(model.emptyEverywhere).toBe(true);
  });
});

describe("NAV recorded on chain", () => {
  it("formats the change from the two integers the event carried", () => {
    const model = buildNavModel(aggregate(history()).navPoints);

    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]?.previousAmount).toBe("1.000000");
    expect(model.rows[0]?.amount).toBe("1.004300");
    expect(model.rows[0]?.changeAmount).toBe("+0.004300");
    expect(model.latest).toBe("1.004300");
    expect(model.forced).toBe(0);
  });

  it("marks a change forced past the rail by the transaction it shares with NAVForced", () => {
    // A fabricated transaction hash, not a key: NAVForced and the NAVUpdated it
    // qualifies are emitted by the same `setNAV` call, so the flag is resolved
    // per transaction and the two fixtures have to share one hash.
    const tx = "0xfeed000000000000000000000000000000000000000000000000000000000001"; // allow-secret
    const model = buildNavModel(
      aggregate([
        event(
          "NAVUpdated",
          5,
          { oldNav: "1004300", newNav: "0900000", reportedAUM: "900000", by: ALICE },
          { transactionHash: tx },
        ),
        event(
          "NAVForced",
          5,
          { oldNav: "1004300", newNav: "900000", by: ALICE },
          {
            transactionHash: tx,
          },
        ),
      ]).navPoints,
    );

    expect(model.rows[0]?.forced).toBe(true);
    expect(model.rows[0]?.changeAmount).toBe("-0.104300");
    expect(model.forced).toBe(1);
  });

  it("labels a point with no resolved timestamp by its block, never by a neighbour's date", () => {
    const model = buildNavModel(
      aggregate([
        event(
          "NAVUpdated",
          4_096,
          { oldNav: "1000000", newNav: "1000100", reportedAUM: "0", by: ALICE },
          { timestamp: null },
        ),
      ]).navPoints,
    );

    expect(model.rows[0]?.time).toBeNull();
    expect(model.rows[0]?.date).toBe("");
    expect(model.rows[0]?.label).toBe("#4096");
    expect(model.rows[0]?.fullLabel).toBe("Block 4,096");
    expect(model.undated).toBe(1);
  });

  it("keeps the most recent points when there are more than the cap", () => {
    const points = aggregate(
      Array.from({ length: 5 }, (_, i) =>
        event("NAVUpdated", 100 + i, {
          oldNav: "1000000",
          newNav: (1_000_000 + i).toString(),
          reportedAUM: "0",
          by: ALICE,
        }),
      ),
    ).navPoints;

    const model = buildNavModel(points, 2);
    expect(model.shown).toBe(2);
    expect(model.total).toBe(5);
    expect(model.truncated).toBe(true);
    expect(model.rows[1]?.amount).toBe("1.000004");
  });
});

describe("coverage", () => {
  it("counts the blocks the scan actually covered", () => {
    const model = buildCoverageModel(index({ fromBlock: 1n, toBlock: 10_000n }), cache);

    expect(model.blocksScanned).toBe("10,000");
    expect(model.complete).toBe(true);
    expect(model.headBehindDeploy).toBe(false);
  });

  it("reports a node whose head is below the deploy block as nothing scanned", () => {
    const model = buildCoverageModel(
      index({ deployBlock: 5n, fromBlock: 5n, toBlock: 0n, headBlock: 0n }),
      cache,
    );

    expect(model.headBehindDeploy).toBe(true);
    expect(model.blocksScanned).toBe("0");
  });

  it("carries every gap with its reason and the blocks it covers", () => {
    const model = buildCoverageModel(
      index({
        complete: false,
        gaps: [{ fromBlock: 10n, toBlock: 19n, reason: "the node refused the range" }],
      }),
      cache,
    );

    expect(model.complete).toBe(false);
    expect(model.gapBlocks).toBe("10");
    expect(model.gaps[0]?.range).toBe("10 – 19");
    expect(model.gaps[0]?.reason).toBe("the node refused the range");
  });
});

describe("the whole page model", () => {
  it("is measurable when blocks were scanned and not when none were", () => {
    const events = history();
    const folded = aggregate(events);

    const built = buildStatsModel({
      index: index({ events }),
      cache,
      folded,
      chainSupplyWei: 800n * TOKENS,
      limitations: ["only what this build managed"],
    });

    expect(built.measurable).toBe(true);
    expect(built.totalEvents).toBe("8");
    expect(built.eventCounts.find((row) => row.name === "Transfer")?.count).toBe("3");
    expect(built.eventCounts.find((row) => row.name === "Paused")?.zero).toBe(true);
    expect(built.limitations).toEqual(["only what this build managed"]);
    expect(built.undatedEvents).toBe("0");

    const behind = buildStatsModel({
      index: index({ events, deployBlock: 5n, fromBlock: 5n, toBlock: 0n, headBlock: 0n }),
      cache,
      folded,
      chainSupplyWei: null,
      limitations: [],
    });
    expect(behind.measurable).toBe(false);
  });
});
