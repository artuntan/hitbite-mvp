/**
 * The registrar worker's decision logic (PLAN.md D8), against a real store and a scripted chain.
 *
 * The chain is faked, never called: no test here spawns a node, holds a key or waits for a block.
 * What is being tested is the sequence of judgements the worker makes — claim, re-check the
 * country, re-check the type, notice an address that is already verified, interpret a revert, give
 * up after enough failures — because that sequence is what decides whether a transaction is signed.
 */

import { describe, expect, it } from "vitest";

import {
  getBlocklistView,
  getVerificationState,
  MAX_PER_CALL,
  processDueRequests,
  resolveCountryVerdict,
  submitVerificationRequest,
  type RegistrarDeps,
} from "../registrar";
import { createStore, MAX_ATTEMPTS, type Store } from "../store";
import type { VerificationRecord } from "../verification";
import { FakeChain, type FakeChainOptions } from "./fake-chain";

const ALICE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const BOB = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const TX = `0x${"ab".repeat(32)}` as const;

const T0 = 1_789_420_690_000;
const DELAY = 10_000;

interface Harness extends RegistrarDeps {
  store: Store;
  chain: FakeChain;
}

function harness(options: FakeChainOptions = {}, now = T0): Harness {
  return {
    store: createStore(":memory:"),
    chain: new FakeChain(options),
    now,
    autoApproveDelayMs: DELAY,
  };
}

function at(deps: Harness, now: number): Harness {
  return { ...deps, now };
}

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    address: ALICE,
    country: 276,
    professional_attestation: true,
    consent: true,
    ...overrides,
  };
}

// --------------------------------------------------------------------------- the country check

describe("the blocklist is read from the chain, not from a constant", () => {
  it("believes the registry when it blocks a country the seed list does not", async () => {
    const chain = new FakeChain({ blocked: [250] });

    const verdict = await resolveCountryVerdict(chain, 250);

    expect(verdict).toEqual({ blocked: true, source: "chain", reason: null });
    expect(chain.blockedChecks).toEqual([250]);
  });

  it("allows a country the registry does not block", async () => {
    const verdict = await resolveCountryVerdict(new FakeChain({ blocked: [840] }), 276);
    expect(verdict.blocked).toBe(false);
    expect(verdict.source).toBe("chain");
  });

  it("falls back to the seeded codes when the chain cannot be asked", async () => {
    const chain = new FakeChain({ unavailable: "connect ECONNREFUSED 127.0.0.1:8545" });

    expect(await resolveCountryVerdict(chain, 840)).toMatchObject({
      blocked: true,
      source: "seed",
    });
    expect(await resolveCountryVerdict(chain, 792)).toMatchObject({
      blocked: true,
      source: "seed",
    });
    expect(await resolveCountryVerdict(chain, 276)).toMatchObject({ blocked: false });
  });

  it("refuses a seeded code even when the chain says it is fine, and says why", async () => {
    const verdict = await resolveCountryVerdict(new FakeChain({ blocked: [] }), 840);

    expect(verdict.blocked).toBe(true);
    expect(verdict.source).toBe("seed");
    expect(verdict.reason).toMatch(/stricter/);
  });
});

// --------------------------------------------------------------------------- submission

describe("POST /api/verify", () => {
  it("records a pending request and tells the caller what happens next", async () => {
    const deps = harness();

    const payload = await submitVerificationRequest(body(), deps);

    expect(payload.accepted).toBe(true);
    expect(payload.rule).toBeNull();
    expect(payload.request.status).toBe("pending");
    expect(payload.request.address).toBe(ALICE);
    expect(payload.request.auto_approve_in_ms).toBe(DELAY);
    expect(payload.next_step).toMatch(/\/api\/verify\/process/);
    expect(payload.country_blocklist_source).toBe("chain");
    expect((await deps.store.get(ALICE))?.status).toBe("pending");
    expect(deps.chain.addVerifiedCalls).toHaveLength(0);
  });

  it("records a blocked country as blocked, and sends nothing", async () => {
    const deps = harness({ blocked: [840] });

    const payload = await submitVerificationRequest(body({ country: 840 }), deps);

    expect(payload.accepted).toBe(false);
    expect(payload.rule).toBe("country_blocked");
    expect(payload.request.status).toBe("blocked");
    expect(payload.request.reason).toMatch(/United States/);
    expect((await deps.store.get(ALICE))?.status).toBe("blocked");
    expect(deps.chain.addVerifiedCalls).toHaveLength(0);
  });

  it("records a country the admin blocked after deployment as blocked", async () => {
    const deps = harness({ blocked: [250] });

    const payload = await submitVerificationRequest(body({ country: 250 }), deps);

    expect(payload.request.status).toBe("blocked");
    expect(payload.country_blocklist_source).toBe("chain");
  });

  it("records retail as rejected (PLAN.md D21)", async () => {
    const deps = harness();

    const payload = await submitVerificationRequest(body({ investor_type: 2 }), deps);

    expect(payload.rule).toBe("retail");
    expect(payload.request.status).toBe("rejected");
    expect(payload.request.reason).toMatch(/professional/i);
  });

  it("records a missing attestation and a missing consent as rejected", async () => {
    const deps = harness();

    const noAttestation = await submitVerificationRequest(
      body({ professional_attestation: false }),
      deps,
    );
    expect(noAttestation).toMatchObject({ rule: "no_attestation", accepted: false });

    const noConsent = await submitVerificationRequest(body({ address: BOB, consent: false }), deps);
    expect(noConsent).toMatchObject({ rule: "no_consent", accepted: false });
    expect(await deps.store.counts()).toMatchObject({ rejected: 2, pending: 0 });
  });

  it("queues the request even when the chain is unreachable, and says so", async () => {
    const deps = harness({ unavailable: "fetch failed" });

    const payload = await submitVerificationRequest(body(), deps);

    expect(payload.request.status).toBe("pending");
    expect(payload.country_blocklist_source).toBe("seed");
    expect(payload.chain.status).toBe("unavailable");
    expect(payload.notes.join(" ")).toMatch(/fetch failed/);
  });

  it("does not un-approve an address that is already verified", async () => {
    const deps = harness();
    await submitVerificationRequest(body(), deps);
    await deps.store.markApproved(ALICE, TX, T0 + 1);

    const payload = await submitVerificationRequest(body({ country: 840 }), at(deps, T0 + 2));

    expect(payload.request.status).toBe("approved");
    expect(payload.request.country).toBe(276);
    expect(payload.next_step).toMatch(/already verified/i);
    expect(payload.rule).toBeNull();
    expect(payload.notes.join(" ")).toMatch(/already verified on chain/i);
  });

  it("reports what the registry already knows about the address", async () => {
    const deps = harness({
      identities: {
        [ALICE]: {
          verified: true,
          canHold: true,
          country: 276,
          investorType: 1,
          verifiedAt: 1_789_420_000,
        },
      },
    });

    const payload = await submitVerificationRequest(body(), deps);

    expect(payload.chain).toMatchObject({
      status: "ok",
      is_verified: true,
      can_hold: true,
      country_name: "Germany",
      verified_at: "2026-09-14T21:06:40Z",
    });
  });
});

// --------------------------------------------------------------------------- status

describe("GET /api/verify/status", () => {
  it("says not_requested for an address nobody has submitted", async () => {
    const deps = harness();

    const payload = await getVerificationState(BOB, deps);

    expect(payload.status).toBe("not_requested");
    expect(payload.source).toBe("none");
    expect(payload.request).toBeNull();
  });

  it("reports the stored request while it is pending", async () => {
    const deps = harness();
    await submitVerificationRequest(body(), deps);

    const payload = await getVerificationState(ALICE, at(deps, T0 + 3_000));

    expect(payload.status).toBe("pending");
    expect(payload.source).toBe("store");
    expect(payload.request?.auto_approve_in_ms).toBe(7_000);
  });

  it("believes the chain over the store when the two disagree", async () => {
    const deps = harness({
      identities: {
        [ALICE]: {
          verified: true,
          canHold: true,
          country: 276,
          investorType: 1,
          verifiedAt: 1_789_420_000,
        },
      },
    });
    await submitVerificationRequest(body(), deps);

    const payload = await getVerificationState(ALICE, deps);

    expect(payload.status).toBe("approved");
    expect(payload.source).toBe("chain");
    expect(payload.request?.status).toBe("pending");
    expect(payload.notes.join(" ")).toMatch(/chain is authoritative/i);
  });

  it("explains a record that exists but cannot hold, because its country was blocked", async () => {
    const deps = harness({
      blocked: [792],
      identities: {
        [ALICE]: {
          verified: true,
          canHold: false,
          country: 792,
          investorType: 1,
          verifiedAt: 1_789_420_000,
        },
      },
    });

    const payload = await getVerificationState(ALICE, deps);

    expect(payload.status).toBe("not_requested");
    expect(payload.notes.join(" ")).toMatch(/blocklist/);
  });

  it("falls back to the store when the chain cannot be reached", async () => {
    const deps = harness({ unavailable: "fetch failed" });
    await submitVerificationRequest(body(), deps);

    const payload = await getVerificationState(ALICE, deps);

    expect(payload.status).toBe("pending");
    expect(payload.source).toBe("store");
    expect(payload.chain).toMatchObject({ status: "unavailable", reason: "fetch failed" });
  });
});

// --------------------------------------------------------------------------- the worker

async function queue(deps: Harness, address: string, country = 276): Promise<void> {
  await submitVerificationRequest(body({ address, country }), deps);
}

describe("POST /api/verify/process", () => {
  it("does nothing before the delay has elapsed", async () => {
    const deps = harness();
    await queue(deps, ALICE);

    const payload = await processDueRequests({}, at(deps, T0 + DELAY - 1));

    expect(payload.due).toBe(0);
    expect(payload.processed).toHaveLength(0);
    expect(deps.chain.addVerifiedCalls).toHaveLength(0);
    expect((await deps.store.get(ALICE))?.status).toBe("pending");
  });

  it("approves a due request by calling addVerified, and records the transaction", async () => {
    const deps = harness();
    await queue(deps, ALICE);

    const payload = await processDueRequests({}, at(deps, T0 + DELAY));

    expect(deps.chain.addVerifiedCalls).toEqual([{ address: ALICE, country: 276 }]);
    expect(payload.summary.approved).toBe(1);
    expect(payload.processed[0]).toMatchObject({
      address: ALICE,
      outcome: "approved",
      tx_hash: TX,
    });

    const record = await deps.store.get(ALICE);
    expect(record?.status).toBe("approved");
    expect(record?.txHash).toBe(TX);
    expect(record?.claimedAt).toBeNull();
    expect(payload.counts).toEqual({ pending: 0, approved: 1, rejected: 0, blocked: 0 });
  });

  it("re-checks the country at signing time and blocks one the admin blocked in between", async () => {
    const deps = harness();
    await queue(deps, ALICE);
    // The admin blocks Germany after the request was queued.
    const blocking = { ...deps, chain: new FakeChain({ blocked: [276] }), now: T0 + DELAY };

    const payload = await processDueRequests({}, blocking);

    expect(blocking.chain.addVerifiedCalls).toHaveLength(0);
    expect(payload.summary.blocked).toBe(1);
    expect((await deps.store.get(ALICE))?.status).toBe("blocked");
    expect((await deps.store.get(ALICE))?.reason).toMatch(/CountryBlocked/);
  });

  it("refuses to sign for a row that is not professional, even if one got into the store", async () => {
    const deps = harness();
    await deps.store.submit({
      address: ALICE,
      country: 276,
      investorType: 2,
      attestation: true,
      consent: true,
      status: "pending",
      reason: null,
      now: T0,
    });

    const payload = await processDueRequests({}, at(deps, T0 + DELAY));

    expect(deps.chain.addVerifiedCalls).toHaveLength(0);
    expect(payload.summary.rejected).toBe(1);
    expect((await deps.store.get(ALICE))?.reason).toMatch(/D21/);
  });

  it("refuses to sign for a row with no attestation or no consent", async () => {
    const deps = harness();
    for (const [address, field] of [
      [ALICE, "attestation"],
      [BOB, "consent"],
    ] as const) {
      await deps.store.submit({
        address,
        country: 276,
        investorType: 1,
        attestation: field !== "attestation",
        consent: field !== "consent",
        status: "pending",
        reason: null,
        now: T0,
      });
    }

    const payload = await processDueRequests({}, at(deps, T0 + DELAY));

    expect(deps.chain.addVerifiedCalls).toHaveLength(0);
    expect(payload.summary.rejected).toBe(2);
  });

  it("closes out an address the registry already verified, without sending anything", async () => {
    const deps = harness({
      identities: {
        [ALICE]: {
          verified: true,
          canHold: true,
          country: 276,
          investorType: 1,
          verifiedAt: 1_789_420_000,
        },
      },
    });
    await queue(deps, ALICE);

    const payload = await processDueRequests({}, at(deps, T0 + DELAY));

    expect(deps.chain.addVerifiedCalls).toHaveLength(0);
    expect(payload.summary.approved).toBe(1);
    expect(payload.processed[0]?.reason).toMatch(/already holds/);
    expect((await deps.store.get(ALICE))?.status).toBe("approved");
  });

  it("does nothing at all when the registrar key is not configured", async () => {
    const deps = harness({ registrarUnavailable: "REGISTRAR_PRIVATE_KEY is not set" });
    await queue(deps, ALICE);

    const payload = await processDueRequests({}, at(deps, T0 + DELAY));

    expect(deps.chain.addVerifiedCalls).toHaveLength(0);
    expect(payload.summary.deferred).toBe(1);
    expect(payload.worker.registrar.status).toBe("unavailable");
    expect(payload.notes.join(" ")).toMatch(/REGISTRAR_PRIVATE_KEY is not set/);
    expect((await deps.store.get(ALICE))?.status).toBe("pending");
  });

  describe("when the transaction does not go through", () => {
    it("blocks the request when the registry reverts CountryBlocked", async () => {
      const deps = harness({
        addVerifiedResult: {
          status: "reverted",
          errorName: "CountryBlocked",
          hash: null,
          reason: "would revert",
        },
      });
      await queue(deps, ALICE);

      const payload = await processDueRequests({}, at(deps, T0 + DELAY));

      expect(payload.summary.blocked).toBe(1);
      expect((await deps.store.get(ALICE))?.status).toBe("blocked");
    });

    it("rejects the request when the registry reverts RetailNotAllowed", async () => {
      const deps = harness({
        addVerifiedResult: {
          status: "reverted",
          errorName: "RetailNotAllowed",
          hash: null,
          reason: "would revert",
        },
      });
      await queue(deps, ALICE);

      const payload = await processDueRequests({}, at(deps, T0 + DELAY));

      expect(payload.summary.rejected).toBe(1);
    });

    it("keeps the request pending when the node is unreachable, and counts the attempt", async () => {
      const deps = harness({
        addVerifiedResult: { status: "unavailable", reason: "the node did not answer" },
      });
      await queue(deps, ALICE);

      const payload = await processDueRequests({}, at(deps, T0 + DELAY));

      expect(payload.summary.deferred).toBe(1);
      const record = await deps.store.get(ALICE);
      expect(record?.status).toBe("pending");
      expect(record?.attempts).toBe(1);
      expect(record?.claimedAt).toBeNull();
    });

    it("keeps a transaction whose receipt never arrived, rather than claiming it landed", async () => {
      const deps = harness({
        addVerifiedResult: { status: "sent", hash: TX, reason: "no receipt in 20000 ms" },
      });
      await queue(deps, ALICE);

      const payload = await processDueRequests({}, at(deps, T0 + DELAY));

      expect(payload.processed[0]).toMatchObject({ outcome: "deferred", tx_hash: TX });
      const record = await deps.store.get(ALICE);
      expect(record?.status).toBe("pending");
      expect(record?.txHash).toBe(TX);
    });

    it("gives up after enough failures instead of retrying for ever", async () => {
      const deps = harness({
        addVerifiedResult: { status: "unavailable", reason: "the node did not answer" },
      });
      await queue(deps, ALICE);

      let payload = await processDueRequests({}, at(deps, T0 + DELAY));
      for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
        payload = await processDueRequests({}, at(deps, T0 + DELAY + attempt * 60_001));
      }

      expect(payload.summary.rejected).toBe(1);
      const record = await deps.store.get(ALICE);
      expect(record?.status).toBe("rejected");
      expect(record?.attempts).toBe(MAX_ATTEMPTS);
      expect(record?.reason).toMatch(/stopped trying/);
      expect(deps.chain.addVerifiedCalls).toHaveLength(MAX_ATTEMPTS);
    });
  });

  it("bounds the work per call", async () => {
    const deps = harness();
    for (let index = 0; index < MAX_PER_CALL + 2; index += 1) {
      await queue(deps, addressFor(index));
    }

    const payload = await processDueRequests({}, at(deps, T0 + DELAY));

    expect(payload.processed).toHaveLength(MAX_PER_CALL);
    expect(payload.max_per_call).toBe(MAX_PER_CALL);
    expect(payload.notes.join(" ")).toMatch(/cap of 5/);
    expect((await deps.store.counts()).pending).toBe(2);
  });

  it("refuses to be asked for more than the cap", async () => {
    const deps = harness();
    for (let index = 0; index < MAX_PER_CALL + 2; index += 1) {
      await queue(deps, addressFor(index));
    }

    const payload = await processDueRequests({ maxPerCall: 100 }, at(deps, T0 + DELAY));

    expect(payload.processed).toHaveLength(MAX_PER_CALL);
  });

  it("processes one named address when asked, and only if it is due", async () => {
    const deps = harness();
    await queue(deps, ALICE);
    await queue(deps, BOB);

    const early = await processDueRequests({ address: ALICE }, at(deps, T0 + DELAY - 1));
    expect(early.processed).toHaveLength(0);

    const payload = await processDueRequests({ address: ALICE }, at(deps, T0 + DELAY));

    expect(deps.chain.addVerifiedCalls).toEqual([{ address: ALICE, country: 276 }]);
    expect(payload.processed).toHaveLength(1);
    expect((await deps.store.get(BOB))?.status).toBe("pending");
  });

  it("ignores a named address that was never submitted", async () => {
    const deps = harness();

    const payload = await processDueRequests({ address: BOB }, at(deps, T0 + DELAY));

    expect(payload.due).toBe(0);
    expect(deps.chain.addVerifiedCalls).toHaveLength(0);
  });

  it("sends one transaction when two workers run at once", async () => {
    const deps = harness();
    await queue(deps, ALICE);
    const later = at(deps, T0 + DELAY);

    const [first, second] = await Promise.all([
      processDueRequests({}, later),
      processDueRequests({}, later),
    ]);

    expect(deps.chain.addVerifiedCalls).toHaveLength(1);
    const outcomes = [...first.processed, ...second.processed].map((item) => item.outcome).sort();
    expect(outcomes).toEqual(["approved", "skipped"]);
  });
});

function addressFor(index: number): string {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

// --------------------------------------------------------------------------- blocklist view

describe("GET /api/verify", () => {
  it("returns what the registry currently blocks", async () => {
    const deps = harness({ blocked: [840, 792, 250] });

    const payload = await getBlocklistView(deps);

    expect(payload.source).toBe("chain");
    expect(payload.blocked.map((entry) => entry.numeric)).toEqual([250, 792, 840]);
    expect(payload.blocked.find((entry) => entry.numeric === 250)?.name).toBe("France");
    expect(payload.count).toBe(3);
  });

  it("never returns an empty list when the chain cannot be asked", async () => {
    const deps = harness({ unavailable: "fetch failed" });

    const payload = await getBlocklistView(deps);

    expect(payload.source).toBe("seed");
    expect(payload.blocked.map((entry) => entry.numeric)).toEqual([792, 840]);
    expect(payload.reason).toMatch(/fetch failed/);
  });

  it("keeps a seeded code in the list even when the chain has unblocked it", async () => {
    const deps = harness({ blocked: [250] });

    const payload = await getBlocklistView(deps);

    expect(payload.blocked.map((entry) => entry.numeric)).toEqual([250, 792, 840]);
    expect(payload.notes.join(" ")).toMatch(/still refuses/);
  });
});

// --------------------------------------------------------------------------- record shape

describe("the stored record", () => {
  it("keeps only the address, the country, the declarations and the timestamps", async () => {
    const deps = harness();
    await submitVerificationRequest(body({ name: "A Person" }), deps);

    const record = (await deps.store.get(ALICE)) as VerificationRecord;

    expect(Object.keys(record).sort()).toEqual([
      "address",
      "attempts",
      "attestation",
      "claimedAt",
      "consent",
      "country",
      "createdAt",
      "decidedAt",
      "investorType",
      "lastError",
      "reason",
      "status",
      "txHash",
      "updatedAt",
    ]);
    expect(JSON.stringify(record)).not.toContain("A Person");
  });
});
