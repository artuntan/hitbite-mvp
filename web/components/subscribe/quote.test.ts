/**
 * The subscribe quote is the one place in the app where a number we display becomes a number the
 * chain settles at. If `buildQuote` and `HBToken.subscribe` disagree by even one unit, the success
 * card contradicts the transaction that produced it.
 *
 * So these tests do not check the implementation against itself. They check it against the formula
 * written in BUILD_PROMPT 16.4 and implemented in `contracts/src/HBToken.sol`:
 *
 *     tokens (1e18) = usdcAmount (1e6) * 1e18 / nav (1e6)
 *
 * with Solidity's integer division, which truncates toward zero. `contracts/test/HBToken.fuzz.t.sol`
 * pins the same property from the chain's side.
 */

import { describe, expect, it } from "vitest";

import { amountTextFromUsdc6, buildQuote, chainNav, readAmount } from "./quote";

/** The contract's formula, written out independently of the module under test. */
function contractTokensOut(usdc6: bigint, nav6: bigint): bigint {
  return (usdc6 * 10n ** 18n) / nav6;
}

const NAV_ONE = 1_000_000n; // 1.000000 USDC
const NAV_PUBLISHED = 1_003_061n; // what the engine publishes today

function nav(value6: bigint) {
  return chainNav(value6, null);
}

describe("readAmount", () => {
  it("treats an empty box as the starting state, not an error", () => {
    const r = readAmount("");
    expect(r.empty).toBe(true);
    expect(r.error).toBeNull();
    expect(r.value6).toBeNull();
  });

  it("parses a plain amount to its 6-decimal integer", () => {
    expect(readAmount("100").value6).toBe(100_000_000n);
    expect(readAmount("1000.5").value6).toBe(1_000_500_000n);
    expect(readAmount("0.000001").value6).toBe(1n);
  });

  it("truncates excess precision downward rather than rounding it up (D52)", () => {
    // 1.9999999 would round to 2.000000. Rounding up would quote tokens the contract will not mint.
    const r = readAmount("1.9999999");
    expect(r.value6).toBe(1_999_999n);
    expect(r.truncated).toBe(true);

    const exact = readAmount("1.999999");
    expect(exact.value6).toBe(1_999_999n);
    expect(exact.truncated).toBe(false);
  });

  it("rejects zero and negatives, which the contract reverts on", () => {
    expect(readAmount("0").error).not.toBeNull();
    expect(readAmount("0").value6).toBeNull();
    expect(readAmount("-5").value6).toBeNull();
  });

  it("rejects an amount above the uint128 ceiling the contract enforces (D28)", () => {
    const overMax = (2n ** 128n).toString();
    expect(readAmount(overMax).error).not.toBeNull();
    expect(readAmount(overMax).value6).toBeNull();
  });

  it("rejects text that is not a number", () => {
    for (const bad of ["abc", "1.2.3", "1e6", "٣"]) {
      expect(readAmount(bad).value6, `${bad} should not parse`).toBeNull();
    }
  });

  it("round-trips through amountTextFromUsdc6", () => {
    for (const v of [1n, 100_000_000n, 1_999_999n, 123_456_789n]) {
      expect(readAmount(amountTextFromUsdc6(v)).value6).toBe(v);
    }
  });
});

describe("buildQuote", () => {
  it("reproduces the contract's formula at NAV 1.00, where nothing truncates", () => {
    const q = buildQuote(readAmount("1000"), nav(NAV_ONE));
    expect(q.tokensOut18).toBe(contractTokensOut(1_000_000_000n, NAV_ONE));
    expect(q.tokensOut18).toBe(1000n * 10n ** 18n);
    expect(q.truncatedTokens).toBe(false);
  });

  it("reproduces the contract's formula at the published NAV", () => {
    const amount = readAmount("1000");
    const q = buildQuote(amount, nav(NAV_PUBLISHED));
    expect(q.tokensOut18).toBe(contractTokensOut(1_000_000_000n, NAV_PUBLISHED));
    // 1000 USDC at 1.003061 buys strictly fewer than 1000 tokens.
    expect(q.tokensOut18! < 1000n * 10n ** 18n).toBe(true);
  });

  it("matches the contract across a wide grid of amounts and NAVs", () => {
    const amounts6 = [1n, 999n, 100_000_000n, 1_000_500_000n, 987_654_321n, 2n ** 60n];
    const navs6 = [1n, 999_999n, NAV_ONE, NAV_PUBLISHED, 5_000_000n, 2n ** 40n];
    for (const a of amounts6) {
      for (const n of navs6) {
        const q = buildQuote(readAmount(amountTextFromUsdc6(a)), nav(n));
        expect(q.tokensOut18, `amount ${a} at nav ${n}`).toBe(contractTokensOut(a, n));
      }
    }
  });

  it("never quotes more than the exact ratio — the rounding always favours the fund", () => {
    const amounts6 = [1n, 7n, 333_333n, 1_000_000n, 999_999_999n];
    const navs6 = [3n, 7n, NAV_PUBLISHED, 1_234_567n];
    for (const a of amounts6) {
      for (const n of navs6) {
        const q = buildQuote(readAmount(amountTextFromUsdc6(a)), nav(n));
        const exactNumerator = a * 10n ** 18n;
        expect(q.tokensOut18! * n <= exactNumerator).toBe(true);
        // ...and it is the *largest* such integer, i.e. floored rather than merely under.
        expect((q.tokensOut18! + 1n) * n > exactNumerator).toBe(true);
      }
    }
  });

  it("flags a truncating division, and does not flag an exact one", () => {
    // 1e18 is a multiple of 1e6, so at NAV 1.00 the division is exact for any whole-unit amount.
    expect(buildQuote(readAmount("1"), nav(NAV_ONE)).truncatedTokens).toBe(false);
    // At a NAV that is not a divisor, a remainder appears.
    expect(buildQuote(readAmount("1"), nav(NAV_PUBLISHED)).truncatedTokens).toBe(true);
  });

  it("quotes nothing when the NAV is unknown or zero rather than guessing", () => {
    expect(buildQuote(readAmount("1000"), null).tokensOut18).toBeNull();
    expect(buildQuote(readAmount("1000"), nav(0n)).tokensOut18).toBeNull();
  });

  it("quotes nothing for an unusable amount, and keeps the reason", () => {
    const q = buildQuote(readAmount("0"), nav(NAV_ONE));
    expect(q.tokensOut18).toBeNull();
    expect(q.amount6).toBeNull();
  });

  it("carries the amount-truncation flag through to the quote", () => {
    const q = buildQuote(readAmount("1.9999999"), nav(NAV_ONE));
    expect(q.truncatedAmount).toBe(true);
    expect(q.amount6).toBe(1_999_999n);
  });

  it("rounds a dust subscription to zero tokens, which the contract reverts on", () => {
    // tokens = usdc6 * 1e18 / nav6 floors to zero only once nav6 exceeds usdc6 * 1e18. For the
    // smallest possible amount, one unit of USDC, that means a NAV above 1e18.
    const dustNav = 2n * 10n ** 18n;
    const q = buildQuote(readAmount("0.000001"), nav(dustNav));
    expect(q.tokensOut18).toBe(0n);
    expect(q.tokensOut18).toBe(contractTokensOut(1n, dustNav));

    // One unit below that boundary still mints something, so the zero above is the real edge.
    expect(buildQuote(readAmount("0.000001"), nav(10n ** 18n)).tokensOut18).toBe(1n);
  });
});
