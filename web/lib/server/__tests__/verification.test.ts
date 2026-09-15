/**
 * Request validation and the refusal rules (PLAN.md D21, D23; COMPLIANCE_RULES.md section 1).
 *
 * Every rejection path, from both directions: a malformed request must be a 400 that stores
 * nothing, and a well-formed request the policy refuses must be a decision with a reason. The
 * distinction is the contract the `/verify` page is written against, so it is pinned here.
 */

import { describe, expect, it } from "vitest";

import { RequestError } from "../http";
import {
  decideSubmission,
  INVESTOR_PROFESSIONAL,
  INVESTOR_RETAIL,
  investorTypeLabel,
  isoUtc,
  normaliseAddress,
  parseAddressParam,
  parseSubmission,
  toRequestView,
  type CountryBlockVerdict,
  type VerificationRecord,
} from "../verification";

const ALICE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    address: ALICE,
    country: 276,
    professional_attestation: true,
    consent: true,
    ...overrides,
  };
}

function expectBadRequest(run: () => unknown, match: RegExp): void {
  try {
    run();
    throw new Error("expected the call to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(RequestError);
    const request = error as RequestError;
    expect(request.status).toBe(400);
    expect(request.code).toBe("bad_request");
    expect(`${request.message} ${request.hint}`).toMatch(match);
    // Every refusal says what to do about it. A 400 with no hint is a puzzle.
    expect(request.hint.length).toBeGreaterThan(10);
  }
}

describe("a well-formed submission", () => {
  it("is parsed into exactly the five things that get stored", () => {
    expect(parseSubmission(body())).toEqual({
      address: ALICE,
      country: 276,
      investorType: INVESTOR_PROFESSIONAL,
      attestation: true,
      consent: true,
    });
  });

  it("accepts camelCase aliases, because the page that calls it is React", () => {
    const parsed = parseSubmission({
      address: ALICE,
      country: "276",
      investorType: 1,
      professionalAttestation: true,
      consent: true,
    });
    expect(parsed.country).toBe(276);
    expect(parsed.attestation).toBe(true);
  });

  it("drops any field it was not asked for, so no name is ever stored", () => {
    const parsed = parseSubmission(body({ name: "A Person", email: "a@example.com" }));
    expect(Object.keys(parsed).sort()).toEqual([
      "address",
      "attestation",
      "consent",
      "country",
      "investorType",
    ]);
    expect(JSON.stringify(parsed)).not.toContain("A Person");
  });

  it("defaults the investor type to professional, which is the only one phase one allows", () => {
    expect(parseSubmission(body()).investorType).toBe(INVESTOR_PROFESSIONAL);
    expect(investorTypeLabel(INVESTOR_PROFESSIONAL)).toBe("professional");
    expect(investorTypeLabel(INVESTOR_RETAIL)).toBe("retail");
  });
});

describe("addresses", () => {
  it("normalises to the checksummed form, so the store holds one row per wallet", () => {
    expect(normaliseAddress(ALICE.toLowerCase())).toBe(ALICE);
    expect(normaliseAddress(` ${ALICE} `)).toBe(ALICE);
  });

  it("rejects a mixed-case address whose checksum does not hold", () => {
    const mistyped = `0x70997970C51812dc3A010C7d01b50e0d17dc79C9`;
    expectBadRequest(() => normaliseAddress(mistyped), /checksum/i);
  });

  it("rejects anything that is not an address at all", () => {
    expectBadRequest(() => normaliseAddress(undefined), /required/i);
    expectBadRequest(() => normaliseAddress(""), /required/i);
    expectBadRequest(() => normaliseAddress("0x1234"), /hexadecimal/i);
    expectBadRequest(() => normaliseAddress(42), /required|string/i);
    expectBadRequest(
      () => normaliseAddress("0xZZ997970C51812dc3A010C7d01b50e0d17dc79C8"),
      /hexadecimal/i,
    );
  });

  it("reads the address out of a status query string", () => {
    expect(parseAddressParam(`https://x/api/verify/status?address=${ALICE.toLowerCase()}`)).toBe(
      ALICE,
    );
    expectBadRequest(() => parseAddressParam("https://x/api/verify/status"), /required/i);
    expectBadRequest(() => parseAddressParam("https://x/api/verify/status?address=nope"), /0x/i);
  });
});

describe("a malformed body is a 400 and nothing is stored", () => {
  it("refuses a body that is not an object", () => {
    expectBadRequest(() => parseSubmission(null), /object/i);
    expectBadRequest(() => parseSubmission([]), /object/i);
    expectBadRequest(() => parseSubmission("address=0x…"), /object/i);
  });

  it("refuses a country that is not an ISO 3166-1 numeric code", () => {
    expectBadRequest(() => parseSubmission(body({ country: "DE" })), /numeric code/i);
    expectBadRequest(() => parseSubmission(body({ country: "Germany" })), /numeric code/i);
    expectBadRequest(() => parseSubmission(body({ country: undefined })), /numeric code/i);
    expectBadRequest(() => parseSubmission(body({ country: 276.5 })), /numeric code/i);
  });

  it("refuses a country outside the range the registry accepts", () => {
    expectBadRequest(() => parseSubmission(body({ country: 0 })), /1\.\.999/);
    expectBadRequest(() => parseSubmission(body({ country: 1000 })), /1\.\.999/);
  });

  it("refuses a code in range that no country has", () => {
    expectBadRequest(() => parseSubmission(body({ country: 999 })), /not an ISO 3166-1/i);
  });

  it("refuses an investor type the registry does not know", () => {
    expectBadRequest(() => parseSubmission(body({ investor_type: 7 })), /not a type/i);
    expectBadRequest(() => parseSubmission(body({ investor_type: "professional" })), /number/i);
  });

  it("refuses a missing attestation or consent, and a non-boolean one", () => {
    expectBadRequest(
      () => parseSubmission(body({ professional_attestation: undefined })),
      /professional_attestation` is required/,
    );
    expectBadRequest(() => parseSubmission(body({ consent: undefined })), /consent` is required/);
    expectBadRequest(() => parseSubmission(body({ consent: "true" })), /boolean/i);
    expectBadRequest(() => parseSubmission(body({ professional_attestation: 1 })), /boolean/i);
  });
});

describe("the decision", () => {
  const allowed: CountryBlockVerdict = { blocked: false, source: "chain", reason: null };
  const blockedOnChain: CountryBlockVerdict = { blocked: true, source: "chain", reason: null };
  const blockedBySeed: CountryBlockVerdict = {
    blocked: true,
    source: "seed",
    reason: "the RPC did not answer",
  };

  it("queues a professional applicant from an allowed country", () => {
    expect(decideSubmission(parseSubmission(body()), allowed)).toEqual({ outcome: "pending" });
  });

  it("blocks a country the registry says is blocked", () => {
    const decision = decideSubmission(parseSubmission(body({ country: 840 })), blockedOnChain);
    expect(decision.outcome).toBe("blocked");
    if (decision.outcome === "blocked") {
      expect(decision.rule).toBe("country_blocked");
      expect(decision.reason).toMatch(/United States/);
      expect(decision.reason).toMatch(/securities law/i);
      expect(decision.reason).toMatch(/deployed IdentityRegistry/i);
    }
  });

  it("blocks a seeded country even when the chain could not be asked", () => {
    const decision = decideSubmission(parseSubmission(body({ country: 792 })), blockedBySeed);
    expect(decision.outcome).toBe("blocked");
    if (decision.outcome === "blocked") {
      expect(decision.reason).toMatch(/Türkiye/);
      expect(decision.reason).toMatch(/the RPC did not answer/);
    }
  });

  it("blocks a country the admin added, with no entry in the seed list", () => {
    // Nothing in countries.json marks 250 (France) as blocked. The registry can, and then it is.
    const decision = decideSubmission(parseSubmission(body({ country: 250 })), blockedOnChain);
    expect(decision.outcome).toBe("blocked");
    if (decision.outcome === "blocked") {
      expect(decision.reason).toMatch(/France/);
      expect(decision.reason).toMatch(/admin has blocked/i);
    }
  });

  it("rejects retail, whatever the client claims (PLAN.md D21)", () => {
    const decision = decideSubmission(parseSubmission(body({ investor_type: 2 })), allowed);
    expect(decision.outcome).toBe("rejected");
    if (decision.outcome === "rejected") {
      expect(decision.rule).toBe("retail");
      expect(decision.reason).toMatch(/RetailNotAllowed/);
    }
  });

  it("rejects a missing attestation and a missing consent, separately", () => {
    const noAttestation = decideSubmission(
      parseSubmission(body({ professional_attestation: false })),
      allowed,
    );
    expect(noAttestation).toMatchObject({ outcome: "rejected", rule: "no_attestation" });

    const noConsent = decideSubmission(parseSubmission(body({ consent: false })), allowed);
    expect(noConsent).toMatchObject({ outcome: "rejected", rule: "no_consent" });
  });

  it("puts the country first: a retail applicant from a blocked country is blocked", () => {
    const decision = decideSubmission(
      parseSubmission(body({ country: 840, investor_type: 2, consent: false })),
      blockedOnChain,
    );
    expect(decision).toMatchObject({ outcome: "blocked", rule: "country_blocked" });
  });
});

describe("the view a page renders", () => {
  const record: VerificationRecord = {
    address: ALICE,
    country: 276,
    investorType: 1,
    attestation: true,
    consent: true,
    status: "pending",
    reason: null,
    txHash: null,
    attempts: 0,
    lastError: "rpc down",
    createdAt: 1_789_420_690_000,
    updatedAt: 1_789_420_690_000,
    decidedAt: null,
    claimedAt: null,
  };

  it("counts down to the moment the worker will act", () => {
    const view = toRequestView(record, {
      now: record.createdAt + 4_000,
      autoApproveDelayMs: 10_000,
    });

    expect(view.status).toBe("pending");
    expect(view.auto_approve_at).toBe(isoUtc(record.createdAt + 10_000));
    expect(view.auto_approve_in_ms).toBe(6_000);
    expect(view.country_name).toBe("Germany");
    expect(view.country_alpha2).toBe("DE");
    expect(view.investor_type_label).toBe("professional");
  });

  it("floors the countdown at zero rather than going negative", () => {
    const view = toRequestView(record, {
      now: record.createdAt + 60_000,
      autoApproveDelayMs: 10_000,
    });
    expect(view.auto_approve_in_ms).toBe(0);
  });

  it("drops the countdown once the request is decided, and never leaks the last error", () => {
    const view = toRequestView(
      { ...record, status: "approved", decidedAt: record.createdAt + 11_000 },
      { now: record.createdAt + 20_000, autoApproveDelayMs: 10_000 },
    );

    expect(view.auto_approve_at).toBeNull();
    expect(view.auto_approve_in_ms).toBeNull();
    expect(view.decided_at).toBe(isoUtc(record.createdAt + 11_000));
    expect(JSON.stringify(view)).not.toContain("rpc down");
  });

  it("formats timestamps the way the engine does: UTC, seconds, Z", () => {
    expect(isoUtc(1_789_420_690_000)).toBe("2026-09-14T21:18:10Z");
  });
});
