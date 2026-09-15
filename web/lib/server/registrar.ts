/**
 * The registrar worker (PLAN.md D8) and everything the three `/api/verify` routes do.
 *
 * `POST /api/verify` records a request. `POST /api/verify/process` is the worker: it approves
 * pending, non-blocked requests older than `AUTO_APPROVE_DELAY_MS` by calling `addVerified` with
 * `REGISTRAR_PRIVATE_KEY`. `GET /api/verify/status` reports where an address stands. There is no
 * long-running process anywhere: every call does a bounded amount of work and returns, which is
 * what makes it work on a serverless host and what makes a cron, the page's countdown and an
 * admin clicking "approve" all the same code path.
 *
 * ## The rules are re-decided here, on every path
 *
 * The form disables blocked countries and will not submit without the checkboxes. That is
 * courtesy, not enforcement — anyone can post to this API directly. So:
 *
 *   - **on submission**, the country is checked against the deployed registry, retail is refused
 *     (PLAN.md D21), and a missing attestation or consent is refused;
 *   - **again in the worker**, immediately before signing, because minutes may have passed and
 *     the admin may have blocked the country in between;
 *   - **and again on chain**, by `IdentityRegistry.addVerified`, which reverts `CountryBlocked`,
 *     `RetailNotAllowed` or `NotRegistrar` regardless of what this code believes.
 *
 * The third is the only one that is enforcement. The first two exist so the interface can explain
 * the refusal instead of showing a failed transaction.
 *
 * ## What an unauthenticated caller of the worker can do
 *
 * When `REGISTRAR_WORKER_SECRET` is unset, `POST /api/verify/process` is open. It can then:
 * advance requests that someone already submitted and that are already past their delay. It
 * cannot create a request, choose an address or a country, shorten the delay, approve a blocked
 * or retail request, approve more than `MAX_PER_CALL` rows in one call, or make the registrar
 * sign anything other than `addVerified(address, country, 1)` for a row that is already stored.
 * The route additionally rate-limits per instance. Set the secret and it is closed entirely.
 */

import type { Address } from "viem";

import { getCountryByNumeric, isSeedBlockedCountry, SEED_BLOCKED_CODES } from "../countries";

import type { AddVerifiedResult, RegistryGateway } from "./chain";
import { getRegistryGateway } from "./chain";
import { describeStorage, getAutoApproveDelayMs, getWorkerAuthMode, redactSecrets } from "./env";
import { getStore, MAX_ATTEMPTS, type Store } from "./store";
import {
  decideSubmission,
  isoUtc,
  parseSubmission,
  toRequestView,
  type ChainIdentityView,
  type CountryBlockVerdict,
  type ParsedSubmission,
  type VerificationRecord,
  type VerificationRequestView,
} from "./verification";

/** The most rows one `POST /api/verify/process` will touch. Bounds an open endpoint's cost. */
export const MAX_PER_CALL = 5;

const SIMULATED_REGISTRAR_NOTE =
  "Verification on this testnet is auto-approved by a simulated registrar after a short delay. " +
  "In production the licensed partner's KYC vendor writes to the same registry and the same rules " +
  "apply (COMPLIANCE_RULES.md section 9).";

const CHAIN_IS_THE_RECORD_NOTE =
  "The registry on chain is the record that matters. This store is a queue in front of it: if the " +
  "two ever disagree, believe the chain.";

export interface RegistrarDeps {
  readonly store: Store;
  readonly chain: RegistryGateway;
  /** Unix milliseconds. Injected so tests do not sleep and a request has one consistent clock. */
  readonly now: number;
  readonly autoApproveDelayMs: number;
}

/** The real dependencies: the process-wide store, the configured chain, and the wall clock. */
export function defaultDeps(): RegistrarDeps {
  return {
    store: getStore(),
    chain: getRegistryGateway(),
    now: Date.now(),
    autoApproveDelayMs: getAutoApproveDelayMs(),
  };
}

// --------------------------------------------------------------------------- shared views

function storageView(): {
  kind: "file" | "memory" | "remote";
  display: string;
  ephemeral: boolean;
  note: string;
} {
  const storage = describeStorage();
  return {
    kind: storage.kind,
    display: storage.display,
    ephemeral: storage.ephemeral,
    note: storage.note,
  };
}

function workerView(deps: RegistrarDeps): {
  endpoint: "/api/verify/process";
  auto_approve_delay_ms: number;
  requires_secret: boolean;
  registrar: { status: "ready" | "unavailable"; address: string | null; reason: string | null };
} {
  const registrar = deps.chain.registrar();
  return {
    endpoint: "/api/verify/process",
    auto_approve_delay_ms: deps.autoApproveDelayMs,
    requires_secret: getWorkerAuthMode().mode !== "open",
    registrar: {
      status: registrar.status,
      address: registrar.address,
      reason: registrar.reason === null ? null : redactSecrets(registrar.reason),
    },
  };
}

async function chainIdentityView(
  chain: RegistryGateway,
  address: Address,
): Promise<ChainIdentityView> {
  const result = await chain.identityOf(address);
  if (result.status === "unavailable" || chain.registryAddress === null) {
    return {
      status: "unavailable",
      chain_id: chain.chainId,
      network: chain.network,
      reason:
        result.status === "unavailable"
          ? result.reason
          : "no IdentityRegistry deployment is recorded for the configured chain.",
    };
  }
  const identity = result.identity;
  return {
    status: "ok",
    chain_id: chain.chainId,
    network: chain.network,
    registry_address: chain.registryAddress,
    is_verified: identity.verified,
    can_hold: identity.canHold,
    country: identity.country,
    country_name: getCountryByNumeric(identity.country)?.name ?? null,
    investor_type: identity.investorType,
    verified_at: identity.verifiedAt === null ? null : isoUtc(identity.verifiedAt * 1000),
  };
}

// --------------------------------------------------------------------------- the country check

/**
 * Ask the deployed registry whether a country is blocked, with the seed list as a floor.
 *
 * Two answers, and the difference is the whole point of reading from the chain:
 *
 *   - the registry answers → that answer decides, so a country the admin blocked yesterday is
 *     refused today without anyone editing a constant;
 *   - the registry cannot be reached → the codes it was deployed with (840, 792) still refuse.
 *
 * The floor can only ever refuse something the chain might have allowed. The opposite mistake —
 * queueing a request the contract will reject — is the one that would waste a user's time, and it
 * cannot happen here.
 */
export async function resolveCountryVerdict(
  chain: RegistryGateway,
  country: number,
): Promise<CountryBlockVerdict> {
  const seedBlocked = isSeedBlockedCountry(country);
  const onChain = await chain.isCountryBlocked(country);

  if (onChain.status === "ok") {
    if (onChain.blocked) return { blocked: true, source: "chain", reason: null };
    if (seedBlocked) {
      return {
        blocked: true,
        source: "seed",
        reason:
          `the deployed registry reports country ${country} as not blocked, but it is one of the codes ` +
          `this deployment is seeded with (${SEED_BLOCKED_CODES.join(", ")}). The request is refused ` +
          "on the stricter of the two answers.",
      };
    }
    return { blocked: false, source: "chain", reason: null };
  }

  return {
    blocked: seedBlocked,
    source: "seed",
    reason: onChain.reason,
  };
}

// --------------------------------------------------------------------------- submit

export interface SubmitPayload {
  request: VerificationRequestView;
  accepted: boolean;
  next_step: string;
  rule: "country_blocked" | "retail" | "no_attestation" | "no_consent" | null;
  country_blocklist_source: "chain" | "seed";
  chain: ChainIdentityView;
  storage: ReturnType<typeof storageView>;
  worker: ReturnType<typeof workerView>;
  notes: string[];
}

/**
 * Record a verification request (`POST /api/verify`).
 *
 * A malformed body throws `RequestError` and nothing is stored. A well-formed request that policy
 * refuses **is** stored, as `blocked` or `rejected`, so the page can show the reason and an
 * operator can see that it happened.
 */
export async function submitVerificationRequest(
  body: unknown,
  deps: RegistrarDeps,
): Promise<SubmitPayload> {
  const submission: ParsedSubmission = parseSubmission(body);
  const verdict = await resolveCountryVerdict(deps.chain, submission.country);
  const decision = decideSubmission(submission, verdict);

  const existing = await deps.store.get(submission.address);
  const record = await deps.store.submit({
    address: submission.address,
    country: submission.country,
    investorType: submission.investorType,
    attestation: submission.attestation,
    consent: submission.consent,
    status: decision.outcome,
    reason: decision.outcome === "pending" ? null : decision.reason,
    now: deps.now,
  });

  const chain = await chainIdentityView(deps.chain, submission.address);
  const alreadyApproved = existing?.status === "approved" && record.status === "approved";

  const notes = [SIMULATED_REGISTRAR_NOTE, CHAIN_IS_THE_RECORD_NOTE];
  if (verdict.reason) notes.push(verdict.reason);
  if (alreadyApproved && decision.outcome !== "pending") {
    notes.push(
      "This submission would have been refused, but the address is already verified on chain and " +
        "that record is not this endpoint's to undo. Use removeVerified from /admin to reverse it.",
    );
  }
  const storage = storageView();
  if (storage.ephemeral) notes.push(storage.note);

  return {
    request: toRequestView(record, {
      now: deps.now,
      autoApproveDelayMs: deps.autoApproveDelayMs,
    }),
    accepted: record.status === "pending",
    next_step: nextStep(record, deps, alreadyApproved),
    // The rule describes the row as it now stands. When an already-approved record survived this
    // submission, reporting the rule that would have refused it would contradict the status.
    rule: decision.outcome === "pending" || alreadyApproved ? null : decision.rule,
    country_blocklist_source: verdict.source,
    chain,
    storage,
    worker: workerView(deps),
    notes,
  };
}

function nextStep(
  record: VerificationRecord,
  deps: RegistrarDeps,
  alreadyApproved: boolean,
): string {
  switch (record.status) {
    case "pending":
      return (
        `Wait ${Math.max(0, record.createdAt + deps.autoApproveDelayMs - deps.now)} ms, then POST ` +
        "/api/verify/process (no body needed) to have the registrar approve it, or wait for the " +
        "cron to do the same. Poll GET /api/verify/status?address=… for the result."
      );
    case "approved":
      return alreadyApproved
        ? "This address is already verified on chain; the submission changed nothing. It can subscribe."
        : "This address is verified on chain and can subscribe.";
    case "blocked":
      return "This country cannot be verified. Nothing was sent on chain and nothing will be.";
    case "rejected":
      return "Fix what the reason names and submit again. Nothing was sent on chain.";
  }
}

// --------------------------------------------------------------------------- status

export interface StatusPayload {
  address: Address;
  status: "not_requested" | VerificationRecord["status"];
  source: "chain" | "store" | "none";
  request: VerificationRequestView | null;
  chain: ChainIdentityView;
  storage: ReturnType<typeof storageView>;
  worker: ReturnType<typeof workerView>;
  notes: string[];
}

/**
 * Where an address stands (`GET /api/verify/status`).
 *
 * The chain outranks the store. An address verified by the demo script, or by an admin, or by a
 * worker whose store was thrown away between invocations, reads as approved here even with no
 * stored row — because it is. `source` says which side the answer came from, so a caller can tell
 * "verified, and we have the request" from "verified, and we have no idea when".
 */
export async function getVerificationState(
  address: Address,
  deps: RegistrarDeps,
): Promise<StatusPayload> {
  const [record, chain] = await Promise.all([
    deps.store.get(address),
    chainIdentityView(deps.chain, address),
  ]);

  const chainSaysVerified = chain.status === "ok" && chain.is_verified && chain.can_hold;
  const status = chainSaysVerified ? "approved" : (record?.status ?? "not_requested");
  const source = chainSaysVerified ? "chain" : record ? "store" : "none";

  const notes = [SIMULATED_REGISTRAR_NOTE, CHAIN_IS_THE_RECORD_NOTE];
  if (chainSaysVerified && record && record.status !== "approved") {
    notes.push(
      `The registry reports this address as verified while the stored request is "${record.status}". ` +
        "The chain is authoritative and is what this response reports.",
    );
  }
  if (chain.status === "ok" && chain.is_verified && !chain.can_hold) {
    notes.push(
      "This address has a verification record but cannot hold hbTRS: its country is on the " +
        "registry's blocklist. Blocking a country does not delete existing records, it stops them " +
        "receiving tokens (COMPLIANCE_RULES.md section 1).",
    );
  }
  const storage = storageView();
  if (storage.ephemeral && record === null) notes.push(storage.note);

  return {
    address,
    status,
    source,
    request: record
      ? toRequestView(record, { now: deps.now, autoApproveDelayMs: deps.autoApproveDelayMs })
      : null,
    chain,
    storage,
    worker: workerView(deps),
    notes,
  };
}

// --------------------------------------------------------------------------- the worker

export type ProcessOutcome = "approved" | "blocked" | "rejected" | "deferred" | "skipped";

export interface ProcessedItem {
  address: Address;
  outcome: ProcessOutcome;
  reason: string;
  tx_hash: string | null;
}

export interface ProcessPayload {
  ran_at: string;
  due: number;
  max_per_call: number;
  processed: ProcessedItem[];
  summary: Record<"approved" | "blocked" | "rejected" | "deferred" | "skipped", number>;
  counts: Record<VerificationRecord["status"], number>;
  authenticated: boolean;
  storage: ReturnType<typeof storageView>;
  worker: ReturnType<typeof workerView>;
  notes: string[];
}

export interface ProcessOptions {
  /** Process only this address, if it is due. The page's countdown uses it. */
  readonly address?: Address | null;
  /** Cap on rows touched. Never above `MAX_PER_CALL`, whatever the caller asks for. */
  readonly maxPerCall?: number;
  /** Whether the caller presented the worker secret, for the response only. */
  readonly authenticated?: boolean;
}

/**
 * Approve every pending request that is due (`POST /api/verify/process`).
 *
 * Rows are handled one at a time, not in parallel: two `addVerified` transactions signed by the
 * same key in the same millisecond collide on the nonce, and one of them fails for no reason worth
 * explaining to anyone. Each row is claimed first, so two concurrent invocations of this function
 * — a cron and a page countdown, say — split the work instead of duplicating it.
 */
export async function processDueRequests(
  options: ProcessOptions,
  deps: RegistrarDeps,
): Promise<ProcessPayload> {
  const limit = Math.max(1, Math.min(options.maxPerCall ?? MAX_PER_CALL, MAX_PER_CALL));
  const processed: ProcessedItem[] = [];
  const notes = [SIMULATED_REGISTRAR_NOTE];

  const registrar = deps.chain.registrar();
  const due = await collectDue(options.address ?? null, limit, deps);

  if (registrar.status !== "ready") {
    notes.push(
      `Nothing was sent: ${redactSecrets(registrar.reason ?? "the registrar is not configured")} ` +
        "Requests stay pending and this endpoint is safe to call again once it is fixed.",
    );
    for (const record of due) {
      processed.push({
        address: record.address,
        outcome: "deferred",
        reason: "the registrar is not available; the request is still pending.",
        tx_hash: record.txHash,
      });
    }
    return assemble(processed, due.length, limit, options, deps, notes);
  }

  for (const record of due) {
    processed.push(await processOne(record, deps));
  }

  if (due.length === limit) {
    notes.push(
      `This call stopped at its cap of ${limit} requests. Call it again to continue; the work per ` +
        "call is bounded on purpose so that an unauthenticated caller cannot turn it into an " +
        "unbounded job.",
    );
  }
  const storage = storageView();
  if (storage.ephemeral) notes.push(storage.note);

  return assemble(processed, due.length, limit, options, deps, notes);
}

async function collectDue(
  address: Address | null,
  limit: number,
  deps: RegistrarDeps,
): Promise<VerificationRecord[]> {
  if (!address) {
    return deps.store.listDue({ now: deps.now, delayMs: deps.autoApproveDelayMs, limit });
  }
  const record = await deps.store.get(address);
  if (!record) return [];
  if (record.status !== "pending") return [];
  if (record.createdAt + deps.autoApproveDelayMs > deps.now) return [];
  if (record.attempts >= MAX_ATTEMPTS) return [];
  return [record];
}

async function processOne(record: VerificationRecord, deps: RegistrarDeps): Promise<ProcessedItem> {
  const claimed = await deps.store.claim(record.address, deps.now);
  if (!claimed) {
    return {
      address: record.address,
      outcome: "skipped",
      reason:
        "another invocation is already working on this request, or it stopped being pending " +
        "between listing it and claiming it.",
      tx_hash: record.txHash,
    };
  }

  // Re-check the country at signing time. Minutes can pass between submission and this call, and
  // `setCountryBlocked` is one transaction away.
  const verdict = await resolveCountryVerdict(deps.chain, record.country);
  if (verdict.blocked) {
    const country = getCountryByNumeric(record.country);
    const reason =
      `${country?.name ?? `Country ${record.country}`} is blocked by the registry, so addVerified ` +
      "would revert CountryBlocked. Nothing was sent.";
    await deps.store.markBlocked(record.address, reason, deps.now);
    return { address: record.address, outcome: "blocked", reason, tx_hash: null };
  }

  // Defensive: a row can only be pending if it passed these checks on submission, but the worker
  // is the thing that signs, so it does not take that on trust.
  const policyFailure = policyReason(record);
  if (policyFailure) {
    await deps.store.markRejected(record.address, policyFailure, deps.now);
    return { address: record.address, outcome: "rejected", reason: policyFailure, tx_hash: null };
  }

  // Already verified on chain? Then a previous call's transaction landed after we stopped
  // watching, or an admin did it by hand. Close the row out without sending anything.
  const identity = await deps.chain.identityOf(record.address);
  if (
    identity.status === "ok" &&
    identity.identity.verified &&
    identity.identity.country === record.country
  ) {
    const reason =
      "the registry already holds a matching verification record for this address, so no " +
      "transaction was needed.";
    await deps.store.markApproved(record.address, record.txHash, deps.now, reason);
    return { address: record.address, outcome: "approved", reason, tx_hash: record.txHash };
  }

  const result = await deps.chain.addVerified(record.address, record.country);
  return applyResult(record, result, deps);
}

function policyReason(record: VerificationRecord): string | null {
  if (record.investorType !== 1) {
    return `Investor type ${record.investorType} cannot be verified; only professional (1) can (PLAN.md D21).`;
  }
  if (!record.attestation) {
    return "The professional-investor attestation is not recorded on this request, so it cannot be approved.";
  }
  if (!record.consent) {
    return "Consent is not recorded on this request, so it cannot be approved.";
  }
  return null;
}

async function applyResult(
  record: VerificationRecord,
  result: AddVerifiedResult,
  deps: RegistrarDeps,
): Promise<ProcessedItem> {
  const address = record.address;

  switch (result.status) {
    case "confirmed": {
      const reason = `addVerified(${address}, ${record.country}, 1) is mined.`;
      await deps.store.markApproved(address, result.hash, deps.now, null);
      return { address, outcome: "approved", reason, tx_hash: result.hash };
    }

    case "reverted": {
      if (result.errorName === "CountryBlocked") {
        const reason = `The registry refused this country: addVerified reverted CountryBlocked(${record.country}).`;
        await deps.store.markBlocked(address, reason, deps.now);
        return { address, outcome: "blocked", reason, tx_hash: result.hash };
      }
      if (result.errorName === "RetailNotAllowed" || result.errorName === "InvalidInvestorType") {
        const reason = `The registry refused this investor type: addVerified reverted ${result.errorName}.`;
        await deps.store.markRejected(address, reason, deps.now);
        return { address, outcome: "rejected", reason, tx_hash: result.hash };
      }
      // Anything else — NotRegistrar, ZeroAddress, an undecodable revert — is an operational
      // fault, not the applicant's. It is retried, and it gives up after MAX_ATTEMPTS.
      return defer(record, result.reason, result.hash, deps);
    }

    case "sent":
      return defer(record, result.reason, result.hash, deps);

    case "unavailable":
      return defer(record, result.reason, null, deps);
  }
}

async function defer(
  record: VerificationRecord,
  reason: string,
  txHash: `0x${string}` | null,
  deps: RegistrarDeps,
): Promise<ProcessedItem> {
  const attempts = await deps.store.recordFailure({
    address: record.address,
    error: reason,
    now: deps.now,
    txHash,
  });

  if (attempts >= MAX_ATTEMPTS) {
    const giveUp =
      `The registrar could not verify this address after ${attempts} attempts and has stopped ` +
      `trying. Last failure: ${redactSecrets(reason)}`;
    await deps.store.markRejected(record.address, giveUp, deps.now);
    return { address: record.address, outcome: "rejected", reason: giveUp, tx_hash: txHash };
  }

  return {
    address: record.address,
    outcome: "deferred",
    reason: `${redactSecrets(reason)} Attempt ${attempts} of ${MAX_ATTEMPTS}; the request is still pending.`,
    tx_hash: txHash,
  };
}

async function assemble(
  processed: ProcessedItem[],
  due: number,
  limit: number,
  options: ProcessOptions,
  deps: RegistrarDeps,
  notes: string[],
): Promise<ProcessPayload> {
  const summary = { approved: 0, blocked: 0, rejected: 0, deferred: 0, skipped: 0 };
  for (const item of processed) summary[item.outcome] += 1;

  return {
    ran_at: isoUtc(deps.now),
    due,
    max_per_call: limit,
    processed,
    summary,
    counts: await deps.store.counts(),
    authenticated: options.authenticated ?? false,
    storage: storageView(),
    worker: workerView(deps),
    notes,
  };
}

// --------------------------------------------------------------------------- blocklist

export interface BlocklistPayload {
  source: "chain" | "seed";
  reason: string | null;
  chain_id: number;
  network: string;
  registry_address: string | null;
  count: number;
  blocked: { numeric: number; alpha2: string | null; name: string | null; reason: string | null }[];
  country_list_path: "web/lib/countries.json";
  notes: string[];
}

/**
 * The live blocklist (`GET /api/verify`), so a select can disable the right options rather than
 * the ones that were right on deployment day.
 *
 * Folded from the registry's own events. When that cannot be done the seed list is returned with
 * `source: "seed"` and the reason, never an empty list — an empty blocklist rendered as "every
 * country is fine" is the one failure mode worth designing against.
 */
export async function getBlocklistView(deps: RegistrarDeps): Promise<BlocklistPayload> {
  const result = await deps.chain.blockedCountries();
  const codes = result.status === "ok" ? [...result.codes] : [...SEED_BLOCKED_CODES];
  const merged = [...new Set([...codes, ...SEED_BLOCKED_CODES])].sort((a, b) => a - b);

  const notes = [
    "The registry's admin can change this list at any time with setCountryBlocked, so read it per " +
      "session rather than caching it in a build.",
    `Codes this deployment was seeded with (${SEED_BLOCKED_CODES.join(", ")}) are always included: ` +
      "the server refuses them even when the chain cannot be asked.",
  ];
  if (result.status === "ok" && merged.length !== result.codes.length) {
    notes.push(
      "One of the seeded codes is not blocked on chain right now; it is listed here anyway because " +
        "the server still refuses it.",
    );
  }

  return {
    source: result.status === "ok" ? "chain" : "seed",
    reason: result.status === "ok" ? null : result.reason,
    chain_id: deps.chain.chainId,
    network: deps.chain.network,
    registry_address: deps.chain.registryAddress,
    count: merged.length,
    blocked: merged.map((numeric) => {
      const country = getCountryByNumeric(numeric);
      return {
        numeric,
        alpha2: country?.alpha2 ?? null,
        name: country?.name ?? null,
        reason:
          country?.reason ??
          "Blocked by the registry's admin. Addresses registered to this country cannot be verified or hold hbTRS.",
      };
    }),
    country_list_path: "web/lib/countries.json",
    notes,
  };
}
