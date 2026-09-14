import { describe, expect, it } from "vitest";
import {
  FormatError,
  MAX_INPUT,
  formatAddress,
  formatBasisPoints,
  formatBasisPointsAsPercent,
  formatDate,
  formatDateTimeUtc,
  formatFixed,
  formatIsoDate,
  formatNumber,
  formatPercent,
  formatPercentDelta,
  formatPlain,
  formatRatio1e18,
  formatTokens,
  formatTokensExact,
  formatTokensWithSymbol,
  formatTxHash,
  formatUnixSeconds,
  formatUsdDelta,
  formatUsdString,
  formatUsdc,
  formatUsdcExact,
  formatUsdcWithSymbol,
  isWithinContractBounds,
  parseAmount,
  parseFixed,
  previewRedeemUsdc,
  previewSubscribeTokens,
  toTokens18,
  toUsdc6,
  tryParseFixed,
} from "./format";

describe("formatUsdc", () => {
  it("formats a 6-decimal amount with two decimals and thousands separators", () => {
    expect(formatUsdc(1_234_560_000n)).toBe("1,234.56");
  });

  it("formats zero and whole units", () => {
    expect(formatUsdc(0n)).toBe("0.00");
    expect(formatUsdc(1_000_000n)).toBe("1.00");
    expect(formatUsdc(100_000_000n)).toBe("100.00");
  });

  it("pads the fractional part", () => {
    expect(formatUsdc(1_050_000n)).toBe("1.05");
    expect(formatUsdc(10_000n)).toBe("0.01");
  });

  it("rounds half away from zero to the nearest cent", () => {
    expect(formatUsdc(4_999n)).toBe("0.00");
    expect(formatUsdc(5_000n)).toBe("0.01");
    expect(formatUsdc(999_999n)).toBe("1.00");
    expect(formatUsdc(1_234_565_000n)).toBe("1,234.57");
    expect(formatUsdc(-1_234_565_000n)).toBe("-1,234.57");
  });

  it("handles negative amounts and rounds tiny negatives to zero without a sign", () => {
    expect(formatUsdc(-1_234_560_000n)).toBe("-1,234.56");
    expect(formatUsdc(-4_999n)).toBe("0.00");
  });

  it("handles amounts beyond Number.MAX_SAFE_INTEGER exactly", () => {
    expect(formatUsdc(1_000_000_000_000_000_000n)).toBe("1,000,000,000,000.00");
    expect(formatUsdc(123_456_789_012_345_678_901_234n)).toBe("123,456,789,012,345,678.90");
  });
});

describe("formatFixed", () => {
  it("defaults to the value's own scale", () => {
    expect(formatFixed(1_003_061n, 6)).toBe("1.003061");
    expect(formatFixed(0n, 0)).toBe("0");
  });

  it("widens as well as narrows the display scale", () => {
    expect(formatFixed(150n, 2, { displayDecimals: 6 })).toBe("1.500000");
    expect(formatFixed(1n, 0, { displayDecimals: 4 })).toBe("1.0000");
  });

  it("truncates instead of rounding when asked", () => {
    expect(formatFixed(1_999_999n, 6, { displayDecimals: 2, rounding: "trunc" })).toBe("1.99");
    expect(formatFixed(1_999_999n, 6, { displayDecimals: 2, rounding: "half-up" })).toBe("2.00");
  });

  it("rounds exactly at the half boundary, away from zero, in both directions", () => {
    // 0.005 at cent scale: the boundary case a float formatter gets wrong.
    expect(formatFixed(5_000n, 6, { displayDecimals: 2 })).toBe("0.01");
    expect(formatFixed(4_999n, 6, { displayDecimals: 2 })).toBe("0.00");
    expect(formatFixed(15_000n, 6, { displayDecimals: 2 })).toBe("0.02");
    expect(formatFixed(-5_000n, 6, { displayDecimals: 2 })).toBe("-0.01");
    expect(formatFixed(-4_999n, 6, { displayDecimals: 2 })).toBe("0.00");
  });

  it("never renders a negative zero", () => {
    expect(formatFixed(-1n, 18, { displayDecimals: 2 })).toBe("0.00");
    expect(formatFixed(-1n, 18, { displayDecimals: 2, signDisplay: "always" })).toBe("0.00");
  });

  it("adds an explicit plus only to non-zero positives", () => {
    expect(formatFixed(1_000_000n, 6, { displayDecimals: 2, signDisplay: "always" })).toBe("+1.00");
    expect(formatFixed(0n, 6, { displayDecimals: 2, signDisplay: "always" })).toBe("0.00");
    expect(formatFixed(-1_000_000n, 6, { displayDecimals: 2, signDisplay: "always" })).toBe(
      "-1.00",
    );
  });

  it("groups by default and can be told not to", () => {
    expect(formatFixed(1_234_567_000_000n, 6, { displayDecimals: 2 })).toBe("1,234,567.00");
    expect(formatFixed(1_234_567_000_000n, 6, { displayDecimals: 2, group: false })).toBe(
      "1234567.00",
    );
  });

  it("handles very small and very large magnitudes without losing a digit", () => {
    // One wei of an 18-decimal token.
    expect(formatFixed(1n, 18)).toBe("0.000000000000000001");
    // The contract's MAX_INPUT bound, 2^128 - 1, as USDC. Not a single digit is lost, which a
    // Number-based formatter cannot claim past 2^53.
    expect(formatFixed(MAX_INPUT, 6)).toBe("340,282,366,920,938,463,463,374,607,431,768.211455");
    expect(formatFixed(MAX_INPUT, 6, { displayDecimals: 0 })).toBe(
      "340,282,366,920,938,463,463,374,607,431,768",
    );
  });

  it("rejects a nonsensical scale", () => {
    expect(() => formatFixed(1n, -1)).toThrow(FormatError);
    expect(() => formatFixed(1n, 6, { displayDecimals: -1 })).toThrow(FormatError);
  });
});

describe("formatPlain", () => {
  it("emits machine-readable text with no separators", () => {
    expect(formatPlain(1_234_567_000_000n, 6)).toBe("1234567.000000");
    expect(formatPlain(10n ** 18n, 18)).toBe("1.000000000000000000");
  });
});

describe("parseFixed", () => {
  it("parses a fixed-scale string exactly", () => {
    expect(parseFixed("1016860.71", 6)).toBe(1_016_860_710_000n);
    expect(parseFixed("1.003061", 6)).toBe(1_003_061n);
    expect(parseFixed("0.00", 6)).toBe(0n);
    expect(parseFixed("-22658.30", 6)).toBe(-22_658_300_000n);
  });

  it("accepts fewer fractional digits than the scale and pads them", () => {
    expect(parseFixed("1", 6)).toBe(1_000_000n);
    expect(parseFixed("1.5", 6)).toBe(1_500_000n);
  });

  it("refuses to silently drop precision", () => {
    expect(() => parseFixed("1.0000001", 6)).toThrow(/more than the 6/);
  });

  it("rejects anything that is not a plain decimal", () => {
    for (const bad of ["", "abc", "1e6", "1,000.00", "0x10", "1.2.3", "Infinity", "NaN"]) {
      expect(() => parseFixed(bad, 6)).toThrow(FormatError);
    }
  });

  it("round-trips through formatFixed for values far beyond double precision", () => {
    const huge = "123456789012345678901234567890.123456";
    expect(formatFixed(parseFixed(huge, 6), 6, { group: false })).toBe(huge);
  });

  it("tryParseFixed returns null instead of throwing", () => {
    expect(tryParseFixed("nope", 6)).toBeNull();
    expect(tryParseFixed("1.00", 6)).toBe(1_000_000n);
  });

  it("converts engine display strings", () => {
    expect(toUsdc6("12500.00")).toBe(12_500_000_000n);
    expect(toTokens18("1.000000000000000000")).toBe(10n ** 18n);
  });
});

describe("parseAmount", () => {
  it("accepts ordinary input", () => {
    expect(parseAmount("1000", 6)).toEqual({ ok: true, value: 1_000_000_000n, truncated: false });
    expect(parseAmount("  1,000.50 ", 6)).toEqual({
      ok: true,
      value: 1_000_500_000n,
      truncated: false,
    });
    expect(parseAmount(".5", 6)).toEqual({ ok: true, value: 500_000n, truncated: false });
    expect(parseAmount("7.", 6)).toEqual({ ok: true, value: 7_000_000n, truncated: false });
  });

  it("truncates excess precision downwards and says so", () => {
    // 1.9999999 USDC cannot be sent; 1.999999 can. Rounding up would quote an amount the
    // wallet would then fail to transfer.
    expect(parseAmount("1.9999999", 6)).toEqual({ ok: true, value: 1_999_999n, truncated: true });
  });

  it("rejects empty, negative and non-numeric input with a message", () => {
    expect(parseAmount("", 6).ok).toBe(false);
    expect(parseAmount("   ", 6).ok).toBe(false);
    expect(parseAmount("-5", 6).ok).toBe(false);
    expect(parseAmount("five", 6).ok).toBe(false);
  });
});

describe("contract bounds", () => {
  it("accepts a positive amount up to MAX_INPUT and nothing beyond", () => {
    expect(isWithinContractBounds(1n)).toBe(true);
    expect(isWithinContractBounds(MAX_INPUT)).toBe(true);
    expect(isWithinContractBounds(MAX_INPUT + 1n)).toBe(false);
    expect(isWithinContractBounds(0n)).toBe(false);
    expect(isWithinContractBounds(-1n)).toBe(false);
  });

  it("MAX_INPUT is type(uint128).max, as HBToken declares", () => {
    expect(MAX_INPUT).toBe(340_282_366_920_938_463_463_374_607_431_768_211_455n);
  });
});

describe("preview maths matches the contract", () => {
  const NAV_ONE = 1_000_000n;

  it("subscribe: tokens = usdc * 1e18 / nav, truncated", () => {
    expect(previewSubscribeTokens(1_000_000_000n, NAV_ONE)).toBe(1_000n * 10n ** 18n);
    expect(previewSubscribeTokens(1_000_000_000n, 1_004_300n)).toBe(
      (1_000_000_000n * 10n ** 18n) / 1_004_300n,
    );
  });

  it("redeem: usdcOut = tokens * nav / 1e18, truncated", () => {
    expect(previewRedeemUsdc(200n * 10n ** 18n, 1_004_300n)).toBe(200_860_000n);
  });

  it("truncates rather than rounds, so a quote is never above what settles", () => {
    // nav = 3, so 1 micro-USDC buys 333333333333333333 wei and one third is lost to truncation.
    expect(previewSubscribeTokens(1n, 3n)).toBe(333_333_333_333_333_333n);
    // The reverse trip returns 0 micro-USDC, exactly as the contract would.
    expect(previewRedeemUsdc(333_333_333_333_333_333n, 3n)).toBe(0n);
  });

  it("a round trip at one NAV never creates value (BUILD_PROMPT 5.5)", () => {
    for (const nav of [1n, 999_999n, 1_000_000n, 1_000_001n, 7_654_321n]) {
      for (const usdcIn of [1n, 100n, 100_000_000n, 1_000_000_000_000n]) {
        const tokens = previewSubscribeTokens(usdcIn, nav);
        const usdcOut = previewRedeemUsdc(tokens, nav);
        expect(usdcOut <= usdcIn).toBe(true);
      }
    }
  });

  it("refuses a zero or negative NAV and a negative amount", () => {
    expect(() => previewSubscribeTokens(1n, 0n)).toThrow(FormatError);
    expect(() => previewRedeemUsdc(1n, 0n)).toThrow(FormatError);
    expect(() => previewSubscribeTokens(-1n, 1_000_000n)).toThrow(FormatError);
    expect(() => previewRedeemUsdc(-1n, 1_000_000n)).toThrow(FormatError);
  });
});

describe("USDC and token display helpers", () => {
  it("shows all six decimals when exactness matters", () => {
    expect(formatUsdcExact(1_003_061n)).toBe("1.003061");
    expect(formatUsdcExact(0n)).toBe("0.000000");
  });

  it("appends a symbol", () => {
    expect(formatUsdcWithSymbol(1_500_000n)).toBe("1.50 USDC");
    expect(formatTokensWithSymbol(1_500_000_000_000_000_000n)).toBe("1.5000 hbTRS");
  });

  it("formats engine display strings", () => {
    expect(formatUsdString("1016860.71")).toBe("1,016,860.71");
    expect(formatUsdString("12500.00")).toBe("12,500.00");
    expect(formatUsdDelta("-22658.30")).toBe("-22,658.30");
    expect(formatUsdDelta("98721.01")).toBe("+98,721.01");
  });

  it("truncates token balances rather than rounding them up", () => {
    // 0.99999 hbTRS must not be shown as 1.0000: the holder cannot transfer a whole token.
    expect(formatTokens(999_990_000_000_000_000n)).toBe("0.9999");
    expect(formatTokens(10n ** 18n)).toBe("1.0000");
    expect(formatTokensExact(1n)).toBe("0.000000000000000001");
  });

  it("formats a 1e18-scaled ratio", () => {
    expect(formatRatio1e18(10n ** 18n)).toBe("1.0000");
    expect(formatRatio1e18(1_234_500_000_000_000_000n)).toBe("1.2345");
  });
});

describe("percentages and basis points", () => {
  it("formats an analytic float", () => {
    expect(formatPercent(6.421046)).toBe("6.42%");
    expect(formatPercent(6.421046, 4)).toBe("6.4210%");
    expect(formatPercent(0)).toBe("0.00%");
    expect(formatPercent(-2.22826)).toBe("-2.23%");
  });

  it("formats a fixed-scale string exactly", () => {
    expect(formatPercent("6.421046", 4)).toBe("6.4210%");
    expect(formatPercent("6.425000", 3)).toBe("6.425%");
  });

  it("shows an explicit sign for deltas and never a signed zero", () => {
    expect(formatPercentDelta(9.708411)).toBe("+9.71%");
    expect(formatPercentDelta(-8.485051)).toBe("-8.49%");
    expect(formatPercentDelta(0)).toBe("0.00%");
  });

  it("formats plain analytic numbers", () => {
    expect(formatNumber(4.587369)).toBe("4.59");
    expect(formatNumber(30.882722, 3)).toBe("30.883");
    expect(formatNumber("4.58736900")).toBe("4.59");
  });

  it("rejects a non-finite analytic value rather than printing NaN", () => {
    expect(() => formatPercent(Number.NaN)).toThrow(FormatError);
    expect(() => formatPercent(Number.POSITIVE_INFINITY)).toThrow(FormatError);
  });

  it("formats basis points as themselves and as a percentage", () => {
    expect(formatBasisPoints(500)).toBe("500 bp");
    expect(formatBasisPoints(10_000n)).toBe("10,000 bp");
    expect(formatBasisPointsAsPercent(500)).toBe("5.00%");
    expect(formatBasisPointsAsPercent(1)).toBe("0.01%");
    expect(formatBasisPointsAsPercent(12_345, 2)).toBe("123.45%");
  });
});

describe("dates", () => {
  it("formats an ISO date in UTC, without a locale", () => {
    expect(formatDate("2026-09-14")).toBe("14 Sep 2026");
    expect(formatDate("2026-01-01")).toBe("1 Jan 2026");
    expect(formatDate("2026-12-31")).toBe("31 Dec 2026");
  });

  it("formats an ISO timestamp with the UTC suffix", () => {
    expect(formatDateTimeUtc("2026-09-14T06:00:00Z")).toBe("14 Sep 2026, 06:00 UTC");
    expect(formatDateTimeUtc("2026-09-14T23:59:59Z")).toBe("14 Sep 2026, 23:59 UTC");
  });

  it("is independent of the host time zone", () => {
    // A timestamp late in the UTC day would roll over into the next day in +03:00 (Istanbul) and
    // back into the previous one in -05:00. Formatting from UTC components keeps server and
    // browser renders identical, which is what stops React reporting a hydration mismatch.
    expect(formatDate("2026-09-14T23:30:00Z")).toBe("14 Sep 2026");
    expect(formatDate("2026-09-14T00:30:00Z")).toBe("14 Sep 2026");
  });

  it("normalises back to an ISO date", () => {
    expect(formatIsoDate("2026-09-14T06:00:00Z")).toBe("2026-09-14");
    expect(formatIsoDate("2026-01-05")).toBe("2026-01-05");
  });

  it("formats unix seconds from the deployment record", () => {
    expect(formatUnixSeconds(1_789_420_690)).toBe("14 Sep 2026, 21:18 UTC");
    expect(formatUnixSeconds(1_789_420_690n)).toBe("14 Sep 2026, 21:18 UTC");
  });

  it("rejects an unparseable date rather than rendering 'Invalid Date'", () => {
    expect(() => formatDate("not-a-date")).toThrow(FormatError);
    expect(() => formatDateTimeUtc("2026-13-45")).toThrow(FormatError);
  });
});

describe("addresses and hashes", () => {
  it("shortens an address around an ellipsis", () => {
    expect(formatAddress("0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0")).toBe("0x9fE4…a6e0");
    expect(formatAddress("0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0", 6)).toBe("0x9fE467…7fa6e0");
  });

  it("shortens a transaction hash", () => {
    // The real HBToken creation hash from the local Anvil deployment: public chain data, not a
    // secret. The marker is for scripts/check-secrets.sh, whose bare-hex rule cannot tell a tx
    // hash from a private key by shape alone.
    const hash = "0x5e8ed126a35a187a3706300d6b4cf231dbac1942d71b22aa74a11955811872cb"; // allow-secret
    expect(formatTxHash(hash)).toBe("0x5e8ed1…1872cb");
  });

  it("returns anything that is not hex unchanged instead of throwing inside a render", () => {
    expect(formatAddress("")).toBe("");
    expect(formatAddress("not an address")).toBe("not an address");
    expect(formatAddress("0xabc")).toBe("0xabc");
  });
});
