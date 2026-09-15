/**
 * `GET /api/events` — the indexed log reader (PLAN.md D10).
 *
 * Every event both contracts emit, from `deployBlock` to the chain head, decoded, deduplicated and
 * held in memory for 60 seconds by `lib/server/indexer.ts`. Filterable by event name, by account
 * and by block range; paginated with a cursor that is a position rather than an offset, so a page
 * does not shift under a reader when new events arrive at the head.
 *
 * ## Query parameters
 *
 *   `event`      Repeatable, and comma-separated lists are accepted: `?event=Subscribed,Redeemed`.
 *                Omitted means every indexed event. An unknown name is a 400 listing the valid
 *                ones, not a silently empty page.
 *   `account`    A 20-byte address. Matches the account **anywhere** in the decoded arguments —
 *                `Transfer.from` and `Transfer.to`, `NAVForced.by` (its third argument), and so
 *                on — not only the first indexed argument. The emitting contract's own address is
 *                not matched.
 *   `from_block` `to_block`  Inclusive bounds, whole numbers.
 *   `limit`      1..200, default 50. 200 is the documented maximum page size.
 *   `cursor`     `next_cursor` from the previous page. Exclusive: the next page starts after it.
 *   `order`      `desc` (newest first, the default) or `asc`.
 *
 * ## What it still does not do
 *
 * Said in the response, in `limitations`, rather than only here — the people who most need to know
 * are reading the JSON. In particular, when the scan could not cover the whole range, the response
 * says which block ranges are missing instead of returning a short list that looks complete.
 *
 *   curl -s 'https://<host>/api/events?event=Subscribed&limit=5' | jq '.data.events[].args'
 *   curl -s 'https://<host>/api/events?account=0x…&order=asc' | jq '.data.page'
 */

import { ACTIVE_CHAIN_ID, getChainConfig, getDeployment } from "@/lib/chains";
import { jsonError, jsonInternalError, jsonOkValidated } from "@/lib/data";
import {
  filterEvents,
  isEventName,
  paginate,
  parseCursor,
  toWireEvent,
  type Cursor,
  type EventOrder,
} from "@/lib/server/events";
import {
  coverageLimitations,
  describeRpcError,
  getEventIndex,
  noDeploymentReason,
  toWireCoverage,
} from "@/lib/server/indexer";
import { EVENT_NAMES, eventsResponseSchema, type EventName } from "@/lib/schemas";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
/** The documented maximum page size. Larger asks are refused, not silently clamped. */
const MAX_LIMIT = 200;

const HINT = "Check the RPC configured by SERVER_RPC_URL / NEXT_PUBLIC_RPC_URL.";

/** Said when there is no index at all, so the absence is never mistaken for an empty chain. */
const UNAVAILABLE_LIMITATIONS: readonly string[] = [
  "No events are being reported because the index could not be built — this is not the same as a chain with no events.",
  "There is no database (PLAN.md D10): the index is read from the chain on demand and cached for 60 seconds, so it is only ever as available as the RPC.",
];

class BadRequest extends Error {
  readonly hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.name = "BadRequest";
    this.hint = hint;
  }
}

function parseEventNames(params: URLSearchParams): EventName[] {
  const requested = params
    .getAll("event")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value !== "");
  const names: EventName[] = [];
  for (const value of requested) {
    if (!isEventName(value)) {
      throw new BadRequest(
        `\`event=${value}\` is not an indexed event.`,
        `Valid names: ${EVENT_NAMES.join(", ")}. Omit \`event\` for all of them.`,
      );
    }
    if (!names.includes(value)) names.push(value);
  }
  return names;
}

function parseAccount(params: URLSearchParams): string | null {
  const raw = params.get("account");
  if (raw === null || raw.trim() === "") return null;
  const value = raw.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new BadRequest(
      "`account` is not a 20-byte hex address.",
      "Pass a full `0x`-prefixed address, for example ?account=0x1234…cdef.",
    );
  }
  return value;
}

function parseBlock(params: URLSearchParams, name: string): bigint | null {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return null;
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    throw new BadRequest(
      `\`${name}\` must be a whole block number.`,
      `Try ?${name}=0, or omit it to scan from the deploy block to the chain head.`,
    );
  }
  return BigInt(value);
}

function parseLimit(params: URLSearchParams): number {
  const raw = params.get("limit");
  if (raw === null || raw.trim() === "") return DEFAULT_LIMIT;
  const value = raw.trim();
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > MAX_LIMIT) {
    throw new BadRequest(
      `\`limit\` must be a whole number between 1 and ${MAX_LIMIT}.`,
      `Try ?limit=${DEFAULT_LIMIT}, or omit it. Use \`cursor\` to read past ${MAX_LIMIT} events.`,
    );
  }
  return Number(value);
}

function parseOrder(params: URLSearchParams): EventOrder {
  const raw = params.get("order");
  if (raw === null || raw.trim() === "") return "desc";
  const value = raw.trim().toLowerCase();
  if (value !== "asc" && value !== "desc") {
    throw new BadRequest(
      "`order` must be `asc` or `desc`.",
      "Omit it for `desc`, which returns the newest events first.",
    );
  }
  return value;
}

function parseCursorParam(params: URLSearchParams, chainId: number): Cursor | null {
  const raw = params.get("cursor");
  if (raw === null || raw.trim() === "") return null;
  const result = parseCursor(raw.trim());
  if (result.status === "invalid") {
    throw new BadRequest(
      `\`cursor\` is not a cursor this endpoint issued: ${result.reason}`,
      "Pass back the `page.next_cursor` from the previous response, unchanged, or omit it to start at the first page.",
    );
  }
  if (result.cursor.chainId !== chainId) {
    throw new BadRequest(
      `\`cursor\` was issued for chain ${result.cursor.chainId} and this endpoint is serving chain ${chainId}.`,
      "Cursors carry the chain they were minted on so one chain's block heights are never applied to another's. Start a fresh page without `cursor`.",
    );
  }
  return result.cursor;
}

export async function GET(request: Request): Promise<Response> {
  const chainId = ACTIVE_CHAIN_ID;
  const chain = getChainConfig(chainId);
  const network = chain.key;

  const unavailable = (reason: string): Response =>
    jsonOkValidated(
      eventsResponseSchema,
      {
        status: "unavailable",
        chain_id: chainId,
        network,
        reason,
        limitations: UNAVAILABLE_LIMITATIONS,
      },
      "Deploy the contracts and point SERVER_RPC_URL at the same testnet.",
    );

  try {
    const params = new URL(request.url).searchParams;
    let names: EventName[];
    let account: string | null;
    let fromBlock: bigint | null;
    let toBlock: bigint | null;
    let limit: number;
    let order: EventOrder;
    let cursor: Cursor | null;
    try {
      names = parseEventNames(params);
      account = parseAccount(params);
      fromBlock = parseBlock(params, "from_block");
      toBlock = parseBlock(params, "to_block");
      limit = parseLimit(params);
      order = parseOrder(params);
      cursor = parseCursorParam(params, chainId);
    } catch (error) {
      if (error instanceof BadRequest) {
        return jsonError("bad_request", error.message, error.hint, 400);
      }
      throw error;
    }

    if (!getDeployment(chainId)) return unavailable(noDeploymentReason(chainId, network));

    const result = await getEventIndex({ chainId });
    if (result.status === "unavailable") return unavailable(result.reason);

    const { index, cache } = result;
    const matched = filterEvents(index.events, { names, account, fromBlock, toBlock });
    const page = paginate(matched, { chainId, order, limit, cursor });

    return jsonOkValidated(
      eventsResponseSchema,
      {
        status: "ok",
        chain_id: chainId,
        network,
        token_address: index.tokenAddress,
        registry_address: index.registryAddress,
        deploy_block: Number(index.deployBlock),
        from_block: Number(index.fromBlock),
        to_block: Number(index.toBlock),
        window_truncated: !index.complete,
        results_truncated: page.hasMore,
        limit,
        count: page.events.length,
        events: page.events.map(toWireEvent),
        filters: {
          event: names,
          account,
          from_block: fromBlock === null ? null : Number(fromBlock),
          to_block: toBlock === null ? null : Number(toBlock),
        },
        page: {
          order,
          limit,
          max_limit: MAX_LIMIT,
          cursor: params.get("cursor")?.trim() || null,
          next_cursor: page.nextCursor,
          has_more: page.hasMore,
          returned: page.events.length,
          matched: matched.length,
        },
        coverage: toWireCoverage(index, cache),
        limitations: coverageLimitations(index, cache),
      },
      HINT,
    );
  } catch (error) {
    // An unreachable or rate-limited RPC is an expected condition on a public testnet endpoint, so
    // it is reported inside a 200 envelope with a reason rather than as a server error.
    try {
      return unavailable(
        `Could not read logs from ${chain.label} at the configured RPC: ${describeRpcError(error)}`,
      );
    } catch (fallbackError) {
      return jsonInternalError(
        fallbackError,
        "The events endpoint failed while reporting a failure.",
      );
    }
  }
}
