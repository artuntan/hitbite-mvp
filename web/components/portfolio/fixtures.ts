/**
 * Event fixtures for the tests of this folder — and for `e2e/portfolio.spec.ts`, which asserts the
 * CSV generator against them.
 *
 * They are built to be a **real** `ChainEvent`: `history.test.ts` parses every one of them with
 * `chainEventSchema`, so a fixture that has drifted from what `/api/events` actually serves fails a
 * test rather than quietly propping up a passing one.
 *
 * Hashes and addresses are generated from a short seed rather than written out, for two reasons:
 * a 32-byte hex literal in a `.ts` file trips `scripts/check-secrets.sh` (a transaction hash and a
 * private key are indistinguishable to a regex), and a readable seed makes a failing assertion say
 * which event it was about.
 */

import type { ChainEvent, EventName } from "@/lib/schemas";

/** `hash("a1") -> "0x0000…00a1"`. Deterministic, and no 64-hex literal in the source. */
export function hash(seed: string): string {
  return `0x${seed
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "")
    .padStart(64, "0")}`;
}

/** `addr("beef") -> "0x0000…beef"`, 20 bytes. */
export function addr(seed: string): string {
  return `0x${seed
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "")
    .padStart(40, "0")}`;
}

export const HOLDER = addr("a11ce");
export const OTHER = addr("b0b");
export const ZERO = addr("");
export const TOKEN_ADDRESS = addr("70ce7");
export const REGISTRY_ADDRESS = addr("7e915747");

/** 2026-09-14T21:18:10Z, the timestamp the committed Anvil deployment records. */
const BASE_TIMESTAMP = 1_789_420_690;

function isoFromSeconds(seconds: number): string {
  return `${new Date(seconds * 1000).toISOString().slice(0, 19)}Z`;
}

export interface EventOptions {
  readonly block: number;
  readonly logIndex?: number;
  readonly tx?: string;
  /** `null` builds an event whose block timestamp the indexer has not fetched. */
  readonly timestamp?: number | null;
  readonly source?: "token" | "registry";
}

function event(
  name: EventName,
  args: Record<string, string>,
  accounts: readonly string[],
  options: EventOptions,
): ChainEvent {
  const timestamp =
    options.timestamp === undefined ? BASE_TIMESTAMP + options.block * 12 : options.timestamp;
  const source = options.source ?? "token";
  return {
    name,
    source,
    address: source === "registry" ? REGISTRY_ADDRESS : TOKEN_ADDRESS,
    block_number: options.block,
    block_hash: hash(`b${options.block.toString(16)}`),
    block_timestamp: timestamp,
    block_time: timestamp === null ? null : isoFromSeconds(timestamp),
    transaction_hash: hash(options.tx ?? `7${options.block.toString(16)}`),
    transaction_index: 0,
    log_index: options.logIndex ?? 0,
    args,
    accounts: accounts.map((value) => value.toLowerCase()),
  };
}

export function subscribed(
  account: string,
  usdcIn: bigint,
  tokensOut: bigint,
  nav: bigint,
  options: EventOptions,
): ChainEvent {
  return event(
    "Subscribed",
    {
      account,
      usdcIn: usdcIn.toString(),
      tokensOut: tokensOut.toString(),
      nav: nav.toString(),
    },
    [account],
    options,
  );
}

export function redeemed(
  account: string,
  tokensIn: bigint,
  usdcOut: bigint,
  nav: bigint,
  options: EventOptions,
): ChainEvent {
  return event(
    "Redeemed",
    {
      account,
      tokensIn: tokensIn.toString(),
      usdcOut: usdcOut.toString(),
      nav: nav.toString(),
    },
    [account],
    options,
  );
}

export function transfer(
  from: string,
  to: string,
  value: bigint,
  options: EventOptions,
): ChainEvent {
  return event("Transfer", { from, to, value: value.toString() }, [from, to], options);
}

export function couponClaimed(
  account: string,
  usdcAmount: bigint,
  options: EventOptions,
): ChainEvent {
  return event("CouponClaimed", { account, usdcAmount: usdcAmount.toString() }, [account], options);
}

export function identityVerified(
  account: string,
  country: number,
  options: EventOptions,
): ChainEvent {
  return event(
    "IdentityVerified",
    {
      account,
      country: country.toString(),
      investorType: "2",
      verifiedAt: String(BASE_TIMESTAMP),
    },
    [account],
    { ...options, source: "registry" },
  );
}

export function identityRemoved(account: string, options: EventOptions): ChainEvent {
  return event("IdentityRemoved", { account }, [account], { ...options, source: "registry" });
}

export function operationalMint(
  account: string,
  amount: bigint,
  options: EventOptions,
): ChainEvent {
  return event("OperationalMint", { to: account, amount: amount.toString() }, [account], options);
}

/**
 * One address's whole story, oldest first, in exactly the order `/api/events?order=asc` returns it:
 *
 *   1. verified in the registry;
 *   2. subscribes 1,000 USDC at NAV 1.000000 -> 1,000 hbTRS (with its mint `Transfer`);
 *   3. subscribes 500 USDC at NAV 1.250000 -> 400 hbTRS (with its mint `Transfer`);
 *   4. is sent 100 hbTRS by another address — tokens with no cost basis this app can know;
 *   5. sends 200 hbTRS on;
 *   6. claims a 12.500000 USDC coupon;
 *   7. redeems 300 hbTRS at NAV 1.250000 -> 375 USDC (with its burn `Transfer`).
 *
 * Ending balance: 1,000 + 400 + 100 − 200 − 300 = 1,000 hbTRS.
 */
export function holderHistory(): ChainEvent[] {
  return [
    identityVerified(HOLDER, 784, { block: 10 }),
    subscribed(HOLDER, 1_000_000_000n, 1_000_000_000_000_000_000_000n, 1_000_000n, { block: 12 }),
    transfer(ZERO, HOLDER, 1_000_000_000_000_000_000_000n, { block: 12, logIndex: 1 }),
    subscribed(HOLDER, 500_000_000n, 400_000_000_000_000_000_000n, 1_250_000n, { block: 20 }),
    transfer(ZERO, HOLDER, 400_000_000_000_000_000_000n, { block: 20, logIndex: 1 }),
    transfer(OTHER, HOLDER, 100_000_000_000_000_000_000n, { block: 24 }),
    transfer(HOLDER, OTHER, 200_000_000_000_000_000_000n, { block: 28 }),
    couponClaimed(HOLDER, 12_500_000n, { block: 30 }),
    redeemed(HOLDER, 300_000_000_000_000_000_000n, 375_000_000n, 1_250_000n, { block: 34 }),
    transfer(HOLDER, ZERO, 300_000_000_000_000_000_000n, { block: 34, logIndex: 1 }),
  ];
}

/** The balance the fixture history ends on, in wei. */
export const HOLDER_BALANCE_18 = 1_000_000_000_000_000_000_000n;
