/**
 * The event indexer (PLAN.md D10).
 *
 * Server-side `viem.getLogs` from the `deployBlock` recorded in `lib/generated/addresses.ts`,
 * chunked at 10,000 blocks, decoded and folded by `lib/server/events.ts`, held in memory for 60
 * seconds. **No database.** D10 says so, and a serverless instance could not keep one anyway: the
 * instance that answers the next request may not be the instance that answered this one, so the
 * only durable state this design is allowed to assume is the chain itself.
 *
 * ## What a public RPC actually does to you
 *
 * It rate-limits, it caps the number of logs per response, and it refuses wide ranges — usually
 * with a message and sometimes by returning a short list. So:
 *
 *   - the range is walked in 10,000-block chunks from `deployBlock`, never in one call;
 *   - a rate-limited chunk is retried with exponential backoff;
 *   - a chunk refused for being too wide is **halved and retried**, down to a single block;
 *   - a chunk that still cannot be read becomes an entry in `gaps`, and `complete` turns false.
 *
 * That last point is the one that matters. When the range cannot be covered the index says so in
 * the response rather than returning a short list that looks complete. `/api/events` and
 * `/api/stats` both surface `coverage.complete` and `coverage.gaps`, and `holders.complete` goes
 * false with them, because a holder count folded from a log set with a hole in it is a floor, not
 * an answer.
 *
 * ## Reorgs
 *
 * Three mechanisms, none of which assume the chain is append-only:
 *
 *   1. Logs the node marks `removed` are dropped.
 *   2. Logs are identified by `(blockNumber, logIndex, transactionHash)`. Two different
 *      transactions in one slot is a reorg, counted in `coverage.reorg_conflicts`, and the later
 *      observation wins.
 *   3. **The index is never appended to.** Every build reads the whole range from `deployBlock`
 *      again, so a reorg cannot corrupt the cache beyond its 60-second TTL: the next build simply
 *      reads whatever the canonical chain now says, and the previous index is replaced whole.
 *
 * Block timestamps are the one thing cached beyond a build, because they never change — but only
 * for a block that stays canonical, so they are keyed by **block hash**, not by height. A
 * re-mined height has a different hash and therefore misses the cache instead of returning the
 * orphaned block's timestamp.
 *
 * ## The cache cannot cross chains
 *
 * The cache key is `chainId:token:registry:deployBlock`. Pointing `NEXT_PUBLIC_CHAIN` at the other
 * testnet, or redeploying the contracts, changes the key, so one chain's logs can never be served
 * under another chain's id. `assertRpcIsConfiguredChain` runs before the first read for the same
 * reason at the transport level (PLAN.md D50).
 */

import { type Address, type Hex } from "viem";

import {
  ACTIVE_CHAIN_ID,
  assertRpcIsConfiguredChain,
  getChainConfig,
  getDeployment,
  getPublicClient,
  type ChainKey,
  type SupportedChainId,
} from "../chains";
import type { IndexCoverage } from "../schemas";

import { assertServerOnly, describeError } from "./env";
import {
  decodeLogs,
  dedupeEvents,
  EVENT_DEFINITIONS,
  isoTimestampFromSeconds,
  withTimestamps,
  type IndexedEvent,
  type RawLog,
} from "./events";

assertServerOnly("lib/server/indexer.ts");

// --------------------------------------------------------------------------- knobs

/** PLAN.md D10: 10,000 blocks per `eth_getLogs`. */
export const CHUNK_SIZE = 10_000n;
/** PLAN.md D10: 60 s in memory, and `s-maxage=60` at the CDN. */
export const CACHE_TTL_MS = 60_000;
/** How long a failed rebuild may keep serving the previous index before it gives up. */
export const MAX_STALE_MS = 600_000;
/** Attempts per chunk before it is split or given up on. */
export const MAX_ATTEMPTS = 3;
/** First backoff step; doubles each attempt. Deterministic, so tests can assert on it. */
export const BASE_BACKOFF_MS = 250;
/** Total `eth_getLogs` calls one build may make, retries and splits included. */
export const MAX_LOG_REQUESTS = 120;
/** Events one build may hold. Past this the rest of the range is reported as a gap. */
export const MAX_INDEXED_EVENTS = 25_000;
/** New block timestamps fetched per build, newest first. The cache carries the rest forward. */
export const MAX_NEW_TIMESTAMP_BLOCKS = 256;
/** Concurrent `eth_getBlockByHash` calls. The viem transport batches them into one request. */
export const TIMESTAMP_CONCURRENCY = 8;
/** Distinct block timestamps kept across builds before the cache is dropped and refilled. */
export const MAX_CACHED_TIMESTAMPS = 20_000;
/** Gaps merged into one summary entry past this many, so a dead RPC cannot produce a huge array. */
const MAX_REPORTED_GAPS = 20;

// --------------------------------------------------------------------------- the source

export interface BlockRange {
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
}

/**
 * Everything the indexer needs from a node, and nothing else.
 *
 * An interface rather than a viem client so the unit tests can drive chunking, backoff, splitting,
 * gaps and the cache from a script instead of from a chain. `lib/server/__tests__/indexer.test.ts`
 * never opens a socket.
 */
export interface ChainLogSource {
  readonly chainId: SupportedChainId;
  readonly network: ChainKey;
  readonly tokenAddress: Address;
  readonly registryAddress: Address;
  readonly deployBlock: bigint;
  /** Refuse to read from a node that is not the configured testnet (PLAN.md D50). */
  assertNetwork(): Promise<void>;
  getBlockNumber(): Promise<bigint>;
  getLogs(range: BlockRange): Promise<readonly RawLog[]>;
  getBlockTimestamp(blockHash: Hex): Promise<number>;
}

const ABI_EVENTS = EVENT_DEFINITIONS.map((definition) => definition.abi);

export function noDeploymentReason(chainId: SupportedChainId, network: ChainKey): string {
  return (
    `No deployment is recorded for ${getChainConfig(chainId).label} (chain ${chainId}). ` +
    `Run \`make deploy CHAIN=${network}\` and re-run \`pnpm sync:contracts\`.`
  );
}

/** The real source: one viem public client, the two deployed addresses, the topic0 filter. */
export function createViemLogSource(
  chainId: SupportedChainId = ACTIVE_CHAIN_ID,
): ChainLogSource | null {
  const deployment = getDeployment(chainId);
  if (!deployment) return null;

  const client = getPublicClient(chainId);
  let networkChecked: Promise<void> | null = null;

  return {
    chainId,
    network: deployment.network,
    tokenAddress: deployment.addresses.HBToken,
    registryAddress: deployment.addresses.IdentityRegistry,
    deployBlock: BigInt(deployment.deployBlock),

    assertNetwork(): Promise<void> {
      networkChecked ??= assertRpcIsConfiguredChain(chainId).catch((error: unknown) => {
        networkChecked = null;
        throw error;
      });
      return networkChecked;
    },

    getBlockNumber(): Promise<bigint> {
      return client.getBlockNumber();
    },

    async getLogs(range: BlockRange): Promise<readonly RawLog[]> {
      const logs = await client.getLogs({
        address: [deployment.addresses.HBToken, deployment.addresses.IdentityRegistry],
        events: ABI_EVENTS,
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
      });
      const raw: RawLog[] = [];
      for (const log of logs) {
        // A pending log has no block context. It is not history and is not indexed.
        if (
          log.blockNumber === null ||
          log.blockHash === null ||
          log.logIndex === null ||
          log.transactionHash === null ||
          log.transactionIndex === null
        ) {
          continue;
        }
        raw.push({
          address: log.address,
          topics: log.topics,
          data: log.data,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          logIndex: log.logIndex,
          transactionHash: log.transactionHash,
          transactionIndex: log.transactionIndex,
          removed: log.removed,
        });
      }
      return raw;
    },

    async getBlockTimestamp(blockHash: Hex): Promise<number> {
      const block = await client.getBlock({ blockHash, includeTransactions: false });
      return Number(block.timestamp);
    },
  };
}

// --------------------------------------------------------------------------- the index

export interface IndexGap extends BlockRange {
  readonly reason: string;
}

export interface EventIndex {
  readonly chainId: SupportedChainId;
  readonly network: ChainKey;
  readonly tokenAddress: Address;
  readonly registryAddress: Address;
  readonly deployBlock: bigint;
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  readonly headBlock: bigint;
  /** Ascending by `(blockNumber, logIndex)`, one event per slot. */
  readonly events: readonly IndexedEvent[];
  readonly complete: boolean;
  readonly gaps: readonly IndexGap[];
  readonly chunkSize: bigint;
  readonly logRequests: number;
  readonly duplicates: number;
  readonly reorgConflicts: number;
  readonly removedLogs: number;
  readonly undecodableLogs: number;
  readonly problems: readonly string[];
  readonly blocksTimestamped: number;
  readonly blocksWithoutTimestamp: number;
  readonly builtAtMs: number;
}

export interface BuildOptions {
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly chunkSize?: bigint;
  readonly maxAttempts?: number;
  readonly baseBackoffMs?: number;
  readonly maxLogRequests?: number;
  readonly maxIndexedEvents?: number;
  readonly maxNewTimestampBlocks?: number;
  /** Lower-cased block hash → unix seconds. Survives builds; a reorg misses it by construction. */
  readonly timestamps?: Map<string, number>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Everything an error says, for classification only.
 *
 * `describeError` keeps the first line, which is right for a message a human will read and wrong
 * for deciding what to do next: viem puts `HTTP request failed.` on line one and the status code,
 * the JSON-RPC error and the URL further down. This walks the `cause` chain and viem's `details`
 * and `shortMessage` so the decision below sees the whole thing. The result is never returned to a
 * caller — `describeRpcError` is what a caller sees.
 */
function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    if (current instanceof Error) {
      parts.push(current.message);
      const viem = current as { details?: unknown; shortMessage?: unknown };
      if (typeof viem.details === "string") parts.push(viem.details);
      if (typeof viem.shortMessage === "string") parts.push(viem.shortMessage);
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    parts.push(String(current));
    current = null;
  }
  return parts.join(" | ");
}

/**
 * An RPC failure in one line, with any URL removed.
 *
 * `SERVER_RPC_URL` can carry a provider key in its path. `redactSecrets` does not know about it —
 * it knows the registrar key and the worker secret — and viem quotes the URL it called in every
 * transport error, so a gap reason echoed into a public JSON response would publish it. The URL
 * adds nothing a reader of this endpoint can act on, so it is dropped rather than trimmed.
 */
export function describeRpcError(error: unknown): string {
  return describeError(error).replace(/https?:\/\/\S+/g, "<the configured RPC URL>");
}

/**
 * Errors that mean "that range was too wide", not "try again".
 *
 * Retrying an identical query that returned too many results will return too many results again,
 * so these are split immediately instead of being backed off. The strings are the ones Alchemy,
 * Infura, QuickNode, Ankr and a stock Geth actually produce; an unrecognised message is treated as
 * transient first and split as a last resort, which is the safe order.
 */
function isRangeTooWide(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("too many results") ||
    text.includes("query returned more than") ||
    text.includes("more than 10000 results") ||
    text.includes("response size exceeded") ||
    text.includes("log response size exceeded") ||
    text.includes("query timeout exceeded") ||
    text.includes("block range") ||
    text.includes("range is too large") ||
    text.includes("range too large") ||
    text.includes("exceed maximum block range") ||
    text.includes("limit exceeded")
  );
}

function mergeGaps(gaps: readonly IndexGap[]): IndexGap[] {
  if (gaps.length === 0) return [];
  const sorted = [...gaps].sort((a, b) => (a.fromBlock < b.fromBlock ? -1 : 1));
  const merged: IndexGap[] = [];
  for (const gap of sorted) {
    const last = merged[merged.length - 1];
    if (last && gap.fromBlock <= last.toBlock + 1n) {
      merged[merged.length - 1] = {
        fromBlock: last.fromBlock,
        toBlock: gap.toBlock > last.toBlock ? gap.toBlock : last.toBlock,
        reason: last.reason === gap.reason ? last.reason : `${last.reason} / ${gap.reason}`,
      };
      continue;
    }
    merged.push(gap);
  }
  if (merged.length <= MAX_REPORTED_GAPS) return merged;

  const first = merged[0];
  const last = merged[merged.length - 1];
  if (!first || !last) return merged;
  return [
    {
      fromBlock: first.fromBlock,
      toBlock: last.toBlock,
      reason: `${merged.length} separate ranges could not be read; they are summarised as one. First reason: ${first.reason}`,
    },
  ];
}

/**
 * Read `deployBlock..head`, decode, deduplicate, timestamp.
 *
 * Every failure that cannot be retried away ends up in `gaps` rather than in a throw. The only
 * throws that escape are the ones that mean there is nothing to index at all: a node that will not
 * say which chain it is, or one that will not say how tall it is.
 */
export async function buildIndex(
  source: ChainLogSource,
  options: BuildOptions = {},
): Promise<EventIndex> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const chunkSize = options.chunkSize ?? CHUNK_SIZE;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const baseBackoffMs = options.baseBackoffMs ?? BASE_BACKOFF_MS;
  const maxLogRequests = options.maxLogRequests ?? MAX_LOG_REQUESTS;
  const maxIndexedEvents = options.maxIndexedEvents ?? MAX_INDEXED_EVENTS;
  const maxNewTimestamps = options.maxNewTimestampBlocks ?? MAX_NEW_TIMESTAMP_BLOCKS;
  const timestamps = options.timestamps ?? getTimestampCache(source.chainId);

  await source.assertNetwork();
  const headBlock = await source.getBlockNumber();

  const deployBlock = source.deployBlock;
  const fromBlock = deployBlock;
  // Not clamped up to `deployBlock`: a node whose head is below it has nothing to index, and
  // asking it for a block it does not have would be reported as a coverage gap — which would say
  // "logs are missing" about a range that does not exist yet. The loop below simply does not run.
  const toBlock = headBlock;

  const rawLogs: RawLog[] = [];
  const gaps: IndexGap[] = [];
  let logRequests = 0;
  let removedLogs = 0;
  let undecodableLogs = 0;
  const problems: string[] = [];

  const readRange = async (range: BlockRange): Promise<void> => {
    let lastError = "the RPC did not answer";
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      // Checked before every call, not once per range: retries and splits spend the same budget,
      // and a node that fails everything must not be able to turn one scan into thousands of calls.
      if (logRequests >= maxLogRequests) {
        gaps.push({
          ...range,
          reason: `the per-request budget of ${maxLogRequests} eth_getLogs calls was exhausted before this range was read.`,
        });
        return;
      }
      try {
        logRequests += 1;
        const logs = await source.getLogs(range);
        rawLogs.push(...logs);
        return;
      } catch (error) {
        lastError = describeRpcError(error);
        if (isRangeTooWide(errorText(error))) break;
        if (attempt < maxAttempts - 1) await sleep(baseBackoffMs * 2 ** attempt);
      }
    }

    // Split and retry: half a range that was refused for being too wide is the one query that
    // might work, and it is also the cheapest way to isolate a single unreadable block.
    const span = range.toBlock - range.fromBlock;
    if (span >= 1n) {
      const middle = range.fromBlock + span / 2n;
      await readRange({ fromBlock: range.fromBlock, toBlock: middle });
      await readRange({ fromBlock: middle + 1n, toBlock: range.toBlock });
      return;
    }
    gaps.push({ ...range, reason: lastError });
  };

  let cursor = fromBlock;
  while (cursor <= toBlock) {
    if (logRequests >= maxLogRequests) {
      gaps.push({
        fromBlock: cursor,
        toBlock,
        reason: `the per-request budget of ${maxLogRequests} eth_getLogs calls was exhausted with ${(toBlock - cursor + 1n).toString()} blocks still unread.`,
      });
      break;
    }
    if (rawLogs.length > maxIndexedEvents) {
      gaps.push({
        fromBlock: cursor,
        toBlock,
        reason: `this index holds at most ${maxIndexedEvents} logs and reached the cap before this range; the remaining blocks were not read.`,
      });
      break;
    }
    const end = cursor + chunkSize - 1n;
    await readRange({ fromBlock: cursor, toBlock: end > toBlock ? toBlock : end });
    cursor = end + 1n;
  }

  const decoded = decodeLogs(rawLogs);
  removedLogs = decoded.removed;
  undecodableLogs = decoded.undecodable;
  problems.push(...decoded.problems);

  const deduped = dedupeEvents(decoded.events);

  // Timestamps, newest block first: the first page of /api/events is the newest events, so if the
  // budget runs out it must run out on the oldest blocks, not the ones about to be rendered.
  const blockHashes: string[] = [];
  for (let index = deduped.events.length - 1; index >= 0; index -= 1) {
    const event = deduped.events[index];
    if (!event) continue;
    const hash = event.blockHash.toLowerCase();
    if (!blockHashes.includes(hash)) blockHashes.push(hash);
  }
  const missing = blockHashes.filter((hash) => !timestamps.has(hash));
  await mapWithConcurrency(
    missing.slice(0, maxNewTimestamps),
    TIMESTAMP_CONCURRENCY,
    async (hash) => {
      try {
        const timestamp = await source.getBlockTimestamp(hash as Hex);
        if (Number.isFinite(timestamp) && timestamp >= 0) timestamps.set(hash, timestamp);
      } catch {
        // A block whose timestamp cannot be read stays undated. An event with no timestamp sits
        // in no daily bucket rather than in a guessed one.
      }
    },
  );
  if (timestamps.size > MAX_CACHED_TIMESTAMPS) timestamps.clear();

  const events = withTimestamps(deduped.events, timestamps);
  const timestamped = blockHashes.filter((hash) => timestamps.has(hash)).length;
  const mergedGaps = mergeGaps(gaps);

  return {
    chainId: source.chainId,
    network: source.network,
    tokenAddress: source.tokenAddress,
    registryAddress: source.registryAddress,
    deployBlock,
    fromBlock,
    toBlock,
    headBlock,
    events,
    complete: mergedGaps.length === 0,
    gaps: mergedGaps,
    chunkSize,
    logRequests,
    duplicates: deduped.duplicates,
    reorgConflicts: deduped.conflicts,
    removedLogs,
    undecodableLogs,
    problems,
    blocksTimestamped: timestamped,
    blocksWithoutTimestamp: blockHashes.length - timestamped,
    builtAtMs: now(),
  };
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      await run(item);
    }
  });
  await Promise.all(workers);
}

// --------------------------------------------------------------------------- caches

/** Block hash → unix seconds, per chain. Keyed by hash because a reorg changes it (see header). */
const timestampCaches = new Map<SupportedChainId, Map<string, number>>();

function getTimestampCache(chainId: SupportedChainId): Map<string, number> {
  const existing = timestampCaches.get(chainId);
  if (existing) return existing;
  const created = new Map<string, number>();
  timestampCaches.set(chainId, created);
  return created;
}

interface CacheEntry {
  readonly index: EventIndex;
  readonly builtAtMs: number;
}

const indexCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<EventIndex>>();

/**
 * `chainId:token:registry:deployBlock`.
 *
 * The chain id is first and the addresses are in it: switching `NEXT_PUBLIC_CHAIN`, or
 * redeploying, cannot make one chain's logs answer for another's.
 */
export function cacheKey(source: {
  chainId: SupportedChainId;
  tokenAddress: Address;
  registryAddress: Address;
  deployBlock: bigint;
}): string {
  return [
    source.chainId.toString(),
    source.tokenAddress.toLowerCase(),
    source.registryAddress.toLowerCase(),
    source.deployBlock.toString(),
  ].join(":");
}

export interface CacheMeta {
  readonly hit: boolean;
  readonly ageSeconds: number;
  readonly ttlSeconds: number;
  /** `true` when a rebuild failed and the previous index was served instead of nothing. */
  readonly stale: boolean;
  readonly staleReason: string | null;
}

export type IndexResult =
  | { readonly status: "ok"; readonly index: EventIndex; readonly cache: CacheMeta }
  | {
      readonly status: "unavailable";
      readonly chainId: SupportedChainId;
      readonly network: ChainKey;
      readonly reason: string;
    };

export interface LoadOptions extends BuildOptions {
  readonly chainId?: SupportedChainId;
  /** Injected by tests; production builds one from the deployment record. */
  readonly source?: ChainLogSource | null;
  readonly ttlMs?: number;
  readonly maxStaleMs?: number;
}

/**
 * The index for the configured chain, from cache when it is younger than the TTL.
 *
 * Concurrent callers share one build: `/api/events` and `/api/stats` are frequently hit together
 * and a cold instance must not run the whole scan twice. A build that throws falls back to the
 * previous index, marked `stale` with the reason, for up to `MAX_STALE_MS` — a minute-old answer
 * that says it is a minute old beats no answer at all, and past that bound it says so instead.
 */
export async function getEventIndex(options: LoadOptions = {}): Promise<IndexResult> {
  const chainId = options.chainId ?? ACTIVE_CHAIN_ID;
  const network = getChainConfig(chainId).key;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? CACHE_TTL_MS;
  const maxStaleMs = options.maxStaleMs ?? MAX_STALE_MS;

  const source = options.source === undefined ? createViemLogSource(chainId) : options.source;
  if (!source) {
    return {
      status: "unavailable",
      chainId,
      network,
      reason: noDeploymentReason(chainId, network),
    };
  }

  const key = cacheKey(source);
  const cached = indexCache.get(key);
  const age = (at: number): number => Math.max(0, Math.floor((now() - at) / 1000));

  if (cached && now() - cached.builtAtMs < ttlMs) {
    return {
      status: "ok",
      index: cached.index,
      cache: {
        hit: true,
        ageSeconds: age(cached.builtAtMs),
        ttlSeconds: Math.floor(ttlMs / 1000),
        stale: false,
        staleReason: null,
      },
    };
  }

  let build = inFlight.get(key);
  if (!build) {
    build = buildIndex(source, options).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, build);
  }

  try {
    const index = await build;
    indexCache.set(key, { index, builtAtMs: index.builtAtMs });
    return {
      status: "ok",
      index,
      cache: {
        hit: false,
        ageSeconds: 0,
        ttlSeconds: Math.floor(ttlMs / 1000),
        stale: false,
        staleReason: null,
      },
    };
  } catch (error) {
    const reason = `The event index could not be built from ${getChainConfig(chainId).label} at the configured RPC: ${describeRpcError(error)}`;
    if (cached && now() - cached.builtAtMs < maxStaleMs) {
      return {
        status: "ok",
        index: cached.index,
        cache: {
          hit: true,
          ageSeconds: age(cached.builtAtMs),
          ttlSeconds: Math.floor(ttlMs / 1000),
          stale: true,
          staleReason: reason,
        },
      };
    }
    return { status: "unavailable", chainId, network, reason };
  }
}

/** Drop every cached index and every cached timestamp. Tests, and nothing else, call this. */
export function clearEventIndexCache(): void {
  indexCache.clear();
  inFlight.clear();
  timestampCaches.clear();
}

// --------------------------------------------------------------------------- wire shapes

/** `coverage`, as both `/api/events` and `/api/stats` return it. */
export function toWireCoverage(index: EventIndex, cache: CacheMeta): IndexCoverage {
  return {
    complete: index.complete,
    from_block: Number(index.fromBlock),
    to_block: Number(index.toBlock),
    head_block: Number(index.headBlock),
    chunk_size: Number(index.chunkSize),
    log_requests: index.logRequests,
    gaps: index.gaps.map((gap) => ({
      from_block: Number(gap.fromBlock),
      to_block: Number(gap.toBlock),
      reason: gap.reason,
    })),
    duplicates_dropped: index.duplicates,
    reorg_conflicts: index.reorgConflicts,
    removed_logs_dropped: index.removedLogs,
    undecodable_logs: index.undecodableLogs,
    blocks_timestamped: index.blocksTimestamped,
    blocks_without_timestamp: index.blocksWithoutTimestamp,
    indexed_at: isoTimestampFromSeconds(Math.floor(index.builtAtMs / 1000)),
    cache_age_seconds: cache.ageSeconds,
    cache_ttl_seconds: cache.ttlSeconds,
    stale: cache.stale,
    stale_reason: cache.staleReason,
  };
}

/**
 * The limitations both routes carry, derived from what this build actually managed.
 *
 * These are facts about this response, not a fixed disclaimer: the gap sentence appears only when
 * there is a gap, and the reorg sentence only when a slot conflicted.
 */
export function coverageLimitations(index: EventIndex, cache: CacheMeta): string[] {
  const limitations: string[] = [];

  if (index.headBlock < index.deployBlock) {
    limitations.push(
      `The node's head is block ${index.headBlock.toString()} and the contracts are recorded at deploy block ${index.deployBlock.toString()}, so there is nothing to index yet and \`to_block\` is below \`from_block\`. Either the node is still syncing, or it is not the chain these addresses were deployed to.`,
    );
  }
  if (!index.complete) {
    const blocks = index.gaps.reduce(
      (total, gap) => total + (gap.toBlock - gap.fromBlock + 1n),
      0n,
    );
    limitations.push(
      `The scan did not cover the whole range: ${index.gaps.length} range(s) totalling ${blocks.toString()} block(s) could not be read, so events in them are missing from this response. See \`coverage.gaps\` for each range and its reason.`,
    );
  }
  if (index.blocksWithoutTimestamp > 0) {
    limitations.push(
      `${index.blocksWithoutTimestamp} block timestamp(s) are not resolved yet, so those events have \`block_timestamp: null\` and sit in no daily bucket. Timestamps are fetched at most ${MAX_NEW_TIMESTAMP_BLOCKS} new blocks per build and cached by block hash, so a later request fills them in.`,
    );
  }
  if (index.reorgConflicts > 0) {
    limitations.push(
      `${index.reorgConflicts} log slot(s) held a different transaction than an earlier read of the same slot — a reorg while this index was being built. The later observation was kept.`,
    );
  }
  if (index.undecodableLogs > 0) {
    limitations.push(
      `${index.undecodableLogs} log(s) matched an indexed event but would not decode against the generated ABI, and were dropped. Re-run \`pnpm sync:contracts\` if the contracts changed.`,
    );
  }
  if (cache.stale) {
    limitations.push(
      `This is the previous index, ${cache.ageSeconds}s old, served because the rebuild failed: ${cache.staleReason ?? "no reason recorded"}`,
    );
  }
  limitations.push(
    `There is no database (PLAN.md D10). The index is rebuilt from \`deployBlock\` every ${Math.floor(CACHE_TTL_MS / 1000)}s in the memory of whichever instance answers, so a reorg is corrected by the next build rather than patched into this one.`,
  );
  limitations.push(
    "The most recent blocks can still reorg. Events near the head of the chain are reported as the node reports them now, not as finalised history.",
  );

  return limitations;
}
