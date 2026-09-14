/**
 * `GET /api/nav` — the published NAV document, verbatim.
 *
 * Returns `nav.json` exactly as the engine wrote it (`{ ok: true, data: <nav.json> }`), so a
 * partner reading this endpoint and a reader opening the file in the repository see the same
 * bytes. Money arrives as a fixed-scale display string **and** as a 6-decimal integer
 * (`nav.usdc_6dec`); integrate against the integer (PLAN.md D22).
 *
 *   curl -s https://<host>/api/nav | jq '.data.nav'
 */

import { getNavDocument, jsonInternalError, jsonOkValidated } from "@/lib/data";
import { navResponseSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export function GET(): Response {
  try {
    return jsonOkValidated(
      navResponseSchema,
      getNavDocument(),
      "Re-run `make nav` to regenerate web/public/data/nav.json, or reconcile web/lib/schemas.ts with engine/nav_engine/schemas.py.",
    );
  } catch (error) {
    return jsonInternalError(
      error,
      "web/public/data/nav.json could not be read or did not match its schema. Re-run `make nav`.",
    );
  }
}
