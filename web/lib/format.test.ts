import { describe, expect, it } from "vitest";
import { formatUsdc } from "./format";

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
