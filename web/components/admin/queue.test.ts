import { describe, expect, it } from "vitest";

import {
  ADMIN_REJECT_ACTION,
  REJECT_REASON_MAX_LENGTH,
  adminRejectMessage,
  checkRejectReason,
  describeRejectReasonProblem,
  dueInMs,
  isDue,
  type AdminQueueEntry,
} from "@/components/admin/queue";

const AUTH = {
  address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  reason: "Duplicate request from the same operator.",
  chainId: 84532,
  registry: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  issuedAt: "2026-09-15T06:00:00.000Z",
} as const;

function entry(overrides: Partial<AdminQueueEntry> = {}): AdminQueueEntry {
  return {
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    country: 784,
    country_name: "United Arab Emirates",
    country_alpha2: "AE",
    investor_type: 1,
    investor_type_label: "Professional",
    professional_attestation: true,
    consent: true,
    status: "pending",
    reason: null,
    tx_hash: null,
    attempts: 0,
    submitted_at: "2026-09-15T06:00:00Z",
    updated_at: "2026-09-15T06:00:00Z",
    decided_at: null,
    auto_approve_at: "2026-09-15T06:00:10Z",
    auto_approve_in_ms: 10_000,
    ...overrides,
  };
}

describe("adminRejectMessage", () => {
  it("carries every field the server will act on", () => {
    const message = adminRejectMessage(AUTH);
    expect(message).toContain(`Action: ${ADMIN_REJECT_ACTION}`);
    expect(message).toContain(`Request address: ${AUTH.address}`);
    expect(message).toContain(`Reason: ${AUTH.reason}`);
    expect(message).toContain("Chain id: 84532");
    expect(message).toContain(`Identity registry: ${AUTH.registry}`);
    expect(message).toContain(`Issued at: ${AUTH.issuedAt}`);
  });

  it("says in the signed text that it moves no funds", () => {
    expect(adminRejectMessage(AUTH)).toContain("sends no transaction");
  });

  it("is byte-for-byte stable, because the server rebuilds it to verify the signature", () => {
    expect(adminRejectMessage(AUTH)).toBe(adminRejectMessage({ ...AUTH }));
  });

  it("changes when any signed field changes", () => {
    const baseline = adminRejectMessage(AUTH);
    expect(adminRejectMessage({ ...AUTH, chainId: 31337 })).not.toBe(baseline);
    expect(adminRejectMessage({ ...AUTH, reason: "Something else entirely." })).not.toBe(baseline);
    expect(adminRejectMessage({ ...AUTH, issuedAt: "2026-09-15T06:00:01.000Z" })).not.toBe(
      baseline,
    );
    expect(
      adminRejectMessage({ ...AUTH, address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" }),
    ).not.toBe(baseline);
  });
});

describe("checkRejectReason", () => {
  it("insists on a reason the applicant can read", () => {
    expect(checkRejectReason("")).toBe("empty");
    expect(checkRejectReason("   ")).toBe("empty");
    expect(checkRejectReason("no")).toBe("too-short");
    expect(checkRejectReason("x".repeat(REJECT_REASON_MAX_LENGTH + 1))).toBe("too-long");
    expect(checkRejectReason("Duplicate request.")).toBeNull();
  });

  it("explains each problem, and says nothing when there is none", () => {
    expect(describeRejectReasonProblem("empty")).toContain("/verify");
    expect(describeRejectReasonProblem("too-long")).toContain(String(REJECT_REASON_MAX_LENGTH));
    expect(describeRejectReasonProblem(null)).toBeNull();
  });
});

describe("dueInMs", () => {
  const dueAt = Date.parse("2026-09-15T06:00:10Z");

  it("counts down to the moment the worker will act", () => {
    expect(dueInMs(entry(), dueAt - 4_000)).toBe(4_000);
    expect(isDue(entry(), dueAt - 4_000)).toBe(false);
  });

  it("floors at zero once the delay has passed", () => {
    expect(dueInMs(entry(), dueAt + 1)).toBe(0);
    expect(isDue(entry(), dueAt)).toBe(true);
  });

  it("treats a row with no auto-approval time as due", () => {
    expect(isDue(entry({ auto_approve_at: null }), 0)).toBe(true);
  });
});
