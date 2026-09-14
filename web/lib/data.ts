/**
 * Server-side readers for the documents the NAV engine publishes into `web/public/data/`.
 *
 * **Server only.** It imports `node:fs/promises`, so a client component that imports it fails the
 * build rather than shipping a broken bundle. Public pages are server components and read through
 * here; nothing on a public page touches the wallet stack.
 *
 * Four of the five documents are **statically imported**. That is deliberate:
 *
 *   - they are committed to the repository and refreshed by the `nav-daily` pull request, so a
 *     deploy is what changes them — there is no moment where reading from disk would be fresher;
 *   - a static import is bundled, so a page render costs no file I/O and no `public/` lookup,
 *     which matters because Vercel serves `public/` as CDN assets that a serverless function is
 *     not guaranteed to be able to `readFile`;
 *   - a missing or malformed document becomes a build failure instead of a 500 in front of a
 *     reviewer.
 *
 * `attestation.json` is the exception, and the reason is PLAN.md D34: it is **not committed**, and
 * will not exist until someone runs `make attest` with the real attestor key. A static import of a
 * file that is not there does not type-check and does not build, so it is read from disk and its
 * absence is modelled, not swallowed — see `readAttestation` and `DocumentResult`.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import navJson from "../public/data/nav.json";
import holdingsJson from "../public/data/holdings.json";
import navHistoryJson from "../public/data/nav_history.json";
import scenariosJson from "../public/data/scenarios.json";

import { NO_ATTESTATION_PUBLISHED, SIMULATED_ATTESTOR_NOTE } from "./copy";
import {
  attestationDocumentSchema,
  holdingsDocumentSchema,
  navDocumentSchema,
  navHistoryDocumentSchema,
  scenariosDocumentSchema,
  type ApiErrorCode,
  type AttestationDocument,
  type AttestationStatus,
  type HoldingsDocument,
  type NavDocument,
  type NavHistoryDocument,
  type ScenariosDocument,
} from "./schemas";

/** Repo-relative path of the attestation, quoted in responses and in the UI. */
export const ATTESTATION_PATH = "web/public/data/attestation.json";

/** The command that produces it (root `Makefile`). */
export const ATTESTATION_COMMAND = "make attest";

export class DataError extends Error {
  readonly document: string;

  constructor(document: string, message: string) {
    super(message);
    this.name = "DataError";
    this.document = document;
  }
}

/**
 * A document that may legitimately not exist yet.
 *
 * Discriminated on `status`, so TypeScript refuses to let a caller reach `.document` without
 * first handling the absent branch. That is the whole point: "no attestation has been published"
 * is a fact the transparency page has to state, not a null to coalesce away.
 */
export type DocumentResult<T> =
  | { readonly status: "published"; readonly document: T }
  | {
      readonly status: "absent";
      readonly reason: string;
      readonly howToPublish: string;
      readonly expectedPath: string;
    };

// --------------------------------------------------------------------------- parse once

/** Turn a `ZodError` into one line a developer can act on. */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
}

/**
 * Validate a statically imported document on first use and remember the result.
 *
 * Parsing is lazy so that importing this module is free, and memoised so that a page rendering
 * three documents does not re-validate each of them per request.
 */
function parseOnce<S extends z.ZodType>(name: string, raw: unknown, schema: S): () => z.infer<S> {
  let cached: z.infer<S> | undefined;
  return () => {
    if (cached !== undefined) return cached;
    const result = schema.safeParse(raw);
    if (!result.success) {
      throw new DataError(
        name,
        `${name} does not match the schema the web app expects — the engine and ` +
          `web/lib/schemas.ts have drifted. Re-run \`make nav\`, or update the schema if the ` +
          `engine's output changed on purpose. Issues: ${describeIssues(result.error)}`,
      );
    }
    cached = result.data as z.infer<S>;
    return cached;
  };
}

const readNav = parseOnce("nav.json", navJson, navDocumentSchema);
const readHoldings = parseOnce("holdings.json", holdingsJson, holdingsDocumentSchema);
const readNavHistory = parseOnce("nav_history.json", navHistoryJson, navHistoryDocumentSchema);
const readScenarios = parseOnce("scenarios.json", scenariosJson, scenariosDocumentSchema);

/** `nav.json` — NAV per token, portfolio analytics, distribution yield, comparison reference. */
export function getNavDocument(): NavDocument {
  return readNav();
}

/** `holdings.json` — the simulated reference book, position by position. */
export function getHoldingsDocument(): HoldingsDocument {
  return readHoldings();
}

/** `nav_history.json` — one entry per calendar day since inception. */
export function getNavHistoryDocument(): NavHistoryDocument {
  return readNavHistory();
}

/** `scenarios.json` — parallel yield shifts and the CDS-shock mapping, with their assumptions. */
export function getScenariosDocument(): ScenariosDocument {
  return readScenarios();
}

/** All four committed documents, for a page that renders several of them. */
export function getPublishedDataset(): {
  nav: NavDocument;
  holdings: HoldingsDocument;
  history: NavHistoryDocument;
  scenarios: ScenariosDocument;
} {
  return {
    nav: getNavDocument(),
    holdings: getHoldingsDocument(),
    history: getNavHistoryDocument(),
    scenarios: getScenariosDocument(),
  };
}

// --------------------------------------------------------------------------- attestation

function absentAttestation(reason: string): DocumentResult<AttestationDocument> {
  return {
    status: "absent",
    reason,
    howToPublish: ATTESTATION_COMMAND,
    expectedPath: ATTESTATION_PATH,
  };
}

/**
 * Read `attestation.json` if it is there.
 *
 * Three outcomes, all of them honest:
 *   - the file exists and verifies against the schema → `published`;
 *   - the file is not there → `absent`, with the reason and the command that creates it;
 *   - the file is there but malformed → `absent`, saying so, because showing half of a signed
 *     document is worse than showing none of it.
 */
export async function readAttestation(): Promise<DocumentResult<AttestationDocument>> {
  const file = path.join(process.cwd(), "public", "data", "attestation.json");

  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return absentAttestation(NO_ATTESTATION_PUBLISHED);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return absentAttestation(
      `${ATTESTATION_PATH} exists but is not valid JSON, so nothing here can be trusted. Re-run \`${ATTESTATION_COMMAND}\`.`,
    );
  }

  const result = attestationDocumentSchema.safeParse(parsed);
  if (!result.success) {
    return absentAttestation(
      `${ATTESTATION_PATH} exists but does not match the attestation schema, so it is not being displayed. Re-run \`${ATTESTATION_COMMAND}\`.`,
    );
  }
  return { status: "published", document: result.data };
}

/** The attestation as the API returns it — the same two states, in wire shape. */
export async function getAttestationStatus(): Promise<AttestationStatus> {
  const result = await readAttestation();
  if (result.status === "published") {
    return { status: "published", document: result.document };
  }
  return {
    status: "not_published",
    reason: result.reason,
    how_to_publish: result.howToPublish,
    expected_path: result.expectedPath,
    attestor_note: SIMULATED_ATTESTOR_NOTE,
  };
}

// --------------------------------------------------------------------------- HTTP helpers

/**
 * Public API caching. `s-maxage=60` matches PLAN.md D10 and the engine's once-a-day cadence:
 * a partner polling this endpoint hits the CDN, not a function. `stale-while-revalidate` keeps
 * the last good answer in front of readers while a refresh happens behind them.
 */
export const API_CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

const BASE_HEADERS: Record<string, string> = {
  "Cache-Control": API_CACHE_CONTROL,
  // These endpoints are the partner integration surface (BUILD_PROMPT.md section 8): public,
  // read-only, no credentials, so cross-origin reads are allowed on purpose.
  "Access-Control-Allow-Origin": "*",
};

/** `200 { ok: true, data }` with the public cache headers. */
export function jsonOk(data: unknown, status = 200): Response {
  return Response.json({ ok: true, data }, { status, headers: BASE_HEADERS });
}

/**
 * `jsonOk`, but the complete envelope is validated against the route's own response schema first.
 *
 * Validating on the way out is not ceremony: the documents are validated on the way in, but the
 * derived responses (`/api/stats`, `/api/events`) are assembled by hand from chain reads, and this
 * is what stops a `bigint`, an `undefined` or a renamed field reaching a partner's parser. A
 * response that fails its own schema is a 500 here rather than a puzzle there.
 */
export function jsonOkValidated<S extends z.ZodType>(
  schema: S,
  data: unknown,
  hint: string,
): Response {
  const result = schema.safeParse({ ok: true, data });
  if (!result.success) {
    return jsonError(
      "invalid_document",
      `the response failed its own schema before being sent: ${describeIssues(result.error)}`,
      hint,
      500,
    );
  }
  return Response.json(result.data, { status: 200, headers: BASE_HEADERS });
}

/**
 * `{ ok: false, error: { code, message, hint } }` — the one error shape every route returns.
 * Errors are not cached: a transient RPC failure must not be served for a minute.
 */
export function jsonError(
  code: ApiErrorCode,
  message: string,
  hint: string,
  status: number,
): Response {
  return Response.json(
    { ok: false, error: { code, message, hint } },
    { status, headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } },
  );
}

/** Turn an unexpected throw into the standard 500 without leaking a stack trace. */
export function jsonInternalError(error: unknown, hint: string): Response {
  const message = error instanceof Error ? error.message : "unexpected error";
  return jsonError("internal_error", message, hint, 500);
}
