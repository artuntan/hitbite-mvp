/**
 * The decisions the indexer makes from logs alone, tested against fixture logs.
 *
 * Every log here is **encoded with viem against the generated ABI** and then decoded back, so the
 * argument order these tests assert on is the order `contracts/src/interfaces/` declares — not an
 * order written out by hand in a fixture, which would agree with a wrong decoder.
 *
 * No 32-byte hex literal appears in this file. Transaction and block hashes are generated from a
 * counter, because `scripts/check-secrets.sh` cannot tell a transaction hash from a private key
 * and it is right not to try.
 */

import { encodeAbiParameters, encodeEventTopics, type AbiParameter, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { chainEventSchema, EVENT_NAMES, type EventName } from "../../schemas";
import {
  aggregate,
  argBigInt,
  bucketByDay,
  compareEvents,
  dayIndex,
  decodeLog,
  decodeLogs,
  dedupeEvents,
  EVENT_DEFINITION_BY_NAME,
  EVENT_DEFINITIONS,
  filterEvents,
  foldBalances,
  formatCursor,
  isoDateFromDayIndex,
  isoTimestampFromSeconds,
  matchesAccount,
  paginate,
  parseCursor,
  toWireEvent,
  withTimestamps,
  ZERO_ADDRESS,
  type IndexedEvent,
  type RawLog,
} from "../events";

// --------------------------------------------------------------------------- fixtures

const TOKEN = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const REGISTRY = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
// Digit-only addresses: their EIP-55 checksum is themselves, so an expectation can be written
// as the same literal the fixture used.
const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";
const ADMIN = "0x3333333333333333333333333333333333333333";

const ONE_TOKEN = 10n ** 18n;

/** A deterministic 32-byte hash from a counter. No hash literal appears in this file. */
function hashOf(seed: number): Hex {
  return `0x${seed.toString(16).padStart(64, "0")}` as Hex;
}

interface LogOptions {
  readonly block: number;
  readonly logIndex: number;
  /** Defaults to a hash derived from the block, so two logs in a block share a transaction. */
  readonly tx?: number;
  readonly blockHash?: number;
  readonly transactionIndex?: number;
  readonly removed?: boolean;
}

/** Encode a log the way the chain would, from the generated ABI. */
function makeLog(name: EventName, args: Record<string, unknown>, options: LogOptions): RawLog {
  const definition = EVENT_DEFINITION_BY_NAME[name];
  const topics = encodeEventTopics({
    abi: [definition.abi],
    eventName: name,
    args: args as never,
  }) as Hex[];
  const unindexed = definition.abi.inputs.filter((input) => input.indexed !== true);
  const data =
    unindexed.length === 0
      ? "0x"
      : encodeAbiParameters(
          unindexed as AbiParameter[],
          unindexed.map((input) => args[input.name ?? ""]) as never,
        );
  return {
    address: definition.source === "registry" ? REGISTRY : TOKEN,
    topics,
    data,
    blockNumber: BigInt(options.block),
    blockHash: hashOf(options.blockHash ?? options.block),
    logIndex: options.logIndex,
    transactionHash: hashOf(options.tx ?? 1_000_000 + options.block),
    transactionIndex: options.transactionIndex ?? 0,
    removed: options.removed,
  };
}

function decodeOne(raw: RawLog): IndexedEvent {
  const outcome = decodeLog(raw);
  if (outcome.status !== "ok") throw new Error(`fixture did not decode: ${outcome.reason}`);
  return outcome.event;
}

function index(logs: readonly RawLog[]): IndexedEvent[] {
  return dedupeEvents(decodeLogs(logs).events).events as IndexedEvent[];
}

function dated(event: IndexedEvent, timestamp: number): IndexedEvent {
  return { ...event, blockTimestamp: timestamp };
}

// --------------------------------------------------------------------------- the catalogue

describe("the event catalogue", () => {
  it("covers every event the two interfaces declare as product events", () => {
    expect(EVENT_DEFINITIONS.map((definition) => definition.name)).toEqual([...EVENT_NAMES]);
    expect(EVENT_DEFINITIONS).toHaveLength(14);
  });

  it("gives every event a distinct topics[0]", () => {
    const topics = new Set(EVENT_DEFINITIONS.map((definition) => definition.topic0.toLowerCase()));
    expect(topics.size).toBe(EVENT_DEFINITIONS.length);
  });

  it("reads the signatures from the ABI rather than from a guess", () => {
    // The argument orders a reviewer would check by hand against contracts/src/interfaces/.
    expect(EVENT_DEFINITION_BY_NAME.NAVForced.signature).toBe("NAVForced(uint256,uint256,address)");
    expect(EVENT_DEFINITION_BY_NAME.CouponDistributed.signature).toBe(
      "CouponDistributed(uint256,uint256,uint256,uint256,uint256)",
    );
    expect(EVENT_DEFINITION_BY_NAME.Subscribed.signature).toBe(
      "Subscribed(address,uint256,uint256,uint256)",
    );
    expect(EVENT_DEFINITION_BY_NAME.IdentityVerified.signature).toBe(
      "IdentityVerified(address,uint16,uint8,uint64)",
    );
  });

  it("routes registry events to the registry and everything else to the token", () => {
    expect(EVENT_DEFINITION_BY_NAME.IdentityVerified.source).toBe("registry");
    expect(EVENT_DEFINITION_BY_NAME.CountryBlockStatusChanged.source).toBe("registry");
    expect(EVENT_DEFINITION_BY_NAME.Transfer.source).toBe("token");
    expect(EVENT_DEFINITION_BY_NAME.Paused.source).toBe("token");
  });
});

// --------------------------------------------------------------------------- decoding

describe("decoding", () => {
  it("decodes a Subscribed into the exact integers the contract emitted", () => {
    const event = decodeOne(
      makeLog(
        "Subscribed",
        {
          account: ALICE,
          usdcIn: 1_000_000_000n,
          tokensOut: 996_412_000_000_000_000_000n,
          nav: 1_003_600n,
        },
        { block: 12, logIndex: 3 },
      ),
    );

    expect(event.name).toBe("Subscribed");
    expect(event.source).toBe("token");
    expect(event.args).toEqual({
      account: ALICE,
      usdcIn: "1000000000",
      tokensOut: "996412000000000000000",
      nav: "1003600",
    });
    expect(event.accounts).toEqual([ALICE.toLowerCase()]);
    expect(event.blockNumber).toBe(12n);
    expect(event.logIndex).toBe(3);
    expect(event.blockTimestamp).toBeNull();
  });

  it("keeps CouponDistributed's usdcAmount and usdcAllocated apart", () => {
    const event = decodeOne(
      makeLog(
        "CouponDistributed",
        {
          distributionId: 1n,
          usdcAmount: 12_000_000n,
          usdcAllocated: 11_999_999n,
          couponIndex: 8_000_000_000_000n,
          totalSupply: 1_500n * ONE_TOKEN,
        },
        { block: 20, logIndex: 0 },
      ),
    );

    expect(event.args.usdcAmount).toBe("12000000");
    expect(event.args.usdcAllocated).toBe("11999999");
    expect(event.args.distributionId).toBe("1");
  });

  it("decodes the registry's non-256-bit arguments", () => {
    const event = decodeOne(
      makeLog(
        "IdentityVerified",
        { account: BOB, country: 784, investorType: 1, verifiedAt: 1_789_420_690n },
        { block: 5, logIndex: 1 },
      ),
    );

    expect(event.source).toBe("registry");
    expect(event.args).toEqual({
      account: BOB,
      country: "784",
      investorType: "1",
      verifiedAt: "1789420690",
    });
  });

  it("decodes a boolean argument as a word, not as a number", () => {
    const event = decodeOne(
      makeLog(
        "CountryBlockStatusChanged",
        { country: 840, blocked: true },
        { block: 2, logIndex: 0 },
      ),
    );
    expect(event.args).toEqual({ country: "840", blocked: "true" });
  });

  it("skips a log the node marked removed, a foreign topic, and a log that will not decode", () => {
    const removed = makeLog(
      "Transfer",
      { from: ALICE, to: BOB, value: 1n },
      {
        block: 3,
        logIndex: 0,
        removed: true,
      },
    );
    const foreign: RawLog = { ...removed, removed: false, topics: [hashOf(999)] };
    const broken = makeLog(
      "Transfer",
      { from: ALICE, to: BOB, value: 1n },
      { block: 4, logIndex: 0 },
    );
    const truncated: RawLog = { ...broken, data: "0x00" };

    const report = decodeLogs([removed, foreign, truncated]);

    expect(report.events).toHaveLength(0);
    expect(report.removed).toBe(1);
    expect(report.unknown).toBe(1);
    expect(report.undecodable).toBe(1);
    expect(report.problems[0]).toContain("Transfer");
  });
});

// --------------------------------------------------------------------------- dedup and reorgs

describe("deduplication across a reorg", () => {
  const original = makeLog(
    "CouponClaimed",
    { account: ALICE, usdcAmount: 8_000_000n },
    {
      block: 30,
      logIndex: 2,
      tx: 71,
      blockHash: 300,
    },
  );

  it("drops an exact repeat of the same log without comment", () => {
    const report = dedupeEvents([decodeOne(original), decodeOne(original)]);

    expect(report.events).toHaveLength(1);
    expect(report.duplicates).toBe(1);
    expect(report.conflicts).toBe(0);
  });

  it("treats a different transaction in the same slot as a reorg and keeps the later view", () => {
    // Block 30 is re-mined: same height, same log index, a different transaction and a different
    // block hash. Keying on (block, logIndex) alone would call these the same event.
    const reorged = makeLog(
      "CouponClaimed",
      { account: BOB, usdcAmount: 4_000_000n },
      {
        block: 30,
        logIndex: 2,
        tx: 72,
        blockHash: 301,
      },
    );

    const report = dedupeEvents([decodeOne(original), decodeOne(reorged)]);

    expect(report.events).toHaveLength(1);
    expect(report.duplicates).toBe(0);
    expect(report.conflicts).toBe(1);
    expect(report.conflictSlots).toEqual(["30:2"]);
    const [kept] = report.events;
    expect(kept?.args.account).toBe(BOB);
    expect(kept?.transactionHash).toBe(hashOf(72));
  });

  it("returns one event per slot, ascending, whatever order the chunks arrived in", () => {
    const logs = [
      makeLog("Paused", { account: ADMIN }, { block: 40, logIndex: 1 }),
      makeLog("Unpaused", { account: ADMIN }, { block: 12, logIndex: 0 }),
      makeLog("Paused", { account: ADMIN }, { block: 40, logIndex: 0 }),
    ];
    const report = dedupeEvents(decodeLogs(logs).events);

    expect(
      report.events.map((event) => `${event.blockNumber.toString()}:${event.logIndex.toString()}`),
    ).toEqual(["12:0", "40:0", "40:1"]);
    expect(
      report.events.every((event, i) => i === 0 || compareEvents(report.events[i - 1]!, event) < 0),
    ).toBe(true);
  });

  it("attaches timestamps by block hash, so a re-mined height does not inherit one", () => {
    const events = index([original]);
    const byHash = new Map<string, number>([[hashOf(300).toLowerCase(), 1_789_420_690]]);

    expect(withTimestamps(events, byHash)[0]?.blockTimestamp).toBe(1_789_420_690);

    const reorged = index([
      makeLog(
        "CouponClaimed",
        { account: ALICE, usdcAmount: 8_000_000n },
        {
          block: 30,
          logIndex: 2,
          tx: 71,
          blockHash: 302,
        },
      ),
    ]);
    expect(withTimestamps(reorged, byHash)[0]?.blockTimestamp).toBeNull();
  });
});

// --------------------------------------------------------------------------- the account filter

describe("the account filter", () => {
  const logs = [
    makeLog("Transfer", { from: ALICE, to: BOB, value: ONE_TOKEN }, { block: 10, logIndex: 0 }),
    makeLog(
      "NAVForced",
      { oldNav: 1_000_000n, newNav: 1_100_000n, by: ADMIN },
      { block: 11, logIndex: 0 },
    ),
    makeLog(
      "IdentityVerified",
      { account: ALICE, country: 276, investorType: 1, verifiedAt: 1n },
      {
        block: 12,
        logIndex: 0,
      },
    ),
    makeLog("CouponClaimed", { account: BOB, usdcAmount: 5n }, { block: 13, logIndex: 0 }),
    makeLog("OperationalMint", { to: ALICE, amount: ONE_TOKEN }, { block: 14, logIndex: 0 }),
  ];
  const events = index(logs);

  it("matches an address in the first argument", () => {
    const names = filterEvents(events, { account: BOB }).map((event) => event.name);
    // Transfer.to is the *second* argument and CouponClaimed.account is the first.
    expect(names).toEqual(["Transfer", "CouponClaimed"]);
  });

  it("matches an address in the last argument", () => {
    // NAVForced(uint256 oldNav, uint256 newNav, address indexed by): the only address is third.
    expect(filterEvents(events, { account: ADMIN }).map((event) => event.name)).toEqual([
      "NAVForced",
    ]);
  });

  it("matches every position at once for an address that appears in several", () => {
    expect(filterEvents(events, { account: ALICE }).map((event) => event.name)).toEqual([
      "Transfer",
      "IdentityVerified",
      "OperationalMint",
    ]);
  });

  it("is case-insensitive", () => {
    expect(filterEvents(events, { account: ALICE.toUpperCase().replace("0X", "0x") })).toHaveLength(
      3,
    );
  });

  it("does not match the emitting contract's own address", () => {
    expect(filterEvents(events, { account: TOKEN })).toHaveLength(0);
    expect(filterEvents(events, { account: REGISTRY })).toHaveLength(0);
    expect(matchesAccount(events[0]!, TOKEN)).toBe(false);
  });

  it("combines with the name and block filters", () => {
    expect(
      filterEvents(events, { account: ALICE, names: ["Transfer", "OperationalMint"] }).map(
        (event) => event.name,
      ),
    ).toEqual(["Transfer", "OperationalMint"]);
    expect(
      filterEvents(events, { fromBlock: 12n, toBlock: 13n }).map((event) => event.name),
    ).toEqual(["IdentityVerified", "CouponClaimed"]);
  });
});

// --------------------------------------------------------------------------- pagination

describe("cursor pagination", () => {
  const CHAIN = 31337;
  const events = index(
    [10, 11, 12, 13, 14].map((block) =>
      makeLog("Transfer", { from: ALICE, to: BOB, value: ONE_TOKEN }, { block, logIndex: 0 }),
    ),
  );

  it("walks the whole set newest first, without repeating or dropping an event", () => {
    const seen: number[] = [];
    let cursor = null as ReturnType<typeof parseCursor> | null;
    let next: string | null = null;
    do {
      const parsed = next === null ? null : parseCursor(next);
      cursor = parsed;
      const page = paginate(events, {
        chainId: CHAIN,
        order: "desc",
        limit: 2,
        cursor: parsed?.status === "ok" ? parsed.cursor : null,
      });
      seen.push(...page.events.map((event) => Number(event.blockNumber)));
      next = page.nextCursor;
    } while (next !== null);

    expect(seen).toEqual([14, 13, 12, 11, 10]);
    expect(cursor?.status).toBe("ok");
  });

  it("keeps a page stable when new events arrive at the head", () => {
    const first = paginate(events, { chainId: CHAIN, order: "desc", limit: 2 });
    expect(first.events.map((event) => Number(event.blockNumber))).toEqual([14, 13]);
    expect(first.nextCursor).toBe(`${CHAIN}:13:0`);

    const withNewHead = index([
      ...[10, 11, 12, 13, 14, 15, 16].map((block) =>
        makeLog("Transfer", { from: ALICE, to: BOB, value: ONE_TOKEN }, { block, logIndex: 0 }),
      ),
    ]);

    const parsed = parseCursor(first.nextCursor!);
    expect(parsed.status).toBe("ok");
    const second = paginate(withNewHead, {
      chainId: CHAIN,
      order: "desc",
      limit: 2,
      cursor: parsed.status === "ok" ? parsed.cursor : null,
    });

    // A cursor is a position. Two new events at the head would have shifted an offset by two and
    // made page two repeat blocks 14 and 13; the cursor still resumes exactly below block 13.
    expect(second.events.map((event) => Number(event.blockNumber))).toEqual([12, 11]);
  });

  it("orders ascending on request, with the cursor pointing the other way", () => {
    const page = paginate(events, { chainId: CHAIN, order: "asc", limit: 2 });
    expect(page.events.map((event) => Number(event.blockNumber))).toEqual([10, 11]);

    const parsed = parseCursor(page.nextCursor!);
    const second = paginate(events, {
      chainId: CHAIN,
      order: "asc",
      limit: 2,
      cursor: parsed.status === "ok" ? parsed.cursor : null,
    });
    expect(second.events.map((event) => Number(event.blockNumber))).toEqual([12, 13]);
  });

  it("separates two logs in the same block by log index", () => {
    const sameBlock = index([
      makeLog("Transfer", { from: ALICE, to: BOB, value: 1n }, { block: 50, logIndex: 0 }),
      makeLog(
        "Subscribed",
        { account: BOB, usdcIn: 1n, tokensOut: 1n, nav: 1n },
        {
          block: 50,
          logIndex: 1,
        },
      ),
    ]);
    const page = paginate(sameBlock, { chainId: CHAIN, order: "desc", limit: 1 });
    expect(page.nextCursor).toBe(`${CHAIN}:50:1`);

    const parsed = parseCursor(page.nextCursor!);
    const second = paginate(sameBlock, {
      chainId: CHAIN,
      order: "desc",
      limit: 1,
      cursor: parsed.status === "ok" ? parsed.cursor : null,
    });
    expect(second.events[0]?.logIndex).toBe(0);
    expect(second.hasMore).toBe(false);
  });

  it("reports the last page without a cursor, and refuses a malformed one", () => {
    const page = paginate(events, { chainId: CHAIN, order: "desc", limit: 50 });
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
    expect(page.remaining).toBe(5);

    expect(parseCursor("not-a-cursor").status).toBe("invalid");
    expect(parseCursor("31337:13").status).toBe("invalid");
    expect(parseCursor("31337:13:abc").status).toBe("invalid");
    const ok = parseCursor(formatCursor(84532, events[0]!));
    expect(ok.status === "ok" && ok.cursor.chainId).toBe(84532);
  });
});

// --------------------------------------------------------------------------- balances

describe("the balance and holder fold", () => {
  it("counts holders from Transfer alone and never counts the zero address", () => {
    const events = index([
      // subscribe: mint 1,000 to Alice (the token also emits Subscribed for the same movement)
      makeLog(
        "Transfer",
        { from: ZERO_ADDRESS, to: ALICE, value: 1_000n * ONE_TOKEN },
        {
          block: 10,
          logIndex: 0,
        },
      ),
      makeLog(
        "Subscribed",
        { account: ALICE, usdcIn: 1_000_000_000n, tokensOut: 1_000n * ONE_TOKEN, nav: 1_000_000n },
        {
          block: 10,
          logIndex: 1,
        },
      ),
      // a transfer between holders
      makeLog(
        "Transfer",
        { from: ALICE, to: BOB, value: 400n * ONE_TOKEN },
        { block: 11, logIndex: 0 },
      ),
      // redeem: burn 400 from Bob (the token also emits Redeemed)
      makeLog(
        "Transfer",
        { from: BOB, to: ZERO_ADDRESS, value: 400n * ONE_TOKEN },
        {
          block: 12,
          logIndex: 0,
        },
      ),
      makeLog(
        "Redeemed",
        { account: BOB, tokensIn: 400n * ONE_TOKEN, usdcOut: 400_000_000n, nav: 1_000_000n },
        {
          block: 12,
          logIndex: 1,
        },
      ),
    ]);

    const fold = foldBalances(events);

    // Bob is back to zero and is not a holder; the zero address never was one.
    expect(fold.holders).toBe(1);
    expect(fold.balances.get(ALICE.toLowerCase())).toBe(600n * ONE_TOKEN);
    expect(fold.balances.has(BOB.toLowerCase())).toBe(false);
    expect(fold.balances.has(ZERO_ADDRESS)).toBe(false);

    // Minted and burned come from the zero-address sides of Transfer, counted once — the
    // Subscribed and Redeemed events beside them describe the same movement.
    expect(fold.mintedWei).toBe(1_000n * ONE_TOKEN);
    expect(fold.burnedWei).toBe(400n * ONE_TOKEN);
    expect(fold.supplyWei).toBe(600n * ONE_TOKEN);
    expect(fold.transferCount).toBe(3);
    expect(fold.everHeld).toBe(2);
    expect(fold.negative).toEqual([]);
  });

  it("does not double count an operational mint, which emits its own event beside Transfer", () => {
    const fold = foldBalances(
      index([
        makeLog(
          "Transfer",
          { from: ZERO_ADDRESS, to: BOB, value: 5n * ONE_TOKEN },
          {
            block: 3,
            logIndex: 0,
          },
        ),
        makeLog("OperationalMint", { to: BOB, amount: 5n * ONE_TOKEN }, { block: 3, logIndex: 1 }),
      ]),
    );
    expect(fold.supplyWei).toBe(5n * ONE_TOKEN);
    expect(fold.holders).toBe(1);
  });

  it("reports a negative balance rather than hiding a hole in the index", () => {
    // A transfer whose matching mint fell in a block range the RPC would not serve.
    const fold = foldBalances(
      index([
        makeLog("Transfer", { from: ALICE, to: BOB, value: ONE_TOKEN }, { block: 9, logIndex: 0 }),
      ]),
    );

    expect(fold.negative).toEqual([ALICE.toLowerCase()]);
    expect(fold.holders).toBe(1);
    expect(fold.supplyWei).toBe(0n);
  });
});

// --------------------------------------------------------------------------- days

describe("day bucketing", () => {
  const DAY = 86_400;
  const DAY_ZERO = 1_789_344_000; // 2026-09-14T00:00:00Z

  it("converts a day index to a date in integer arithmetic", () => {
    expect(isoDateFromDayIndex(0)).toBe("1970-01-01");
    expect(isoDateFromDayIndex(dayIndex(1_789_420_690))).toBe("2026-09-14");
    expect(isoDateFromDayIndex(dayIndex(1_709_164_800))).toBe("2024-02-29");
    expect(isoDateFromDayIndex(dayIndex(1_709_251_199))).toBe("2024-02-29");
    expect(isoDateFromDayIndex(dayIndex(1_709_251_200))).toBe("2024-03-01");
    expect(isoTimestampFromSeconds(1_789_420_690)).toBe("2026-09-14T21:18:10Z");
  });

  it("sums a day's flows as exact integers and fills the empty day between", () => {
    const events = [
      dated(
        decodeOne(
          makeLog(
            "Subscribed",
            { account: ALICE, usdcIn: 1_000_000n, tokensOut: ONE_TOKEN, nav: 1_000_000n },
            {
              block: 1,
              logIndex: 0,
            },
          ),
        ),
        DAY_ZERO + 3_600,
      ),
      dated(
        decodeOne(
          makeLog(
            "Subscribed",
            { account: BOB, usdcIn: 2_500_001n, tokensOut: 2n * ONE_TOKEN, nav: 1_000_000n },
            {
              block: 2,
              logIndex: 0,
            },
          ),
        ),
        DAY_ZERO + 7_200,
      ),
      dated(
        decodeOne(
          makeLog(
            "Redeemed",
            { account: ALICE, tokensIn: ONE_TOKEN, usdcOut: 999_999n, nav: 1_000_000n },
            {
              block: 3,
              logIndex: 0,
            },
          ),
        ),
        DAY_ZERO + 2 * DAY,
      ),
    ];

    const report = bucketByDay(events);

    expect(report.buckets.map((bucket) => bucket.date)).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
    ]);
    expect(report.filled).toBe(true);

    const [first, middle, last] = report.buckets;
    expect(first?.subscriptionsCount).toBe(2);
    // 1_000_000 + 2_500_001, summed as integers rather than as 1.0 + 2.500001 dollars.
    expect(first?.subscriptionsUsdcIn6).toBe(3_500_001n);
    expect(first?.subscriptionsTokensOutWei).toBe(3n * ONE_TOKEN);
    expect(middle?.subscriptionsCount).toBe(0);
    expect(middle?.subscriptionsUsdcIn6).toBe(0n);
    expect(last?.redemptionsCount).toBe(1);
    expect(last?.redemptionsUsdcOut6).toBe(999_999n);
    expect(report.undated).toBe(0);
  });

  it("closes a day at the last NAVUpdated of that day", () => {
    const navAt = (timestamp: number, nav: bigint, block: number): IndexedEvent =>
      dated(
        decodeOne(
          makeLog(
            "NAVUpdated",
            { oldNav: 1_000_000n, newNav: nav, reportedAUM: 5n, timestamp: BigInt(timestamp) },
            {
              block,
              logIndex: 0,
            },
          ),
        ),
        timestamp,
      );

    const report = bucketByDay([
      navAt(DAY_ZERO + 100, 1_000_100n, 1),
      navAt(DAY_ZERO + 200, 1_000_200n, 2),
      navAt(DAY_ZERO + DAY + 50, 1_000_300n, 3),
    ]);

    expect(report.buckets.map((bucket) => bucket.navCloseUsdc6)).toEqual([1_000_200n, 1_000_300n]);
  });

  it("puts an event with no timestamp in no bucket, and says how many there were", () => {
    const undated = decodeOne(
      makeLog(
        "Subscribed",
        { account: ALICE, usdcIn: 1n, tokensOut: 1n, nav: 1n },
        {
          block: 1,
          logIndex: 0,
        },
      ),
    );
    const report = bucketByDay([undated, dated({ ...undated, logIndex: 1 }, DAY_ZERO)]);

    expect(report.undated).toBe(1);
    expect(report.buckets).toHaveLength(1);
    expect(report.buckets[0]?.subscriptionsCount).toBe(1);
  });
});

// --------------------------------------------------------------------------- aggregate

describe("the stats aggregate", () => {
  const DAY_ZERO = 1_789_344_000;

  const events = [
    dated(
      decodeOne(
        makeLog(
          "CouponDistributed",
          {
            distributionId: 1n,
            usdcAmount: 12_000_000n,
            usdcAllocated: 11_999_999n,
            couponIndex: 1n,
            totalSupply: ONE_TOKEN,
          },
          { block: 20, logIndex: 0, tx: 20 },
        ),
      ),
      DAY_ZERO,
    ),
    dated(
      decodeOne(
        makeLog(
          "CouponDistributed",
          {
            distributionId: 2n,
            usdcAmount: 5_000_000n,
            usdcAllocated: 5_000_000n,
            couponIndex: 2n,
            totalSupply: ONE_TOKEN,
          },
          { block: 21, logIndex: 0, tx: 21 },
        ),
      ),
      DAY_ZERO + 86_400,
    ),
    decodeOne(
      makeLog(
        "IdentityVerified",
        { account: ALICE, country: 784, investorType: 1, verifiedAt: 1n },
        { block: 5, logIndex: 0 },
      ),
    ),
    decodeOne(
      makeLog(
        "IdentityVerified",
        { account: BOB, country: 276, investorType: 1, verifiedAt: 1n },
        { block: 6, logIndex: 0 },
      ),
    ),
    decodeOne(makeLog("IdentityRemoved", { account: ALICE }, { block: 7, logIndex: 0 })),
    // setNAV(force: true) emits NAVUpdated and NAVForced in one transaction.
    decodeOne(
      makeLog(
        "NAVUpdated",
        { oldNav: 1_000_000n, newNav: 1_100_000n, reportedAUM: 9n, timestamp: 1n },
        { block: 30, logIndex: 0, tx: 30 },
      ),
    ),
    decodeOne(
      makeLog(
        "NAVForced",
        { oldNav: 1_000_000n, newNav: 1_100_000n, by: ADMIN },
        { block: 30, logIndex: 1, tx: 30 },
      ),
    ),
    decodeOne(
      makeLog(
        "NAVUpdated",
        { oldNav: 1_100_000n, newNav: 1_100_500n, reportedAUM: 9n, timestamp: 2n },
        { block: 31, logIndex: 0, tx: 31 },
      ),
    ),
  ].sort(compareEvents);

  const folded = aggregate(events);

  it("reports both distribution figures and the D29 truncation remainder between them", () => {
    expect(folded.distributions.count).toBe(2);
    expect(folded.distributions.usdcAmount6).toBe(17_000_000n);
    expect(folded.distributions.usdcAllocated6).toBe(16_999_999n);
    expect(folded.distributions.truncationRemainder6).toBe(1n);
    expect(folded.distributions.latestDistributionId).toBe(2n);
    expect(folded.distributions.latestTimestamp).toBe(DAY_ZERO + 86_400);
  });

  it("counts a removed verification out again", () => {
    expect(folded.verifications.verified).toBe(2);
    expect(folded.verifications.removed).toBe(1);
    expect(folded.verifications.currentlyVerified).toBe(1);
  });

  it("marks a NAV change forced only when NAVForced sits in the same transaction", () => {
    expect(folded.navPoints).toHaveLength(2);
    expect(folded.navPoints[0]).toMatchObject({ navUsdc6: 1_100_000n, forced: true });
    expect(folded.navPoints[1]).toMatchObject({ navUsdc6: 1_100_500n, forced: false });
    expect(folded.navPoints[0]?.previousNavUsdc6).toBe(1_000_000n);
  });

  it("counts every event name, including the ones that did not occur", () => {
    expect(folded.eventCounts.CouponDistributed).toBe(2);
    expect(folded.eventCounts.IdentityVerified).toBe(2);
    expect(folded.eventCounts.Transfer).toBe(0);
    expect(Object.keys(folded.eventCounts).sort()).toEqual([...EVENT_NAMES].sort());
  });
});

// --------------------------------------------------------------------------- wire shape

describe("the wire shape", () => {
  it("matches chainEventSchema, with every number a string and every account lower-cased", () => {
    const event = dated(
      decodeOne(
        makeLog(
          "Subscribed",
          { account: ALICE, usdcIn: 1_000_000n, tokensOut: ONE_TOKEN, nav: 1_000_000n },
          {
            block: 12,
            logIndex: 3,
          },
        ),
      ),
      1_789_420_690,
    );

    const wire = chainEventSchema.parse(toWireEvent(event));

    expect(wire.args.usdcIn).toBe("1000000");
    expect(wire.accounts).toEqual([ALICE.toLowerCase()]);
    expect(wire.block_time).toBe("2026-09-14T21:18:10Z");
    expect(wire.source).toBe("token");
    expect(wire.address).toBe(TOKEN);
  });

  it("carries a null timestamp rather than inventing one", () => {
    const event = decodeOne(makeLog("Paused", { account: ADMIN }, { block: 1, logIndex: 0 }));
    const wire = chainEventSchema.parse(toWireEvent(event));
    expect(wire.block_timestamp).toBeNull();
    expect(wire.block_time).toBeNull();
  });

  it("keeps the argument value and the folded value the same integer", () => {
    const event = decodeOne(
      makeLog(
        "CouponClaimed",
        { account: BOB, usdcAmount: 12_345_678n },
        { block: 1, logIndex: 0 },
      ),
    );
    expect(argBigInt(event, "usdcAmount")).toBe(12_345_678n);
    expect(toWireEvent(event).args.usdcAmount).toBe("12345678");
  });
});
