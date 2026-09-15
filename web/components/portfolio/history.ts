/**
 * One indexed event, turned into a row somebody can read — and into the numbers the CSV exports.
 *
 * No React, no wagmi, no fetch: a `ChainEvent` goes in and a `HistoryRow` comes out, so the table,
 * the filter chips and the export all read the same view model and cannot disagree about what an
 * event meant.
 *
 * Two rules run through the file.
 *
 *  1. **Amounts stay integers.** `args` carries decimal strings of the exact integer the contract
 *     emitted (PLAN.md D22); they are parsed with `BigInt`, never with `Number`, and formatted from
 *     the integer at the edge. An amount that will not parse becomes `null` — a missing figure —
 *     rather than a `NaN` rendered as a number.
 *  2. **Sign is from the holder's point of view.** `tokens_delta` is positive when tokens arrive at
 *     the address being viewed and negative when they leave it, and `usdc_delta` likewise. That is
 *     the only reading under which a column of a spreadsheet sums to something meaningful.
 */

import {
  eventAddress,
  eventArg,
  eventInt,
  isZeroAddress,
  sameAddress,
} from "@/components/portfolio/args";
import { explorerTxUrl } from "@/lib/chains";
import { TOKEN } from "@/lib/copy";
import { getCountryByNumeric } from "@/lib/countries";
import { formatDateTimeUtc, formatTokens, formatUsdcExact } from "@/lib/format";
import type { ChainEvent, EventName } from "@/lib/schemas";

export type HistoryGroup =
  "subscriptions" | "redemptions" | "coupons" | "transfers" | "issuer" | "verification" | "other";

const GROUP_BY_EVENT: Readonly<Record<EventName, HistoryGroup>> = {
  Subscribed: "subscriptions",
  Redeemed: "redemptions",
  CouponClaimed: "coupons",
  CouponDistributed: "coupons",
  Transfer: "transfers",
  OperationalMint: "issuer",
  OperationalBurn: "issuer",
  IdentityVerified: "verification",
  IdentityRemoved: "verification",
  NAVUpdated: "other",
  NAVForced: "other",
  Paused: "other",
  Unpaused: "other",
  CountryBlockStatusChanged: "other",
};

export interface HistoryFilter {
  readonly id: HistoryGroup | "all";
  readonly label: string;
  /** What the export says it contains when this chip is the active one. */
  readonly describes: string;
}

/**
 * The filter chips, in the order they are shown. Only chips with rows behind them are rendered, so
 * a wallet that has never been sent a token is not offered a "Transfers" filter that shows nothing.
 */
export const HISTORY_FILTERS: readonly HistoryFilter[] = [
  { id: "all", label: "All events", describes: "every indexed event naming this address" },
  { id: "subscriptions", label: "Subscriptions", describes: "subscriptions only" },
  { id: "redemptions", label: "Redemptions", describes: "redemptions only" },
  { id: "coupons", label: "Coupons", describes: "coupon events only" },
  { id: "transfers", label: "Transfers", describes: "ERC-20 transfers only" },
  { id: "issuer", label: "Issuer actions", describes: "issuer mints and burns only" },
  { id: "verification", label: "Verification", describes: "identity registry events only" },
  { id: "other", label: "Other", describes: "NAV, pause and other contract events only" },
];

export type HistoryFilterId = HistoryFilter["id"];

export interface HistoryRow {
  /** `(block, log index, transaction)` — the identity of a log, and a stable React key. */
  readonly key: string;
  readonly name: EventName;
  /** What happened, in words: "Subscribed", "Coupon claimed", "Sent". */
  readonly label: string;
  /** One sentence of context: the NAV used, the counterparty, the country. */
  readonly detail: string;
  readonly group: HistoryGroup;
  readonly blockNumber: number;
  /** Unix seconds, or `null` when the indexer has not fetched this block's timestamp. */
  readonly timestamp: number | null;
  /** `"2026-09-14T21:18:10Z"`, straight from the API. `null` when there is no timestamp. */
  readonly isoTime: string | null;
  /** The same instant for a reader, or the reason there is none. */
  readonly displayTime: string;
  readonly transactionHash: string;
  readonly logIndex: number;
  /** The emitting contract, checksummed. Never the account. */
  readonly contract: string;
  readonly explorerUrl: string | null;
  /** Signed, from the viewed address's point of view. `null` when the event moves no USDC. */
  readonly usdcDelta6: bigint | null;
  /** Signed, same convention, 18 decimals. `null` when the event moves no tokens. */
  readonly tokensDelta18: bigint | null;
  /** The NAV the contract recorded with this event, when it carried one. */
  readonly nav6: bigint | null;
  /** The other side of a transfer, checksummed, or `null`. */
  readonly counterparty: string | null;
}

const usdc = (value: bigint) => `${formatUsdcExact(value)} USDC`;
const tokens = (value: bigint) => `${formatTokens(value, 6)} ${TOKEN.symbol}`;

interface Described {
  readonly label: string;
  readonly detail: string;
  readonly usdcDelta6: bigint | null;
  readonly tokensDelta18: bigint | null;
  readonly nav6: bigint | null;
  readonly counterparty: string | null;
}

const NOTHING: Described = {
  label: "",
  detail: "",
  usdcDelta6: null,
  tokensDelta18: null,
  nav6: null,
  counterparty: null,
};

/**
 * What one event meant for `account`.
 *
 * `Transfer` is the interesting case: `subscribe`, `redeem`, `mint` and `burn` all move tokens
 * through ERC-20 `_update`, so each of them emits a `Transfer` **as well as** its own event. Both
 * are listed — hiding one would make the history disagree with the explorer — and the transfer leg
 * says which it is, so nobody reads a subscription as two separate acquisitions.
 */
function describe(event: ChainEvent, account: string): Described {
  switch (event.name) {
    case "Subscribed": {
      const usdcIn = eventInt(event, "usdcIn");
      const tokensOut = eventInt(event, "tokensOut");
      const nav6 = eventInt(event, "nav");
      return {
        label: "Subscribed",
        detail:
          nav6 === null
            ? "Test USDC into the vault, tokens minted at the NAV in this block."
            : `Minted at ${usdc(nav6)} per token — the NAV in the block that included it.`,
        usdcDelta6: usdcIn === null ? null : -usdcIn,
        tokensDelta18: tokensOut,
        nav6,
        counterparty: null,
      };
    }
    case "Redeemed": {
      const tokensIn = eventInt(event, "tokensIn");
      const usdcOut = eventInt(event, "usdcOut");
      const nav6 = eventInt(event, "nav");
      return {
        label: "Redeemed",
        detail:
          nav6 === null
            ? "Tokens burned, test USDC paid out of available liquidity."
            : `Burned at ${usdc(nav6)} per token, paid out of available liquidity.`,
        usdcDelta6: usdcOut,
        tokensDelta18: tokensIn === null ? null : -tokensIn,
        nav6,
        counterparty: null,
      };
    }
    case "CouponClaimed":
      return {
        ...NOTHING,
        label: "Coupon claimed",
        detail: "Everything accrued to this address at the moment of the claim, paid in test USDC.",
        usdcDelta6: eventInt(event, "usdcAmount"),
      };
    case "CouponDistributed": {
      const amount = eventInt(event, "usdcAmount");
      const allocated = eventInt(event, "usdcAllocated");
      return {
        ...NOTHING,
        label: "Coupon distributed",
        detail:
          amount === null || allocated === null
            ? "A distribution to every holder. Each holder's share accrues without anyone iterating a list."
            : `${usdc(amount)} distributed to all holders, ${usdc(allocated)} of it attributable after index truncation.`,
      };
    }
    case "Transfer": {
      const from = eventAddress(event, "from");
      const to = eventAddress(event, "to");
      const value = eventInt(event, "value");
      const inbound = sameAddress(to, account);
      const outbound = sameAddress(from, account);
      if (inbound && outbound) {
        return {
          ...NOTHING,
          label: "Self-transfer",
          detail: "This address sent tokens to itself, so the balance is unchanged.",
          tokensDelta18: 0n,
        };
      }
      if (inbound) {
        return {
          ...NOTHING,
          label: isZeroAddress(from) ? "Minted in" : "Received",
          detail: isZeroAddress(from)
            ? "The transfer leg of a subscription or an issuer mint: ERC-20 mints show as a transfer from the zero address."
            : `Sent to this address by ${from ?? "an address the log did not carry"}.`,
          tokensDelta18: value,
          counterparty: isZeroAddress(from) ? null : from,
        };
      }
      if (outbound) {
        return {
          ...NOTHING,
          label: isZeroAddress(to) ? "Burned out" : "Sent",
          detail: isZeroAddress(to)
            ? "The transfer leg of a redemption or an issuer burn: ERC-20 burns show as a transfer to the zero address."
            : `Sent from this address to ${to ?? "an address the log did not carry"}.`,
          tokensDelta18: value === null ? null : -value,
          counterparty: isZeroAddress(to) ? null : to,
        };
      }
      return {
        ...NOTHING,
        label: "Transfer",
        detail: "A transfer naming this address, in neither the sender nor the recipient position.",
        tokensDelta18: null,
      };
    }
    case "OperationalMint":
      return {
        ...NOTHING,
        label: "Issuer mint",
        detail:
          "An operational correction by the issuer, outside the subscription flow. No test USDC entered the vault for it.",
        tokensDelta18: eventInt(event, "amount"),
      };
    case "OperationalBurn": {
      const amount = eventInt(event, "amount");
      return {
        ...NOTHING,
        label: "Issuer burn",
        detail:
          "An operational correction by the issuer, outside the redemption flow. No test USDC left the vault for it.",
        tokensDelta18: amount === null ? null : -amount,
      };
    }
    case "IdentityVerified": {
      const country = eventInt(event, "country");
      const name = country === null ? null : (getCountryByNumeric(Number(country))?.name ?? null);
      const investorType = eventInt(event, "investorType");
      return {
        ...NOTHING,
        label: "Verified in the registry",
        detail: `Added to the identity registry${
          country === null ? "" : ` with country ${country}${name ? ` (${name})` : ""}`
        }${investorType === null ? "" : `, investor type ${investorType}`}. This is what lets the address receive tokens.`,
      };
    }
    case "IdentityRemoved":
      return {
        ...NOTHING,
        label: "Removed from the registry",
        detail:
          "The address can no longer receive tokens. It can still redeem and claim coupons — the contract does not check eligibility on a burn or a claim (PLAN.md D4).",
      };
    case "NAVUpdated": {
      const newNav = eventInt(event, "newNav");
      return {
        ...NOTHING,
        label: "NAV updated",
        detail:
          newNav === null
            ? "The oracle set a new net asset value."
            : `The net asset value became ${usdc(newNav)} per token.`,
        nav6: newNav,
      };
    }
    case "NAVForced": {
      const newNav = eventInt(event, "newNav");
      return {
        ...NOTHING,
        label: "NAV forced",
        detail:
          "A NAV move outside the oracle rail, forced by an admin. Recorded as its own event so it can never pass unnoticed.",
        nav6: newNav,
      };
    }
    case "Paused":
      return {
        ...NOTHING,
        label: "Token paused",
        detail:
          "Subscriptions, redemptions, transfers, distributions and claims all stop while the token is paused.",
      };
    case "Unpaused":
      return { ...NOTHING, label: "Token unpaused", detail: "Value can move again." };
    case "CountryBlockStatusChanged": {
      const country = eventInt(event, "country");
      const blocked = eventArg(event, "blocked");
      return {
        ...NOTHING,
        label: "Country block status changed",
        detail: `Country ${country ?? "?"} is now ${blocked === "true" ? "blocked" : "allowed"} in the registry.`,
      };
    }
  }
}

/** `ChainEvent` + the address being viewed -> the row the table, the fold and the CSV all read. */
export function toHistoryRow(event: ChainEvent, account: string): HistoryRow {
  const described = describe(event, account);
  return {
    key: `${event.block_number}:${event.log_index}:${event.transaction_hash}`,
    name: event.name,
    label: described.label,
    detail: described.detail,
    group: GROUP_BY_EVENT[event.name],
    blockNumber: event.block_number,
    timestamp: event.block_timestamp,
    isoTime: event.block_time,
    displayTime:
      event.block_time === null ? "Timestamp not indexed" : formatDateTimeUtc(event.block_time),
    transactionHash: event.transaction_hash,
    logIndex: event.log_index,
    contract: event.address,
    explorerUrl: explorerTxUrl(event.transaction_hash),
    usdcDelta6: described.usdcDelta6,
    tokensDelta18: described.tokensDelta18,
    nav6: described.nav6,
    counterparty: described.counterparty,
  };
}

/**
 * Newest first. The API is asked for ascending order because the cost-basis fold reads forward in
 * time; a table reads the other way, and sorting here keeps one fetch serving both.
 */
export function toHistoryRows(
  events: readonly ChainEvent[],
  account: string,
): readonly HistoryRow[] {
  return events
    .map((event) => toHistoryRow(event, account))
    .sort(
      (a, b) =>
        b.blockNumber - a.blockNumber ||
        b.logIndex - a.logIndex ||
        b.transactionHash.localeCompare(a.transactionHash),
    );
}

export function filterRows(
  rows: readonly HistoryRow[],
  filter: HistoryFilterId,
): readonly HistoryRow[] {
  return filter === "all" ? rows : rows.filter((row) => row.group === filter);
}

/** How many rows each chip would show. The page renders only the ones above zero, plus "All". */
export function countByFilter(
  rows: readonly HistoryRow[],
): Readonly<Record<HistoryFilterId, number>> {
  const counts: Record<HistoryFilterId, number> = {
    all: rows.length,
    subscriptions: 0,
    redemptions: 0,
    coupons: 0,
    transfers: 0,
    issuer: 0,
    verification: 0,
    other: 0,
  };
  for (const row of rows) counts[row.group] += 1;
  return counts;
}

export function filterById(id: HistoryFilterId): HistoryFilter {
  const found = HISTORY_FILTERS.find((filter) => filter.id === id);
  // `HistoryFilterId` is the union of the ids in that list, so this is unreachable — but a lookup
  // that can return `undefined` would push the check into every caller.
  if (!found) throw new Error(`unknown history filter: ${id}`);
  return found;
}

/** The token amount as it appears in a column: signed, six decimals, never rounded up. */
export function formatTokenDelta(value: bigint): string {
  const magnitude = value < 0n ? -value : value;
  const sign = value > 0n ? "+" : value < 0n ? "-" : "";
  return `${sign}${formatTokens(magnitude, 6)}`;
}

/** The USDC amount as it appears in a column: signed, all six decimals. */
export function formatUsdcDelta(value: bigint): string {
  const magnitude = value < 0n ? -value : value;
  const sign = value > 0n ? "+" : value < 0n ? "-" : "";
  return `${sign}${formatUsdcExact(magnitude)}`;
}

export { tokens as formatTokenAmount, usdc as formatUsdcAmount };
