"use client";

/**
 * The browser half of the `/api/verify` contract.
 *
 * ## Why this does not import the zod schemas
 *
 * `lib/server/verification.ts` exports a schema for every response and is written to be safe in a
 * browser bundle. It is imported here for its **types only**, and the envelope is narrowed by hand,
 * for two reasons that point the same way:
 *
 *   1. `lib/server/__tests__/secrets.test.ts` fails the build if any file marked `"use client"`
 *      carries a runtime import of `lib/server/*`. That test is the thing standing between the
 *      registrar key and a client bundle, and a page is not the right place to start making
 *      exceptions to it. `import type` is erased by the compiler, so it is not an exception.
 *   2. Every one of these routes already validates its own payload against that schema before
 *      sending it (`jsonOk` in `lib/server/http.ts`), and `e2e/verify.spec.ts` parses the real
 *      responses with the real schemas. Re-parsing in the browser would buy a third copy of the
 *      same check and put zod in this route's bundle.
 *
 * The types below are therefore the ones that matter — `VerificationRequestView` and
 * `ChainIdentityView` come straight from the server module, so a field rename there is a type error
 * here rather than an empty panel in production.
 */

import type { ChainIdentityView, VerificationRequestView } from "@/lib/server/verification";

// --------------------------------------------------------------------------- response shapes

/** `describeStorage()` — what is holding the request, and whether it survives the instance. */
export interface StorageView {
  kind: "file" | "memory" | "remote";
  display: string;
  ephemeral: boolean;
  note: string;
}

export interface WorkerView {
  endpoint: "/api/verify/process";
  auto_approve_delay_ms: number;
  requires_secret: boolean;
  registrar: { status: "ready" | "unavailable"; address: string | null; reason: string | null };
}

/** A rule that refused a submission, or `null` when nothing did. */
export type RefusalRule = "country_blocked" | "retail" | "no_attestation" | "no_consent";

export interface BlockedCountry {
  numeric: number;
  alpha2: string | null;
  name: string | null;
  reason: string | null;
}

/** `GET /api/verify` — the live blocklist. */
export interface BlocklistData {
  source: "chain" | "seed";
  reason: string | null;
  chain_id: number;
  network: string;
  registry_address: string | null;
  count: number;
  blocked: BlockedCountry[];
  country_list_path: string;
  notes: string[];
}

/** `POST /api/verify`. */
export interface SubmitData {
  request: VerificationRequestView;
  accepted: boolean;
  next_step: string;
  rule: RefusalRule | null;
  country_blocklist_source: "chain" | "seed";
  chain: ChainIdentityView;
  storage: StorageView;
  worker: WorkerView;
  notes: string[];
}

/** `GET /api/verify/status`. */
export interface StatusData {
  address: string;
  status: "not_requested" | "pending" | "approved" | "rejected" | "blocked";
  source: "chain" | "store" | "none";
  request: VerificationRequestView | null;
  chain: ChainIdentityView;
  storage: StorageView;
  worker: WorkerView;
  notes: string[];
}

export interface ProcessedItem {
  address: string;
  outcome: "approved" | "blocked" | "rejected" | "deferred" | "skipped";
  reason: string;
  tx_hash: string | null;
}

/** `POST /api/verify/process` — the registrar worker. */
export interface ProcessData {
  ran_at: string;
  due: number;
  max_per_call: number;
  processed: ProcessedItem[];
  summary: Record<"approved" | "blocked" | "rejected" | "deferred" | "skipped", number>;
  counts: Record<string, number>;
  authenticated: boolean;
  storage: StorageView;
  worker: WorkerView;
  notes: string[];
}

// --------------------------------------------------------------------------- calling them

/** A failure with somewhere to go: a sentence for the panel and, where there is one, a hint. */
export interface ApiFailure {
  /** HTTP status, or 0 when the request never got an answer. */
  status: number;
  message: string;
  hint: string | null;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; failure: ApiFailure };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the `{ ok, data }` / `{ ok, error }` envelope the API uses everywhere.
 *
 * A body that is neither — an HTML error page from a proxy, an empty 502 — is reported as such
 * rather than crashing on a missing field, because that is the shape a real outage takes.
 */
function readEnvelope<T>(status: number, body: unknown): ApiResult<T> {
  if (isRecord(body) && body.ok === true && "data" in body) {
    return { ok: true, data: body.data as T };
  }
  if (isRecord(body) && body.ok === false && isRecord(body.error)) {
    const error = body.error;
    return {
      ok: false,
      failure: {
        status,
        message: typeof error.message === "string" ? error.message : "The request was refused.",
        hint: typeof error.hint === "string" ? error.hint : null,
      },
    };
  }
  return {
    ok: false,
    failure: {
      status,
      message: `The server answered ${status} with something that is not this API's JSON envelope.`,
      hint: "That usually means a proxy or the platform answered instead of the app. Try again; if it persists, the deployment is unhealthy.",
    },
  };
}

async function call<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init });
  } catch {
    return {
      ok: false,
      failure: {
        status: 0,
        message: "The request never reached the server.",
        hint: "Check the connection and try again. Nothing was sent, so nothing is half-done.",
      },
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      failure: {
        status: response.status,
        message: `The server answered ${response.status} with a body that is not JSON.`,
        hint: "Retrying is safe: this endpoint is keyed by your address, so a repeat does not create a second request.",
      },
    };
  }

  return readEnvelope<T>(response.status, body);
}

/** The live country blocklist. The chain answers when it can; the seed list when it cannot. */
export function fetchBlocklist(signal?: AbortSignal): Promise<ApiResult<BlocklistData>> {
  return call<BlocklistData>("/api/verify", { signal });
}

export interface SubmitBody {
  address: string;
  country: number;
  professional_attestation: boolean;
  consent: boolean;
}

export function submitRequest(
  body: SubmitBody,
  signal?: AbortSignal,
): Promise<ApiResult<SubmitData>> {
  return call<SubmitData>("/api/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

export function fetchStatus(address: string, signal?: AbortSignal): Promise<ApiResult<StatusData>> {
  return call<StatusData>(`/api/verify/status?address=${encodeURIComponent(address)}`, { signal });
}

/**
 * Ask the registrar worker to act, naming the address so one page never drains another wallet's
 * queue. The endpoint is idempotent: it only advances rows that are already stored and already due.
 */
export function runWorker(address: string, signal?: AbortSignal): Promise<ApiResult<ProcessData>> {
  return call<ProcessData>("/api/verify/process", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
    signal,
  });
}

/**
 * What a worker failure means for the person watching the countdown. The request is stored either
 * way, so none of these is a dead end — they differ only in who finishes the job.
 */
export function explainWorkerFailure(failure: ApiFailure): string {
  if (failure.status === 401) {
    return "This deployment protects the worker with a secret, so the page cannot run it. The request stays queued and the operator's cron will approve it.";
  }
  if (failure.status === 429) {
    return "The worker is rate limited on this instance. The request stays queued; it will be picked up on the next call.";
  }
  if (failure.status === 0) {
    return "The worker could not be reached. The request is stored and still pending.";
  }
  return failure.message;
}
