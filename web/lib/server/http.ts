/**
 * The HTTP envelope for the verification routes.
 *
 * Same shape as the public API built in Phase 6 — `{ ok: true, data }` and
 * `{ ok: false, error: { code, message, hint } }`, with `code` drawn from the same
 * `apiErrorCode` enum in `lib/schemas.ts` — so a partner writing one parser can read every
 * endpoint. Two things differ, both on purpose:
 *
 *   - **`Cache-Control: no-store`.** `lib/data.ts` sends `s-maxage=60` because NAV and holdings
 *     change once a day. A verification status changes in seconds, and a CDN holding "pending"
 *     for a minute after the address was verified would make the UI wrong in the one place a
 *     reviewer is watching a countdown.
 *   - **No `Access-Control-Allow-Origin`.** The public read endpoints are meant to be fetched
 *     cross-origin. These are not: they write, and there is nothing a third-party page needs from
 *     them. `readJsonBody` adds the other half, insisting on `content-type: application/json` for
 *     any body with content — a header a cross-origin `<form>` cannot set without a preflight
 *     that never gets an answer. So no other origin can submit a verification request from a
 *     browser, and none can read a reply. The one thing another origin can still fire is a
 *     bodiless POST to `/api/verify/process`, which is exactly the open-worker case that
 *     `app/api/verify/process/route.ts` bounds on purpose.
 *
 * The error-code enum is Phase 6's and is not extended here: adding `unauthorized` or
 * `rate_limited` would change a published contract, which is not this phase's call to make. An
 * unauthorised worker call is therefore HTTP 401 with code `bad_request` and a message that says
 * exactly what is wrong. The status code carries the meaning; the code string stays stable.
 */

import type { z } from "zod";

import type { ApiErrorCode } from "../schemas";

import { describeError, ServerConfigError } from "./env";
import { RequestError } from "./errors";

/** Re-exported so a route imports its error type and its response helpers from one module. */
export { RequestError } from "./errors";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
};

export function jsonError(
  code: ApiErrorCode,
  message: string,
  hint: string,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(
    { ok: false, error: { code, message: describeError(message), hint } },
    { status, headers: { ...NO_STORE_HEADERS, ...extraHeaders } },
  );
}

/** `{ ok: true, data }`, validated against the route's own schema before it is sent. */
export function jsonOk<S extends z.ZodType>(schema: S, data: unknown, hint: string): Response {
  const result = schema.safeParse({ ok: true, data });
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    return jsonError(
      "invalid_document",
      `the response failed its own schema before being sent: ${issues}`,
      hint,
      500,
    );
  }
  return Response.json(result.data, { status: 200, headers: NO_STORE_HEADERS });
}

/**
 * Turn anything thrown inside a route into the standard envelope.
 *
 * `RequestError` carries its own status; everything else is a 500 whose message has been through
 * `redactSecrets` and lost its stack trace.
 */
export function errorResponse(error: unknown, hint: string): Response {
  if (error instanceof RequestError) {
    return jsonError(error.code, error.message, error.hint, error.status);
  }
  if (error instanceof ServerConfigError) {
    // A misconfigured deployment is a 500, but it is an operator's 500 and it says what to fix.
    return jsonError("internal_error", describeError(error), error.hint, 500);
  }
  return jsonError("internal_error", describeError(error), hint, 500);
}

/**
 * Read and parse a JSON request body.
 *
 * `content-type: application/json` is required for any body that has content, rather than sniffed.
 * A `<form>` on a hostile page can post `text/plain` to any origin without a preflight; it cannot
 * set `application/json`. That check is what makes "no CORS headers" mean "no cross-origin
 * caller".
 *
 * An empty body is allowed when `allowEmpty` is set, and the content-type rule does not apply to
 * it, because `curl -X POST …/api/verify/process` sends neither and that is exactly how a cron
 * will call the worker. An empty body carries no instruction, so there is nothing to smuggle in
 * one.
 *
 * The body is size-capped, so a large payload is refused rather than buffered.
 */
export async function readJsonBody(
  request: Request,
  options: { maxBytes?: number; allowEmpty?: boolean } = {},
): Promise<unknown> {
  const { maxBytes = 8_192, allowEmpty = false } = options;

  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > maxBytes) {
    throw RequestError.badRequest(
      `the request body is larger than ${maxBytes} bytes.`,
      "A verification request is four fields. Send only those.",
    );
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    throw RequestError.badRequest(
      "the request body could not be read.",
      "Retry the request; if it keeps failing, the connection dropped mid-body.",
    );
  }

  if (text.length > maxBytes) {
    throw RequestError.badRequest(
      `the request body is larger than ${maxBytes} bytes.`,
      "A verification request is four fields. Send only those.",
    );
  }

  if (text.trim() === "") {
    if (allowEmpty) return {};
    throw RequestError.badRequest(
      "the request body is required.",
      'Send { "address": "0x…", "country": 276, "professional_attestation": true, "consent": true } as JSON.',
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw RequestError.badRequest(
      "a request body must be sent as `content-type: application/json`.",
      'fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(...) }).',
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw RequestError.badRequest(
      "the request body is not valid JSON.",
      "Check for a trailing comma or an unquoted key.",
    );
  }
}

/** The first hop in `x-forwarded-for`, for rate limiting. `null` when there is no proxy header. */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || null;
}

/** The presented worker secret: `Authorization: Bearer …` or `x-registrar-worker-secret`. */
export function presentedWorkerSecret(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match?.[1]) return match[1].trim();
  }
  return request.headers.get("x-registrar-worker-secret")?.trim() || null;
}
