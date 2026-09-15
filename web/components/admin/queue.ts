/**
 * The shapes and the signed authorisation the verification queue needs, shared by the browser and
 * the route that serves it.
 *
 * ## Why a rejection is signed
 *
 * Every other action on `/admin` is a transaction, and `AccessControl` on the deployed contract is
 * the thing that decides whether it lands. Hiding a button is a courtesy; the chain is the boundary.
 * A **rejection is different**: it closes a stored request off chain, and there is no contract in
 * the path to refuse a caller who should not be there. An unauthenticated endpoint that closes
 * other people's verification requests would be exactly the kind of gap a console like this is
 * supposed to make impossible.
 *
 * So a rejection carries an EIP-191 signature over the message built here, and the server checks
 * two things before it writes: that the signature recovers to the address that claims to have made
 * it, and that `IdentityRegistry.hasRole(REGISTRAR_ROLE, signer)` is true on the configured chain.
 * The authority is the same registry role the rest of the verification path runs on — read from the
 * chain, not from a list in this repository.
 *
 * The message is built in one function, used by both sides, because a client and a server that
 * disagree about a single space produce a signature that never verifies and an error message that
 * explains nothing.
 */

import type { VerificationRequestView } from "@/lib/server/verification";

/** One pending request, exactly as `/api/verify/status` reports one. */
export type AdminQueueEntry = VerificationRequestView;

export interface AdminQueueStorage {
  kind: "file" | "memory" | "remote";
  display: string;
  ephemeral: boolean;
  note: string;
}

export interface AdminQueueWorker {
  endpoint: "/api/verify/process";
  auto_approve_delay_ms: number;
  requires_secret: boolean;
  registrar: { status: "ready" | "unavailable"; address: string | null; reason: string | null };
}

/** `GET /admin/api/queue`. */
export interface AdminQueueData {
  fetched_at: string;
  chain_id: number;
  network: string;
  registry_address: string | null;
  /** Pending requests, oldest first. */
  pending: AdminQueueEntry[];
  /** How many rows sit in each status, across the whole store. */
  counts: { pending: number; approved: number; rejected: number; blocked: number };
  /** True when there are more pending rows than `limit`. */
  truncated: boolean;
  limit: number;
  storage: AdminQueueStorage;
  worker: AdminQueueWorker;
  notes: string[];
}

/** `POST /admin/api/queue`. */
export interface AdminRejectData {
  address: string;
  /** False when the row had already left `pending` — a late click, not an error. */
  rejected: boolean;
  reason: string;
  signer: string;
  note: string;
}

// --------------------------------------------------------------------------- the signed message

export const ADMIN_REJECT_ACTION = "reject-verification-request";

/** How long a signed rejection stays usable. Long enough to read the queue, short enough to expire. */
export const REJECT_MESSAGE_MAX_AGE_MS = 600_000;

/** Tolerance for a browser clock that runs ahead of the server's. */
export const REJECT_MESSAGE_CLOCK_SKEW_MS = 120_000;

export const REJECT_REASON_MIN_LENGTH = 4;
export const REJECT_REASON_MAX_LENGTH = 200;

export interface RejectAuthorization {
  /** The request being closed, EIP-55 checksummed. */
  readonly address: string;
  /** Why, in the operator's words. Stored on the row and shown on `/verify`. */
  readonly reason: string;
  /** The chain the registry whose role authorises this lives on. */
  readonly chainId: number;
  /** That registry's address, EIP-55 checksummed. */
  readonly registry: string;
  /** ISO 8601, milliseconds included. */
  readonly issuedAt: string;
}

/**
 * The exact string the wallet signs.
 *
 * Readable on purpose: a signature request that shows an opaque hash teaches people to sign opaque
 * hashes. Every field that the server will act on appears in it, so a signature captured for one
 * deployment cannot be replayed against another — the chain id and the registry address are in the
 * signed bytes and are re-checked against the server's own configuration.
 */
export function adminRejectMessage(auth: RejectAuthorization): string {
  return [
    "HitBite admin console",
    "",
    `Action: ${ADMIN_REJECT_ACTION}`,
    `Request address: ${auth.address}`,
    `Reason: ${auth.reason}`,
    `Chain id: ${auth.chainId}`,
    `Identity registry: ${auth.registry}`,
    `Issued at: ${auth.issuedAt}`,
    "",
    "This signature sends no transaction and moves no funds. It authorises the server to close the",
    "off-chain verification request named above. It expires ten minutes after it was issued.",
  ].join("\n");
}

export type RejectReasonProblem = "empty" | "too-short" | "too-long" | null;

export function checkRejectReason(reason: string): RejectReasonProblem {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return "empty";
  if (trimmed.length < REJECT_REASON_MIN_LENGTH) return "too-short";
  if (trimmed.length > REJECT_REASON_MAX_LENGTH) return "too-long";
  return null;
}

export function describeRejectReasonProblem(problem: RejectReasonProblem): string | null {
  switch (problem) {
    case "empty":
    case "too-short":
      return `A rejection is stored on the request and shown to the applicant on /verify, so it needs a reason of at least ${REJECT_REASON_MIN_LENGTH} characters.`;
    case "too-long":
      return `Keep the reason under ${REJECT_REASON_MAX_LENGTH} characters.`;
    default:
      return null;
  }
}

// --------------------------------------------------------------------------- small read helpers

/** Milliseconds until the worker will touch a pending request; 0 once it is due. */
export function dueInMs(entry: AdminQueueEntry, now: number): number {
  if (entry.auto_approve_at === null) return 0;
  return Math.max(0, Date.parse(entry.auto_approve_at) - now);
}

export function isDue(entry: AdminQueueEntry, now: number): boolean {
  return dueInMs(entry, now) === 0;
}
