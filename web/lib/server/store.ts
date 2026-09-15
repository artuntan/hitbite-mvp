/**
 * The verification request store (PLAN.md D7).
 *
 * `@libsql/client` behind a small `Store` interface. `DATABASE_URL` defaults to
 * `file:./.data/hitbite.db`, which is right for local work, CI and Docker; on Vercel that file
 * lives inside one serverless instance and is discarded with it, so a Turso `libsql://` URL is
 * what makes the queue survive. `describeStorage()` in `env.ts` says which of those is in force
 * and every response carries the sentence. Nothing here pretends a file on Vercel persists.
 *
 * ## Why the interface exists
 *
 * `Store` is four reads and five writes. Keeping the surface that small means `/admin` in Phase 9
 * and a Turso deployment both work against the same thing, and the worker's decision logic can be
 * tested against a real database rather than a mock, because a real one is `:memory:` and costs a
 * millisecond.
 *
 * ## Concurrency
 *
 * `POST /api/verify/process` is serverless and can run twice at once — a page's countdown and a
 * cron, for instance. Two invocations sending `addVerified` for the same address at the same time
 * would collide on the registrar's nonce and one would fail for no good reason. So a worker
 * *claims* a row before it sends anything: `claim()` is a conditional `UPDATE … WHERE status =
 * 'pending' AND (claimed_at IS NULL OR claimed_at <= ?)`, and SQLite's single writer makes that
 * atomic. The claim is a lease, not a lock — it expires after `CLAIM_LEASE_MS` — so an invocation
 * that is killed mid-flight strands a row for a minute rather than forever.
 *
 * Every state change is likewise conditional on the row still being `pending`, so a late second
 * worker cannot approve something an admin has just rejected.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";

import { createClient, type Client, type Row } from "@libsql/client";

import {
  assertServerOnly,
  describeError,
  getDatabaseAuthToken,
  getDatabaseUrl,
  redactSecrets,
} from "./env";
import {
  VERIFICATION_STATUSES,
  type NewVerificationRequest,
  type VerificationRecord,
  type VerificationStatus,
} from "./verification";

assertServerOnly("lib/server/store.ts");

/** How long a worker's claim on a row is honoured before another worker may take it. */
export const CLAIM_LEASE_MS = 60_000;

/**
 * How many times the worker will try and fail to send `addVerified` before giving up on a row.
 * Without a ceiling, an RPC outage would turn into an unbounded retry loop across every cron tick.
 */
export const MAX_ATTEMPTS = 5;

/** Bumped only when the schema changes in a way `CREATE TABLE IF NOT EXISTS` cannot express. */
export const SCHEMA_VERSION = 1;

const TABLE = "verification_requests";

/** How many rows sit in each status. Every status is always present, including zeros. */
export type StatusCounts = Record<VerificationStatus, number>;

export interface Store {
  /** Run the migration. Idempotent, safe to call concurrently, memoised per client. */
  init(): Promise<void>;

  get(address: string): Promise<VerificationRecord | null>;

  /**
   * Record a submission. Overwrites any existing row for the address **unless** that row is
   * `approved`, which is left alone: an address that is already verified on chain does not get
   * un-verified by someone posting the form again. Returns the row as it now stands.
   */
  submit(request: NewVerificationRequest): Promise<VerificationRecord>;

  /** Pending rows older than `delayMs`, unclaimed (or with an expired claim), oldest first. */
  listDue(options: {
    now: number;
    delayMs: number;
    limit: number;
    leaseMs?: number;
  }): Promise<VerificationRecord[]>;

  /** Take the lease on a pending row. False when another worker got there first. */
  claim(address: string, now: number, leaseMs?: number): Promise<boolean>;

  /** pending → approved. False when the row moved underneath us. */
  markApproved(
    address: string,
    txHash: `0x${string}` | null,
    now: number,
    reason?: string | null,
  ): Promise<boolean>;

  /** pending → rejected. */
  markRejected(address: string, reason: string, now: number): Promise<boolean>;

  /** pending → blocked. */
  markBlocked(address: string, reason: string, now: number): Promise<boolean>;

  /**
   * A failed attempt: increments `attempts`, releases the claim, keeps the row pending, and
   * records the redacted error. Returns the new attempt count.
   */
  recordFailure(options: {
    address: string;
    error: string;
    now: number;
    txHash?: `0x${string}` | null;
  }): Promise<number>;

  counts(): Promise<StatusCounts>;

  /** Release resources. Tests call it; route handlers do not — the client is process-wide. */
  close(): Promise<void>;
}

// --------------------------------------------------------------------------- migration

const STATUS_LIST = VERIFICATION_STATUSES.map((status) => `'${status}'`).join(", ");

/**
 * Migration 1. Every statement is `IF NOT EXISTS`, so a half-applied migration converges on the
 * next call instead of needing a repair, and two instances racing on a cold start both succeed.
 *
 * `address` is the primary key and is stored EIP-55 checksummed, with `COLLATE NOCASE` so that a
 * caller who lower-cases it cannot create a second row for the same wallet. The `CHECK`
 * constraints put the status enum and the registry's 1..999 country range in the database itself:
 * a bug in application code then produces a failed write rather than a row nothing can interpret.
 */
const MIGRATIONS: readonly (readonly string[])[] = [
  [
    `CREATE TABLE IF NOT EXISTS ${TABLE} (
       address       TEXT    PRIMARY KEY COLLATE NOCASE,
       country       INTEGER NOT NULL CHECK (country BETWEEN 1 AND 999),
       investor_type INTEGER NOT NULL CHECK (investor_type BETWEEN 0 AND 255),
       attestation   INTEGER NOT NULL CHECK (attestation IN (0, 1)),
       consent       INTEGER NOT NULL CHECK (consent IN (0, 1)),
       status        TEXT    NOT NULL CHECK (status IN (${STATUS_LIST})),
       reason        TEXT,
       tx_hash       TEXT,
       attempts      INTEGER NOT NULL DEFAULT 0,
       last_error    TEXT,
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       decided_at    INTEGER,
       claimed_at    INTEGER
     )`,
    `CREATE INDEX IF NOT EXISTS idx_${TABLE}_status_created ON ${TABLE} (status, created_at)`,
  ],
];

const SCHEMA_TABLE_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
   version    INTEGER PRIMARY KEY,
   applied_at INTEGER NOT NULL
 )`;

// --------------------------------------------------------------------------- row mapping

function asNumber(value: unknown, field: string): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  throw new Error(`${TABLE}.${field} is not a number`);
}

function asNullableNumber(value: unknown, field: string): number | null {
  return value === null || value === undefined ? null : asNumber(value, field);
}

function asString(value: unknown, field: string): string {
  if (typeof value === "string") return value;
  throw new Error(`${TABLE}.${field} is not text`);
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isStatus(value: string): value is VerificationStatus {
  return (VERIFICATION_STATUSES as readonly string[]).includes(value);
}

function toRecord(row: Row): VerificationRecord {
  const status = asString(row.status, "status");
  if (!isStatus(status)) {
    throw new Error(`${TABLE}.status holds "${status}", which is not one of ${STATUS_LIST}`);
  }
  const txHash = asNullableString(row.tx_hash);

  return {
    address: asString(row.address, "address") as `0x${string}`,
    country: asNumber(row.country, "country"),
    investorType: asNumber(row.investor_type, "investor_type"),
    attestation: asNumber(row.attestation, "attestation") === 1,
    consent: asNumber(row.consent, "consent") === 1,
    status,
    reason: asNullableString(row.reason),
    txHash: txHash === null ? null : (txHash as `0x${string}`),
    attempts: asNumber(row.attempts, "attempts"),
    lastError: asNullableString(row.last_error),
    createdAt: asNumber(row.created_at, "created_at"),
    updatedAt: asNumber(row.updated_at, "updated_at"),
    decidedAt: asNullableNumber(row.decided_at, "decided_at"),
    claimedAt: asNullableNumber(row.claimed_at, "claimed_at"),
  };
}

// --------------------------------------------------------------------------- the libsql store

class LibsqlStore implements Store {
  private readonly client: Client;
  private migration: Promise<void> | null = null;

  constructor(client: Client) {
    this.client = client;
  }

  async init(): Promise<void> {
    // Memoised, not guarded by a boolean: two concurrent first requests must await the same
    // promise, not race two migrations and one of them return early on a half-built schema.
    this.migration ??= this.runMigrations();
    try {
      await this.migration;
    } catch (error) {
      // A failed migration must be retryable: a transient "database is locked" on a cold start
      // should not poison the process for as long as it lives.
      this.migration = null;
      throw error;
    }
  }

  private async runMigrations(): Promise<void> {
    await this.client.execute(SCHEMA_TABLE_SQL);

    const applied = await this.client.execute("SELECT version FROM schema_migrations");
    const versions = new Set(applied.rows.map((row) => asNumber(row.version, "version")));

    for (const [index, statements] of MIGRATIONS.entries()) {
      const version = index + 1;
      if (versions.has(version)) continue;
      await this.client.batch(
        [
          ...statements,
          {
            sql: "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            args: [version, Date.now()],
          },
        ],
        "write",
      );
    }
  }

  async get(address: string): Promise<VerificationRecord | null> {
    await this.init();
    const result = await this.client.execute({
      sql: `SELECT * FROM ${TABLE} WHERE address = ?`,
      args: [address],
    });
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }

  async submit(request: NewVerificationRequest): Promise<VerificationRecord> {
    await this.init();
    await this.client.execute({
      sql: `INSERT INTO ${TABLE}
              (address, country, investor_type, attestation, consent, status, reason,
               tx_hash, attempts, last_error, created_at, updated_at, decided_at, claimed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, ?, ?, ?, NULL)
            ON CONFLICT(address) DO UPDATE SET
              country       = excluded.country,
              investor_type = excluded.investor_type,
              attestation   = excluded.attestation,
              consent       = excluded.consent,
              status        = excluded.status,
              reason        = excluded.reason,
              tx_hash       = NULL,
              attempts      = 0,
              last_error    = NULL,
              created_at    = excluded.created_at,
              updated_at    = excluded.updated_at,
              decided_at    = excluded.decided_at,
              claimed_at    = NULL
            WHERE ${TABLE}.status <> 'approved'`,
      args: [
        request.address,
        request.country,
        request.investorType,
        request.attestation ? 1 : 0,
        request.consent ? 1 : 0,
        request.status,
        request.reason,
        request.now,
        request.now,
        request.status === "pending" ? null : request.now,
      ],
    });

    const record = await this.get(request.address);
    if (!record) {
      throw new Error(
        `the verification request for ${request.address} was written but could not be read back`,
      );
    }
    return record;
  }

  async listDue(options: {
    now: number;
    delayMs: number;
    limit: number;
    leaseMs?: number;
  }): Promise<VerificationRecord[]> {
    await this.init();
    const leaseMs = options.leaseMs ?? CLAIM_LEASE_MS;
    const result = await this.client.execute({
      sql: `SELECT * FROM ${TABLE}
             WHERE status = 'pending'
               AND created_at <= ?
               AND attempts < ?
               AND (claimed_at IS NULL OR claimed_at <= ?)
             ORDER BY created_at ASC
             LIMIT ?`,
      args: [options.now - options.delayMs, MAX_ATTEMPTS, options.now - leaseMs, options.limit],
    });
    return result.rows.map(toRecord);
  }

  async claim(address: string, now: number, leaseMs = CLAIM_LEASE_MS): Promise<boolean> {
    await this.init();
    const result = await this.client.execute({
      sql: `UPDATE ${TABLE}
               SET claimed_at = ?, updated_at = ?
             WHERE address = ?
               AND status = 'pending'
               AND (claimed_at IS NULL OR claimed_at <= ?)`,
      args: [now, now, address, now - leaseMs],
    });
    return result.rowsAffected === 1;
  }

  private async decide(
    address: string,
    status: Exclude<VerificationStatus, "pending">,
    reason: string | null,
    now: number,
    txHash: `0x${string}` | null,
  ): Promise<boolean> {
    await this.init();
    const result = await this.client.execute({
      sql: `UPDATE ${TABLE}
               SET status = ?, reason = ?, tx_hash = COALESCE(?, tx_hash),
                   decided_at = ?, updated_at = ?, claimed_at = NULL, last_error = NULL
             WHERE address = ? AND status = 'pending'`,
      args: [status, reason, txHash, now, now, address],
    });
    return result.rowsAffected === 1;
  }

  markApproved(
    address: string,
    txHash: `0x${string}` | null,
    now: number,
    reason: string | null = null,
  ): Promise<boolean> {
    return this.decide(address, "approved", reason, now, txHash);
  }

  markRejected(address: string, reason: string, now: number): Promise<boolean> {
    return this.decide(address, "rejected", reason, now, null);
  }

  markBlocked(address: string, reason: string, now: number): Promise<boolean> {
    return this.decide(address, "blocked", reason, now, null);
  }

  async recordFailure(options: {
    address: string;
    error: string;
    now: number;
    txHash?: `0x${string}` | null;
  }): Promise<number> {
    await this.init();
    await this.client.execute({
      sql: `UPDATE ${TABLE}
               SET attempts = attempts + 1, last_error = ?, updated_at = ?,
                   claimed_at = NULL, tx_hash = COALESCE(?, tx_hash)
             WHERE address = ? AND status = 'pending'`,
      args: [
        redactSecrets(options.error).slice(0, 500),
        options.now,
        options.txHash ?? null,
        options.address,
      ],
    });
    const record = await this.get(options.address);
    return record?.attempts ?? 0;
  }

  async counts(): Promise<StatusCounts> {
    await this.init();
    const result = await this.client.execute(
      `SELECT status, COUNT(*) AS total FROM ${TABLE} GROUP BY status`,
    );
    const counts: StatusCounts = { pending: 0, approved: 0, rejected: 0, blocked: 0 };
    for (const row of result.rows) {
      const status = asString(row.status, "status");
      if (isStatus(status)) counts[status] = asNumber(row.total, "total");
    }
    return counts;
  }

  async close(): Promise<void> {
    this.client.close();
    return Promise.resolve();
  }
}

// --------------------------------------------------------------------------- construction

/**
 * A store on an explicit URL. `createStore(":memory:")` is what the tests use: a real libSQL
 * database, real SQL, real constraints, no file.
 */
export function createStore(url: string, authToken?: string): Store {
  ensureDirectoryFor(url);
  return new LibsqlStore(createClient(authToken ? { url, authToken } : { url }));
}

/** `file:./.data/hitbite.db` needs `.data/` to exist; libSQL will not create it. */
function ensureDirectoryFor(url: string): void {
  if (!url.startsWith("file:") || url.includes(":memory:")) return;
  const filePath = url.slice("file:".length).split("?")[0] ?? "";
  if (!filePath) return;
  const directory = path.dirname(path.resolve(process.cwd(), filePath));
  try {
    mkdirSync(directory, { recursive: true });
  } catch (error) {
    throw new Error(
      `could not create the directory for DATABASE_URL (${directory}): ${describeError(error)}`,
    );
  }
}

let shared: Store | null = null;

/**
 * The process-wide store, built from `DATABASE_URL` on first use.
 *
 * One client per process, not per request: a serverless instance handles many requests and
 * opening a database per request would be both slower and, on a file store, a good way to meet
 * `SQLITE_BUSY`. The migration runs on the first call and is idempotent thereafter.
 */
export function getStore(): Store {
  shared ??= createStore(getDatabaseUrl(), getDatabaseAuthToken());
  return shared;
}

/** Drop the shared store. For tests that change `DATABASE_URL` between cases. */
export async function resetStoreForTests(): Promise<void> {
  const current = shared;
  shared = null;
  if (current) await current.close();
}
