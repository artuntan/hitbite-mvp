/**
 * The verification store (PLAN.md D7).
 *
 * These run against a real libSQL database — `:memory:`, or a real file for the migration cases —
 * rather than a mock. The behaviour that matters here *is* the SQL: the conditional updates that
 * make two concurrent workers safe, the upsert that refuses to un-approve an address, and the
 * `CHECK` constraints that stop an impossible row being written. A mock of those would only prove
 * that the mock agrees with itself.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createClient } from "@libsql/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { createStore, MAX_ATTEMPTS, type Store } from "../store";
import type { NewVerificationRequest } from "../verification";

const ALICE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const BOB = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const TX = "0x5e8ed126a35a187a3706300d6b4cf231dbac1942d71b22aa74a11955811872cb" as const; // allow-secret

const T0 = 1_789_420_690_000;

function pendingRequest(overrides: Partial<NewVerificationRequest> = {}): NewVerificationRequest {
  return {
    address: ALICE,
    country: 276,
    investorType: 1,
    attestation: true,
    consent: true,
    status: "pending",
    reason: null,
    now: T0,
    ...overrides,
  };
}

let store: Store;
const tempDirs: string[] = [];

beforeEach(() => {
  store = createStore(":memory:");
});

afterEach(async () => {
  await store.close();
});

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function tempDatabase(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hitbite-store-"));
  tempDirs.push(dir);
  return `file:${path.join(dir, name)}`;
}

describe("round trip", () => {
  it("stores a request and reads back every field", async () => {
    const record = await store.submit(pendingRequest());

    expect(record).toMatchObject({
      address: ALICE,
      country: 276,
      investorType: 1,
      attestation: true,
      consent: true,
      status: "pending",
      reason: null,
      txHash: null,
      attempts: 0,
      lastError: null,
      createdAt: T0,
      updatedAt: T0,
      decidedAt: null,
      claimedAt: null,
    });
    expect(await store.get(ALICE)).toEqual(record);
  });

  it("records a refusal with its reason and the moment it was decided", async () => {
    const record = await store.submit(
      pendingRequest({ country: 840, status: "blocked", reason: "United States: not offered." }),
    );

    expect(record.status).toBe("blocked");
    expect(record.reason).toBe("United States: not offered.");
    expect(record.decidedAt).toBe(T0);
  });

  it("treats an address as one row whatever case it arrives in", async () => {
    await store.submit(pendingRequest());
    const lower = await store.get(ALICE.toLowerCase());

    expect(lower?.address).toBe(ALICE);
    expect((await store.counts()).pending).toBe(1);
  });

  it("returns null for an address nobody has submitted", async () => {
    expect(await store.get(BOB)).toBeNull();
  });

  it("refuses a row the registry could never accept", async () => {
    // country 0 is rejected on chain because an unset country would slip past the blocklist; the
    // CHECK constraint says the same thing one layer earlier.
    await expect(store.submit(pendingRequest({ country: 0 }))).rejects.toThrow();
    await expect(store.submit(pendingRequest({ country: 1000 }))).rejects.toThrow();
  });
});

describe("resubmission", () => {
  it("overwrites a pending request and restarts its clock", async () => {
    await store.submit(pendingRequest({ country: 840, status: "blocked", reason: "blocked" }));
    const corrected = await store.submit(pendingRequest({ country: 276, now: T0 + 5_000 }));

    expect(corrected.status).toBe("pending");
    expect(corrected.country).toBe(276);
    expect(corrected.reason).toBeNull();
    expect(corrected.createdAt).toBe(T0 + 5_000);
    expect((await store.counts()).blocked).toBe(0);
  });

  it("leaves an approved address alone", async () => {
    await store.submit(pendingRequest());
    await store.markApproved(ALICE, TX, T0 + 1_000);

    const resubmitted = await store.submit(pendingRequest({ country: 840, now: T0 + 2_000 }));

    expect(resubmitted.status).toBe("approved");
    expect(resubmitted.country).toBe(276);
    expect(resubmitted.txHash).toBe(TX);
  });

  it("clears a previous failure when the applicant tries again", async () => {
    await store.submit(pendingRequest());
    await store.recordFailure({ address: ALICE, error: "rpc down", now: T0 + 1 });

    const again = await store.submit(pendingRequest({ now: T0 + 2 }));

    expect(again.attempts).toBe(0);
    expect(again.lastError).toBeNull();
  });
});

describe("status transitions", () => {
  it("moves pending to approved, and only once", async () => {
    await store.submit(pendingRequest());

    expect(await store.markApproved(ALICE, TX, T0 + 10)).toBe(true);
    expect(await store.markApproved(ALICE, TX, T0 + 20)).toBe(false);

    const record = await store.get(ALICE);
    expect(record?.status).toBe("approved");
    expect(record?.txHash).toBe(TX);
    expect(record?.decidedAt).toBe(T0 + 10);
    expect(record?.claimedAt).toBeNull();
  });

  it("moves pending to rejected and to blocked, with the reason", async () => {
    await store.submit(pendingRequest());
    expect(await store.markRejected(ALICE, "retail is not eligible", T0 + 10)).toBe(true);
    expect((await store.get(ALICE))?.reason).toBe("retail is not eligible");

    await store.submit(pendingRequest({ address: BOB }));
    expect(await store.markBlocked(BOB, "country blocked", T0 + 10)).toBe(true);
    expect((await store.get(BOB))?.status).toBe("blocked");
  });

  it("refuses to move a request that has already been decided", async () => {
    await store.submit(pendingRequest());
    await store.markRejected(ALICE, "no consent", T0 + 10);

    expect(await store.markApproved(ALICE, TX, T0 + 20)).toBe(false);
    expect(await store.markBlocked(ALICE, "too late", T0 + 20)).toBe(false);
    expect((await store.get(ALICE))?.status).toBe("rejected");
  });

  it("counts rows by status", async () => {
    await store.submit(pendingRequest());
    await store.submit(pendingRequest({ address: BOB, status: "blocked", reason: "no" }));
    await store.markApproved(ALICE, TX, T0 + 1);

    expect(await store.counts()).toEqual({ pending: 0, approved: 1, rejected: 0, blocked: 1 });
  });
});

describe("claims and due work", () => {
  it("only lists pending requests that are past the delay", async () => {
    await store.submit(pendingRequest());
    await store.submit(pendingRequest({ address: BOB, now: T0 + 9_000 }));

    const due = await store.listDue({ now: T0 + 10_000, delayMs: 10_000, limit: 10 });

    expect(due.map((record) => record.address)).toEqual([ALICE]);
  });

  it("lists the oldest first and honours the limit", async () => {
    await store.submit(pendingRequest({ address: BOB, now: T0 }));
    await store.submit(pendingRequest({ address: ALICE, now: T0 - 5_000 }));

    const due = await store.listDue({ now: T0 + 60_000, delayMs: 0, limit: 1 });

    expect(due.map((record) => record.address)).toEqual([ALICE]);
  });

  it("lets one worker claim a row and keeps the next one out", async () => {
    await store.submit(pendingRequest());

    expect(await store.claim(ALICE, T0 + 1)).toBe(true);
    expect(await store.claim(ALICE, T0 + 2)).toBe(false);

    const due = await store.listDue({ now: T0 + 3, delayMs: 0, limit: 10 });
    expect(due).toHaveLength(0);
  });

  it("expires a claim, so a worker killed mid-flight does not strand a row", async () => {
    await store.submit(pendingRequest());
    await store.claim(ALICE, T0, 60_000);

    expect(await store.claim(ALICE, T0 + 59_000, 60_000)).toBe(false);
    expect(await store.claim(ALICE, T0 + 60_001, 60_000)).toBe(true);
  });

  it("will not claim a request that is no longer pending", async () => {
    await store.submit(pendingRequest());
    await store.markBlocked(ALICE, "country blocked", T0 + 1);

    expect(await store.claim(ALICE, T0 + 2)).toBe(false);
  });

  it("counts failures, releases the claim, and stops listing a row that keeps failing", async () => {
    await store.submit(pendingRequest());
    await store.claim(ALICE, T0);

    expect(await store.recordFailure({ address: ALICE, error: "rpc down", now: T0 + 1 })).toBe(1);
    const afterOne = await store.get(ALICE);
    expect(afterOne?.status).toBe("pending");
    expect(afterOne?.claimedAt).toBeNull();
    expect(afterOne?.lastError).toBe("rpc down");

    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await store.recordFailure({ address: ALICE, error: "rpc down", now: T0 + attempt });
    }

    expect((await store.get(ALICE))?.attempts).toBe(MAX_ATTEMPTS);
    expect(await store.listDue({ now: T0 + 100_000, delayMs: 0, limit: 10 })).toHaveLength(0);
  });

  it("keeps the transaction hash of an attempt whose receipt never arrived", async () => {
    await store.submit(pendingRequest());
    await store.recordFailure({ address: ALICE, error: "no receipt", now: T0 + 1, txHash: TX });

    expect((await store.get(ALICE))?.txHash).toBe(TX);
  });
});

describe("migration", () => {
  it("runs on first use and is idempotent across clients and calls", async () => {
    const url = tempDatabase("migrate.db");

    const first = createStore(url);
    await first.init();
    await first.init();
    await first.submit(pendingRequest());
    await first.close();

    // A second process opening the same file must migrate without error and see the data.
    const second = createStore(url);
    await second.init();
    expect((await second.get(ALICE))?.country).toBe(276);
    await second.close();

    const raw = createClient({ url });
    const versions = await raw.execute("SELECT version FROM schema_migrations ORDER BY version");
    const tables = await raw.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    raw.close();

    expect(versions.rows.map((row) => Number(row.version))).toEqual([1]);
    expect(tables.rows.map((row) => String(row.name))).toContain("verification_requests");
  });

  it("creates the directory a file: URL needs", async () => {
    const url = `${tempDatabase("nested.db").slice(0, -"nested.db".length)}nested/deeper/hitbite.db`;

    const nested = createStore(url);
    await nested.init();
    await nested.submit(pendingRequest());

    expect((await nested.get(ALICE))?.status).toBe("pending");
    await nested.close();
  });

  it("is run automatically by the first read, so a route never has to remember to", async () => {
    const fresh = createStore(":memory:");
    expect(await fresh.get(ALICE)).toBeNull();
    await fresh.close();
  });
});
