/**
 * The verification request: its shape, its statuses, and every reason the server refuses one.
 *
 * This module is the contract between `/verify`, the store and the registrar worker. It is pure —
 * zod, viem's address helpers and the committed country list, nothing else. No database, no chain
 * call, no environment variable, no secret.
 *
 * **It is therefore safe to import from a client component**, types and values alike: the schemas
 * here are the ones the page can validate a response against, and `VERIFICATION_STATUSES` is the
 * list it switches on. Its whole transitive graph is `lib/countries.ts`, `lib/schemas.ts` and
 * `lib/server/errors.ts`, which is asserted by a test rather than left as a promise. The modules
 * that must never cross into a bundle are `env.ts`, `store.ts` and `chain.ts`, and they say so
 * themselves by throwing on import if a `window` exists.
 *
 * ## What the server refuses, regardless of what the client sent
 *
 * The form on `/verify` disables a blocked country and will not submit without the two checkboxes.
 * None of that is a control: anyone can `curl` this endpoint. So every rule is re-decided here on
 * the server, and the ones that matter are re-decided *again* on chain by `IdentityRegistry`
 * (COMPLIANCE_RULES.md section 1), which is the only place a rule is actually enforced.
 *
 * Two kinds of "no", deliberately different:
 *
 *   - **A malformed request is HTTP 400** with `ok: false`. A missing field, a country code that
 *     is not ISO 3166-1, an investor type that is neither 1 nor 2, an address that fails its
 *     checksum: the caller has a bug, and nothing is recorded.
 *   - **A refused request is HTTP 200** with `ok: true` and a recorded status of `blocked` or
 *     `rejected`. A blocked country, a retail investor (PLAN.md D21), an unticked attestation or
 *     consent: the request is well formed, the answer is no, and the answer is stored so the page
 *     can show it and an operator can see it. Following PLAN.md D51 — a legitimate state of the
 *     system is a state, not a transport error.
 */

import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";

import {
  describeCountry,
  getCountryByNumeric,
  isCountryCodeInContractRange,
  isKnownCountryCode,
  seedBlockedReason,
} from "../countries";
import { apiSuccessSchema, evmAddress } from "../schemas";

import { RequestError } from "./errors";

// --------------------------------------------------------------------------- statuses

/**
 * Every state a stored request can be in.
 *
 *   pending   recorded, waiting for the worker (or an admin) to act
 *   approved  `addVerified` landed on chain; `tx_hash` is the receipt
 *   rejected  refused by policy — retail, or a missing attestation or consent
 *   blocked   refused because the country is on the registry's blocklist
 *
 * `blocked` is kept separate from `rejected` because the two need different words in the UI and
 * have different fixes: a blocked country is final for that country, a rejection is often the
 * user having missed a checkbox.
 */
export const VERIFICATION_STATUSES = ["pending", "approved", "rejected", "blocked"] as const;
export const verificationStatusSchema = z.enum(VERIFICATION_STATUSES);
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** `IdentityRegistry.INVESTOR_PROFESSIONAL` — the only type that can be verified (PLAN.md D21). */
export const INVESTOR_PROFESSIONAL = 1;
/** `IdentityRegistry.INVESTOR_RETAIL` — stored for a later phase; no path can write it today. */
export const INVESTOR_RETAIL = 2;

export function investorTypeLabel(investorType: number): string {
  if (investorType === INVESTOR_PROFESSIONAL) return "professional";
  if (investorType === INVESTOR_RETAIL) return "retail";
  return `unknown (${investorType})`;
}

// --------------------------------------------------------------------------- the stored record

/** A row of `verification_requests`, in the shape the rest of the server works with. */
export interface VerificationRecord {
  /** EIP-55 checksummed. */
  readonly address: Address;
  /** ISO 3166-1 numeric, 1..999. */
  readonly country: number;
  readonly investorType: number;
  /** The professional-investor attestation checkbox, as submitted. */
  readonly attestation: boolean;
  /** The consent checkbox, as submitted. */
  readonly consent: boolean;
  readonly status: VerificationStatus;
  /** Why it is in this status, in a sentence fit to render. `null` while pending. */
  readonly reason: string | null;
  /** The `addVerified` transaction, once there is one. */
  readonly txHash: `0x${string}` | null;
  /** How many times the worker has tried and failed to send the transaction. */
  readonly attempts: number;
  /** The last failure, redacted. Diagnostic only; never a reason to show a user on its own. */
  readonly lastError: string | null;
  /** Unix milliseconds. `createdAt` restarts when an address resubmits. */
  readonly createdAt: number;
  readonly updatedAt: number;
  /** When it left `pending`. */
  readonly decidedAt: number | null;
  /** Worker lease: set while an invocation is sending a transaction for this row. */
  readonly claimedAt: number | null;
}

/** What `submit` hands the store. */
export interface NewVerificationRequest {
  readonly address: Address;
  readonly country: number;
  readonly investorType: number;
  readonly attestation: boolean;
  readonly consent: boolean;
  readonly status: VerificationStatus;
  readonly reason: string | null;
  readonly now: number;
}

// --------------------------------------------------------------------------- input parsing

/**
 * The accepted request body.
 *
 * Canonical field names are snake_case, matching the JSON this API returns. camelCase aliases are
 * accepted too, because `wagmi` and React code is camelCase and a 400 over a field name would be
 * a stupid way to fail. Unknown fields are **dropped, not rejected**: BUILD_PROMPT.md 7.2 lists a
 * name field on the form, and a testnet demonstration storing people's names is a liability with
 * no benefit, so no name is stored, no column exists for one, and sending one is simply ignored.
 */
const rawSubmissionSchema = z.object({
  address: z.unknown(),
  country: z.unknown(),
  investor_type: z.unknown().optional(),
  investorType: z.unknown().optional(),
  professional_attestation: z.unknown().optional(),
  professionalAttestation: z.unknown().optional(),
  attestation: z.unknown().optional(),
  consent: z.unknown().optional(),
});

export interface ParsedSubmission {
  readonly address: Address;
  readonly country: number;
  readonly investorType: number;
  readonly attestation: boolean;
  readonly consent: boolean;
}

function firstDefined(...values: readonly unknown[]): unknown {
  for (const value of values) if (value !== undefined) return value;
  return undefined;
}

function requireBoolean(value: unknown, field: string, meaning: string): boolean {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) {
    throw RequestError.badRequest(
      `\`${field}\` is required.`,
      `Send \`${field}: true\` or \`${field}: false\`. It records ${meaning}, so it cannot be left out.`,
    );
  }
  throw RequestError.badRequest(
    `\`${field}\` must be a JSON boolean, not ${typeof value}.`,
    'Send true or false, not "true".',
  );
}

/**
 * Parse an address strictly enough to be useful and loosely enough to be usable.
 *
 * `isAddress` with viem's default `strict: true` accepts an all-lowercase address (no checksum
 * information to check) and rejects a mixed-case one whose EIP-55 checksum is wrong — which is
 * exactly the case that catches a typo. Whatever comes in, the checksummed form is what is stored
 * and what is sent to `addVerified`, so the store has one row per address and not two.
 */
export function normaliseAddress(value: unknown, field = "address"): Address {
  if (typeof value !== "string" || value.trim() === "") {
    throw RequestError.badRequest(
      `\`${field}\` is required and must be a string.`,
      "Send the connected wallet address, 0x followed by 40 hex characters.",
    );
  }
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    throw RequestError.badRequest(
      `\`${field}\` is not an Ethereum address.`,
      "An address is 0x followed by exactly 40 hexadecimal characters.",
    );
  }
  if (!isAddress(trimmed)) {
    throw RequestError.badRequest(
      `\`${field}\` has the right length but fails its EIP-55 checksum, so it is probably mistyped.`,
      "Send the address exactly as the wallet reports it, or send it all lower case.",
    );
  }
  return getAddress(trimmed);
}

function parseCountry(value: unknown): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d{1,3}$/.test(value.trim())
        ? Number(value.trim())
        : null;

  if (numeric === null || !Number.isInteger(numeric)) {
    throw RequestError.badRequest(
      "`country` must be an ISO 3166-1 numeric code.",
      'Send the number, e.g. 276 for Germany — not "DE" and not "Germany".',
    );
  }
  if (!isCountryCodeInContractRange(numeric)) {
    throw RequestError.badRequest(
      `\`country\` ${numeric} is outside the 1..999 range the registry accepts.`,
      "IdentityRegistry rejects 0 and anything above 999, because an unset country would otherwise slip past the blocklist.",
    );
  }
  if (!isKnownCountryCode(numeric)) {
    throw RequestError.badRequest(
      `\`country\` ${numeric} is not an ISO 3166-1 numeric code.`,
      "Pick a code from web/lib/countries.json, which is the list the select renders.",
    );
  }
  return numeric;
}

function parseInvestorType(value: unknown): number {
  // Absent means professional: the form on /verify has an attestation checkbox, not a type
  // selector, so a client that never mentions the field is declaring the only type phase one
  // allows. A client that does mention it must send 1 or 2 and nothing else.
  if (value === undefined || value === null) return INVESTOR_PROFESSIONAL;

  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : null;

  if (numeric === null || !Number.isInteger(numeric)) {
    throw RequestError.badRequest(
      "`investor_type` must be a number.",
      `${INVESTOR_PROFESSIONAL} is professional, ${INVESTOR_RETAIL} is retail. Omit the field to declare professional.`,
    );
  }
  if (numeric !== INVESTOR_PROFESSIONAL && numeric !== INVESTOR_RETAIL) {
    throw RequestError.badRequest(
      `\`investor_type\` ${numeric} is not a type the registry knows.`,
      `Only ${INVESTOR_PROFESSIONAL} (professional) and ${INVESTOR_RETAIL} (retail) exist; addVerified reverts InvalidInvestorType for anything else.`,
    );
  }
  return numeric;
}

/** Parse a `POST /api/verify` body, or throw a `RequestError` carrying its own 400. */
export function parseSubmission(body: unknown): ParsedSubmission {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw RequestError.badRequest(
      "the request body must be a JSON object.",
      'Send { "address": "0x…", "country": 276, "professional_attestation": true, "consent": true }.',
    );
  }

  const parsed = rawSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    throw RequestError.badRequest(
      "the request body could not be read as a verification request.",
      'Send { "address": "0x…", "country": 276, "professional_attestation": true, "consent": true }.',
    );
  }
  const raw = parsed.data;

  return {
    address: normaliseAddress(raw.address),
    country: parseCountry(raw.country),
    investorType: parseInvestorType(firstDefined(raw.investor_type, raw.investorType)),
    attestation: requireBoolean(
      firstDefined(raw.professional_attestation, raw.professionalAttestation, raw.attestation),
      "professional_attestation",
      "the declaration that the applicant is a professional investor",
    ),
    consent: requireBoolean(
      raw.consent,
      "consent",
      "consent to the processing of the request and to the testnet terms shown on the form",
    ),
  };
}

/** Parse the `?address=` of `GET /api/verify/status`. */
export function parseAddressParam(url: string): Address {
  const raw = new URL(url).searchParams.get("address");
  if (raw === null || raw.trim() === "") {
    throw RequestError.badRequest(
      "`address` is required.",
      "Call /api/verify/status?address=0x… with the connected wallet address.",
    );
  }
  return normaliseAddress(raw, "address");
}

// --------------------------------------------------------------------------- the decision

/** Why a submission was refused, or that it was not. */
export type SubmissionDecision =
  | { readonly outcome: "pending" }
  | {
      readonly outcome: "blocked" | "rejected";
      readonly reason: string;
      /** Which rule said no, for tests and for the admin queue. */
      readonly rule: "country_blocked" | "retail" | "no_attestation" | "no_consent";
    };

/** What the chain said about the submitted country, and whether it could be asked. */
export interface CountryBlockVerdict {
  readonly blocked: boolean;
  /** `chain` — the deployed registry answered. `seed` — it did not, and the seed list decided. */
  readonly source: "chain" | "seed";
  /** Present when the chain could not be asked. */
  readonly reason: string | null;
}

/**
 * Decide a parsed submission, given what the chain says about the country.
 *
 * Order matters and is deliberate: the country is checked first, so a retail applicant from a
 * blocked country is recorded as `blocked` rather than `rejected`. The country is the rule that
 * cannot be fixed by ticking a box.
 */
export function decideSubmission(
  submission: ParsedSubmission,
  verdict: CountryBlockVerdict,
): SubmissionDecision {
  if (verdict.blocked) {
    const country = getCountryByNumeric(submission.country);
    const explanation =
      seedBlockedReason(submission.country) ??
      "The registry's admin has blocked this country, so no address registered to it can be verified or hold hbTRS.";
    const attribution =
      verdict.source === "chain"
        ? "The deployed IdentityRegistry reports this country as blocked."
        : `The chain could not be asked (${verdict.reason ?? "no deployment"}), and this country is on the blocklist the registry is deployed with, so the request is refused rather than queued.`;
    return {
      outcome: "blocked",
      rule: "country_blocked",
      reason: `${country?.name ?? describeCountry(submission.country)}: ${explanation} ${attribution}`,
    };
  }

  if (submission.investorType === INVESTOR_RETAIL) {
    return {
      outcome: "rejected",
      rule: "retail",
      reason:
        "Only professional investors can be verified in phase one. addVerified reverts RetailNotAllowed for investor type 2, so this request cannot be fulfilled on chain (PLAN.md D21, COMPLIANCE_RULES.md section 1).",
    };
  }

  if (!submission.attestation) {
    return {
      outcome: "rejected",
      rule: "no_attestation",
      reason:
        "The professional-investor attestation was not given. Verification requires the applicant to declare, on the form, that they are a professional investor.",
    };
  }

  if (!submission.consent) {
    return {
      outcome: "rejected",
      rule: "no_consent",
      reason:
        "Consent was not given. The request cannot be processed without it, and nothing is sent on chain.",
    };
  }

  return { outcome: "pending" };
}

// --------------------------------------------------------------------------- wire shapes

/** `2026-09-15T08:30:00Z` — second precision, UTC, the same format the NAV engine writes. */
export function isoUtc(unixMs: number): string {
  return new Date(unixMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export const verificationRequestViewSchema = z.strictObject({
  address: evmAddress,
  country: z.number().int(),
  country_name: z.string().nullable(),
  country_alpha2: z.string().nullable(),
  investor_type: z.number().int(),
  investor_type_label: z.string(),
  professional_attestation: z.boolean(),
  consent: z.boolean(),
  status: verificationStatusSchema,
  reason: z.string().nullable(),
  tx_hash: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  submitted_at: z.string(),
  updated_at: z.string(),
  decided_at: z.string().nullable(),
  /** When the worker becomes willing to approve it. `null` unless pending. */
  auto_approve_at: z.string().nullable(),
  /** Milliseconds until then, floored at 0. `null` unless pending — for the countdown. */
  auto_approve_in_ms: z.number().int().nullable(),
});
export type VerificationRequestView = z.infer<typeof verificationRequestViewSchema>;

export function toRequestView(
  record: VerificationRecord,
  options: { readonly now: number; readonly autoApproveDelayMs: number },
): VerificationRequestView {
  const country = getCountryByNumeric(record.country);
  const dueAt = record.createdAt + options.autoApproveDelayMs;
  const pending = record.status === "pending";

  return {
    address: record.address,
    country: record.country,
    country_name: country?.name ?? null,
    country_alpha2: country?.alpha2 ?? null,
    investor_type: record.investorType,
    investor_type_label: investorTypeLabel(record.investorType),
    professional_attestation: record.attestation,
    consent: record.consent,
    status: record.status,
    reason: record.reason,
    tx_hash: record.txHash,
    attempts: record.attempts,
    submitted_at: isoUtc(record.createdAt),
    updated_at: isoUtc(record.updatedAt),
    decided_at: record.decidedAt === null ? null : isoUtc(record.decidedAt),
    auto_approve_at: pending ? isoUtc(dueAt) : null,
    auto_approve_in_ms: pending ? Math.max(0, dueAt - options.now) : null,
  };
}

/** What the registry says about an address right now. */
export const chainIdentitySchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ok"),
    chain_id: z.number().int(),
    network: z.string(),
    registry_address: evmAddress,
    is_verified: z.boolean(),
    /** `isVerified && !blocked(country)` — the only question HBToken asks. */
    can_hold: z.boolean(),
    country: z.number().int(),
    country_name: z.string().nullable(),
    investor_type: z.number().int(),
    verified_at: z.string().nullable(),
  }),
  z.strictObject({
    status: z.literal("unavailable"),
    chain_id: z.number().int(),
    network: z.string(),
    reason: z.string(),
  }),
]);
export type ChainIdentityView = z.infer<typeof chainIdentitySchema>;

export const storageViewSchema = z.strictObject({
  kind: z.enum(["file", "memory", "remote"]),
  display: z.string(),
  ephemeral: z.boolean(),
  note: z.string(),
});

export const workerViewSchema = z.strictObject({
  endpoint: z.literal("/api/verify/process"),
  auto_approve_delay_ms: z.number().int().nonnegative(),
  /** True when `REGISTRAR_WORKER_SECRET` is configured and the endpoint requires it. */
  requires_secret: z.boolean(),
  /** Whether a registrar key is configured, in words, without revealing anything about it. */
  registrar: z.strictObject({
    status: z.enum(["ready", "unavailable"]),
    /** The registrar's public address when it is ready — it is on chain already. */
    address: evmAddress.nullable(),
    reason: z.string().nullable(),
  }),
});

// --------------------------------------------------------------------------- responses

export const submitResponseSchema = apiSuccessSchema(
  z.strictObject({
    request: verificationRequestViewSchema,
    /** True when the request was recorded as pending and the worker will act on it. */
    accepted: z.boolean(),
    /** What the caller should do next, in one sentence. */
    next_step: z.string(),
    /** Which rule refused it, when one did. */
    rule: z.enum(["country_blocked", "retail", "no_attestation", "no_consent"]).nullable(),
    country_blocklist_source: z.enum(["chain", "seed"]),
    chain: chainIdentitySchema,
    storage: storageViewSchema,
    worker: workerViewSchema,
    notes: z.array(z.string()),
  }),
);

export const statusResponseSchema = apiSuccessSchema(
  z.strictObject({
    address: evmAddress,
    /**
     * The state the UI should render. `not_requested` means this address has no stored request;
     * the chain can still say it is verified, which is why `source` is here too.
     */
    status: z.enum(["not_requested", ...VERIFICATION_STATUSES]),
    /** `chain` when the registry's answer overruled the store, which it does when they differ. */
    source: z.enum(["chain", "store", "none"]),
    request: verificationRequestViewSchema.nullable(),
    chain: chainIdentitySchema,
    storage: storageViewSchema,
    worker: workerViewSchema,
    notes: z.array(z.string()),
  }),
);

export const processedItemSchema = z.strictObject({
  address: evmAddress,
  outcome: z.enum(["approved", "blocked", "rejected", "deferred", "skipped"]),
  reason: z.string(),
  tx_hash: z.string().nullable(),
});

export const processResponseSchema = apiSuccessSchema(
  z.strictObject({
    ran_at: z.string(),
    /** How many due requests this call looked at, before the per-call cap. */
    due: z.number().int().nonnegative(),
    /** The cap. Work per call is bounded so an open endpoint cannot be turned into a queue drain. */
    max_per_call: z.number().int().positive(),
    processed: z.array(processedItemSchema),
    summary: z.strictObject({
      approved: z.number().int().nonnegative(),
      blocked: z.number().int().nonnegative(),
      rejected: z.number().int().nonnegative(),
      deferred: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
    }),
    /** Rows still waiting, by status, after this call. */
    counts: z.record(verificationStatusSchema, z.number().int().nonnegative()),
    authenticated: z.boolean(),
    storage: storageViewSchema,
    worker: workerViewSchema,
    notes: z.array(z.string()),
  }),
);

export const blocklistResponseSchema = apiSuccessSchema(
  z.strictObject({
    /** `chain` when the deployed registry answered; `seed` when it could not be asked. */
    source: z.enum(["chain", "seed"]),
    reason: z.string().nullable(),
    chain_id: z.number().int(),
    network: z.string(),
    registry_address: evmAddress.nullable(),
    count: z.number().int().nonnegative(),
    blocked: z.array(
      z.strictObject({
        numeric: z.number().int(),
        alpha2: z.string().nullable(),
        name: z.string().nullable(),
        reason: z.string().nullable(),
      }),
    ),
    /** Every country, so a select can be rendered from one response if the caller prefers. */
    country_list_path: z.literal("web/lib/countries.json"),
    notes: z.array(z.string()),
  }),
);
