"use client";

/**
 * The browser half of `/admin/api/queue`.
 *
 * `ApiResult` and `ApiFailure` are `/verify`'s types, re-exported rather than redefined, because
 * this endpoint uses the same `{ ok, data }` / `{ ok, error }` envelope as every other route in the
 * app and a second vocabulary for the same shape would be a small lie about how many APIs there
 * are. The envelope reader itself is a local copy of about forty lines: `components/verify/api.ts`
 * does not export it, and that file belongs to another surface.
 *
 * Approving deliberately does **not** live here. It is `runWorker` from `components/verify/api.ts`
 * — the same call the verification page's countdown makes, hitting the same endpoint, signed by the
 * same registrar key. An admin approval is the worker running early, not a second implementation of
 * `addVerified`.
 */

import type { AdminQueueData, AdminRejectData } from "@/components/admin/queue";
import type { ApiFailure, ApiResult } from "@/components/verify/api";

export type { ApiFailure, ApiResult } from "@/components/verify/api";
export { runWorker, type ProcessData, type ProcessedItem } from "@/components/verify/api";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
      } satisfies ApiFailure,
    };
  }
  return {
    ok: false,
    failure: {
      status,
      message: `The server answered ${status} with something that is not this API's JSON envelope.`,
      hint: "That usually means a proxy or the platform answered instead of the app.",
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
        hint: null,
      },
    };
  }

  return readEnvelope<T>(response.status, body);
}

export function fetchAdminQueue(signal?: AbortSignal): Promise<ApiResult<AdminQueueData>> {
  return call<AdminQueueData>("/admin/api/queue", { signal });
}

export interface RejectBody {
  address: string;
  reason: string;
  issued_at: string;
  signer: string;
  signature: string;
}

/**
 * Close a request off chain. The body carries the signature over `adminRejectMessage(...)`; the
 * server rebuilds that message, recovers the signer and checks REGISTRAR_ROLE against the registry
 * before it writes anything.
 */
export function rejectRequest(
  body: RejectBody,
  signal?: AbortSignal,
): Promise<ApiResult<AdminRejectData>> {
  return call<AdminRejectData>("/admin/api/queue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}
