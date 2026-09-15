/**
 * Reading a decoded event argument, safely.
 *
 * `/api/events` carries every argument as a string — addresses checksummed, integers as decimal
 * strings of the exact integer the contract emitted (PLAN.md D22), because JSON has no BigInt and a
 * JSON number would silently lose the low digits of an 18-decimal amount. These four helpers are
 * the only place this page turns one of those strings back into a value, and each returns `null`
 * rather than a guess when the string is not what it should be: a missing figure can be rendered as
 * "not recorded", whereas a `NaN` renders as a number that is not one.
 */

import type { ChainEvent } from "@/lib/schemas";

/** The ERC-20 mint/burn sentinel. Never an account, never a counterparty, never a holder. */
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function eventArg(event: ChainEvent, name: string): string | null {
  return event.args[name] ?? null;
}

/** A decimal-string argument as a BigInt, or `null` when it is absent or not a whole number. */
export function eventInt(event: ChainEvent, name: string): bigint | null {
  const raw = eventArg(event, name);
  if (raw === null || !/^-?\d+$/.test(raw)) return null;
  return BigInt(raw);
}

/** An address argument, as emitted (checksummed), or `null` when it is absent or malformed. */
export function eventAddress(event: ChainEvent, name: string): string | null {
  const raw = eventArg(event, name);
  return raw !== null && /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw : null;
}

export function isZeroAddress(address: string | null): boolean {
  return address !== null && address.toLowerCase() === ZERO_ADDRESS;
}

/** Address equality, case-insensitively: the API lower-cases `accounts` and checksums `args`. */
export function sameAddress(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.toLowerCase() === b.toLowerCase();
}
