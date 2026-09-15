/**
 * The pure half of the event indexer (PLAN.md D10): decode, deduplicate, filter, paginate, fold.
 *
 * Nothing here performs I/O. `lib/server/indexer.ts` owns the RPC, the chunking, the retries and
 * the cache; this module owns every decision that can be made from logs alone, which is why every
 * one of them is unit-tested against fixture logs rather than against a chain.
 *
 * Four things in here are load-bearing and easy to get wrong, so each is stated once:
 *
 *   1. **Identity of a log.** A log is identified by `(blockNumber, logIndex, transactionHash)`.
 *      The first two alone are not enough: after a reorg the same slot can hold a different
 *      transaction, and treating those as the same event would silently keep the orphaned one.
 *      `dedupeEvents` drops exact repeats and reports slot conflicts separately, because a
 *      conflict is a reorg and the caller has to be able to say so.
 *   2. **Balances come from `Transfer` and from nothing else.** `subscribe`, `redeem`, `mint` and
 *      `burn` all move tokens through ERC-20 `_update`, so each already emits a `Transfer` with
 *      the zero address on the minting or burning side. Folding `OperationalMint` or `Subscribed`
 *      as well would double-count every one of them.
 *   3. **The zero address is never a holder.** It is the ERC-20 burn/mint sentinel, not an
 *      account. `foldBalances` never records it and `holders` never counts it.
 *   4. **Every amount stays an integer.** Args are carried as decimal strings of the exact
 *      integer the contract emitted and folded as `bigint` (PLAN.md D22). No float touches a
 *      USDC or token amount anywhere in this file, including the day buckets.
 *
 * Argument names and positions are taken from `contracts/src/interfaces/IHBToken.sol` and
 * `IIdentityRegistry.sol` through the generated ABIs, never written out by hand — note that
 * `NAVForced(uint256 oldNav, uint256 newNav, address indexed by)` puts its only address *last*,
 * which is exactly the case an account filter written against "the first indexed argument" gets
 * wrong.
 */

import {
  decodeEventLog,
  getAbiItem,
  getAddress,
  toEventSelector,
  toEventSignature,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";

import { hbTokenAbi, identityRegistryAbi } from "../generated/abis";
import { EVENT_NAMES, type ChainEvent, type EventName, type EventSource } from "../schemas";

// --------------------------------------------------------------------------- the catalogue

/** The ERC-20 mint/burn sentinel. Never an account, never a holder, never counted. */
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Events emitted by `IdentityRegistry`; everything else in `EVENT_NAMES` is `HBToken`. */
const REGISTRY_EVENT_NAMES = new Set<EventName>([
  "IdentityVerified",
  "IdentityRemoved",
  "CountryBlockStatusChanged",
]);

export interface EventDefinition {
  readonly name: EventName;
  readonly source: EventSource;
  readonly abi: AbiEvent;
  /** `topics[0]` — `keccak256` of the canonical signature. */
  readonly topic0: Hex;
  /** `"Subscribed(address,uint256,uint256,uint256)"`, for documentation and error messages. */
  readonly signature: string;
  /** Names of the `address`-typed arguments, in ABI order. The account filter reads all of them. */
  readonly addressArgs: readonly string[];
}

function defineEvent(name: EventName): EventDefinition {
  const source: EventSource = REGISTRY_EVENT_NAMES.has(name) ? "registry" : "token";
  const abi = getAbiItem({
    abi: source === "registry" ? identityRegistryAbi : hbTokenAbi,
    name,
  }) as AbiEvent | undefined;
  if (!abi) {
    throw new Error(
      `lib/server/events.ts: ${name} is not in the generated ABI for the ${source} contract. ` +
        "Re-run `pnpm sync:contracts` after `forge build`.",
    );
  }
  return {
    name,
    source,
    abi,
    topic0: toEventSelector(abi),
    signature: toEventSignature(abi),
    addressArgs: abi.inputs
      .filter((input) => input.type === "address")
      .map((input, index) => input.name ?? `arg${index}`),
  };
}

/** Every indexed event, in the order `EVENT_NAMES` declares them. */
export const EVENT_DEFINITIONS: readonly EventDefinition[] = EVENT_NAMES.map(defineEvent);

export const EVENT_DEFINITION_BY_NAME: Readonly<Record<EventName, EventDefinition>> =
  Object.fromEntries(
    EVENT_DEFINITIONS.map((definition) => [definition.name, definition]),
  ) as Record<EventName, EventDefinition>;

/** `topics[0]` → definition. Two events cannot share a selector, so this is total. */
export const EVENT_DEFINITION_BY_TOPIC: ReadonlyMap<string, EventDefinition> = new Map(
  EVENT_DEFINITIONS.map((definition) => [definition.topic0.toLowerCase(), definition]),
);

/** The `topics[0]` filter handed to `eth_getLogs`, so the node returns only what we decode. */
export const EVENT_TOPICS: readonly Hex[] = EVENT_DEFINITIONS.map(
  (definition) => definition.topic0,
);

export function isEventName(value: unknown): value is EventName {
  return typeof value === "string" && (EVENT_NAMES as readonly string[]).includes(value);
}

// --------------------------------------------------------------------------- logs in, events out

/** A log exactly as an RPC returns it, before anything has been decoded. */
export interface RawLog {
  readonly address: string;
  readonly topics: readonly string[];
  readonly data: string;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly logIndex: number;
  readonly transactionHash: string;
  readonly transactionIndex: number;
  /** `true` when the node is telling us this log was reorged out. Always dropped. */
  readonly removed?: boolean;
}

export interface IndexedEvent {
  readonly name: EventName;
  readonly source: EventSource;
  /** The emitting contract, checksummed. Not an account: it never matches the account filter. */
  readonly address: Address;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly logIndex: number;
  readonly transactionHash: Hex;
  readonly transactionIndex: number;
  /** Decoded arguments in ABI order; every value the exact integer or address, stringified. */
  readonly args: Readonly<Record<string, string>>;
  /** Every address appearing anywhere in `args`, lower-cased and de-duplicated. */
  readonly accounts: readonly string[];
  /** Unix seconds of the block, or `null` until `lib/server/indexer.ts` has fetched it. */
  readonly blockTimestamp: number | null;
}

export type DecodeOutcome =
  | { readonly status: "ok"; readonly event: IndexedEvent }
  | { readonly status: "skipped"; readonly reason: string };

function stringifyArgument(type: string, value: unknown): string {
  if (type === "address" && typeof value === "string") return getAddress(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isInteger(value) ? value.toString() : String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Decode one log.
 *
 * Every refusal is a value: an unknown `topics[0]` (a role event, an `Approval`, anything a later
 * contract version adds) and a log the ABI cannot decode are both `skipped` with a reason, so the
 * caller can count them and say how many it dropped rather than pretending it saw everything.
 */
export function decodeLog(raw: RawLog): DecodeOutcome {
  if (raw.removed === true) {
    return { status: "skipped", reason: "the node marked the log removed (reorged out)" };
  }
  const topic0 = raw.topics[0];
  if (topic0 === undefined) {
    return { status: "skipped", reason: "anonymous log: no topics[0] to match an event against" };
  }
  const definition = EVENT_DEFINITION_BY_TOPIC.get(topic0.toLowerCase());
  if (!definition) {
    return { status: "skipped", reason: `topics[0] ${topic0} is not an indexed event` };
  }

  let decoded: { args?: unknown };
  try {
    decoded = decodeEventLog({
      abi: [definition.abi],
      data: raw.data as Hex,
      topics: raw.topics as [Hex, ...Hex[]],
    });
  } catch (error) {
    return {
      status: "skipped",
      reason: `${definition.name} did not decode against ${definition.signature}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const values = decoded.args;
  const byName = values !== null && typeof values === "object" && !Array.isArray(values);
  const args: Record<string, string> = {};
  const accounts: string[] = [];

  definition.abi.inputs.forEach((input, index) => {
    const key = input.name ?? `arg${index}`;
    const value = byName
      ? (values as Record<string, unknown>)[key]
      : (values as unknown[] | undefined)?.[index];
    if (value === undefined || value === null) return;
    const text = stringifyArgument(input.type, value);
    args[key] = text;
    if (input.type === "address") {
      const lowered = text.toLowerCase();
      if (!accounts.includes(lowered)) accounts.push(lowered);
    }
  });

  return {
    status: "ok",
    event: {
      name: definition.name,
      source: definition.source,
      address: getAddress(raw.address),
      blockNumber: raw.blockNumber,
      blockHash: raw.blockHash as Hex,
      logIndex: raw.logIndex,
      transactionHash: raw.transactionHash as Hex,
      transactionIndex: raw.transactionIndex,
      args,
      accounts,
      blockTimestamp: null,
    },
  };
}

export interface DecodeReport {
  readonly events: readonly IndexedEvent[];
  /** Logs the node marked `removed`. */
  readonly removed: number;
  /** Logs whose `topics[0]` is not one of ours — role events, `Approval`, a future event. */
  readonly unknown: number;
  /** Logs that matched an event but would not decode against its ABI. */
  readonly undecodable: number;
  /** One line per undecodable log, capped, for the operator. */
  readonly problems: readonly string[];
}

const MAX_REPORTED_PROBLEMS = 5;

export function decodeLogs(logs: readonly RawLog[]): DecodeReport {
  const events: IndexedEvent[] = [];
  const problems: string[] = [];
  let removed = 0;
  let unknown = 0;
  let undecodable = 0;

  for (const raw of logs) {
    const outcome = decodeLog(raw);
    if (outcome.status === "ok") {
      events.push(outcome.event);
      continue;
    }
    if (raw.removed === true) {
      removed += 1;
    } else if (
      outcome.reason.includes("not an indexed event") ||
      outcome.reason.includes("topics[0] to match")
    ) {
      unknown += 1;
    } else {
      undecodable += 1;
      if (problems.length < MAX_REPORTED_PROBLEMS) problems.push(outcome.reason);
    }
  }

  return { events, removed, unknown, undecodable, problems };
}

// --------------------------------------------------------------------------- identity and dedup

/** `(blockNumber, logIndex, transactionHash)` — the identity of a log. */
export function eventKey(event: IndexedEvent): string {
  return `${event.blockNumber.toString()}:${event.logIndex.toString()}:${event.transactionHash.toLowerCase()}`;
}

/** `(blockNumber, logIndex)` — the *slot*. Two different keys in one slot mean a reorg. */
export function slotKey(event: IndexedEvent): string {
  return `${event.blockNumber.toString()}:${event.logIndex.toString()}`;
}

/** Ascending canonical order: block, then log index. Total, because a slot holds one log. */
export function compareEvents(a: IndexedEvent, b: IndexedEvent): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}

export interface DedupeReport {
  /** Ascending, one event per slot. */
  readonly events: readonly IndexedEvent[];
  /** Exact `(block, logIndex, hash)` repeats dropped — an overlapping refetch, harmless. */
  readonly duplicates: number;
  /** Slots that held two different transactions. That is a reorg, and it is reported as one. */
  readonly conflicts: number;
  readonly conflictSlots: readonly string[];
}

/**
 * One event per slot, ascending.
 *
 * Input order is fetch order, so on a conflict the **later** observation wins: it is the more
 * recent view of the chain, and the earlier one is the orphan. Exact repeats are dropped without
 * comment; conflicts are counted, because a caller that is about to serve this index needs to be
 * able to say a reorg was seen while it was built.
 */
export function dedupeEvents(events: readonly IndexedEvent[]): DedupeReport {
  const bySlot = new Map<string, IndexedEvent>();
  const conflictSlots: string[] = [];
  let duplicates = 0;
  let conflicts = 0;

  for (const event of events) {
    const slot = slotKey(event);
    const existing = bySlot.get(slot);
    if (existing === undefined) {
      bySlot.set(slot, event);
      continue;
    }
    if (eventKey(existing) === eventKey(event)) {
      duplicates += 1;
      continue;
    }
    conflicts += 1;
    if (!conflictSlots.includes(slot)) conflictSlots.push(slot);
    bySlot.set(slot, event);
  }

  return {
    events: [...bySlot.values()].sort(compareEvents),
    duplicates,
    conflicts,
    conflictSlots,
  };
}

/** Attach block timestamps by block hash. Keyed by hash, not height: a reorg changes the hash. */
export function withTimestamps(
  events: readonly IndexedEvent[],
  timestampsByBlockHash: ReadonlyMap<string, number>,
): IndexedEvent[] {
  return events.map((event) => {
    const timestamp = timestampsByBlockHash.get(event.blockHash.toLowerCase());
    return timestamp === undefined ? event : { ...event, blockTimestamp: timestamp };
  });
}

// --------------------------------------------------------------------------- filtering

export interface EventFilter {
  /** Event names to keep. Empty or absent keeps every name. */
  readonly names?: readonly EventName[];
  /** An address that must appear somewhere in the decoded arguments. Case-insensitive. */
  readonly account?: string | null;
  readonly fromBlock?: bigint | null;
  readonly toBlock?: bigint | null;
}

/**
 * Does `account` appear anywhere in this event's arguments?
 *
 * Every `address`-typed argument is checked, in every position: `Transfer.from` **and**
 * `Transfer.to`, `NAVForced.by` (the third argument), `IdentityVerified.account`. The emitting
 * contract's own address is deliberately not matched — that would return the whole index for
 * anyone who filtered by the token address.
 */
export function matchesAccount(event: IndexedEvent, account: string): boolean {
  return event.accounts.includes(account.toLowerCase());
}

export function filterEvents(events: readonly IndexedEvent[], filter: EventFilter): IndexedEvent[] {
  const names = filter.names && filter.names.length > 0 ? new Set<EventName>(filter.names) : null;
  const account = filter.account ? filter.account.toLowerCase() : null;
  return events.filter((event) => {
    if (names && !names.has(event.name)) return false;
    if (account !== null && !matchesAccount(event, account)) return false;
    if (filter.fromBlock != null && event.blockNumber < filter.fromBlock) return false;
    if (filter.toBlock != null && event.blockNumber > filter.toBlock) return false;
    return true;
  });
}

// --------------------------------------------------------------------------- pagination

export type EventOrder = "asc" | "desc";

export interface Cursor {
  readonly chainId: number;
  readonly blockNumber: bigint;
  readonly logIndex: number;
}

/**
 * `"<chainId>:<blockNumber>:<logIndex>"` — a *position*, not an offset.
 *
 * That is what makes a page stable: events arriving at the head between two requests shift every
 * offset by one, but they do not move the slot a cursor names, so page two contains the same
 * events whether or not page one is still the newest page. The chain id is in the cursor so a
 * cursor minted against one chain is rejected rather than silently applied to another's heights.
 */
export function formatCursor(chainId: number, event: IndexedEvent): string {
  return `${chainId.toString()}:${event.blockNumber.toString()}:${event.logIndex.toString()}`;
}

export type CursorResult =
  | { readonly status: "ok"; readonly cursor: Cursor }
  | { readonly status: "invalid"; readonly reason: string };

export function parseCursor(raw: string): CursorResult {
  const parts = raw.split(":");
  if (parts.length !== 3) {
    return {
      status: "invalid",
      reason: "a cursor is three colon-separated parts: <chain id>:<block number>:<log index>.",
    };
  }
  const [chainPart, blockPart, logPart] = parts;
  if (
    chainPart === undefined ||
    blockPart === undefined ||
    logPart === undefined ||
    !/^\d+$/.test(chainPart) ||
    !/^\d+$/.test(blockPart) ||
    !/^\d+$/.test(logPart)
  ) {
    return { status: "invalid", reason: "every part of a cursor is a whole decimal number." };
  }
  return {
    status: "ok",
    cursor: {
      chainId: Number(chainPart),
      blockNumber: BigInt(blockPart),
      logIndex: Number(logPart),
    },
  };
}

/** Is `event` strictly after `cursor` in the given order? */
function isAfterCursor(event: IndexedEvent, cursor: Cursor, order: EventOrder): boolean {
  if (event.blockNumber !== cursor.blockNumber) {
    return order === "asc"
      ? event.blockNumber > cursor.blockNumber
      : event.blockNumber < cursor.blockNumber;
  }
  return order === "asc" ? event.logIndex > cursor.logIndex : event.logIndex < cursor.logIndex;
}

export interface PageRequest {
  readonly chainId: number;
  readonly order: EventOrder;
  readonly limit: number;
  readonly cursor?: Cursor | null;
}

export interface Page {
  readonly events: readonly IndexedEvent[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  /** How many events matched the filter *after* the cursor was applied. */
  readonly remaining: number;
}

/** `events` must be ascending (`dedupeEvents` output). Order is applied here. */
export function paginate(events: readonly IndexedEvent[], request: PageRequest): Page {
  const ordered = request.order === "desc" ? [...events].reverse() : [...events];
  const after = request.cursor
    ? ordered.filter((event) => isAfterCursor(event, request.cursor as Cursor, request.order))
    : ordered;
  const page = after.slice(0, request.limit);
  const last = page[page.length - 1];
  const hasMore = after.length > page.length;
  return {
    events: page,
    hasMore,
    nextCursor: hasMore && last ? formatCursor(request.chainId, last) : null,
    remaining: after.length,
  };
}

// --------------------------------------------------------------------------- argument access

/** A decoded argument as the exact integer the contract emitted, or `null` if it is not there. */
export function argBigInt(event: IndexedEvent, name: string): bigint | null {
  const raw = event.args[name];
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  return BigInt(raw);
}

/** A decoded address argument, lower-cased for comparison. */
export function argAddress(event: IndexedEvent, name: string): string | null {
  const raw = event.args[name];
  if (raw === undefined || !/^0x[0-9a-fA-F]{40}$/.test(raw)) return null;
  return raw.toLowerCase();
}

// --------------------------------------------------------------------------- balances and holders

export interface BalanceFold {
  /** Lower-cased address → balance in wei. The zero address is never a key. */
  readonly balances: ReadonlyMap<string, bigint>;
  /** Addresses with a strictly positive balance. Excludes the zero address, by construction. */
  readonly holders: number;
  /** Every address that ever held a positive balance, whether or not it still does. */
  readonly everHeld: number;
  /** `minted - burned` from `Transfer` alone; compared against `totalSupply()` by the caller. */
  readonly supplyWei: bigint;
  readonly mintedWei: bigint;
  readonly burnedWei: bigint;
  readonly transferCount: number;
  /**
   * Addresses whose balance went negative. Arithmetically impossible on a complete log set, so a
   * non-empty list means the index has a hole and the holder count must not be trusted.
   */
  readonly negative: readonly string[];
}

/**
 * Fold `Transfer` into balances.
 *
 * `Transfer` is the only event folded, and that is not an omission. Subscription mints, redemption
 * burns and the issuer's operational mint and burn all go through ERC-20 `_update`, so each emits
 * a `Transfer` with the zero address on one side *in addition to* its own event. Folding
 * `Subscribed` or `OperationalMint` as well would count every one of them twice.
 */
export function foldBalances(events: readonly IndexedEvent[]): BalanceFold {
  const balances = new Map<string, bigint>();
  const everHeld = new Set<string>();
  const negative: string[] = [];
  let mintedWei = 0n;
  let burnedWei = 0n;
  let transferCount = 0;

  const move = (address: string, delta: bigint): void => {
    if (address === ZERO_ADDRESS) return;
    const next = (balances.get(address) ?? 0n) + delta;
    if (next === 0n) {
      balances.delete(address);
      return;
    }
    if (next < 0n && !negative.includes(address)) negative.push(address);
    if (next > 0n) everHeld.add(address);
    balances.set(address, next);
  };

  for (const event of events) {
    if (event.name !== "Transfer" || event.source !== "token") continue;
    const from = argAddress(event, "from");
    const to = argAddress(event, "to");
    const value = argBigInt(event, "value");
    if (from === null || to === null || value === null) continue;
    transferCount += 1;
    if (from === ZERO_ADDRESS) mintedWei += value;
    else move(from, -value);
    if (to === ZERO_ADDRESS) burnedWei += value;
    else move(to, value);
  }

  let holders = 0;
  for (const balance of balances.values()) if (balance > 0n) holders += 1;

  return {
    balances,
    holders,
    everHeld: everHeld.size,
    supplyWei: mintedWei - burnedWei,
    mintedWei,
    burnedWei,
    transferCount,
    negative,
  };
}

// --------------------------------------------------------------------------- days

export const SECONDS_PER_DAY = 86_400;

/** Unix seconds → whole days since the epoch, floored. Integer arithmetic, UTC. */
export function dayIndex(timestampSeconds: number): number {
  return Math.floor(timestampSeconds / SECONDS_PER_DAY);
}

/**
 * Whole days since the epoch → `"YYYY-MM-DD"`.
 *
 * Howard Hinnant's `civil_from_days`, in integers. Written out rather than delegated to `Date` or
 * `Intl` for the same reason `lib/format.ts` formats dates by hand (PLAN.md D52): the bucket a
 * number lands in must not depend on the locale or the timezone of whoever is running the server.
 */
export function isoDateFromDayIndex(days: number): string {
  const shifted = days + 719_468;
  const era = Math.floor(shifted / 146_097);
  const dayOfEra = shifted - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1_460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9);
  const calendarYear = year + (month <= 2 ? 1 : 0);
  const pad = (value: number): string => value.toString().padStart(2, "0");
  return `${calendarYear.toString().padStart(4, "0")}-${pad(month)}-${pad(day)}`;
}

/** Unix seconds → `"2026-09-14T21:18:10Z"`, the `isoTimestamp` shape the schemas validate. */
export function isoTimestampFromSeconds(seconds: number): string {
  return `${new Date(seconds * 1000).toISOString().slice(0, 19)}Z`;
}

export interface DailyBucket {
  readonly date: string;
  readonly dayIndex: number;
  readonly subscriptionsCount: number;
  readonly subscriptionsUsdcIn6: bigint;
  readonly subscriptionsTokensOutWei: bigint;
  readonly redemptionsCount: number;
  readonly redemptionsTokensInWei: bigint;
  readonly redemptionsUsdcOut6: bigint;
  readonly distributionsCount: number;
  readonly distributionsUsdcAmount6: bigint;
  readonly distributionsUsdcAllocated6: bigint;
  readonly claimsCount: number;
  readonly claimsUsdc6: bigint;
  /** The last `NAVUpdated.newNav` of the day, or `null` if NAV did not change that day. */
  readonly navCloseUsdc6: bigint | null;
}

export interface BucketReport {
  readonly buckets: readonly DailyBucket[];
  /** Events whose block timestamp was not resolved, and which therefore sit in no bucket. */
  readonly undated: number;
  /** `true` when empty days between the first and last were filled with zero rows. */
  readonly filled: boolean;
}

/** Days beyond which empty-day filling is skipped rather than allocating an unbounded array. */
export const MAX_FILLED_DAYS = 1_000;

function emptyBucket(day: number): DailyBucket {
  return {
    date: isoDateFromDayIndex(day),
    dayIndex: day,
    subscriptionsCount: 0,
    subscriptionsUsdcIn6: 0n,
    subscriptionsTokensOutWei: 0n,
    redemptionsCount: 0,
    redemptionsTokensInWei: 0n,
    redemptionsUsdcOut6: 0n,
    distributionsCount: 0,
    distributionsUsdcAmount6: 0n,
    distributionsUsdcAllocated6: 0n,
    claimsCount: 0,
    claimsUsdc6: 0n,
    navCloseUsdc6: null,
  };
}

/**
 * Subscriptions, redemptions, distributions and claims bucketed by UTC day.
 *
 * Sums are `bigint` throughout: a day's subscriptions are the exact sum of the six-decimal
 * integers the contract emitted, not a rounded float that happens to render the same (D22).
 * Events whose block timestamp is not known are counted in `undated` and are in no bucket — a day
 * they might belong to is not a day they do belong to.
 */
export function bucketByDay(events: readonly IndexedEvent[]): BucketReport {
  const buckets = new Map<number, DailyBucket>();
  let undated = 0;

  const edit = (day: number, change: (bucket: DailyBucket) => DailyBucket): void => {
    buckets.set(day, change(buckets.get(day) ?? emptyBucket(day)));
  };

  for (const event of events) {
    if (event.blockTimestamp === null) {
      if (
        event.name === "Subscribed" ||
        event.name === "Redeemed" ||
        event.name === "CouponDistributed" ||
        event.name === "CouponClaimed" ||
        event.name === "NAVUpdated"
      ) {
        undated += 1;
      }
      continue;
    }
    const day = dayIndex(event.blockTimestamp);

    switch (event.name) {
      case "Subscribed":
        edit(day, (bucket) => ({
          ...bucket,
          subscriptionsCount: bucket.subscriptionsCount + 1,
          subscriptionsUsdcIn6: bucket.subscriptionsUsdcIn6 + (argBigInt(event, "usdcIn") ?? 0n),
          subscriptionsTokensOutWei:
            bucket.subscriptionsTokensOutWei + (argBigInt(event, "tokensOut") ?? 0n),
        }));
        break;
      case "Redeemed":
        edit(day, (bucket) => ({
          ...bucket,
          redemptionsCount: bucket.redemptionsCount + 1,
          redemptionsTokensInWei:
            bucket.redemptionsTokensInWei + (argBigInt(event, "tokensIn") ?? 0n),
          redemptionsUsdcOut6: bucket.redemptionsUsdcOut6 + (argBigInt(event, "usdcOut") ?? 0n),
        }));
        break;
      case "CouponDistributed":
        edit(day, (bucket) => ({
          ...bucket,
          distributionsCount: bucket.distributionsCount + 1,
          distributionsUsdcAmount6:
            bucket.distributionsUsdcAmount6 + (argBigInt(event, "usdcAmount") ?? 0n),
          distributionsUsdcAllocated6:
            bucket.distributionsUsdcAllocated6 + (argBigInt(event, "usdcAllocated") ?? 0n),
        }));
        break;
      case "CouponClaimed":
        edit(day, (bucket) => ({
          ...bucket,
          claimsCount: bucket.claimsCount + 1,
          claimsUsdc6: bucket.claimsUsdc6 + (argBigInt(event, "usdcAmount") ?? 0n),
        }));
        break;
      case "NAVUpdated": {
        const nav = argBigInt(event, "newNav");
        if (nav !== null) edit(day, (bucket) => ({ ...bucket, navCloseUsdc6: nav }));
        break;
      }
      default:
        break;
    }
  }

  const days = [...buckets.keys()].sort((a, b) => a - b);
  const first = days[0];
  const last = days[days.length - 1];
  if (first === undefined || last === undefined) {
    return { buckets: [], undated, filled: false };
  }

  const span = last - first + 1;
  if (span > MAX_FILLED_DAYS) {
    return {
      buckets: days.map((day) => buckets.get(day) ?? emptyBucket(day)),
      undated,
      filled: false,
    };
  }

  const filledBuckets: DailyBucket[] = [];
  for (let day = first; day <= last; day += 1) {
    filledBuckets.push(buckets.get(day) ?? emptyBucket(day));
  }
  return { buckets: filledBuckets, undated, filled: true };
}

// --------------------------------------------------------------------------- aggregates

export interface FlowTotals {
  readonly count: number;
  /** Distinct accounts that appear in these events. */
  readonly accounts: number;
  readonly usdc6: bigint;
  readonly tokensWei: bigint;
}

export interface DistributionTotals {
  readonly count: number;
  /** `CouponDistributed.usdcAmount`: what the issuer actually paid into the vault. */
  readonly usdcAmount6: bigint;
  /** `CouponDistributed.usdcAllocated`: the part the cumulative index attributed to holders. */
  readonly usdcAllocated6: bigint;
  /** `usdcAmount - usdcAllocated` — the D29 index truncation remainder. Vault liquidity, not debt. */
  readonly truncationRemainder6: bigint;
  readonly latestDistributionId: bigint | null;
  readonly latestTimestamp: number | null;
}

export interface NavPoint {
  readonly blockNumber: bigint;
  readonly timestamp: number | null;
  readonly previousNavUsdc6: bigint;
  readonly navUsdc6: bigint;
  readonly reportedAumUsdc6: bigint;
  /** `true` when a `NAVForced` was emitted in the same transaction (an admin rail bypass). */
  readonly forced: boolean;
  readonly transactionHash: Hex;
}

export interface VerificationTotals {
  readonly verified: number;
  readonly removed: number;
  /** Accounts verified and not since removed. A re-verification overwrites, it does not add. */
  readonly currentlyVerified: number;
}

export interface ActivityAggregate {
  readonly eventCounts: Readonly<Record<EventName, number>>;
  readonly balances: BalanceFold;
  readonly subscriptions: FlowTotals;
  readonly redemptions: FlowTotals;
  readonly distributions: DistributionTotals;
  readonly claims: FlowTotals;
  readonly verifications: VerificationTotals;
  readonly daily: BucketReport;
  readonly navPoints: readonly NavPoint[];
  readonly pauseCount: number;
  readonly unpauseCount: number;
}

function emptyCounts(): Record<EventName, number> {
  const counts = {} as Record<EventName, number>;
  for (const name of EVENT_NAMES) counts[name] = 0;
  return counts;
}

/** Everything `/api/stats` reports, folded in one pass over the ascending index. */
export function aggregate(events: readonly IndexedEvent[]): ActivityAggregate {
  const eventCounts = emptyCounts();

  const subscriptionAccounts = new Set<string>();
  const redemptionAccounts = new Set<string>();
  const claimAccounts = new Set<string>();
  const verified = new Set<string>();

  let subscriptionCount = 0;
  let subscriptionUsdc6 = 0n;
  let subscriptionTokensWei = 0n;
  let redemptionCount = 0;
  let redemptionUsdc6 = 0n;
  let redemptionTokensWei = 0n;
  let claimCount = 0;
  let claimUsdc6 = 0n;
  let distributionCount = 0;
  let distributionAmount6 = 0n;
  let distributionAllocated6 = 0n;
  let latestDistributionId: bigint | null = null;
  let latestDistributionAt: number | null = null;
  let verifiedCount = 0;
  let removedCount = 0;
  let pauseCount = 0;
  let unpauseCount = 0;

  // `NAVForced` sits in the same transaction as the `NAVUpdated` it qualifies (HBToken.setNAV
  // emits both), so the forced flag is resolved per transaction rather than per log.
  const forcedTransactions = new Set<string>();
  for (const event of events) {
    if (event.name === "NAVForced") forcedTransactions.add(event.transactionHash.toLowerCase());
  }

  const navPoints: NavPoint[] = [];

  for (const event of events) {
    eventCounts[event.name] += 1;

    switch (event.name) {
      case "Subscribed": {
        subscriptionCount += 1;
        subscriptionUsdc6 += argBigInt(event, "usdcIn") ?? 0n;
        subscriptionTokensWei += argBigInt(event, "tokensOut") ?? 0n;
        const account = argAddress(event, "account");
        if (account) subscriptionAccounts.add(account);
        break;
      }
      case "Redeemed": {
        redemptionCount += 1;
        redemptionTokensWei += argBigInt(event, "tokensIn") ?? 0n;
        redemptionUsdc6 += argBigInt(event, "usdcOut") ?? 0n;
        const account = argAddress(event, "account");
        if (account) redemptionAccounts.add(account);
        break;
      }
      case "CouponClaimed": {
        claimCount += 1;
        claimUsdc6 += argBigInt(event, "usdcAmount") ?? 0n;
        const account = argAddress(event, "account");
        if (account) claimAccounts.add(account);
        break;
      }
      case "CouponDistributed": {
        distributionCount += 1;
        distributionAmount6 += argBigInt(event, "usdcAmount") ?? 0n;
        distributionAllocated6 += argBigInt(event, "usdcAllocated") ?? 0n;
        latestDistributionId = argBigInt(event, "distributionId");
        latestDistributionAt = event.blockTimestamp;
        break;
      }
      case "NAVUpdated": {
        const previous = argBigInt(event, "oldNav");
        const next = argBigInt(event, "newNav");
        if (previous !== null && next !== null) {
          navPoints.push({
            blockNumber: event.blockNumber,
            timestamp: event.blockTimestamp,
            previousNavUsdc6: previous,
            navUsdc6: next,
            reportedAumUsdc6: argBigInt(event, "reportedAUM") ?? 0n,
            forced: forcedTransactions.has(event.transactionHash.toLowerCase()),
            transactionHash: event.transactionHash,
          });
        }
        break;
      }
      case "IdentityVerified": {
        verifiedCount += 1;
        const account = argAddress(event, "account");
        if (account) verified.add(account);
        break;
      }
      case "IdentityRemoved": {
        removedCount += 1;
        const account = argAddress(event, "account");
        if (account) verified.delete(account);
        break;
      }
      case "Paused":
        pauseCount += 1;
        break;
      case "Unpaused":
        unpauseCount += 1;
        break;
      default:
        break;
    }
  }

  return {
    eventCounts,
    balances: foldBalances(events),
    subscriptions: {
      count: subscriptionCount,
      accounts: subscriptionAccounts.size,
      usdc6: subscriptionUsdc6,
      tokensWei: subscriptionTokensWei,
    },
    redemptions: {
      count: redemptionCount,
      accounts: redemptionAccounts.size,
      usdc6: redemptionUsdc6,
      tokensWei: redemptionTokensWei,
    },
    distributions: {
      count: distributionCount,
      usdcAmount6: distributionAmount6,
      usdcAllocated6: distributionAllocated6,
      truncationRemainder6: distributionAmount6 - distributionAllocated6,
      latestDistributionId,
      latestTimestamp: latestDistributionAt,
    },
    claims: {
      count: claimCount,
      accounts: claimAccounts.size,
      usdc6: claimUsdc6,
      tokensWei: 0n,
    },
    verifications: {
      verified: verifiedCount,
      removed: removedCount,
      currentlyVerified: verified.size,
    },
    daily: bucketByDay(events),
    navPoints,
    pauseCount,
    unpauseCount,
  };
}

// --------------------------------------------------------------------------- wire shape

/** An indexed event in the shape `/api/events` returns. Every integer is a decimal string. */
export function toWireEvent(event: IndexedEvent): ChainEvent {
  return {
    name: event.name,
    source: event.source,
    address: event.address,
    block_number: Number(event.blockNumber),
    block_hash: event.blockHash,
    block_timestamp: event.blockTimestamp,
    block_time:
      event.blockTimestamp === null ? null : isoTimestampFromSeconds(event.blockTimestamp),
    transaction_hash: event.transactionHash,
    transaction_index: event.transactionIndex,
    log_index: event.logIndex,
    args: event.args,
    accounts: [...event.accounts],
  };
}
