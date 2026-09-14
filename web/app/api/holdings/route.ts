/**
 * `GET /api/holdings` — the published holdings document, verbatim.
 *
 * Every position carries `illustrative: true` and an `isin` of `"TBD"`: the book is simulated,
 * the coupons and maturities are placeholders chosen to match the yield levels observed on
 * 31 Aug 2026, and the document says so in `source_note`. Render those labels; do not strip them.
 *
 *   curl -s https://<host>/api/holdings | jq '.data.positions[] | {name, market_value_usd}'
 */

import { getHoldingsDocument, jsonInternalError, jsonOkValidated } from "@/lib/data";
import { holdingsResponseSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export function GET(): Response {
  try {
    return jsonOkValidated(
      holdingsResponseSchema,
      getHoldingsDocument(),
      "Re-run `make nav` to regenerate web/public/data/holdings.json, or reconcile web/lib/schemas.ts with engine/nav_engine/schemas.py.",
    );
  } catch (error) {
    return jsonInternalError(
      error,
      "web/public/data/holdings.json could not be read or did not match its schema. Re-run `make nav`.",
    );
  }
}
