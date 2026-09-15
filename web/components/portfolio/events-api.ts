"use client";

/**
 * The browser half of `GET /api/events`, for one account.
 *
 * Three decisions, each of which the rest of `/portfolio` depends on.
 *
 *  1. **One fetch, every event, then everything else is local.** The cost basis has to fold the
 *     account's *whole* history (a partial fold is a wrong number, not an approximate one), and the
 *     CSV has to export exactly what the filter chips are showing. Fetching the whole account
 *     history once and filtering in memory is the only arrangement where those two cannot drift
 *     apart. `order=asc` because a fold reads forward in time, and the table reverses it for display.
 *  2. **The page cap is reported, never silent.** `MAX_PAGES × PAGE_LIMIT` events are read; past
 *     that the load stops and says so, and every figure derived from it is labelled incomplete. A
 *     silently truncated history would produce a cost basis that looks authoritative and is not.
 *  3. **Types by hand, no zod in this bundle.** `lib/schemas.ts` is the source of truth and its
 *     types are imported with `import type`, which the compiler erases. The route already validates
 *     its own payload against those schemas before sending it (`jsonOkValidated`) and
 *     `e2e/portfolio.spec.ts` parses the real response with the real schema, so re-parsing here
 *     would buy a third copy of the same check at the cost of shipping zod to a wallet page. This
 *     mirrors `components/verify/api.ts`, which made the same call for the same reason.
 */

import type { ChainEvent, IndexCoverage } from "@/lib/schemas";

/** The documented maximum page size of `/api/events`. */
export const PAGE_LIMIT = 200;
/** Hard cap on pages per load: 2,000 events. Reached, it becomes a sentence, not a shrug. */
export const MAX_PAGES = 10;

interface EventsPageMeta {
  readonly order: "asc" | "desc";
  readonly limit: number;
  readonly max_limit: number;
  readonly cursor: string | null;
  readonly next_cursor: string | null;
  readonly has_more: boolean;
  readonly returned: number;
  readonly matched: number;
}

/** `data` when the index exists. Structurally the `status: "ok"` arm of `eventsResponseSchema`. */
interface EventsOkData {
  readonly status: "ok";
  readonly chain_id: number;
  readonly network: string;
  readonly token_address: string;
  readonly registry_address: string;
  readonly deploy_block: number;
  readonly from_block: number;
  readonly to_block: number;
  readonly window_truncated: boolean;
  readonly results_truncated: boolean;
  readonly events: ChainEvent[];
  readonly page: EventsPageMeta;
  readonly coverage: IndexCoverage;
  readonly limitations: string[];
}

/** `data` when there is no index: no deployment, or the RPC would not answer. */
interface EventsUnavailableData {
  readonly status: "unavailable";
  readonly chain_id: number;
  readonly network: string;
  readonly reason: string;
  readonly limitations: string[];
}

type EventsData = EventsOkData | EventsUnavailableData;

export type HistoryLoad =
  | {
      readonly status: "ok";
      readonly events: readonly ChainEvent[];
      readonly coverage: IndexCoverage;
      /** The endpoint's own limitations, verbatim. Rendered as-is. */
      readonly limitations: readonly string[];
      readonly chainId: number;
      /** How many events matched the account filter server-side, before any page cap. */
      readonly matched: number;
      /** True when the page cap stopped the read before the history ended. */
      readonly truncated: boolean;
      readonly pages: number;
    }
  | {
      readonly status: "unavailable";
      readonly reason: string;
      readonly limitations: readonly string[];
    }
  | { readonly status: "error"; readonly message: string; readonly hint: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the `{ ok, data }` / `{ ok, error }` envelope. A body that is neither — an HTML error page
 * from a proxy, an empty 502 — is reported as such rather than crashing on a missing field, because
 * that is the shape a real outage takes.
 */
function readEnvelope(
  status: number,
  body: unknown,
): { ok: true; data: EventsData } | { ok: false; message: string; hint: string | null } {
  if (isRecord(body) && body.ok === true && isRecord(body.data)) {
    return { ok: true, data: body.data as unknown as EventsData };
  }
  if (isRecord(body) && body.ok === false && isRecord(body.error)) {
    const error = body.error;
    return {
      ok: false,
      message: typeof error.message === "string" ? error.message : "The request was refused.",
      hint: typeof error.hint === "string" ? error.hint : null,
    };
  }
  return {
    ok: false,
    message: `The events endpoint answered ${status} with something that is not this API's JSON envelope.`,
    hint: "That usually means a proxy or the platform answered instead of the app.",
  };
}

function buildUrl(account: string, cursor: string | null): string {
  const params = new URLSearchParams({
    account,
    order: "asc",
    limit: String(PAGE_LIMIT),
  });
  if (cursor !== null) params.set("cursor", cursor);
  return `/api/events?${params.toString()}`;
}

/**
 * Every indexed event touching `account`, in block order, oldest first.
 *
 * The account filter matches the address in **any** decoded argument — both legs of a `Transfer`,
 * the holder of a `Subscribed`, the claimant of a `CouponClaimed` — so what comes back is the whole
 * of this wallet's on-chain story with the two contracts, not just the events it sent.
 */
export async function fetchAccountHistory(
  account: string,
  signal?: AbortSignal,
): Promise<HistoryLoad> {
  const collected: ChainEvent[] = [];
  let cursor: string | null = null;
  let pages = 0;

  // `while (true)` with every exit as an explicit `return`: the cap, the last page and each failure
  // all leave from the point that discovered them, so no state has to survive the loop.
  for (;;) {
    let response: Response;
    try {
      response = await fetch(buildUrl(account, cursor), { cache: "no-store", signal });
    } catch (error) {
      // An aborted fetch is the page moving on, not a failure worth rendering.
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw error;
      }
      return {
        status: "error",
        message: "The request for this address's events never reached the server.",
        hint: "Check the connection and try again. Nothing was sent, so nothing is half-done.",
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        status: "error",
        message: `The events endpoint answered ${response.status} with a body that is not JSON.`,
        hint: "Retrying is safe: this endpoint only reads.",
      };
    }

    const envelope = readEnvelope(response.status, body);
    if (!envelope.ok) {
      return { status: "error", message: envelope.message, hint: envelope.hint };
    }
    if (envelope.data.status === "unavailable") {
      return {
        status: "unavailable",
        reason: envelope.data.reason,
        limitations: envelope.data.limitations,
      };
    }

    const data = envelope.data;
    pages += 1;
    collected.push(...data.events);
    cursor = data.page.next_cursor;

    const more = data.page.has_more && cursor !== null;
    if (!more || pages >= MAX_PAGES) {
      return {
        status: "ok",
        events: collected,
        coverage: data.coverage,
        limitations: data.limitations,
        chainId: data.chain_id,
        matched: data.page.matched,
        // Truncated only when there was more to read and the cap is what stopped it.
        truncated: more,
        pages,
      };
    }
  }
}
