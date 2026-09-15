/**
 * The redeem quote is a number this page shows before a wallet is asked for a signature, so it has
 * to be the number `HBToken.redeem` settles at. These tests check it against the formula written in
 * `contracts/src/HBToken.sol`:
 *
 *     usdcOut (1e6) = tokenAmount (1e18) * nav (1e6) / 1e18
 *
 * with Solidity's truncating division, and against the two rules the contract enforces around it:
 * `InsufficientLiquidity` measured against `availableLiquidity()` rather than the vault (PLAN.md
 * D6), and **no eligibility check at all** on the way out (PLAN.md D4).
 *
 * The last one is the reason this file exists at all. A verification gate added here would be
 * invisible in a review and would trap somebody's money in an interface the contract deliberately
 * lets them leave.
 */

import { describe, expect, it } from "vitest";

import {
  EMPTY_PORTFOLIO_CHAIN_STATE,
  buildRedeemGates,
  buildRedeemQuote,
  claimReadiness,
  maxRedeemableTokens18,
  readTokenAmount,
  redeemReadiness,
  tokenAmountText,
  valueAtNav,
  type PortfolioChainState,
  type RedeemGateInput,
} from "./position";

/** The contract's formula, written out independently of the module under test. */
function contractUsdcOut(tokens18: bigint, nav6: bigint): bigint {
  return (tokens18 * nav6) / 10n ** 18n;
}

const ONE_TOKEN = 1_000_000_000_000_000_000n;
const NAV = 1_003_061n;

function chainState(overrides: Partial<PortfolioChainState> = {}): PortfolioChainState {
  return {
    ...EMPTY_PORTFOLIO_CHAIN_STATE,
    reads: "ready",
    nav6: NAV,
    paused: false,
    balance18: 1_000n * ONE_TOKEN,
    pendingCoupon6: 0n,
    availableLiquidity6: 10_000_000_000n,
    vaultBalance6: 10_500_000_000n,
    couponReserve6: 500_000_000n,
    canHold: true,
    ...overrides,
  };
}

function gateInput(overrides: Partial<RedeemGateInput> = {}): RedeemGateInput {
  const chain = overrides.chain ?? chainState();
  const amount = overrides.amount ?? readTokenAmount("100");
  return {
    network: "ready",
    requiredChainLabel: "Base Sepolia",
    currentChainLabel: "Base Sepolia",
    currentChainId: 84532,
    ownAddress: true,
    chain,
    amount,
    quote: buildRedeemQuote(amount, chain, null),
    ...overrides,
  };
}

function gate(input: RedeemGateInput, id: string) {
  const found = buildRedeemGates(input).find((entry) => entry.id === id);
  if (!found) throw new Error(`no gate ${id}`);
  return found;
}

describe("readTokenAmount", () => {
  it("treats an empty box as the starting state, not an error", () => {
    const reading = readTokenAmount("");
    expect(reading.empty).toBe(true);
    expect(reading.error).toBeNull();
    expect(reading.value18).toBeNull();
  });

  it("parses to the 18-decimal integer the contract takes", () => {
    expect(readTokenAmount("1").value18).toBe(ONE_TOKEN);
    expect(readTokenAmount("0.000000000000000001").value18).toBe(1n);
    expect(readTokenAmount("1,250.5").value18).toBe(1_250_500_000_000_000_000_000n);
  });

  it("truncates a nineteenth decimal downward rather than rounding it up (D52)", () => {
    const reading = readTokenAmount("1.9999999999999999999");
    expect(reading.value18).toBe(1_999_999_999_999_999_999n);
    expect(reading.truncated).toBe(true);
  });

  it("rejects the two amounts `redeem` reverts on", () => {
    expect(readTokenAmount("0").error).toMatch(/ZeroAmount/);
    // 2^128, one above MAX_INPUT, expressed in whole tokens.
    const tooLarge = readTokenAmount("340282366920938463463374607431768211456");
    expect(tooLarge.error).toMatch(/AmountTooLarge/);
    expect(tooLarge.value18).toBeNull();
  });

  it("round-trips an integer through the amount box", () => {
    const value = 1_234_567_890_123_456_789n;
    expect(readTokenAmount(tokenAmountText(value)).value18).toBe(value);
  });
});

describe("valueAtNav and maxRedeemableTokens18", () => {
  it("values a balance with the contract's arithmetic", () => {
    expect(valueAtNav(1_000n * ONE_TOKEN, NAV)).toBe(contractUsdcOut(1_000n * ONE_TOKEN, NAV));
    expect(valueAtNav(null, NAV)).toBeNull();
    expect(valueAtNav(ONE_TOKEN, null)).toBeNull();
  });

  it("caps the maximum at whatever available liquidity can actually pay for", () => {
    // 100.000000 USDC available at NAV 1.003061 buys 99.694... tokens back.
    const max = maxRedeemableTokens18(100_000_000n, NAV, 1_000n * ONE_TOKEN);
    expect(max).toBe((100_000_000n * 10n ** 18n) / NAV);
    // And the payout for exactly that amount is within the available liquidity, which is the
    // comparison `redeem` makes.
    expect(contractUsdcOut(max as bigint, NAV)).toBeLessThanOrEqual(100_000_000n);
  });

  it("caps the maximum at the balance when liquidity is the larger of the two", () => {
    expect(maxRedeemableTokens18(10_000_000_000n, NAV, 5n * ONE_TOKEN)).toBe(5n * ONE_TOKEN);
  });

  it("is null when either side is unreadable", () => {
    expect(maxRedeemableTokens18(null, NAV, ONE_TOKEN)).toBeNull();
    expect(maxRedeemableTokens18(1n, null, ONE_TOKEN)).toBeNull();
    expect(maxRedeemableTokens18(1n, NAV, null)).toBeNull();
  });
});

describe("buildRedeemQuote", () => {
  it("reproduces previewRedeem exactly, truncation included", () => {
    for (const text of ["1", "100", "1234.567891234567891", "0.000000000000000001"]) {
      const amount = readTokenAmount(text);
      const quote = buildRedeemQuote(amount, chainState(), null);
      expect(quote.local6).toBe(contractUsdcOut(amount.value18 as bigint, NAV));
      expect(quote.usdcOut6).toBe(quote.local6);
      expect(quote.source).toBe("local");
    }
  });

  it("prefers the contract's own answer when previewRedeem has returned one", () => {
    const amount = readTokenAmount("100");
    const quote = buildRedeemQuote(amount, chainState(), 99_999_999n);
    expect(quote.source).toBe("chain");
    expect(quote.usdcOut6).toBe(99_999_999n);
    // Disagreement is surfaced, not resolved silently: it means the NAV moved between two reads.
    expect(quote.mismatch).toBe(true);
  });

  it("measures the shortfall against available liquidity, not the vault", () => {
    const chain = chainState({ availableLiquidity6: 50_000_000n, vaultBalance6: 10_000_000_000n });
    const amount = readTokenAmount("100");
    const quote = buildRedeemQuote(amount, chain, null);
    expect(quote.usdcOut6).toBe(contractUsdcOut(100n * ONE_TOKEN, NAV));
    expect(quote.shortfall6).toBe((quote.usdcOut6 as bigint) - 50_000_000n);
  });

  it("flags a payout that truncates to zero, which the contract rejects", () => {
    // One wei of a token is worth far less than one micro-USDC.
    const quote = buildRedeemQuote(readTokenAmount("0.000000000000000001"), chainState(), null);
    expect(quote.usdcOut6).toBe(0n);
    expect(quote.zeroPayout).toBe(true);
  });

  it("flags a balance the burn would exceed", () => {
    const quote = buildRedeemQuote(readTokenAmount("1001"), chainState(), null);
    expect(quote.exceedsBalance).toBe(true);
  });

  it("quotes nothing when there is no NAV to quote against", () => {
    const quote = buildRedeemQuote(readTokenAmount("10"), chainState({ nav6: null }), null);
    expect(quote.usdcOut6).toBeNull();
    expect(quote.source).toBeNull();
  });
});

describe("the redeem gates", () => {
  it("passes every gate on a healthy state", () => {
    const readiness = redeemReadiness(buildRedeemGates(gateInput()));
    expect(readiness.canRedeem).toBe(true);
    expect(readiness.blockers).toEqual([]);
  });

  it("never gates a redemption on eligibility (D4)", () => {
    const input = gateInput({ chain: chainState({ canHold: false, identity: null }) });
    const gates = buildRedeemGates(input);

    expect(gates.some((entry) => /verif|eligib|whitelist/i.test(entry.label))).toBe(false);
    expect(gates.some((entry) => /verif|eligib|whitelist/i.test(entry.detail))).toBe(false);
    expect(redeemReadiness(gates).canRedeem).toBe(true);
  });

  it("blocks on the pause, which is the one thing that can hold up an exit", () => {
    const input = gateInput({ chain: chainState({ paused: true }) });
    expect(gate(input, "paused").status).toBe("blocked");
    expect(redeemReadiness(buildRedeemGates(input)).canRedeem).toBe(false);
  });

  it("explains a liquidity shortfall with both numbers before anything is signed", () => {
    const chain = chainState({
      availableLiquidity6: 50_000_000n,
      vaultBalance6: 10_000_000_000n,
      couponReserve6: 9_950_000_000n,
    });
    const input = gateInput({ chain });
    const liquidity = gate(input, "liquidity");

    expect(liquidity.status).toBe("blocked");
    // The available figure, the requested figure, and the name of the error it would revert with.
    expect(liquidity.detail).toContain("50.000000");
    expect(liquidity.detail).toContain("InsufficientLiquidity");
    // And why the rest of the vault is not available: the coupon reserve is not the holder's money.
    expect(liquidity.detail).toContain("9,950.000000");
    expect(liquidity.action).toBe("max-liquidity");
  });

  it("blocks a burn larger than the balance", () => {
    const input = gateInput({ amount: readTokenAmount("5000") });
    const balance = gate(
      { ...input, quote: buildRedeemQuote(input.amount, input.chain, null) },
      "balance",
    );
    expect(balance.status).toBe("blocked");
    expect(balance.detail).toContain("ERC20InsufficientBalance");
  });

  it("waits rather than complains before an amount is typed", () => {
    const input = gateInput({ amount: readTokenAmount("") });
    expect(gate(input, "amount").status).toBe("waiting");
    expect(redeemReadiness(buildRedeemGates(input)).canRedeem).toBe(false);
  });

  it("refuses to act for an address the connected wallet does not hold", () => {
    const input = gateInput({ ownAddress: false });
    expect(gate(input, "wallet").status).toBe("blocked");
  });

  it("reports an unreadable chain as unknown rather than as a pass", () => {
    const input = gateInput({
      chain: chainState({ reads: "no-deployment", nav6: null, paused: null, balance18: null }),
    });
    expect(gate(input, "deployment").status).toBe("unknown");
    expect(gate(input, "paused").status).toBe("unknown");
    expect(gate(input, "liquidity").status).not.toBe("ok");
  });
});

describe("claimReadiness", () => {
  it("lets a de-verified holder claim (D4)", () => {
    const readiness = claimReadiness(
      chainState({ canHold: false, pendingCoupon6: 12_500_000n }),
      "ready",
      true,
    );
    expect(readiness.canClaim).toBe(true);
    expect(readiness.reason).toBeNull();
  });

  it("refuses with the contract's reason when nothing has accrued", () => {
    const readiness = claimReadiness(chainState({ pendingCoupon6: 0n }), "ready", true);
    expect(readiness.canClaim).toBe(false);
    expect(readiness.reason).toContain("NothingToClaim");
  });

  it("refuses while the token is paused, and says the coupon is not lost", () => {
    const readiness = claimReadiness(
      chainState({ paused: true, pendingCoupon6: 1n }),
      "ready",
      true,
    );
    expect(readiness.canClaim).toBe(false);
    expect(readiness.reason).toContain("stays accrued");
  });

  it("refuses for an address the connected wallet does not hold", () => {
    const readiness = claimReadiness(chainState({ pendingCoupon6: 1n }), "ready", false);
    expect(readiness.canClaim).toBe(false);
    expect(readiness.reason).toContain("claimCoupon");
  });

  it("says nothing at all while the wallet is still reconnecting", () => {
    expect(claimReadiness(chainState(), "connecting", true)).toEqual({
      canClaim: false,
      reason: null,
    });
  });
});
