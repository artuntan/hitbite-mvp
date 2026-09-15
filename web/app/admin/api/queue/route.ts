/**
 * `GET  /admin/api/queue` — the pending verification queue.
 * `POST /admin/api/queue` — reject one request, authorised by a signature from a REGISTRAR_ROLE holder.
 *
 *     curl -s http://localhost:3000/admin/api/queue | jq '.data.pending[] | {address, country}'
 *
 * ## Why this lives under `/admin` rather than under `/api`
 *
 * `/api/*` is the published, cacheable, cross-origin surface a partner integrates against
 * (PARTNER_INTEGRATION.md). This pair is neither: it is the console's own back end, same-origin,
 * never cached, and not part of the documented API. Keeping it beside the page it serves says so
 * without a paragraph of explanation, and leaves the public contract untouched.
 *
 * ## What GET exposes, and why that is acceptable
 *
 * A pending row is an address, an ISO 3166-1 numeric country code, an investor type and two
 * declarations. There is no name and no other personal data in it — the form does not collect one
 * and the table has no column for one (PLAN.md D59) — and every field becomes public on chain in
 * the `IdentityVerified` event the moment the request is approved. So the read is open, and the
 * page says plainly what it is showing. Closing it behind a signature would mean a console nobody
 * can demonstrate without a funded wallet, bought with privacy that this data does not have.
 *
 * ## Why POST is not
 *
 * Rejecting closes somebody else's request. Unlike every other action the console offers, there is
 * no contract in the path to refuse a caller who should not be there — so this route supplies the
 * missing boundary rather than pretending the UI is one. A rejection must carry an EIP-191
 * signature over `adminRejectMessage(...)`, and the signer must hold `REGISTRAR_ROLE` on the
 * `IdentityRegistry` deployed on the configured chain. That is the same role the registrar worker
 * signs `addVerified` with, read from the chain on every call rather than from a list here.
 *
 * The signed bytes carry the chain id, the registry address, the request address, the reason and
 * the issue time, so a signature cannot be moved to another deployment, applied to another request,
 * given another reason, or used tomorrow. Replaying it inside its ten-minute life is harmless:
 * `markRejected` only moves a row that is still `pending`, so the second attempt changes nothing
 * and is reported as changing nothing.
 */

import { getAddress, isAddress, verifyMessage, type Address, type Hex } from "viem";
import { z } from "zod";

import {
  adminRejectMessage,
  REJECT_MESSAGE_CLOCK_SKEW_MS,
  REJECT_MESSAGE_MAX_AGE_MS,
  REJECT_REASON_MAX_LENGTH,
  REJECT_REASON_MIN_LENGTH,
} from "@/components/admin/queue";
import { ACTIVE_CHAIN, ACTIVE_CHAIN_ID, getContractAddress, getPublicClient } from "@/lib/chains";
import { identityRegistryAbi } from "@/lib/generated/abis";
import { apiSuccessSchema, evmAddress } from "@/lib/schemas";
import { describeError, describeStorage, getWorkerAuthMode, redactSecrets } from "@/lib/server/env";
import { clientIp, errorResponse, jsonOk, readJsonBody, RequestError } from "@/lib/server/http";
import { createRateLimiter } from "@/lib/server/ratelimit";
import { defaultDeps } from "@/lib/server/registrar";
import { MAX_ATTEMPTS } from "@/lib/server/store";
import {
  storageViewSchema,
  toRequestView,
  verificationRequestViewSchema,
} from "@/lib/server/verification";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** How many pending rows one read returns. Beyond this the console says it is looking at a slice. */
const QUEUE_LIMIT = 50;

const QUEUE_PRIVACY_NOTE =
  "A queued request holds an address, a declared ISO 3166-1 numeric country code, an investor " +
  "type and two declarations, and nothing else: no name and no other personal data (PLAN.md D59). " +
  "Every one of those fields is emitted publicly on chain in IdentityVerified when the request is " +
  "approved.";

const CHAIN_IS_THE_RECORD =
  "This queue sits in front of the registry; the registry is the record. Rejecting a request here " +
  "sends no transaction and does not un-verify an address the chain already holds.";

const queueDataSchema = z.strictObject({
  fetched_at: z.string(),
  chain_id: z.number().int(),
  network: z.string(),
  registry_address: evmAddress.nullable(),
  pending: z.array(verificationRequestViewSchema),
  counts: z.strictObject({
    pending: z.number().int().nonnegative(),
    approved: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
  }),
  truncated: z.boolean(),
  limit: z.number().int().positive(),
  storage: storageViewSchema,
  worker: z.strictObject({
    endpoint: z.literal("/api/verify/process"),
    auto_approve_delay_ms: z.number().int().nonnegative(),
    requires_secret: z.boolean(),
    registrar: z.strictObject({
      status: z.enum(["ready", "unavailable"]),
      address: evmAddress.nullable(),
      reason: z.string().nullable(),
    }),
  }),
  notes: z.array(z.string()),
});

const queueResponseSchema = apiSuccessSchema(queueDataSchema);

const rejectResponseSchema = apiSuccessSchema(
  z.strictObject({
    address: evmAddress,
    rejected: z.boolean(),
    reason: z.string(),
    signer: evmAddress,
    note: z.string(),
  }),
);

/** Per-instance, per-IP. The read is cheap but it is a database round trip for anyone who asks. */
const reads = createRateLimiter({ limit: 60, windowMs: 60_000 });
/** Writes are signature-gated, so this only bounds the cost of checking bad signatures. */
const writes = createRateLimiter({ limit: 20, windowMs: 60_000 });

function throttle(
  limiter: ReturnType<typeof createRateLimiter>,
  request: Request,
  what: string,
): void {
  const decision = limiter.take(clientIp(request) ?? "unknown", Date.now());
  if (decision.allowed) return;
  throw RequestError.tooManyRequests(
    `more than ${decision.limit} ${what} from this address in ${decision.windowMs / 1000} seconds.`,
    `Wait ${Math.ceil(decision.retryAfterMs / 1000)} seconds and try again.`,
  );
}

// --------------------------------------------------------------------------- GET

export async function GET(request: Request): Promise<Response> {
  try {
    throttle(reads, request, "queue reads");

    const deps = defaultDeps();
    const [records, counts] = await Promise.all([
      // delayMs 0 and leaseMs 0: the console wants every pending row, not only the ones the worker
      // is willing to touch this second, and a row another invocation is mid-way through is still
      // worth showing — it is shown with its claim.
      deps.store.listDue({ now: deps.now, delayMs: 0, limit: QUEUE_LIMIT + 1, leaseMs: 0 }),
      deps.store.counts(),
    ]);

    const truncated = records.length > QUEUE_LIMIT;
    const pending = records
      .slice(0, QUEUE_LIMIT)
      .map((record) =>
        toRequestView(record, { now: deps.now, autoApproveDelayMs: deps.autoApproveDelayMs }),
      );

    const registrar = deps.chain.registrar();
    const storage = describeStorage();
    const notes: string[] = [QUEUE_PRIVACY_NOTE, CHAIN_IS_THE_RECORD];

    if (truncated) {
      notes.push(
        `More than ${QUEUE_LIMIT} requests are pending. This is the oldest ${QUEUE_LIMIT}; work through them and read again.`,
      );
    } else {
      // `listDue` excludes rows the worker has given up on, so the count and the list can disagree.
      // Saying so beats a console that silently hides the requests most in need of attention.
      const exhausted = counts.pending - pending.length;
      if (exhausted > 0) {
        notes.push(
          `${exhausted} pending request${exhausted === 1 ? " is" : "s are"} not listed: the worker has failed ${MAX_ATTEMPTS} times on ${exhausted === 1 ? "it" : "them"} and stopped retrying. Inspect the store directly, or have the applicant submit again.`,
        );
      }
    }

    if (storage.ephemeral) notes.push(storage.note);
    if (registrar.status !== "ready" && registrar.reason !== null) {
      notes.push(
        `The registrar key is not usable, so approving will not send anything: ${redactSecrets(registrar.reason)}`,
      );
    }

    return jsonOk(
      queueResponseSchema,
      {
        fetched_at: new Date(deps.now).toISOString(),
        chain_id: deps.chain.chainId,
        network: deps.chain.network,
        registry_address: deps.chain.registryAddress,
        pending,
        counts,
        truncated,
        limit: QUEUE_LIMIT,
        storage: {
          kind: storage.kind,
          display: storage.display,
          ephemeral: storage.ephemeral,
          note: storage.note,
        },
        worker: {
          endpoint: "/api/verify/process" as const,
          auto_approve_delay_ms: deps.autoApproveDelayMs,
          requires_secret: getWorkerAuthMode().mode !== "open",
          registrar: {
            status: registrar.status,
            address: registrar.address,
            reason: registrar.reason === null ? null : redactSecrets(registrar.reason),
          },
        },
        notes,
      },
      "The queue response did not match its own schema, which is a bug in app/admin/api/queue/route.ts.",
    );
  } catch (error) {
    return errorResponse(
      error,
      "Check DATABASE_URL (see .env.example). A chain that cannot be reached is reported inside the response, not as a 500.",
    );
  }
}

// --------------------------------------------------------------------------- POST

const rejectBodySchema = z.object({
  address: z.string(),
  reason: z.string(),
  issued_at: z.string(),
  signer: z.string(),
  signature: z.string(),
});

function address(value: string, field: string): Address {
  if (!isAddress(value, { strict: false })) {
    throw RequestError.badRequest(
      `"${field}" is not a 20-byte hex address.`,
      "Send it as 0x followed by 40 hex characters.",
    );
  }
  return getAddress(value);
}

export async function POST(request: Request): Promise<Response> {
  try {
    throttle(writes, request, "rejection attempts");

    const parsed = rejectBodySchema.safeParse(await readJsonBody(request, { maxBytes: 2_048 }));
    if (!parsed.success) {
      throw RequestError.badRequest(
        "a rejection needs address, reason, issued_at, signer and signature.",
        "Use the console, or rebuild the message with adminRejectMessage() from components/admin/queue.ts and sign it.",
      );
    }

    const target = address(parsed.data.address, "address");
    const signer = address(parsed.data.signer, "signer");
    const reason = parsed.data.reason.trim();

    if (reason.length < REJECT_REASON_MIN_LENGTH || reason.length > REJECT_REASON_MAX_LENGTH) {
      throw RequestError.badRequest(
        `"reason" must be between ${REJECT_REASON_MIN_LENGTH} and ${REJECT_REASON_MAX_LENGTH} characters.`,
        "The applicant reads this on /verify, so it has to say something.",
      );
    }

    const issuedAtMs = Date.parse(parsed.data.issued_at);
    if (Number.isNaN(issuedAtMs)) {
      throw RequestError.badRequest(
        '"issued_at" is not an ISO 8601 timestamp.',
        "Send new Date().toISOString().",
      );
    }
    const now = Date.now();
    if (issuedAtMs - now > REJECT_MESSAGE_CLOCK_SKEW_MS) {
      throw RequestError.unauthorized(
        "the signed authorisation is dated in the future.",
        "Check the clock on the machine that signed it.",
      );
    }
    if (now - issuedAtMs > REJECT_MESSAGE_MAX_AGE_MS) {
      throw RequestError.unauthorized(
        `the signed authorisation is older than ${REJECT_MESSAGE_MAX_AGE_MS / 60_000} minutes.`,
        "Sign the rejection again.",
      );
    }

    const registry = getContractAddress("IdentityRegistry", ACTIVE_CHAIN_ID);
    if (registry === null) {
      // Not the caller's mistake: there is no registry on this network to read the role from, so
      // the authority this route depends on does not exist. 503, and nothing is written.
      throw new RequestError(
        "chain_unavailable",
        503,
        `no IdentityRegistry deployment is recorded for ${ACTIVE_CHAIN.label}, so there is no REGISTRAR_ROLE to check a signature against and nothing here can be authorised.`,
        "Deploy the contracts and re-run `pnpm sync:contracts`.",
      );
    }

    const message = adminRejectMessage({
      address: target,
      reason,
      chainId: ACTIVE_CHAIN_ID,
      registry,
      issuedAt: parsed.data.issued_at,
    });

    let signatureValid = false;
    try {
      signatureValid = await verifyMessage({
        address: signer,
        message,
        signature: parsed.data.signature as Hex,
      });
    } catch (error) {
      throw RequestError.unauthorized(
        `the signature could not be checked: ${describeError(error)}`,
        "Send the 65-byte signature returned by personal_sign, as 0x-prefixed hex.",
      );
    }
    if (!signatureValid) {
      throw RequestError.unauthorized(
        "the signature does not recover to the address in `signer` for this exact message.",
        "The signed bytes carry the request address, the reason, the chain id, the registry address and the issue time. Change any of them and sign again.",
      );
    }

    // The boundary: the registry, read now, decides. Not a list in this repository, and not the UI.
    const client = getPublicClient(ACTIVE_CHAIN_ID);
    let holdsRole: boolean;
    try {
      const role = await client.readContract({
        address: registry,
        abi: identityRegistryAbi,
        functionName: "REGISTRAR_ROLE",
      });
      holdsRole = await client.readContract({
        address: registry,
        abi: identityRegistryAbi,
        functionName: "hasRole",
        args: [role, signer],
      });
    } catch (error) {
      throw new RequestError(
        "chain_unavailable",
        503,
        `the registry could not be asked whether ${signer} holds REGISTRAR_ROLE: ${describeError(error)}`,
        "Nothing was changed. Check the RPC URL and try again.",
      );
    }

    if (!holdsRole) {
      throw RequestError.unauthorized(
        `${signer} does not hold REGISTRAR_ROLE on the IdentityRegistry at ${registry}, so it cannot reject a verification request.`,
        "Connect the wallet the registrar role was granted to. The role is the authority here, exactly as it is for addVerified.",
      );
    }

    const deps = defaultDeps();
    const rejected = await deps.store.markRejected(target, reason, deps.now);

    return jsonOk(
      rejectResponseSchema,
      {
        address: target,
        rejected,
        reason,
        signer,
        note: rejected
          ? "The request is closed. No transaction was sent and the registry is unchanged."
          : "Nothing changed: the request had already left `pending` — approved, rejected or blocked by another operator or by the worker.",
      },
      "The rejection response did not match its own schema, which is a bug in app/admin/api/queue/route.ts.",
    );
  } catch (error) {
    return errorResponse(
      error,
      "Check DATABASE_URL and the RPC URL (see .env.example). Nothing was written unless the response says it was.",
    );
  }
}
