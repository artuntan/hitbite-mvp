/**
 * `POST /api/verify/process` — the registrar worker (PLAN.md D8).
 *
 *     curl -X POST https://<host>/api/verify/process                    # everything due
 *     curl -X POST https://<host>/api/verify/process \                  # one address
 *       -H 'content-type: application/json' -d '{"address":"0x…"}'
 *     curl -X POST https://<host>/api/verify/process \                  # with a secret set
 *       -H 'authorization: Bearer $REGISTRAR_WORKER_SECRET'
 *
 * It approves pending, non-blocked requests older than `AUTO_APPROVE_DELAY_MS` by calling
 * `addVerified` with `REGISTRAR_PRIVATE_KEY`. No body is required, so a cron, the page's countdown
 * and an operator with `curl` all call it the same way. It returns as soon as it is done: there is
 * no worker process to keep alive and nothing here needs one.
 *
 * ## Not an open relay
 *
 * With `REGISTRAR_WORKER_SECRET` set, every call must present it as `Authorization: Bearer …` or
 * `x-registrar-worker-secret`, compared in constant time; without it, 401. That is the setting for
 * any deployment anyone can reach.
 *
 * With no secret set — the local and demo default, since requiring one would mean the page's
 * countdown could not finish the flow — the endpoint is open, and bounded in five ways:
 *
 *   1. it only ever advances requests **someone already submitted**; it cannot create one, and it
 *      cannot choose an address or a country;
 *   2. it cannot approve anything before `AUTO_APPROVE_DELAY_MS` has elapsed, which is measured
 *      from the stored `created_at`, not from anything the caller sends;
 *   3. it re-checks the country against the registry and the investor type before signing, so a
 *      blocked or retail request is recorded as refused instead of sent;
 *   4. it touches at most `MAX_PER_CALL` rows per call, and a per-instance rate limiter caps
 *      unauthenticated calls;
 *   5. the only transaction it can cause is `addVerified(address, country, 1)` for a row that is
 *      already stored and already due — and `IdentityRegistry` will refuse that too if the
 *      registrar key does not hold `REGISTRAR_ROLE`.
 *
 * So the worst an anonymous caller can do is make the registrar do, sooner, the exact work it was
 * about to do anyway, at the cost of testnet gas. It cannot make it verify an address of the
 * caller's choosing, and it cannot make it verify a blocked country.
 */

import { getWorkerAuthMode, workerSecretMatches } from "@/lib/server/env";
import {
  clientIp,
  errorResponse,
  jsonOk,
  presentedWorkerSecret,
  readJsonBody,
  RequestError,
} from "@/lib/server/http";
import { createRateLimiter } from "@/lib/server/ratelimit";
import { defaultDeps, MAX_PER_CALL, processDueRequests } from "@/lib/server/registrar";
import { normaliseAddress, processResponseSchema } from "@/lib/server/verification";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Unauthenticated callers only. A cron holding the secret is not throttled. */
const anonymous = createRateLimiter({ limit: 12, windowMs: 60_000 });

function authenticate(request: Request): boolean {
  const mode = getWorkerAuthMode();

  if (mode.mode === "misconfigured") {
    throw RequestError.unauthorized(mode.reason, "Set a longer secret, or unset it entirely.");
  }

  if (mode.mode === "secret") {
    if (!workerSecretMatches(presentedWorkerSecret(request))) {
      throw RequestError.unauthorized(
        "this worker endpoint requires the registrar worker secret.",
        "Send it as `Authorization: Bearer <REGISTRAR_WORKER_SECRET>` or `x-registrar-worker-secret`.",
      );
    }
    return true;
  }

  const decision = anonymous.take(clientIp(request) ?? "unknown", Date.now());
  if (!decision.allowed) {
    throw RequestError.tooManyRequests(
      `more than ${decision.limit} worker calls from this address in ${decision.windowMs / 1000} seconds.`,
      `Wait ${Math.ceil(decision.retryAfterMs / 1000)} seconds. Set REGISTRAR_WORKER_SECRET to close this endpoint and lift the limit for the holder.`,
    );
  }
  return false;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const authenticated = authenticate(request);

    const body = await readJsonBody(request, { allowEmpty: true, maxBytes: 1_024 });
    const requested = (body as { address?: unknown }).address;
    const address = requested === undefined ? null : normaliseAddress(requested);

    const payload = await processDueRequests(
      { address, maxPerCall: MAX_PER_CALL, authenticated },
      defaultDeps(),
    );

    return jsonOk(
      processResponseSchema,
      payload,
      "The worker ran but its response did not match its own schema, which is a bug in lib/server/verification.ts.",
    );
  } catch (error) {
    return errorResponse(
      error,
      "Check REGISTRAR_PRIVATE_KEY, REGISTRAR_WORKER_SECRET and DATABASE_URL (see .env.example). A registrar that is not configured is reported inside the response, not as a 500.",
    );
  }
}
