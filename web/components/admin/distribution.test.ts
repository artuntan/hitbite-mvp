import { describe, expect, it } from "vitest";

import {
  assessDistribution,
  checkFunding,
  largestDistribution6,
  smallestDistribution6,
  type DistributionFacts,
} from "@/components/admin/distribution";
import { MAX_INPUT, TOKEN_SCALE } from "@/lib/format";

/** 1,500 hbTRS outstanding at NAV 1.000000, reported AUM 1,500 USDC. */
function facts(overrides: Partial<DistributionFacts> = {}): DistributionFacts {
  return {
    supply18: 1_500n * TOKEN_SCALE,
    nav6: 1_000_000n,
    reportedAum6: 1_500_000_000n,
    anchor6: 1_000_000n,
    ...overrides,
  };
}

describe("assessDistribution", () => {
  it("reproduces the contract's arithmetic for a clean distribution", () => {
    // 12.00 USDC over 1,500 tokens = 0.008 USDC per token, exactly.
    const result = assessDistribution(12_000_000n, facts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.preview.perToken6).toBe(8_000n);
    expect(result.preview.allocated6).toBe(12_000_000n);
    expect(result.preview.remainder6).toBe(0n);
    expect(result.preview.navAfter6).toBe(992_000n);
    expect(result.preview.reportedAumAfter6).toBe(1_488_000_000n);
    expect(result.preview.anchorAfter6).toBe(992_000n);
  });

  it("rounds the allocation up and names the truncation remainder (PLAN.md D29)", () => {
    // 10.000000 USDC over 3 tokens at NAV 5.000000: perToken truncates to 3.333333, so the
    // allocation rounds back up to 9.999999 and one micro-USDC is never allocated to anybody.
    const result = assessDistribution(
      10_000_000n,
      facts({ supply18: 3n * TOKEN_SCALE, nav6: 5_000_000n, anchor6: 5_000_000n }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.preview.perToken6).toBe(3_333_333n);
    expect(result.preview.allocated6).toBe(9_999_999n);
    expect(result.preview.remainder6).toBe(1n);
    expect(result.preview.navAfter6).toBe(1_666_667n);
    expect(result.preview.anchorAfter6).toBe(1_666_667n);
  });

  it("refuses a zero amount", () => {
    const result = assessDistribution(0n, facts());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("ZeroAmount");
  });

  it("refuses more than MAX_INPUT", () => {
    const result = assessDistribution(MAX_INPUT + 1n, facts());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("AmountTooLarge");
  });

  it("refuses when nothing is outstanding, and says the USDC still moves first", () => {
    const result = assessDistribution(12_000_000n, facts({ supply18: 0n }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("NoSupply");
    expect(result.refusal.reason).toContain("before this check");
  });

  it("refuses an amount whose per-token increment truncates to zero", () => {
    // 1,500 tokens needs at least 1,500 units (0.0015 USDC) for a non-zero increment.
    const result = assessDistribution(1_499n, facts());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("DistributionTooSmall");
    expect(result.refusal.minimum6).toBe(1_500n);
    expect(assessDistribution(1_500n, facts()).ok).toBe(true);
  });

  it("refuses a per-token amount that is not below NAV", () => {
    // NAV 0.010000 over 1,500 tokens: 15.00 USDC is exactly NAV per token, so it is refused.
    const tight = facts({ nav6: 10_000n });
    const atNav = assessDistribution(15_000_000n, tight);
    expect(atNav.ok).toBe(false);
    if (atNav.ok) return;
    expect(atNav.refusal.code).toBe("DistributionExceedsNav");
    expect(atNav.refusal.maximum6).toBe(14_999_999n);
    expect(assessDistribution(14_999_999n, tight).ok).toBe(true);
  });

  it("floors reportedAUM at zero rather than underflowing", () => {
    const result = assessDistribution(12_000_000n, facts({ reportedAum6: 1_000_000n }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.reportedAumAfter6).toBe(0n);
  });

  it("floors the rail anchor at one, as the contract does", () => {
    const result = assessDistribution(12_000_000n, facts({ anchor6: 8_000n }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.anchorAfter6).toBe(1n);
  });
});

describe("the distribution bounds", () => {
  it("smallest is ceil(supply / 1e18)", () => {
    expect(smallestDistribution6(0n)).toBe(0n);
    expect(smallestDistribution6(TOKEN_SCALE)).toBe(1n);
    expect(smallestDistribution6(TOKEN_SCALE + 1n)).toBe(2n);
    expect(smallestDistribution6(1_500n * TOKEN_SCALE)).toBe(1_500n);
  });

  it("largest keeps the per-token amount strictly below NAV", () => {
    const supply = 1_500n * TOKEN_SCALE;
    const largest = largestDistribution6(supply, 1_000_000n);
    expect(largest).toBe(1_499_999_999n);
    expect(assessDistribution(largest, facts()).ok).toBe(true);
    expect(assessDistribution(largest + 1n, facts()).ok).toBe(false);
  });

  it("is zero when there is no supply or no NAV", () => {
    expect(largestDistribution6(0n, 1_000_000n)).toBe(0n);
    expect(largestDistribution6(TOKEN_SCALE, 0n)).toBe(0n);
  });
});

describe("checkFunding", () => {
  it("reports a short balance and the shortfall", () => {
    const check = checkFunding(12_000_000n, 5_000_000n, 12_000_000n);
    expect(check.balance).toBe("short");
    expect(check.balanceShortfall6).toBe(7_000_000n);
    expect(check.allowance).toBe("ok");
    expect(check.needsApproval).toBe(false);
  });

  it("asks for an approval when the allowance does not cover the amount", () => {
    const check = checkFunding(12_000_000n, 50_000_000n, 0n);
    expect(check.needsApproval).toBe(true);
    expect(check.allowance).toBe("short");
  });

  it("says unknown rather than guessing when the chain has not answered", () => {
    const check = checkFunding(12_000_000n, null, null);
    expect(check.balance).toBe("unknown");
    expect(check.allowance).toBe("unknown");
    expect(check.needsApproval).toBe(false);
    expect(check.balanceShortfall6).toBeNull();
  });
});
