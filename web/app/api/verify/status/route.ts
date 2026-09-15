/**
 * `GET /api/verify/status?address=0x…` — where an address stands (PLAN.md D7, D8).
 *
 *     curl -s 'https://<host>/api/verify/status?address=0x…' | jq '.data | {status, source}'
 *
 * `data.status` is one of `not_requested`, `pending`, `approved`, `rejected`, `blocked` — the five
 * states `/verify` renders, with "not connected" being the one the page knows without asking.
 *
 * **The chain outranks the store.** `data.source` says which side answered: an address the demo
 * script verified, or one whose stored request was lost with a serverless instance, still reads as
 * approved, because `IdentityRegistry` says so and `IdentityRegistry` is the record. When the RPC
 * cannot be reached, `data.chain.status` is `unavailable` with the reason and the stored request
 * answers instead — stated, not silently substituted.
 *
 * Never cached: a countdown that ends and a CDN that holds "pending" for another minute would make
 * the page wrong exactly when someone is watching it.
 */

import { errorResponse, jsonOk } from "@/lib/server/http";
import { defaultDeps, getVerificationState } from "@/lib/server/registrar";
import { parseAddressParam, statusResponseSchema } from "@/lib/server/verification";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const address = parseAddressParam(request.url);
    const payload = await getVerificationState(address, defaultDeps());

    return jsonOk(
      statusResponseSchema,
      payload,
      "The status response did not match its own schema, which is a bug in lib/server/verification.ts.",
    );
  } catch (error) {
    return errorResponse(
      error,
      "Call it as /api/verify/status?address=0x… . Check DATABASE_URL (see .env.example); a chain that cannot be reached is reported inside the response, not as a 500.",
    );
  }
}
