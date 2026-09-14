/**
 * `GET /api/events` — a deliberately minimal log reader.
 *
 * **What it does.** One `eth_getLogs` against the deployed `HBToken`, over a window that ends at
 * the chain head and reaches back at most `MAX_BLOCK_WINDOW` blocks (never past `deployBlock`),
 * decoding `Subscribed`, `Redeemed`, `CouponDistributed`, `CouponClaimed`, `NAVUpdated` and
 * `Transfer`. Newest first, capped by `?limit=` (default 50, max 200).
 *
 * **What it does not do.** No filters by account or event name, no pagination, no cursor, no
 * server-side index, no cost-basis reconstruction, no CSV. Older events exist on chain and this
 * endpoint will not return them once they fall outside the window. That is the whole of the Phase
 * 8 indexer (PLAN.md D10) and it is not built yet.
 *
 * Every response carries a `limitations` array saying exactly that, in the response itself rather
 * than only in this comment, because the people who most need to know are reading the JSON.
 *
 *   curl -s 'https://<host>/api/events?limit=5' | jq '.data.events[] | {name, block_number}'
 */

import { getAbiItem, type AbiEvent } from "viem";

import {
  ACTIVE_CHAIN,
  ACTIVE_CHAIN_ID,
  assertRpcIsConfiguredChain,
  getDeployment,
  getPublicClient,
} from "@/lib/chains";
import { jsonError, jsonInternalError, jsonOkValidated } from "@/lib/data";
import { hbTokenAbi } from "@/lib/generated/abis";
import { eventsResponseSchema, type ChainEvent, type EventName } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Matches the chunk size the Phase 8 indexer will use, so behaviour does not change under it. */
const MAX_BLOCK_WINDOW = 10_000n;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const TRACKED_EVENT_NAMES = [
  "Subscribed",
  "Redeemed",
  "CouponDistributed",
  "CouponClaimed",
  "NAVUpdated",
  "Transfer",
] as const satisfies readonly EventName[];

const TRACKED_EVENTS = TRACKED_EVENT_NAMES.map(
  (name) => getAbiItem({ abi: hbTokenAbi, name }) as AbiEvent,
);

const LIMITATIONS: readonly string[] = [
  "No filters: you cannot yet select by event name, account or block range.",
  "No pagination: the newest matching events in the scanned window are returned, up to `limit`, and there is no cursor for the rest.",
  `The scan window reaches back at most ${MAX_BLOCK_WINDOW} blocks from the chain head, so older events exist on chain but are not returned here (\`window_truncated\` says when that happened).`,
  "There is no server-side index or database. Each request performs one eth_getLogs; only the CDN caches it, for 60 seconds.",
  "The full indexer — filters, pagination, cost basis and CSV export — is Phase 8 (PLAN.md D10).",
];

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Decoded log arguments, stringified. Every number becomes a decimal string; JSON has no BigInt. */
function normaliseArgs(args: unknown): Record<string, string> {
  if (args === null || typeof args !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "bigint") out[key] = value.toString();
    else if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
    else out[key] = JSON.stringify(value);
  }
  return out;
}

function parseLimit(url: string): number | null {
  const raw = new URL(url).searchParams.get("limit");
  if (raw === null || raw.trim() === "") return DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  if (value < 1 || value > MAX_LIMIT) return null;
  return value;
}

export async function GET(request: Request): Promise<Response> {
  const limit = parseLimit(request.url);
  if (limit === null) {
    return jsonError(
      "bad_request",
      "`limit` must be a whole number between 1 and " + MAX_LIMIT + ".",
      `Try ?limit=${DEFAULT_LIMIT}, or omit it.`,
      400,
    );
  }

  const chainId = ACTIVE_CHAIN_ID;
  const network = ACTIVE_CHAIN.key;
  const deployment = getDeployment(chainId);

  const unavailable = (reason: string) =>
    jsonOkValidated(
      eventsResponseSchema,
      { status: "unavailable", chain_id: chainId, network, reason, limitations: LIMITATIONS },
      "Deploy the contracts and point SERVER_RPC_URL at the same testnet.",
    );

  if (!deployment) {
    return unavailable(
      `No deployment is recorded for ${ACTIVE_CHAIN.label} (chain ${chainId}). Run \`make deploy CHAIN=${network}\` and re-run \`pnpm sync:contracts\`.`,
    );
  }

  try {
    await assertRpcIsConfiguredChain(chainId);
    const client = getPublicClient(chainId);
    const tokenAddress = deployment.addresses.HBToken;
    const deployBlock = BigInt(deployment.deployBlock);

    const head = await client.getBlockNumber();
    const windowStart = head > MAX_BLOCK_WINDOW ? head - MAX_BLOCK_WINDOW : 0n;
    const fromBlock = windowStart > deployBlock ? windowStart : deployBlock;

    const logs = await client.getLogs({
      address: tokenAddress,
      events: TRACKED_EVENTS,
      fromBlock,
      toBlock: head,
    });

    const decoded: ChainEvent[] = [];
    for (const log of logs) {
      // Pending logs have null block context; they are not history and are dropped.
      if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) {
        continue;
      }
      const name = log.eventName;
      if (!(TRACKED_EVENT_NAMES as readonly string[]).includes(name)) continue;
      decoded.push({
        name: name as EventName,
        block_number: Number(log.blockNumber),
        transaction_hash: log.transactionHash,
        log_index: log.logIndex,
        args: normaliseArgs(log.args),
      });
    }

    decoded.sort((a, b) =>
      b.block_number === a.block_number
        ? b.log_index - a.log_index
        : b.block_number - a.block_number,
    );

    return jsonOkValidated(
      eventsResponseSchema,
      {
        status: "ok",
        chain_id: chainId,
        network,
        token_address: tokenAddress,
        deploy_block: deployment.deployBlock,
        from_block: Number(fromBlock),
        to_block: Number(head),
        window_truncated: fromBlock > deployBlock,
        results_truncated: decoded.length > limit,
        limit,
        count: Math.min(decoded.length, limit),
        events: decoded.slice(0, limit),
        limitations: LIMITATIONS,
      },
      "Check the RPC configured by SERVER_RPC_URL / NEXT_PUBLIC_RPC_URL.",
    );
  } catch (error) {
    // An unreachable or rate-limited RPC is an expected condition on a public testnet endpoint,
    // so it is reported inside a 200 envelope with a reason rather than as a server error.
    try {
      return unavailable(
        `Could not read logs from ${ACTIVE_CHAIN.label} at the configured RPC: ${describe(error)}`,
      );
    } catch (fallbackError) {
      return jsonInternalError(
        fallbackError,
        "The events endpoint failed while reporting a failure.",
      );
    }
  }
}
