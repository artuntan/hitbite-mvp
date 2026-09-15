/**
 * The OpenAPI 3.1 description of the public API, and the endpoint model the `/developers` page
 * renders.
 *
 * ## Every schema in here is derived, not written
 *
 * The response schemas are the *same* zod objects `lib/schemas.ts` defines and the routes validate
 * against on the way out — turned into JSON Schema by `z.toJSONSchema` (zod 4), which emits the
 * 2020-12 dialect OpenAPI 3.1 already uses. Nothing is transcribed. A field renamed in
 * `lib/schemas.ts` is renamed here in the same build, and a partner's generated client changes
 * with it. A hand-written second copy would drift within a week, and the drift would be invisible
 * until somebody's parser broke.
 *
 * The same rule is applied to everything else that has a source of truth:
 *
 *   - the error codes come from `apiErrorCode.options`, not from a list typed out here;
 *   - the event names come from `EVENT_NAMES`;
 *   - `order` comes from `eventOrderSchema.options`;
 *   - the `oneOf` discriminator mappings are read back out of the generated schemas, so adding a
 *     member to a union updates the mapping without anyone remembering to;
 *   - the two page-size bounds of `/api/events` live in its route file and are checked against
 *     this file by `lib/openapi.test.ts`, which reads the route's source. They are the one pair of
 *     numbers here that is not imported, because exporting them would mean editing a route this
 *     module has no business editing.
 *
 * What *is* written by hand is prose: summaries, descriptions, the `curl` lines and the notes.
 * Prose cannot be derived, and prose is not what a generator turns into types.
 *
 * ## The one endpoint that is not in the envelope
 *
 * Every response described here is `{ ok: true, data }` or
 * `{ ok: false, error: { code, message, hint } }` — except `/api/openapi.json`, which serves this
 * document raw, because a code generator pointed at it expects an OpenAPI document and not an
 * envelope containing one. That exception is stated in the description, in the operation, and on
 * the page.
 *
 * ## What is deliberately absent
 *
 * `/api/verify`, `/api/verify/status` and `/api/verify/process` are not described. They are
 * same-origin by construction (PLAN.md D62): `Cache-Control: no-store`, **no**
 * `Access-Control-Allow-Origin`, a required `content-type: application/json` on any body, and a
 * worker gated by a shared secret. A partner cannot call them from a browser and has no reason to
 * call them from a server — they exist so that *this* app's `/verify` page can register a wallet
 * on a testnet. Publishing them in the partner-facing description would advertise a surface that
 * is closed on purpose and invite integrations that CORS then silently breaks. `info.description`
 * names them and says exactly this, so their absence is a documented decision rather than an
 * omission a reader has to notice.
 */

import { z } from "zod";

import {
  apiErrorCode,
  apiErrorSchema,
  attestationChainSchema,
  attestationDocumentSchema,
  attestationHoldingSchema,
  attestationNavSchema,
  attestationPayloadSchema,
  attestationResponseSchema,
  attestationSignatureSchema,
  attestationStatusSchema,
  analytic,
  blockGapSchema,
  chainEventSchema,
  chainInfoSchema,
  chainStatsSchema,
  comparisonBlockSchema,
  dailyActivitySchema,
  distributionTotalsSchema,
  distributionYieldBlockSchema,
  eventActivitySchema,
  eventFiltersSchema,
  eventNameSchema,
  eventOrderSchema,
  eventPageSchema,
  eventSourceSchema,
  eventsResponseSchema,
  evmAddress,
  feesBlockSchema,
  fixed4,
  fixed8,
  fixed10,
  flowTotalsSchema,
  hash32,
  holdersSchema,
  holdingPositionSchema,
  holdingsDocumentSchema,
  holdingsResponseSchema,
  indexCoverageSchema,
  integerString,
  isoDate,
  isoTimestamp,
  lowerCaseAddress,
  navAgreementSchema,
  navBlockSchema,
  navDocumentSchema,
  navHistoryEntrySchema,
  navResponseSchema,
  onchainNavPointSchema,
  portfolioBlockSchema,
  statsResponseSchema,
  supplyBackedRatioSchema,
  supplySource,
  tBillReferenceSchema,
  tokens18,
  txHash,
  unit6,
  usd2,
  verificationTotalsSchema,
  EVENT_NAMES,
} from "./schemas";

// --------------------------------------------------------------------------- document identity

/**
 * The version of *this description*, not of the app.
 *
 * It is bumped when the wire contract changes in a way a partner would have to react to: a new
 * endpoint, a removed field, a changed error code. Cosmetic edits to prose do not move it.
 */
export const OPENAPI_VERSION = "1.0.0";

export const OPENAPI_TITLE = "HitBite hbTRS public API (testnet)";

/**
 * The cache policy the read endpoints actually send, copied from `lib/data.ts`'s
 * `API_CACHE_CONTROL`.
 *
 * It is re-declared rather than imported because importing `lib/data.ts` would pull
 * `node:fs/promises` and four statically imported JSON documents into every bundle that renders
 * this description. `lib/openapi.test.ts` imports both and asserts they are the same string, so
 * the copy cannot drift — changing one without the other fails the unit tests.
 */
export const PUBLIC_CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

/** What `lib/data.ts` sends on an error envelope. A failure is never cached. */
export const ERROR_CACHE_CONTROL = "no-store";

/** The repository document that carries the integration narrative this description does not. */
export const PARTNER_GUIDE_PATH = "PARTNER_INTEGRATION.md";

/** Where the description is served. */
export const OPENAPI_ROUTE = "/api/openapi.json";

/** The public page that renders it. */
export const DEVELOPERS_ROUTE = "/developers";

// --------------------------------------------------------------------------- components

/**
 * Every schema that earns a name in `components.schemas`.
 *
 * Naming the shared pieces is not decoration: a generator turns each one into a type a partner can
 * hold in a variable — `ChainEvent`, `IndexCoverage`, `NavBlock` — instead of re-declaring the
 * same anonymous object at every use site. The scalars are named for a second reason: `Usd2`,
 * `Unit6` and `IntegerString` are where PLAN.md D22 lives, and a reader who follows the `$ref`
 * finds the rule written down beside the pattern that enforces it.
 *
 * The order here is the order the components appear in the document.
 */
const COMPONENT_SCHEMAS = [
  // scalars — the money conventions
  ["Usd2", usd2],
  ["Unit6", unit6],
  ["Fixed4", fixed4],
  ["Fixed8", fixed8],
  ["Fixed10", fixed10],
  ["Tokens18", tokens18],
  ["IntegerString", integerString],
  ["Analytic", analytic],
  ["IsoDate", isoDate],
  ["IsoTimestamp", isoTimestamp],
  ["EvmAddress", evmAddress],
  ["LowerCaseAddress", lowerCaseAddress],
  ["TxHash", txHash],
  ["Hash32", hash32],
  // envelope
  ["ApiErrorCode", apiErrorCode],
  ["ApiError", apiErrorSchema],
  // nav.json
  ["ChainInfo", chainInfoSchema],
  ["NavBlock", navBlockSchema],
  ["PortfolioBlock", portfolioBlockSchema],
  ["DistributionYieldBlock", distributionYieldBlockSchema],
  ["FeesBlock", feesBlockSchema],
  ["TBillReference", tBillReferenceSchema],
  ["ComparisonBlock", comparisonBlockSchema],
  ["NavDocument", navDocumentSchema],
  ["NavResponse", navResponseSchema],
  // holdings.json
  ["HoldingPosition", holdingPositionSchema],
  ["HoldingsDocument", holdingsDocumentSchema],
  ["HoldingsResponse", holdingsResponseSchema],
  // attestation.json
  ["AttestationHolding", attestationHoldingSchema],
  ["AttestationChain", attestationChainSchema],
  ["AttestationNav", attestationNavSchema],
  ["SupplyBackedRatio", supplyBackedRatioSchema],
  ["AttestationPayload", attestationPayloadSchema],
  ["AttestationSignature", attestationSignatureSchema],
  ["AttestationDocument", attestationDocumentSchema],
  ["AttestationPublished", attestationStatusSchema.options[0]],
  ["AttestationNotPublished", attestationStatusSchema.options[1]],
  ["AttestationStatus", attestationStatusSchema],
  ["AttestationResponse", attestationResponseSchema],
  // the event index
  ["EventName", eventNameSchema],
  ["EventSource", eventSourceSchema],
  ["EventOrder", eventOrderSchema],
  ["ChainEvent", chainEventSchema],
  ["BlockGap", blockGapSchema],
  ["IndexCoverage", indexCoverageSchema],
  ["EventFilters", eventFiltersSchema],
  ["EventPage", eventPageSchema],
  ["EventsOk", eventsResponseSchema.shape.data.options[0]],
  ["EventsUnavailable", eventsResponseSchema.shape.data.options[1]],
  ["EventsData", eventsResponseSchema.shape.data],
  ["EventsResponse", eventsResponseSchema],
  // /api/stats
  ["SupplySource", supplySource],
  ["Holders", holdersSchema],
  ["FlowTotals", flowTotalsSchema],
  ["DistributionTotals", distributionTotalsSchema],
  ["VerificationTotals", verificationTotalsSchema],
  ["DailyActivity", dailyActivitySchema],
  ["OnchainNavPoint", onchainNavPointSchema],
  ["ChainStatsOk", chainStatsSchema.options[0]],
  ["ChainStatsUnavailable", chainStatsSchema.options[1]],
  ["ChainStats", chainStatsSchema],
  ["EventActivityOk", eventActivitySchema.options[0]],
  ["EventActivityUnavailable", eventActivitySchema.options[1]],
  ["EventActivity", eventActivitySchema],
  ["NavHistoryEntry", navHistoryEntrySchema],
  ["NavAgreement", navAgreementSchema],
  ["StatsData", statsResponseSchema.shape.data],
  ["StatsResponse", statsResponseSchema],
] as const satisfies readonly (readonly [string, z.ZodType])[];

/** Component name → the prose a `$ref` should carry. Absent names are an error, not a no-op. */
const COMPONENT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  Usd2:
    'A USD amount as a decimal string with exactly two fractional digits, e.g. "1016860.71". ' +
    "Parse it as a decimal, never as a float; the fixed scale is what makes an exact parse safe.",
  Unit6:
    "A per-token or per-unit amount with exactly six fractional digits — the same scale as USDC " +
    "on-chain. Where an endpoint also publishes the six-decimal integer beside it, integrate " +
    "against the integer (PLAN.md D22).",
  Fixed4: "A four-decimal figure: a clean price or a coupon rate.",
  Fixed8: "An eight-decimal figure: a dirty price.",
  Fixed10: "A ten-decimal figure: reference units and the supply scaling factor.",
  Tokens18:
    "A token amount with exactly eighteen fractional digits, matching the token's 18 decimals. " +
    "The integer beside it, in wei, is the authoritative value.",
  IntegerString:
    "A non-negative integer written as a decimal string, because JSON has no BigInt and a JSON " +
    "number silently loses the low digits of an 18-decimal amount. Parse it with BigInt.",
  Analytic:
    "A yield, duration or convexity. These are analytics rather than money, so they are JSON " +
    "numbers by design. No amount of money is ever a JSON number in this API.",
  IsoDate: "A calendar date, YYYY-MM-DD, in UTC.",
  IsoTimestamp: "An instant to the second, UTC, always ending in Z.",
  EvmAddress: "A 20-byte hex address, 0x-prefixed, as the chain reports it (checksummed casing).",
  LowerCaseAddress:
    "A 20-byte hex address, lower-cased, for comparison rather than display. The `account` " +
    "filter on /api/events matches these.",
  TxHash: "A 32-byte transaction hash, 0x-prefixed.",
  Hash32: "A 32-byte hash — a block hash, where a transaction hash would read as the wrong thing.",
  ApiErrorCode:
    "The stable error codes. Switch on this rather than on the message. Adding a code is a " +
    "breaking change for a caller that switches on it, so the set is closed. `not_found` and " +
    "`chain_unavailable` are reserved: no endpoint described here emits them today, and a " +
    "caller should still have a branch for them.",
  ApiError:
    "The error envelope every endpoint in this description returns on failure, with the sole " +
    "exception of GET /api/openapi.json. `message` says what went wrong; `hint` says what the " +
    "caller or the operator can do about it. Both are always present.",
  NavDocument:
    "nav.json exactly as the NAV engine published it. The same bytes are committed in the " +
    "repository, so a reader of the file and a caller of the endpoint see one document.",
  HoldingsDocument:
    "The simulated reference book, position by position. Every position carries " +
    '`illustrative: true` and an ISIN of "TBD": render those labels, do not strip them.',
  AttestationStatus:
    "Two legitimate states, discriminated on `status`, both answered with HTTP 200. " +
    "`not_published` is the normal state until someone runs `make attest` with the attestor key " +
    "(PLAN.md D34); it is not an error and must not be retried as one.",
  AttestationNotPublished:
    "No attestation has been signed yet. Carries the reason, the command that would publish one, " +
    "and where it will appear. There is nothing to verify, and the API says so rather than " +
    "returning an empty document you might mistake for a valid one.",
  AttestationSignature:
    "EIP-191 personal_sign over the canonical JSON. The exact signed string is published as " +
    "`message`, so a verifier never has to reproduce the canonicalisation: pass `message`, " +
    "`signature` and `attestor_address` straight to viem's verifyMessage.",
  ChainEvent:
    "One decoded log. Identity is (block_number, log_index, transaction_hash) — the first two " +
    "alone collide across a reorg. Every value in `args` is a string: integers are decimal " +
    "strings of the exact integer the contract emitted.",
  IndexCoverage:
    "What the index actually managed to read. Read this before trusting a result: `complete` " +
    "false with a non-empty `gaps` means block ranges are missing from every figure derived " +
    "from it, and `stale` means a rebuild failed and the previous index is being served.",
  BlockGap: "A block range the indexer could not read, inclusive of both ends, and why.",
  EventPage:
    "The pagination state of this response. `next_cursor` is an opaque position; pass it back " +
    "unchanged as `cursor` to get the next page.",
  EventFilters: "The filters this request actually applied, echoed back.",
  EventsData:
    "Discriminated on `status`. `unavailable` means no index could be built — which is not the " +
    "same as a chain with no events, and is why it is a state rather than an empty list.",
  Holders:
    "Addresses with a non-zero balance, folded from Transfer logs. The zero address is the " +
    "ERC-20 mint and burn sentinel, not an account, and is never counted. `complete` false " +
    "means the count is a floor.",
  DistributionTotals:
    "Two figures that are easy to confuse. `usdc_amount_6dec` is what the issuer paid into the " +
    "vault; `usdc_allocated_6dec` is what the cumulative index attributed to holders. The " +
    "difference is the truncation remainder and stays as ordinary vault liquidity.",
  ChainStats:
    "The contract's own figures, discriminated on `status`. Every amount is a decimal string of " +
    "the integer the contract holds.",
  EventActivity: "Everything foldable from logs, discriminated on `status`.",
  NavAgreement:
    "Does the NAV the engine published equal the NAV the contract holds? `matches` is null, not " +
    'false, when there is nothing to compare against — "we could not check" and "the check ' +
    'failed" are different facts.',
  DailyActivity: "One row per UTC day. A day with no activity is a zero row, not a missing row.",
  StatsData: "Everything /api/stats returns, published documents and chain reads together.",
};

type JsonObject = Record<string, unknown>;

/** `$schema` and `$id` belong to a standalone JSON Schema document, not to a Schema Object. */
function stripSchemaIdentity(schema: JsonObject): JsonObject {
  const copy = { ...schema };
  delete copy.$schema;
  delete copy.$id;
  return copy;
}

/**
 * Attach a `discriminator` to a generated `oneOf`, with the mapping **read out of the members**.
 *
 * OpenAPI's Discriminator Object lets a generator pick the branch from one property instead of
 * trying each in turn, which is the difference between a usable union and a `Record<string,
 * unknown>` in most generators. The mapping is derived: each member is a `$ref`, and the constant
 * its discriminating property is pinned to is read from the referenced component. Add a member to
 * the zod union and the mapping grows by itself; rename a `status` value and the mapping follows.
 */
function addDiscriminator(
  schemas: Record<string, JsonObject>,
  name: string,
  propertyName: string,
): void {
  const target = schemas[name];
  if (!target) throw new Error(`lib/openapi.ts: no component named ${name} to discriminate`);
  const members = target.oneOf;
  if (!Array.isArray(members)) {
    throw new Error(
      `lib/openapi.ts: component ${name} is not a oneOf and cannot carry a discriminator`,
    );
  }
  const mapping: Record<string, string> = {};
  for (const member of members) {
    const ref = (member as JsonObject | undefined)?.$ref;
    if (typeof ref !== "string" || !ref.startsWith("#/components/schemas/")) {
      throw new Error(
        `lib/openapi.ts: every member of ${name} must be a component $ref for a discriminator ` +
          `mapping to be derivable; got ${JSON.stringify(member)}`,
      );
    }
    const memberName = ref.slice("#/components/schemas/".length);
    const member_ = schemas[memberName];
    const property = (member_?.properties as JsonObject | undefined)?.[propertyName] as
      JsonObject | undefined;
    const literal = property?.const;
    if (typeof literal !== "string") {
      throw new Error(
        `lib/openapi.ts: ${memberName}.${propertyName} is not pinned to a string constant, so ` +
          `the discriminator mapping for ${name} cannot be derived from it`,
      );
    }
    mapping[literal] = ref;
  }
  target.discriminator = { propertyName, mapping };
}

/**
 * Build `components.schemas` from the zod schemas.
 *
 * `z.toJSONSchema` is given the registry rather than one schema at a time: that is what makes a
 * nested registered schema come out as a `$ref` to its component instead of a fourth inline copy
 * of `NavBlock`.
 */
function buildComponentSchemas(): Record<string, JsonObject> {
  const registry = z.registry<{ id: string }>();
  for (const [id, schema] of COMPONENT_SCHEMAS) registry.add(schema, { id });

  const generated = z.toJSONSchema(registry, {
    target: "draft-2020-12",
    uri: (id) => `#/components/schemas/${id}`,
  }).schemas as Record<string, JsonObject>;

  const schemas: Record<string, JsonObject> = {};
  for (const [id] of COMPONENT_SCHEMAS) {
    const schema = generated[id];
    if (!schema) throw new Error(`lib/openapi.ts: zod emitted no JSON Schema for ${id}`);
    schemas[id] = stripSchemaIdentity(schema);
  }

  for (const [name, description] of Object.entries(COMPONENT_DESCRIPTIONS)) {
    const schema = schemas[name];
    if (!schema) {
      throw new Error(
        `lib/openapi.ts: COMPONENT_DESCRIPTIONS names ${name}, which is not a component. ` +
          "Remove the description or restore the schema.",
      );
    }
    schema.description = description;
  }

  addDiscriminator(schemas, "AttestationStatus", "status");
  addDiscriminator(schemas, "EventsData", "status");
  addDiscriminator(schemas, "ChainStats", "status");
  addDiscriminator(schemas, "EventActivity", "status");

  return schemas;
}

// --------------------------------------------------------------------------- the endpoint model

/**
 * `/api/events` page-size bounds, as its route enforces them.
 *
 * These two numbers are the only facts in this file that are typed out rather than imported: they
 * are `const DEFAULT_LIMIT` and `const MAX_LIMIT` inside `app/api/events/route.ts`, which is not
 * this module's file to edit. `lib/openapi.test.ts` reads that source and fails if either number
 * moves without this one following, so the duplication cannot go unnoticed.
 */
export const EVENTS_DEFAULT_LIMIT = 50;
export const EVENTS_MAX_LIMIT = 200;

export interface EndpointParameter {
  readonly name: string;
  readonly required: boolean;
  /** One sentence for the table on `/developers` and for the operation's parameter description. */
  readonly description: string;
  /** The JSON Schema for the value. */
  readonly schema: JsonObject;
  /** A value that works, attached to the parameter as `example`. */
  readonly example?: unknown;
  readonly defaultNote: string;
}

export interface EndpointFailure {
  readonly status: number;
  readonly code: (typeof apiErrorCode.options)[number];
  readonly when: string;
}

export interface EndpointDoc {
  readonly path: string;
  readonly operationId: string;
  readonly summary: string;
  readonly tag: string;
  /** Markdown. Rendered as the operation description and as the page's body copy. */
  readonly description: string;
  /** Short lines the page renders as bullets under the description. */
  readonly notes: readonly string[];
  /** The component name of the 200 body, or `null` where the body is not one of ours. */
  readonly responseComponent: string | null;
  /** The component name of the `data` member, or `null` when there is no envelope. */
  readonly dataComponent: string | null;
  readonly cacheControl: string;
  readonly parameters: readonly EndpointParameter[];
  readonly failures: readonly EndpointFailure[];
  /** `curl` with `{{base}}` where the origin goes, so the page can fill in the real one. */
  readonly curl: string;
  /** What the example prints, so a reader knows what to expect before running it. */
  readonly curlNote: string;
}

const TAG_DOCUMENTS = "Published documents";
const TAG_CHAIN = "Chain activity";
const TAG_DESCRIPTION = "Description";

/** Every public route carries these. */
const CORS_NOTE =
  "Cross-origin reads are allowed: the endpoint is public, read-only and takes no credentials, " +
  "so it answers with `Access-Control-Allow-Origin: *`.";

const INTERNAL_FAILURES: readonly EndpointFailure[] = [
  {
    status: 500,
    code: "invalid_document",
    when: "the response failed its own schema on the way out, so it was not sent. This is a bug on our side and the message names the field.",
  },
  {
    status: 500,
    code: "internal_error",
    when: "anything else. The message is redacted of secrets and carries no stack trace.",
  },
];

const EVENT_PARAMETERS: readonly EndpointParameter[] = [
  {
    name: "event",
    required: false,
    description:
      "Restrict to these event names. Repeatable and comma-separated: `?event=Subscribed&event=Redeemed` and `?event=Subscribed,Redeemed` are the same request. An unknown name is a 400 listing the valid ones, never a silently empty page.",
    // An array with the default `style: form, explode: true`, which is `?event=A&event=B` on the
    // wire — what the route reads, and what a generator turns into `event?: EventName[]`. The
    // comma-separated shorthand the route also accepts has no expression in OpenAPI's
    // serialisation rules, so it is stated in the description rather than implied by a style.
    schema: { type: "array", items: { $ref: "#/components/schemas/EventName" } },
    example: ["Subscribed", "Redeemed"],
    defaultNote: `all ${EVENT_NAMES.length.toString()} indexed events`,
  },
  {
    name: "account",
    required: false,
    description:
      "A 20-byte address. Matched against every address in the decoded arguments, not only the first indexed one — `Transfer.from` and `Transfer.to`, and `NAVForced.by`, which is the third argument. The emitting contract's own address is never matched.",
    schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
    example: "0x0000000000000000000000000000000000000000",
    defaultNote: "every account",
  },
  {
    name: "from_block",
    required: false,
    description: "Lower bound on the block number, inclusive.",
    schema: { type: "integer", minimum: 0 },
    example: "0",
    defaultNote: "the deploy block",
  },
  {
    name: "to_block",
    required: false,
    description: "Upper bound on the block number, inclusive.",
    schema: { type: "integer", minimum: 0 },
    example: "1000000",
    defaultNote: "the chain head",
  },
  {
    name: "limit",
    required: false,
    description: `Page size, ${EVENTS_MAX_LIMIT.toString()} at most. A larger ask is refused with a 400 rather than silently clamped, so a caller is never told it received everything when it did not.`,
    schema: {
      type: "integer",
      minimum: 1,
      maximum: EVENTS_MAX_LIMIT,
      default: EVENTS_DEFAULT_LIMIT,
    },
    example: "25",
    defaultNote: EVENTS_DEFAULT_LIMIT.toString(),
  },
  {
    name: "cursor",
    required: false,
    description:
      "An opaque position, taken verbatim from `page.next_cursor` of the previous response. It is a position and not an offset: events arriving at the head between two requests shift every offset by one, but they do not move the slot a cursor names, so page two holds the same events whether or not page one is still the newest page. It is exclusive — the next page starts after it — and it is interpreted in the `order` of the request that uses it. A cursor carries the chain it was minted on; one minted against another chain is a 400 rather than a block height read against the wrong chain. Do not construct, parse or arithmetic on a cursor: treat it as bytes we gave you.",
    schema: { type: "string" },
    defaultNote: "the first page",
  },
  {
    name: "order",
    required: false,
    description:
      "`desc` returns the newest events first; `asc` the oldest. The order is applied before the cursor, so a cursor and an order are read together.",
    schema: { type: "string", enum: [...eventOrderSchema.options] },
    example: "asc",
    defaultNote: "desc",
  },
];

/**
 * Every endpoint in this description, in the order `/developers` lists them.
 *
 * The three `/api/verify*` routes are absent on purpose — see the module comment. The e2e test
 * walks `app/api/` and fails if a route exists that is neither described here nor on its
 * explicitly reasoned exclusion list, so this list cannot quietly fall behind the app.
 */
export const ENDPOINTS: readonly EndpointDoc[] = [
  {
    path: "/api/nav",
    operationId: "getNav",
    summary: "The published NAV document",
    tag: TAG_DOCUMENTS,
    description:
      "`nav.json` exactly as the NAV engine wrote it: NAV per token, NAV total, the portfolio " +
      "analytics behind it, the trailing distribution yield, the fee schedule and the " +
      "illustrative T-bill reference.\n\n" +
      "NAV arrives twice — as `nav.per_token_usd`, a six-decimal string for display, and as " +
      "`nav.usdc_6dec`, the integer the contract stores. They are the same number. Integrate " +
      "against the integer and format at the edge; that is what makes the chain, the engine and " +
      "this API agree to the last digit.",
    notes: [
      "`nav.usdc_6dec` is the same integer `nav()` returns on-chain. Compare the two before you trust anything downstream.",
      "`chain` reports what the engine saw on-chain when it generated the document, including which source the supply came from and any warning attached to it.",
      "`simulated` is a literal `true` and `source_note` says what is simulated. Render both.",
    ],
    responseComponent: "NavResponse",
    dataComponent: "NavDocument",
    cacheControl: PUBLIC_CACHE_CONTROL,
    parameters: [],
    failures: INTERNAL_FAILURES,
    curl: "curl -s {{base}}/api/nav | jq '.data.nav'",
    curlNote: "Prints the NAV block: the display string, the six-decimal integer and the totals.",
  },
  {
    path: "/api/holdings",
    operationId: "getHoldings",
    summary: "The reference book, position by position",
    tag: TAG_DOCUMENTS,
    description:
      "`holdings.json` verbatim: face, clean price, accrued interest, dirty price, market value, " +
      "weight, yield to maturity, modified duration and convexity for every position, plus cash " +
      "and fees payable.\n\n" +
      "The book is simulated. Every position carries `illustrative: true` and an `isin` of " +
      '`"TBD"`, the coupons and maturities are placeholders chosen to match observed yield ' +
      "levels, and `source_note` says so. Those labels are part of the data; render them.",
    notes: [
      "Prices and accrued interest are four- and eight-decimal strings; market values are two-decimal strings. None of them is a float.",
      "`scaled_face_usd` is the reference face scaled by on-chain supply, or `null` when there is no supply to scale by.",
      "Yields and durations are JSON numbers: they are analytics, not money.",
    ],
    responseComponent: "HoldingsResponse",
    dataComponent: "HoldingsDocument",
    cacheControl: PUBLIC_CACHE_CONTROL,
    parameters: [],
    failures: INTERNAL_FAILURES,
    curl: "curl -s {{base}}/api/holdings | jq '.data.positions[] | {name, market_value_usd}'",
    curlNote: "One line per position: its label and its market value.",
  },
  {
    path: "/api/attestation",
    operationId: "getAttestation",
    summary: "The signed transparency document, or a plain statement that there isn't one",
    tag: TAG_DOCUMENTS,
    description:
      "`data` is a union discriminated on `status`, and **both branches are HTTP 200**.\n\n" +
      "`published` carries the signed payload, the exact signed string, the signature, the " +
      "attestor's address and its uncompressed public key. `not_published` carries the reason, " +
      "the command that would publish one and where it will appear.\n\n" +
      "`not_published` is the normal state of this endpoint today. The attestation is not " +
      "committed to the repository, because signing it needs the real attestor key and " +
      "publishing a signature made with a throwaway key would put something in the repository " +
      "that looks like proof and is not. A 404 would tell your monitoring that something is " +
      "broken when nothing is, so absence is modelled as a state you have to handle rather than " +
      "as a transport failure.",
    notes: [
      "Switch on `data.status`. The schema is a discriminated union precisely so a caller cannot reach for `document` without deciding what to do when it is not there.",
      "Verification needs no server: `signature.message` is the exact string that was signed, so `verifyMessage({ address: signature.attestor_address, message: signature.message, signature: signature.signature })` is the whole check.",
      "A valid signature proves the document has not been altered since that key signed it. It does not prove the holdings exist, and in this MVP the attestor key is ours — the document says so.",
    ],
    responseComponent: "AttestationResponse",
    dataComponent: "AttestationStatus",
    cacheControl: PUBLIC_CACHE_CONTROL,
    parameters: [],
    failures: INTERNAL_FAILURES,
    curl: "curl -s {{base}}/api/attestation | jq '.data.status'",
    curlNote: 'Prints "published" or "not_published". Both are a 200.',
  },
  {
    path: "/api/stats",
    operationId: "getStats",
    summary: "Published figures, contract reads and everything the log index can fold",
    tag: TAG_CHAIN,
    description:
      "Three halves, and each one says when it could not answer.\n\n" +
      "The **published** half — NAV, portfolio analytics, distribution yield, fees, the NAV " +
      "history series — comes from files in the repository and is always present. The **chain** " +
      "half and the **activity** half are each discriminated on `status`: the contract's own " +
      "integers, or `unavailable` with a reason. A stats endpoint that invents a zero when an " +
      "RPC times out is worse than one that says the RPC timed out.\n\n" +
      "`nav_agreement` compares the NAV the engine published with the NAV the contract holds, as " +
      "integers. `matches` is `null`, not `false`, when there was nothing to compare against.",
    notes: [
      "Every on-chain amount is a decimal string of the integer the contract stores. An 18-decimal supply does not survive a JSON number.",
      "`chain.holders` and everything under `activity` are folded from `Transfer` and the other logs, not read from a contract view: the token keeps no holder list, by design.",
      "`activity.distributions` reports both what the issuer paid in and what the index allocated to holders. Quote the one you mean.",
      "`activity.daily` is one row per UTC day, zero rows included, so a time series never has a hole where a quiet day was.",
    ],
    responseComponent: "StatsResponse",
    dataComponent: "StatsData",
    cacheControl: PUBLIC_CACHE_CONTROL,
    parameters: [],
    failures: INTERNAL_FAILURES,
    curl: "curl -s {{base}}/api/stats | jq '{nav: .data.nav.per_token_usd, holders: .data.chain.holders}'",
    curlNote: "NAV per token and the holder count, or `null` where the index could not be built.",
  },
  {
    path: "/api/events",
    operationId: "listEvents",
    summary: "Decoded contract events, filterable and paged",
    tag: TAG_CHAIN,
    description:
      "Every event both contracts emit, from the deploy block to the chain head, decoded, " +
      "deduplicated and cached for sixty seconds. There is no database: the index is read from " +
      "the chain on demand, which is why it reports its own coverage.\n\n" +
      "**Read `coverage` before you trust a page.** It says whether the scan was complete, which " +
      "ranges could not be read and why, how many duplicate logs were dropped, how many slots " +
      "held a conflicting transaction after a reorg, how old the cached copy is, and whether a " +
      "stale index is being served because a rebuild failed. A range the node would not serve " +
      "becomes a named gap; it never quietly becomes a short list that looks complete.\n\n" +
      'An unreadable chain is reported as `status: "unavailable"` inside a 200 envelope, with ' +
      "the reason. A malformed *request* is a 400.",
    notes: [
      "`page.next_cursor` is an opaque position. Pass it back unchanged; do not parse it, and do not build one.",
      "A cursor minted against another chain is refused with a 400, so one chain's block heights are never applied to another's.",
      'Amounts inside `args` are decimal strings of the exact integer the contract emitted; booleans are `"true"` and `"false"`; addresses are checksummed.',
      "`accounts` lists every address appearing anywhere in `args`, lower-cased. That is the field the `account` filter matches.",
    ],
    responseComponent: "EventsResponse",
    dataComponent: "EventsData",
    cacheControl: PUBLIC_CACHE_CONTROL,
    parameters: EVENT_PARAMETERS,
    failures: [
      {
        status: 400,
        code: "bad_request",
        when:
          "a query parameter is not one this endpoint accepts: an unknown event name, a malformed address, a non-numeric block, a limit outside 1.." +
          `${EVENTS_MAX_LIMIT.toString()}, an order that is neither \`asc\` nor \`desc\`, or a cursor this endpoint did not issue. The message names the parameter and the hint shows a value that works.`,
      },
      ...INTERNAL_FAILURES,
    ],
    curl: "curl -s '{{base}}/api/events?event=Subscribed&limit=5' | jq '.data.events[].args'",
    curlNote: "The decoded arguments of the five most recent subscriptions.",
  },
  {
    path: OPENAPI_ROUTE,
    operationId: "getOpenApiDocument",
    summary: "This description, as an OpenAPI 3.1 document",
    tag: TAG_DESCRIPTION,
    description:
      "The document you are reading, served so a code generator can be pointed straight at it.\n\n" +
      "**This is the one endpoint that is not wrapped in `{ ok, data }`.** A generator pointed at " +
      "this URL expects an OpenAPI document, not an envelope containing one, so the body is the " +
      "document itself. Every other endpoint described here uses the envelope, on success and on " +
      "failure alike.",
    notes: [
      "The response schemas are generated from the same zod schemas the routes validate against, so this description cannot describe a shape the API does not return.",
      "`servers` holds a relative URL and a local development URL. There is no mainnet deployment and no production hostname to point at.",
    ],
    responseComponent: null,
    dataComponent: null,
    cacheControl: PUBLIC_CACHE_CONTROL,
    parameters: [],
    failures: [],
    curl: `curl -s {{base}}${OPENAPI_ROUTE} | jq '.info.version'`,
    curlNote: "Prints the version of this description.",
  },
];

/** The endpoints that return the `{ ok, data }` envelope — everything except the description. */
export const ENVELOPE_ENDPOINTS: readonly EndpointDoc[] = ENDPOINTS.filter(
  (endpoint) => endpoint.dataComponent !== null,
);

/** Routes under `app/api/` that this description leaves out, each with the reason it is out. */
export const UNDOCUMENTED_ROUTES: readonly { readonly path: string; readonly reason: string }[] = [
  {
    path: "/api/verify",
    reason:
      "Same-origin only (PLAN.md D62): `Cache-Control: no-store`, no `Access-Control-Allow-Origin`, " +
      "and a body that must be `content-type: application/json`, which a cross-origin form cannot " +
      "set. It exists so this app's /verify page can register a wallet on a testnet; it writes, it " +
      "takes no partner input, and a browser on another origin cannot call it at all.",
  },
  {
    path: "/api/verify/status",
    reason:
      "The same surface, read side. Never cached, no CORS header, and meaningful only to the page " +
      "watching a single wallet's countdown. The chain is the record: read `canHold(address)` from " +
      "IdentityRegistry instead.",
  },
  {
    path: "/api/verify/process",
    reason:
      "The registrar worker. Gated by `REGISTRAR_WORKER_SECRET`, rate-limited, and able only to " +
      "advance requests someone already submitted. It is operational plumbing, not an integration " +
      "surface.",
  },
];

/**
 * Whole route namespaces this description does not cover, matched by prefix.
 *
 * A prefix rather than a list of paths, because the admin console's routes are not a published
 * surface and enumerating them here would mean this file had to be edited every time one moved —
 * and a stale entry would fail the drift test for no reason anyone cares about. The rule is the
 * fact worth publishing: nothing under `/admin` is part of the API.
 */
export const UNDOCUMENTED_ROUTE_PREFIXES: readonly {
  readonly prefix: string;
  readonly reason: string;
}[] = [
  {
    prefix: "/admin/",
    reason:
      "The admin console's own routes. Every action behind them is gated on an on-chain role and " +
      "ends in a transaction signed by the connected wallet, so there is nothing here a partner " +
      "could call and nothing that would answer if they did. They are an internal surface of one " +
      "page, not an API, and they are free to change shape between deploys.",
  },
];

/** Does a route fall inside a namespace this description deliberately does not cover? */
export function isUndocumentedNamespace(route: string): boolean {
  return UNDOCUMENTED_ROUTE_PREFIXES.some((entry) => route.startsWith(entry.prefix));
}

// --------------------------------------------------------------------------- the document

export interface OpenApiDocument extends JsonObject {
  readonly openapi: string;
  readonly info: JsonObject;
  readonly servers: readonly JsonObject[];
  readonly tags: readonly JsonObject[];
  readonly paths: Record<string, JsonObject>;
  readonly components: { readonly schemas: Record<string, JsonObject> };
}

/**
 * Where this API can be reached.
 *
 * A relative `/` resolves against whatever host served the document, which is the only correct
 * answer for a deployment whose hostname this repository does not know. The second entry is the
 * local development server. There is no third: BUILD_PROMPT section 2 forbids mainnet
 * configuration, there is no production deployment, and a plausible-looking `api.hitbite.…` would
 * be an invented fact in the one file a partner pastes into a generator.
 */
const SERVERS: readonly JsonObject[] = [
  {
    url: "/",
    description: "This deployment, resolved against the host that served this document.",
  },
  { url: "http://localhost:3000", description: "A local `pnpm dev` server." },
];

const INFO_DESCRIPTION = [
  "Read-only JSON over the published NAV documents and the contract logs of a **testnet**",
  "deployment of `hbTRS`. Base Sepolia (84532) and a local Anvil (31337) are the only chains this",
  "project runs on: there is no mainnet deployment, no mainnet configuration and no mainnet",
  "address anywhere in it. The portfolio the numbers value is simulated and every document says",
  "so in `source_note`.",
  "",
  "## The envelope",
  "",
  'Every endpoint below answers `{ "ok": true, "data": … }` or',
  '`{ "ok": false, "error": { "code", "message", "hint" } }`. `code` is drawn from a closed set',
  "(`ApiErrorCode`) so a caller can switch on it; `message` says what went wrong and `hint` says",
  "what to do about it. The single exception is `GET /api/openapi.json`, which serves this",
  "document raw, because a generator pointed at that URL expects an OpenAPI document rather than",
  "an envelope containing one.",
  "",
  "## Money",
  "",
  "No amount of money is ever a JSON number. Each one arrives as a fixed-scale decimal **string**",
  "— two decimals for USD totals, six for per-token amounts and USDC, eighteen for token amounts —",
  "and, wherever a contract or the engine holds the underlying integer, as that **integer** beside",
  "it: `usdc_6dec` and `*_usdc_6dec` are six-decimal USDC integers, `*_wei` and `*_1e18` are",
  "18-decimal integers, and both are written as decimal strings where they would not survive a",
  "JSON number. Parse the integer with `BigInt` and format at the edge. Parse neither into a",
  "float: the fixed number of fractional digits on the string is what makes an exact decimal parse",
  "safe, and a float would lose the low digits of an 18-decimal supply outright. Yields, durations",
  "and convexities *are* JSON numbers — they are analytics, not money.",
  "",
  "## Caching and CORS",
  "",
  `Successful responses carry \`Cache-Control: ${PUBLIC_CACHE_CONTROL}\`: a poller hits a CDN`,
  "rather than a function, and the last good answer stays in front of readers while a refresh",
  `happens behind them. Errors carry \`Cache-Control: ${ERROR_CACHE_CONTROL}\`, because a transient`,
  "RPC failure must not be served for a minute. Every endpoint below answers",
  "`Access-Control-Allow-Origin: *`: they are public, read-only and take no credentials.",
  "",
  "## What is not here",
  "",
  "`/api/verify`, `/api/verify/status` and `/api/verify/process` are deliberately outside this",
  "description. They are same-origin by construction — never cached, no CORS header, and a body",
  "that must be `content-type: application/json`, which a cross-origin form cannot set — and they",
  "exist so that this app's own `/verify` page can register a wallet on a testnet. A partner",
  "cannot call them from a browser and has no reason to call them from a server: eligibility is a",
  "question for the chain, and `IdentityRegistry.canHold(address)` answers it.",
  "",
  "## Further reading",
  "",
  `\`${PARTNER_GUIDE_PATH}\` in the repository carries the integration narrative this description`,
  "does not: what the transfer restrictions do to a custody wallet, how to verify an attestation,",
  `and how to price the token as collateral with a haircut. \`${DEVELOPERS_ROUTE}\` renders this`,
  "document as a page, with a runnable `curl` for every endpoint.",
].join("\n");

const TAGS: readonly JsonObject[] = [
  {
    name: TAG_DOCUMENTS,
    description:
      "The documents the NAV engine publishes, served verbatim. They change once a day, when a " +
      "deploy carries a new set of files.",
  },
  {
    name: TAG_CHAIN,
    description:
      "Figures read from the contracts and folded from their logs. These change as the chain " +
      "does, and each one reports how much of the chain it managed to read.",
  },
  { name: TAG_DESCRIPTION, description: "This description of the API." },
];

/** The response headers every endpoint here actually sends, as OpenAPI Header Objects. */
function responseHeaders(cacheControl: string): JsonObject {
  return {
    "Cache-Control": {
      description: "The cache policy this response was sent with.",
      schema: { type: "string", const: cacheControl },
    },
    "Access-Control-Allow-Origin": {
      description: CORS_NOTE,
      schema: { type: "string", const: "*" },
    },
  };
}

function errorResponse(description: string, codes: readonly string[]): JsonObject {
  return {
    description,
    headers: responseHeaders(ERROR_CACHE_CONTROL),
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ApiError" },
        example: {
          ok: false,
          error: {
            code: codes[0] ?? "internal_error",
            message: "a sentence naming what went wrong.",
            hint: "a sentence naming what to do about it.",
          },
        },
      },
    },
  };
}

function buildOperation(endpoint: EndpointDoc): JsonObject {
  const byStatus = new Map<number, string[]>();
  for (const failure of endpoint.failures) {
    const codes = byStatus.get(failure.status) ?? [];
    codes.push(failure.code);
    byStatus.set(failure.status, codes);
  }

  const responses: JsonObject = {
    "200": {
      description:
        endpoint.dataComponent === null
          ? "The OpenAPI description, unwrapped."
          : "The success envelope.",
      headers: responseHeaders(endpoint.cacheControl),
      content: {
        "application/json": {
          schema:
            endpoint.responseComponent === null
              ? // An OpenAPI document. Its shape is the OpenAPI 3.1 meta-schema, which is not
                // inlined here: pulling a 34 kB foreign schema into this document would triple its
                // size to describe the one endpoint nobody generates a client for.
                { type: "object", description: "An OpenAPI 3.1 document." }
              : { $ref: `#/components/schemas/${endpoint.responseComponent}` },
        },
      },
    },
  };

  for (const [status, codes] of [...byStatus.entries()].sort((a, b) => a[0] - b[0])) {
    const lines = endpoint.failures
      .filter((failure) => failure.status === status)
      .map((failure) => `\`${failure.code}\` — ${failure.when}`);
    responses[status.toString()] = errorResponse(lines.join("\n\n"), codes);
  }

  const operation: JsonObject = {
    operationId: endpoint.operationId,
    summary: endpoint.summary,
    tags: [endpoint.tag],
    description: [endpoint.description, ...endpoint.notes.map((note) => `- ${note}`)].join("\n\n"),
    responses,
  };

  if (endpoint.parameters.length > 0) {
    operation.parameters = endpoint.parameters.map((parameter) => {
      const described: JsonObject = {
        name: parameter.name,
        in: "query",
        required: parameter.required,
        description: `${parameter.description}\n\nDefault: ${parameter.defaultNote}.`,
        schema: parameter.schema,
      };
      if (parameter.example !== undefined) described.example = parameter.example;
      return described;
    });
  }

  return operation;
}

/**
 * Build the whole document.
 *
 * Rebuilt per call rather than memoised at module scope: it is cheap, and a memoised object that
 * a caller could mutate would be a trap in a long-lived server process.
 */
export function buildOpenApiDocument(): OpenApiDocument {
  const paths: Record<string, JsonObject> = {};
  for (const endpoint of ENDPOINTS) {
    paths[endpoint.path] = { get: buildOperation(endpoint) };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: OPENAPI_TITLE,
      version: OPENAPI_VERSION,
      summary:
        "Read-only JSON: the published NAV documents, the contract's own figures, and the " +
        "decoded event log. Testnet only.",
      description: INFO_DESCRIPTION,
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: SERVERS,
    tags: TAGS,
    paths,
    components: { schemas: buildComponentSchemas() },
  };
}

// --------------------------------------------------------------------------- reading it back

/** Substitute the real origin into an endpoint's `curl` line. */
export function curlFor(endpoint: EndpointDoc, baseUrl: string): string {
  return endpoint.curl.replaceAll("{{base}}", baseUrl);
}

/** Follow a `#/components/schemas/…` reference. Anything else is a bug in this module. */
export function resolveComponent(document: OpenApiDocument, ref: string): JsonObject {
  const prefix = "#/components/schemas/";
  if (!ref.startsWith(prefix)) throw new Error(`lib/openapi.ts: ${ref} is not a component ref`);
  const name = ref.slice(prefix.length);
  const schema = document.components.schemas[name];
  if (!schema) throw new Error(`lib/openapi.ts: ${ref} does not resolve`);
  return schema;
}

export interface FieldSummary {
  readonly name: string;
  /** A short type, e.g. `string`, `integer`, `ChainEvent[]`, `NavBlock`, `string | null`. */
  readonly type: string;
  readonly required: boolean;
  readonly description: string | null;
}

/** `#/components/schemas/ChainEvent` → `ChainEvent`; anything else → `null`. */
function componentName(schema: JsonObject): string | null {
  const ref = schema.$ref;
  if (typeof ref !== "string") return null;
  const prefix = "#/components/schemas/";
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : null;
}

/** A one-word rendering of a JSON Schema node, for the field tables on `/developers`. */
export function describeType(schema: JsonObject): string {
  const named = componentName(schema);
  if (named) return named;

  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.map((member) => describeType(member as JsonObject)).join(" | ");
  }
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.map((member) => describeType(member as JsonObject)).join(" | ");
  }
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum))
    return schema.enum.map((value) => JSON.stringify(value)).join(" | ");

  const type = schema.type;
  if (Array.isArray(type)) return type.join(" | ");
  if (type === "array") {
    const items = schema.items;
    return `${items ? describeType(items as JsonObject) : "unknown"}[]`;
  }
  if (typeof type === "string") return type;
  return "object";
}

/**
 * The top-level fields of a component, for the response-shape table on `/developers`.
 *
 * A union is summarised by its discriminator rather than by a merged field list, because a merged
 * list would imply that a caller can read a field from either branch, which is exactly the mistake
 * the union exists to prevent.
 */
export function summariseComponent(
  document: OpenApiDocument,
  name: string,
):
  | { readonly kind: "object"; readonly fields: readonly FieldSummary[] }
  | {
      readonly kind: "union";
      readonly propertyName: string;
      readonly branches: readonly { readonly value: string; readonly component: string }[];
    } {
  const schema = resolveComponent(document, `#/components/schemas/${name}`);

  const discriminator = schema.discriminator as
    { propertyName: string; mapping: Record<string, string> } | undefined;
  if (discriminator) {
    return {
      kind: "union",
      propertyName: discriminator.propertyName,
      branches: Object.entries(discriminator.mapping).map(([value, ref]) => ({
        value,
        component: ref.slice("#/components/schemas/".length),
      })),
    };
  }

  const properties = (schema.properties ?? {}) as Record<string, JsonObject>;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  return {
    kind: "object",
    fields: Object.entries(properties).map(([field, value]) => {
      const named = componentName(value);
      const target = named ? document.components.schemas[named] : undefined;
      const description = value.description ?? target?.description;
      return {
        name: field,
        type: describeType(value),
        required: required.has(field),
        description: typeof description === "string" ? description : null,
      };
    }),
  };
}
