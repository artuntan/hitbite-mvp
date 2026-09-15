/**
 * `POST /api/verify` — record a verification request (PLAN.md D7, D8).
 * `GET  /api/verify` — the registry's live country blocklist (PLAN.md D23).
 *
 *     curl -X POST https://<host>/api/verify \
 *       -H 'content-type: application/json' \
 *       -d '{"address":"0x…","country":276,"professional_attestation":true,"consent":true}'
 *
 * The body is four fields: `address`, `country` (ISO 3166-1 numeric),
 * `professional_attestation` and `consent`. `investor_type` is optional and defaults to 1
 * (professional); 2 (retail) is accepted by the parser and then refused by policy, because the
 * refusal is the point (PLAN.md D21). camelCase aliases are accepted. Any other field — a name,
 * for instance — is **dropped**: this is a testnet demonstration and it stores no personal data
 * beyond the address and the country the applicant declares.
 *
 * A malformed request is a 400 and stores nothing. A well-formed request that policy refuses is a
 * 200 whose `data.request.status` is `blocked` or `rejected`, with the reason, and it *is* stored.
 * See `lib/server/verification.ts` for why those are different answers.
 *
 * Neither method is cached and neither sends CORS headers: these are same-origin, and one of them
 * writes. The public, cacheable, cross-origin endpoints are `/api/nav`, `/api/holdings`,
 * `/api/attestation`, `/api/stats` and `/api/events`.
 */

import { clientIp, errorResponse, jsonOk, readJsonBody, RequestError } from "@/lib/server/http";
import { createRateLimiter } from "@/lib/server/ratelimit";
import { defaultDeps, getBlocklistView, submitVerificationRequest } from "@/lib/server/registrar";
import { blocklistResponseSchema, submitResponseSchema } from "@/lib/server/verification";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Per-instance, per-IP bound on submissions. One address is one row, so a flood cannot grow the
 * store past the number of addresses it names, but there is no reason to let one caller write
 * thousands of them either. Per-instance on a serverless host, which `lib/server/ratelimit.ts`
 * says out loud rather than implying.
 */
const submissions = createRateLimiter({ limit: 20, windowMs: 60_000 });

export async function POST(request: Request): Promise<Response> {
  try {
    const decision = submissions.take(clientIp(request) ?? "unknown", Date.now());
    if (!decision.allowed) {
      throw RequestError.tooManyRequests(
        `more than ${decision.limit} verification requests from this address in ${decision.windowMs / 1000} seconds.`,
        `Wait ${Math.ceil(decision.retryAfterMs / 1000)} seconds and try again. One wallet needs one request.`,
      );
    }

    const body = await readJsonBody(request);
    const payload = await submitVerificationRequest(body, defaultDeps());

    return jsonOk(
      submitResponseSchema,
      payload,
      "The request was stored but the response did not match its own schema, which is a bug in lib/server/verification.ts.",
    );
  } catch (error) {
    return errorResponse(
      error,
      "Check DATABASE_URL (see .env.example). A chain that cannot be reached is reported inside the response, not as a 500.",
    );
  }
}

export async function GET(): Promise<Response> {
  try {
    const payload = await getBlocklistView(defaultDeps());
    return jsonOk(
      blocklistResponseSchema,
      payload,
      "The blocklist response did not match its own schema; reconcile lib/server/verification.ts.",
    );
  } catch (error) {
    return errorResponse(
      error,
      "The blocklist could not be assembled. A chain that cannot be reached falls back to the seeded codes inside a 200 response, so a 500 here means something else failed.",
    );
  }
}
