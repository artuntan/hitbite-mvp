/**
 * `GET /api/attestation` — the signed transparency document, or a plain statement that there
 * isn't one yet.
 *
 * `attestation.json` is deliberately **not committed** (PLAN.md D34). Signing it needs the real
 * attestor key, and publishing a signature made with a throwaway key would put something in the
 * repository that looks like proof and is not. Until a founder runs `make attest`, this endpoint
 * answers:
 *
 *     { "ok": true, "data": { "status": "not_published", "reason": "...",
 *                             "how_to_publish": "make attest",
 *                             "expected_path": "web/public/data/attestation.json",
 *                             "attestor_note": "Simulated attestor — ..." } }
 *
 * and once it exists:
 *
 *     { "ok": true, "data": { "status": "published", "document": { attestation, signature } } }
 *
 * **Both are HTTP 200.** The absence is a true, documented state of the system, not a failure of
 * this route; a 404 would tell a partner's monitoring that something is broken when nothing is.
 * Switch on `data.status` — the schema is a discriminated union precisely so that a caller cannot
 * reach for `document` without deciding what to do when it is not there.
 *
 * Verifying a published attestation in a browser needs no server: the exact signed string is
 * published as `signature.message`, so `viem.verifyMessage({ address: signature.attestor_address,
 * message: signature.message, signature: signature.signature })` is the whole check (PLAN.md D33).
 */

import { getAttestationStatus, jsonInternalError, jsonOkValidated } from "@/lib/data";
import { attestationResponseSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return jsonOkValidated(
      attestationResponseSchema,
      await getAttestationStatus(),
      "Run `make attest` with ATTESTOR_PRIVATE_KEY set to publish an attestation, then redeploy.",
    );
  } catch (error) {
    return jsonInternalError(
      error,
      "The attestation could not be read. This endpoint reports an absent attestation as a normal 200 response, so a 500 here means something else failed.",
    );
  }
}
