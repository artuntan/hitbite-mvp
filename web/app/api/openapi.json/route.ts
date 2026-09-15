/**
 * `GET /api/openapi.json` — the OpenAPI 3.1 description of this API.
 *
 * **This route is the one exception to the `{ ok, data }` envelope.** Every other endpoint wraps
 * its payload; this one serves the document itself, because a code generator pointed at this URL
 * expects an OpenAPI document and would choke on an envelope containing one. The exception is
 * written into the description itself — in `info.description` and in the operation for this path —
 * so a reader meets it in the document rather than discovering it from a parser error.
 *
 *   curl -s https://<host>/api/openapi.json | jq '.info.version'
 *   npx openapi-typescript https://<host>/api/openapi.json -o hitbite.d.ts
 *
 * The body is generated from the same zod schemas `lib/schemas.ts` defines and the other routes
 * validate their responses against (see `lib/openapi.ts`), so this description cannot describe a
 * shape the API does not return.
 *
 * Headers match the rest of the public API: the same `Cache-Control` a NAV read gets, and
 * `Access-Control-Allow-Origin: *`, so a generator running in a browser-based tool can fetch it.
 * The content type is `application/json` rather than the newer `application/openapi+json`:
 * generators and `jq` all accept the former, and some tooling still does not recognise the latter.
 */

import { buildOpenApiDocument, PUBLIC_CACHE_CONTROL } from "@/lib/openapi";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(buildOpenApiDocument(), {
    status: 200,
    headers: {
      "Cache-Control": PUBLIC_CACHE_CONTROL,
      "Access-Control-Allow-Origin": "*",
    },
  });
}
