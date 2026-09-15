/**
 * The indexer's behaviour against a node that misbehaves, driven from a script rather than a chain.
 *
 * Everything a public RPC does to a log scan is reproduced here: it rate-limits, it refuses a wide
 * range, it dies on one block, it reorgs a block out from under a second read. `FakeSource` is a
 * `ChainLogSource`, which is the whole reason that interface exists — no socket is opened by any
 * test in this file.
 *
 * As in `events.test.ts`, no 32-byte hex literal appears here: hashes are generated from a counter
 * so `scripts/check-secrets.sh` has nothing to mistake for a key.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";

import { indexCoverageSchema } from "../../schemas";
import { EVENT_DEFINITION_BY_NAME, type RawLog } from "../events";
import {
  buildIndex,
  cacheKey,
  clearEventIndexCache,
  coverageLimitations,
  describeRpcError,
  getEventIndex,
  toWireCoverage,
  type BlockRange,
  type ChainLogSource,
} from "../indexer";

const TOKEN = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" as Address;
const REGISTRY = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;
const OTHER_TOKEN = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";

function hashOf(seed: number): Hex {
  return `0x${seed.toString(16).padStart(64, "0")}` as Hex;
}

function topicAddress(address: string): Hex {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}` as Hex;
}

/**
 * `IdentityRemoved(address indexed account)` — one indexed argument and no data, so a fixture is
 * two topics and nothing else. Which event it is does not matter to the scan; how it is fetched
 * does.
 */
function log(
  block: number,
  options: {
    account?: string;
    tx?: number;
    blockHash?: number;
    logIndex?: number;
    removed?: boolean;
  } = {},
): RawLog {
  return {
    address: REGISTRY,
    topics: [
      EVENT_DEFINITION_BY_NAME.IdentityRemoved.topic0,
      topicAddress(options.account ?? ALICE),
    ],
    data: "0x",
    blockNumber: BigInt(block),
    blockHash: hashOf(options.blockHash ?? block),
    logIndex: options.logIndex ?? 0,
    transactionHash: hashOf(options.tx ?? 1_000 + block),
    transactionIndex: 0,
    removed: options.removed,
  };
}

interface FakeOptions {
  readonly chainId?: 31337 | 84532;
  readonly tokenAddress?: Address;
  readonly deployBlock?: bigint;
  head?: bigint;
  logs?: RawLog[];
  /** Throw from here to make a range fail. Called before the logs are returned. */
  onGetLogs?: (range: BlockRange, callIndex: number) => void;
  onGetBlockNumber?: (callIndex: number) => void;
  /** Block hash → unix seconds. A hash that is not here throws, like a pruned block would. */
  blockTimes?: Map<string, number>;
}

class FakeSource implements ChainLogSource {
  readonly chainId: 31337 | 84532;
  readonly network = "anvil" as const;
  readonly tokenAddress: Address;
  readonly registryAddress = REGISTRY;
  readonly deployBlock: bigint;

  readonly ranges: BlockRange[] = [];
  readonly blocksAsked: string[] = [];
  networkChecks = 0;
  headCalls = 0;

  constructor(readonly options: FakeOptions = {}) {
    this.chainId = options.chainId ?? 31337;
    this.tokenAddress = options.tokenAddress ?? TOKEN;
    this.deployBlock = options.deployBlock ?? 1n;
  }

  assertNetwork(): Promise<void> {
    this.networkChecks += 1;
    return Promise.resolve();
  }

  getBlockNumber(): Promise<bigint> {
    this.headCalls += 1;
    this.options.onGetBlockNumber?.(this.headCalls - 1);
    return Promise.resolve(this.options.head ?? 1n);
  }

  getLogs(range: BlockRange): Promise<readonly RawLog[]> {
    const callIndex = this.ranges.length;
    this.ranges.push(range);
    this.options.onGetLogs?.(range, callIndex);
    return Promise.resolve(
      (this.options.logs ?? []).filter(
        (entry) => entry.blockNumber >= range.fromBlock && entry.blockNumber <= range.toBlock,
      ),
    );
  }

  getBlockTimestamp(blockHash: Hex): Promise<number> {
    this.blocksAsked.push(blockHash.toLowerCase());
    const timestamp = this.options.blockTimes?.get(blockHash.toLowerCase());
    if (timestamp === undefined) return Promise.reject(new Error("block not found"));
    return Promise.resolve(timestamp);
  }
}

function collector(): { sleeps: number[]; sleep: (ms: number) => Promise<void> } {
  const sleeps: number[] = [];
  return {
    sleeps,
    sleep: (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  };
}

function ranges(source: FakeSource): string[] {
  return source.ranges.map((range) => `${range.fromBlock.toString()}-${range.toBlock.toString()}`);
}

beforeEach(() => {
  clearEventIndexCache();
});

// --------------------------------------------------------------------------- chunking

describe("chunking", () => {
  it("walks from the deploy block to the head in chunks, never in one call", async () => {
    const source = new FakeSource({
      head: 25_000n,
      logs: [log(2), log(10_001), log(24_999)],
    });

    const index = await buildIndex(source, { chunkSize: 10_000n });

    expect(ranges(source)).toEqual(["1-10000", "10001-20000", "20001-25000"]);
    expect(index.events.map((event) => Number(event.blockNumber))).toEqual([2, 10_001, 24_999]);
    expect(index.fromBlock).toBe(1n);
    expect(index.toBlock).toBe(25_000n);
    expect(index.complete).toBe(true);
    expect(index.gaps).toEqual([]);
    expect(source.networkChecks).toBe(1);
  });

  it("starts at the deploy block, not at genesis and not at a rolling window", async () => {
    const source = new FakeSource({ deployBlock: 9_000n, head: 9_500n });
    await buildIndex(source, { chunkSize: 10_000n });
    expect(ranges(source)).toEqual(["9000-9500"]);
  });

  it("indexes nothing, and reports no gap, when the node is behind the deploy block", async () => {
    // A fresh local node, or one still syncing. Asking it for a block it does not have would come
    // back as an unreadable range, and reporting that as a gap would claim logs are missing from a
    // range that does not exist yet.
    const source = new FakeSource({ deployBlock: 1n, head: 0n });

    const index = await buildIndex(source, { chunkSize: 10n });

    expect(source.ranges).toEqual([]);
    expect(index.events).toEqual([]);
    expect(index.complete).toBe(true);
    expect(index.gaps).toEqual([]);
    expect(index.toBlock).toBe(0n);
    expect(
      coverageLimitations(index, {
        hit: false,
        ageSeconds: 0,
        ttlSeconds: 60,
        stale: false,
        staleReason: null,
      })[0],
    ).toContain("nothing to index yet");
  });

  it("drops a log the node marks removed and counts it", async () => {
    const source = new FakeSource({ head: 5n, logs: [log(2), log(3, { removed: true })] });
    const index = await buildIndex(source, { chunkSize: 10n });

    expect(index.events).toHaveLength(1);
    expect(index.removedLogs).toBe(1);
  });
});

// --------------------------------------------------------------------------- failure handling

describe("a node that will not answer", () => {
  it("retries a rate-limited range with exponential backoff", async () => {
    const source = new FakeSource({
      head: 10n,
      logs: [log(4)],
      onGetLogs: (_range, callIndex) => {
        if (callIndex < 2) throw new Error("HTTP request failed. Status: 429 Too Many Requests");
      },
    });
    const { sleeps, sleep } = collector();

    const index = await buildIndex(source, { chunkSize: 10n, sleep, baseBackoffMs: 250 });

    expect(ranges(source)).toEqual(["1-10", "1-10", "1-10"]);
    expect(sleeps).toEqual([250, 500]);
    expect(index.events).toHaveLength(1);
    expect(index.complete).toBe(true);
    expect(index.logRequests).toBe(3);
  });

  it("halves a range the node calls too wide, without backing off first", async () => {
    const source = new FakeSource({
      head: 8n,
      logs: [log(1), log(6)],
      onGetLogs: (range) => {
        if (range.toBlock - range.fromBlock >= 3n) {
          throw new Error("query returned more than 10000 results");
        }
      },
    });
    const { sleeps, sleep } = collector();

    const index = await buildIndex(source, { chunkSize: 8n, sleep });

    // Retrying an identical too-wide query would return the same error, so it is split instead.
    expect(sleeps).toEqual([]);
    expect(ranges(source)).toEqual(["1-8", "1-4", "1-2", "3-4", "5-8", "5-6", "7-8"]);
    expect(index.events.map((event) => Number(event.blockNumber))).toEqual([1, 6]);
    expect(index.complete).toBe(true);
  });

  it("reports the one block it could not read as a gap, and keeps the rest", async () => {
    const source = new FakeSource({
      head: 4n,
      logs: [log(1), log(4)],
      onGetLogs: (range) => {
        if (range.fromBlock <= 3n && range.toBlock >= 3n) throw new Error("execution aborted");
      },
    });
    const { sleep } = collector();

    const index = await buildIndex(source, { chunkSize: 4n, sleep });

    expect(index.complete).toBe(false);
    expect(index.gaps).toEqual([{ fromBlock: 3n, toBlock: 3n, reason: "execution aborted" }]);
    expect(index.events.map((event) => Number(event.blockNumber))).toEqual([1, 4]);

    const limitations = coverageLimitations(index, {
      hit: false,
      ageSeconds: 0,
      ttlSeconds: 60,
      stale: false,
      staleReason: null,
    });
    expect(limitations[0]).toContain("did not cover the whole range");
    expect(limitations[0]).toContain("1 block(s)");
  });

  it("stops at the request budget and says how many blocks were left unread", async () => {
    const source = new FakeSource({
      head: 1_000n,
      onGetLogs: () => {
        throw new Error("service unavailable");
      },
    });
    const { sleep } = collector();

    const index = await buildIndex(source, { chunkSize: 10n, sleep, maxLogRequests: 5 });

    expect(index.logRequests).toBeLessThanOrEqual(5);
    expect(index.complete).toBe(false);
    expect(index.gaps.length).toBeGreaterThan(0);
    expect(index.gaps.map((gap) => gap.reason).join(" ")).toContain("budget");
    // The whole unread tail is reported, not silently dropped.
    expect(index.gaps[index.gaps.length - 1]?.toBlock).toBe(1_000n);
  });

  it("merges adjacent gaps rather than listing one per block", async () => {
    const source = new FakeSource({
      head: 4n,
      onGetLogs: () => {
        throw new Error("execution aborted");
      },
    });
    const { sleep } = collector();

    const index = await buildIndex(source, { chunkSize: 1n, sleep, maxAttempts: 1 });

    expect(index.gaps).toHaveLength(1);
    expect(index.gaps[0]).toMatchObject({ fromBlock: 1n, toBlock: 4n });
  });

  it("strips the RPC URL out of anything it reports", () => {
    const message = describeRpcError(
      new Error("HTTP request failed. URL: https://example.invalid/v2/some-provider-key"),
    );
    expect(message).not.toContain("some-provider-key");
    expect(message).toContain("<the configured RPC URL>");
  });
});

// --------------------------------------------------------------------------- timestamps

describe("block timestamps", () => {
  it("fetches one per distinct block and caches it by hash", async () => {
    const times = new Map([
      [hashOf(2).toLowerCase(), 1_789_344_000],
      [hashOf(3).toLowerCase(), 1_789_430_400],
    ]);
    const source = new FakeSource({
      head: 5n,
      logs: [log(2, { logIndex: 0 }), log(2, { logIndex: 1 }), log(3)],
      blockTimes: times,
    });
    const cache = new Map<string, number>();

    const first = await buildIndex(source, { chunkSize: 10n, timestamps: cache });

    // Two blocks, three logs: two calls, not three.
    expect(source.blocksAsked).toHaveLength(2);
    expect(first.events.map((event) => event.blockTimestamp)).toEqual([
      1_789_344_000, 1_789_344_000, 1_789_430_400,
    ]);
    expect(first.blocksTimestamped).toBe(2);
    expect(first.blocksWithoutTimestamp).toBe(0);

    await buildIndex(source, { chunkSize: 10n, timestamps: cache });
    // Timestamps never change for a block that stays canonical, so the second build asks for none.
    expect(source.blocksAsked).toHaveLength(2);
  });

  it("does not hand a re-mined height the orphaned block's timestamp", async () => {
    const cache = new Map<string, number>([[hashOf(700).toLowerCase(), 1_789_344_000]]);
    const source = new FakeSource({
      head: 5n,
      // Same height, different block hash: the chain re-mined block 2.
      logs: [log(2, { blockHash: 701 })],
      blockTimes: new Map(),
    });

    const index = await buildIndex(source, { chunkSize: 10n, timestamps: cache });

    expect(source.blocksAsked).toEqual([hashOf(701).toLowerCase()]);
    expect(index.events[0]?.blockTimestamp).toBeNull();
    expect(index.blocksWithoutTimestamp).toBe(1);
  });

  it("resolves the newest blocks first when the per-build budget is small", async () => {
    const times = new Map(
      [2, 3, 4].map((block) => [hashOf(block).toLowerCase(), 1_789_344_000 + block]),
    );
    const source = new FakeSource({ head: 9n, logs: [log(2), log(3), log(4)], blockTimes: times });

    const index = await buildIndex(source, {
      chunkSize: 10n,
      timestamps: new Map(),
      maxNewTimestampBlocks: 2,
    });

    expect(index.events.map((event) => event.blockTimestamp)).toEqual([
      null,
      1_789_344_003,
      1_789_344_004,
    ]);
    expect(index.blocksWithoutTimestamp).toBe(1);
  });

  it("leaves an event undated rather than guessing when the block cannot be read", async () => {
    const source = new FakeSource({ head: 5n, logs: [log(2)], blockTimes: new Map() });
    const index = await buildIndex(source, { chunkSize: 10n, timestamps: new Map() });

    expect(index.events[0]?.blockTimestamp).toBeNull();
    expect(index.blocksWithoutTimestamp).toBe(1);
  });
});

// --------------------------------------------------------------------------- the cache

describe("the 60-second cache", () => {
  function clock(start = 1_700_000_000_000): { now: () => number; advance: (ms: number) => void } {
    let value = start;
    return {
      now: () => value,
      advance: (ms: number) => {
        value += ms;
      },
    };
  }

  it("serves the same index for 60 seconds and rebuilds after", async () => {
    const source = new FakeSource({ head: 5n, logs: [log(2)] });
    const time = clock();

    const first = await getEventIndex({ chainId: 31337, source, now: time.now, chunkSize: 10n });
    expect(first.status).toBe("ok");
    expect(source.ranges).toHaveLength(1);
    if (first.status === "ok") expect(first.cache.hit).toBe(false);

    time.advance(30_000);
    const second = await getEventIndex({ chainId: 31337, source, now: time.now, chunkSize: 10n });
    expect(source.ranges).toHaveLength(1);
    if (second.status === "ok") {
      expect(second.cache.hit).toBe(true);
      expect(second.cache.ageSeconds).toBe(30);
      expect(second.cache.stale).toBe(false);
    }

    time.advance(31_000);
    await getEventIndex({ chainId: 31337, source, now: time.now, chunkSize: 10n });
    expect(source.ranges).toHaveLength(2);
  });

  it("builds once when two callers ask at the same moment", async () => {
    const source = new FakeSource({ head: 5n, logs: [log(2)] });

    const [a, b] = await Promise.all([
      getEventIndex({ chainId: 31337, source, chunkSize: 10n }),
      getEventIndex({ chainId: 31337, source, chunkSize: 10n }),
    ]);

    expect(source.ranges).toHaveLength(1);
    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
  });

  it("never serves one chain's logs under another chain's id", async () => {
    const anvil = new FakeSource({ chainId: 31337, head: 5n, logs: [log(2, { account: ALICE })] });
    const baseSepolia = new FakeSource({
      chainId: 84532,
      tokenAddress: OTHER_TOKEN,
      head: 9n,
      logs: [log(7, { account: BOB })],
    });

    expect(cacheKey(anvil)).not.toBe(cacheKey(baseSepolia));

    const first = await getEventIndex({ chainId: 31337, source: anvil, chunkSize: 10n });
    const second = await getEventIndex({ chainId: 84532, source: baseSepolia, chunkSize: 10n });

    expect(first.status === "ok" && first.index.events.map((e) => Number(e.blockNumber))).toEqual([
      2,
    ]);
    expect(second.status === "ok" && second.index.events.map((e) => Number(e.blockNumber))).toEqual(
      [7],
    );
    expect(second.status === "ok" && second.index.chainId).toBe(84532);
  });

  it("replaces the whole index after a reorg rather than appending to it", async () => {
    const source = new FakeSource({ head: 10n, logs: [log(10, { tx: 5_001, blockHash: 800 })] });
    const time = clock();

    const before = await getEventIndex({ chainId: 31337, source, now: time.now, chunkSize: 20n });
    expect(before.status === "ok" && before.index.events[0]?.transactionHash).toBe(hashOf(5_001));

    // Block 10 is re-mined with a different transaction in the same slot.
    source.options.logs = [log(10, { tx: 5_002, blockHash: 801 })];
    time.advance(61_000);

    const after = await getEventIndex({ chainId: 31337, source, now: time.now, chunkSize: 20n });
    expect(after.status === "ok" && after.index.events).toHaveLength(1);
    expect(after.status === "ok" && after.index.events[0]?.transactionHash).toBe(hashOf(5_002));
    // Nothing was carried forward, so nothing has to be un-done: the orphan is simply not there.
    expect(after.status === "ok" && after.index.reorgConflicts).toBe(0);
  });

  it("serves the previous index, labelled stale, when a rebuild fails", async () => {
    const source = new FakeSource({ head: 5n, logs: [log(2)] });
    const time = clock();

    await getEventIndex({ chainId: 31337, source, now: time.now, chunkSize: 10n });

    source.options.onGetBlockNumber = () => {
      throw new Error("HTTP request failed. URL: https://rpc.invalid/key");
    };
    time.advance(61_000);

    const stale = await getEventIndex({ chainId: 31337, source, now: time.now, chunkSize: 10n });
    expect(stale.status).toBe("ok");
    if (stale.status === "ok") {
      expect(stale.cache.stale).toBe(true);
      expect(stale.cache.ageSeconds).toBe(61);
      expect(stale.cache.staleReason).toContain("<the configured RPC URL>");
      expect(stale.index.events).toHaveLength(1);
      expect(coverageLimitations(stale.index, stale.cache).join(" ")).toContain("previous index");
    }

    // Past the staleness bound it stops pretending and says it has nothing.
    time.advance(600_001);
    const gone = await getEventIndex({ chainId: 31337, source, now: time.now, chunkSize: 10n });
    expect(gone.status).toBe("unavailable");
    expect(gone.status === "unavailable" && gone.reason).toContain("could not be built");
  });

  it("reports no deployment as a reason rather than as an empty index", async () => {
    const result = await getEventIndex({ chainId: 31337, source: null });
    expect(result.status).toBe("unavailable");
    expect(result.status === "unavailable" && result.reason).toContain("No deployment is recorded");
  });
});

// --------------------------------------------------------------------------- the wire shape

describe("coverage on the wire", () => {
  it("matches indexCoverageSchema and carries the gaps it found", async () => {
    const source = new FakeSource({
      head: 4n,
      logs: [log(1)],
      onGetLogs: (range) => {
        if (range.fromBlock <= 3n && range.toBlock >= 3n) throw new Error("execution aborted");
      },
    });
    const { sleep } = collector();
    const index = await buildIndex(source, { chunkSize: 4n, sleep, now: () => 1_789_420_690_000 });

    const wire = indexCoverageSchema.parse(
      toWireCoverage(index, {
        hit: true,
        ageSeconds: 12,
        ttlSeconds: 60,
        stale: false,
        staleReason: null,
      }),
    );

    expect(wire.complete).toBe(false);
    expect(wire.gaps).toEqual([{ from_block: 3, to_block: 3, reason: "execution aborted" }]);
    expect(wire.indexed_at).toBe("2026-09-14T21:18:10Z");
    expect(wire.cache_age_seconds).toBe(12);
    expect(wire.chunk_size).toBe(4);
  });
});
