import { describe, expect, it } from "vitest";

import {
  assessNavMove,
  checkNavInput,
  checkReportedAumInput,
  maxDeltaFor,
  possibleAnchors,
  ROLL_SAFETY_SECONDS,
  suggestedReportedAum6,
  type RailFacts,
} from "@/components/admin/nav-rail";
import { MAX_INPUT } from "@/lib/format";

const DAY = 86_400n;
const NOON = 1_789_420_690n;

/** NAV 1.000000, anchor 1.000000, 5 % rail, window opened an hour ago. */
function facts(overrides: Partial<RailFacts> = {}): RailFacts {
  return {
    nav6: 1_000_000n,
    anchor6: 1_000_000n,
    windowStart: NOON - 3_600n,
    railWindow: DAY,
    maxBps: 500n,
    nowSeconds: NOON,
    ...overrides,
  };
}

describe("checkNavInput", () => {
  it("refuses zero, which the contract rejects as InvalidNav", () => {
    const verdict = checkNavInput(0n);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.error).toBe("InvalidNav");
  });

  it("refuses anything above MAX_INPUT", () => {
    expect(checkNavInput(MAX_INPUT).ok).toBe(true);
    expect(checkNavInput(MAX_INPUT + 1n).ok).toBe(false);
  });

  it("accepts a NAV of one micro-USDC, which the contract also accepts", () => {
    expect(checkNavInput(1n).ok).toBe(true);
  });
});

describe("checkReportedAumInput", () => {
  it("bounds reportedAUM by MAX_INPUT, and allows zero", () => {
    expect(checkReportedAumInput(0n)).toBe(true);
    expect(checkReportedAumInput(MAX_INPUT)).toBe(true);
    expect(checkReportedAumInput(MAX_INPUT + 1n)).toBe(false);
  });
});

describe("maxDeltaFor", () => {
  it("floors, exactly as the contract's integer comparison does", () => {
    expect(maxDeltaFor(1_000_000n, 500n)).toBe(50_000n);
    // 1_000_001 * 500 / 10_000 = 50_000.05, floored to 50_000: the extra micro-USDC of anchor buys
    // no extra room, which is exactly how the contract's integer division behaves.
    expect(maxDeltaFor(1_000_001n, 500n)).toBe(50_000n);
    expect(maxDeltaFor(1_000_000n, 0n)).toBe(0n);
    expect(maxDeltaFor(0n, 500n)).toBe(0n);
  });
});

describe("assessNavMove", () => {
  it("passes a move inside the rail and reports the band", () => {
    const assessment = assessNavMove(1_030_000n, facts());
    expect(assessment.verdict).toBe("inside");
    expect(assessment.checks).toHaveLength(1);
    expect(assessment.checks[0]?.breaches).toBe(false);
    expect(assessment.checks[0]?.delta6).toBe(30_000n);
    // 3.00 % = 300.00 bp, carried as hundredths.
    expect(assessment.checks[0]?.deltaBpsHundredths).toBe(30_000n);
    expect(assessment.band).toEqual({ min6: 950_000n, max6: 1_050_000n });
  });

  it("uses the contract's own comparison at the exact boundary", () => {
    // delta * 10_000 > anchor * maxBps, so a delta of exactly 5 % is allowed and one unit more is not.
    expect(assessNavMove(1_050_000n, facts()).verdict).toBe("inside");
    expect(assessNavMove(1_050_001n, facts()).verdict).toBe("breach");
    expect(assessNavMove(950_000n, facts()).verdict).toBe("inside");
    expect(assessNavMove(949_999n, facts()).verdict).toBe("breach");
  });

  it("measures against the window anchor, not the last NAV (PLAN.md D27)", () => {
    // Three in-rail steps have already moved NAV to 1.0499; the anchor is still 1.000000, so a
    // further 1 % step breaches even though it is tiny relative to the current NAV.
    const assessment = assessNavMove(1_060_000n, facts({ nav6: 1_049_900n }));
    expect(assessment.verdict).toBe("breach");
    expect(assessment.checks[0]?.anchor.anchor6).toBe(1_000_000n);
  });

  it("re-anchors on the current NAV once the window has elapsed", () => {
    const assessment = assessNavMove(
      1_080_000n,
      facts({ nav6: 1_049_900n, windowStart: NOON - DAY }),
    );
    expect(assessment.windowRolled).toBe(true);
    expect(assessment.checks).toHaveLength(1);
    expect(assessment.checks[0]?.anchor.anchor6).toBe(1_049_900n);
    expect(assessment.verdict).toBe("inside");
  });

  it("checks both anchors while the window is about to roll (PLAN.md D31)", () => {
    const windowStart = NOON - DAY + ROLL_SAFETY_SECONDS - 1n;
    const near = facts({ nav6: 1_049_900n, windowStart });
    const assessment = assessNavMove(1_080_000n, near);

    expect(assessment.windowRollsSoon).toBe(true);
    expect(assessment.checks).toHaveLength(2);
    // Clears the post-roll anchor (1.0499) and breaches the current one (1.000000).
    expect(assessment.verdict).toBe("partial");
    // The safe band is the intersection, so it is the tighter of the two.
    expect(assessment.band).toEqual({ min6: 997_405n, max6: 1_050_000n });
  });

  it("collapses the two anchors when they are the same value", () => {
    const windowStart = NOON - DAY + 1n;
    expect(possibleAnchors(facts({ windowStart }))).toHaveLength(1);
  });

  it("floors the band at one micro-USDC, because a NAV of zero is InvalidNav", () => {
    const assessment = assessNavMove(1n, facts({ nav6: 10n, anchor6: 10n, maxBps: 10_000n }));
    expect(assessment.band.min6).toBe(1n);
    expect(assessment.verdict).toBe("inside");
  });

  it("allows only the anchor itself when the rail is zero", () => {
    expect(assessNavMove(1_000_000n, facts({ maxBps: 0n })).verdict).toBe("inside");
    expect(assessNavMove(1_000_001n, facts({ maxBps: 0n })).verdict).toBe("breach");
  });
});

describe("suggestedReportedAum6", () => {
  it("is nav times supply, in the contract's integers (PLAN.md D19)", () => {
    // 1.003061 USDC per token, 1,000 tokens.
    expect(suggestedReportedAum6(1_003_061n, 1_000n * 10n ** 18n)).toBe(1_003_061_000n);
  });

  it("is zero when either side is zero", () => {
    expect(suggestedReportedAum6(0n, 10n ** 18n)).toBe(0n);
    expect(suggestedReportedAum6(1_000_000n, 0n)).toBe(0n);
  });

  it("truncates rather than rounds", () => {
    // 1.000001 * 1.5 tokens = 1.5000015 -> 1.500001
    expect(suggestedReportedAum6(1_000_001n, 1_500_000_000_000_000_000n)).toBe(1_500_001n);
  });
});
