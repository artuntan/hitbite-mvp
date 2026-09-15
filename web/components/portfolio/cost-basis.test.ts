/**
 * The cost basis is the one figure on `/portfolio` that no contract can confirm, which is exactly
 * why it is tested hardest. Two properties matter more than the arithmetic:
 *
 *  1. it never claims to know the price of a token it cannot price, and
 *  2. it never disagrees with the chain about how many tokens there are without saying so.
 *
 * The fold is also checked against the chain's own rule that balances come from `Transfer` and from
 * nothing else — every mint and burn already emits one, so counting `Subscribed` as well would
 * double every subscription.
 */

import { describe, expect, it } from "vitest";

import { buildCostBasis, costBasisFor, foldEvents } from "./cost-basis";
import {
  HOLDER,
  HOLDER_BALANCE_18,
  OTHER,
  ZERO,
  holderHistory,
  subscribed,
  transfer,
} from "./fixtures";

const NAV_1_25 = 1_250_000n;
const COMPLETE = { historyComplete: true } as const;

describe("foldEvents", () => {
  const fold = foldEvents(holderHistory(), HOLDER);

  it("sums subscriptions as the integers the contract emitted", () => {
    expect(fold.subscriptions).toBe(2);
    expect(fold.subscribedUsdc6).toBe(1_500_000_000n);
    expect(fold.subscribedTokens18).toBe(1_400_000_000_000_000_000_000n);
  });

  it("folds the balance from Transfer alone, so no mint is counted twice", () => {
    // 1,000 + 400 minted, 100 in, 200 out, 300 burned.
    expect(fold.mintedTokens18).toBe(1_400_000_000_000_000_000_000n);
    expect(fold.transferredInTokens18).toBe(100_000_000_000_000_000_000n);
    expect(fold.transferredOutTokens18).toBe(200_000_000_000_000_000_000n);
    expect(fold.burnedTokens18).toBe(300_000_000_000_000_000_000n);
    expect(fold.foldedBalance18).toBe(HOLDER_BALANCE_18);
  });

  it("keeps redemptions and claims separate from the tokens", () => {
    expect(fold.redemptions).toBe(1);
    expect(fold.redeemedTokens18).toBe(300_000_000_000_000_000_000n);
    expect(fold.redeemedUsdc6).toBe(375_000_000n);
    expect(fold.claims).toBe(1);
    expect(fold.claimedUsdc6).toBe(12_500_000n);
  });

  it("ignores events that name a different address", () => {
    const fold = foldEvents(holderHistory(), OTHER);
    // Two transfers touch OTHER: 100 out of it, 200 into it.
    expect(fold.subscriptions).toBe(0);
    expect(fold.transferredInTokens18).toBe(200_000_000_000_000_000_000n);
    expect(fold.transferredOutTokens18).toBe(100_000_000_000_000_000_000n);
    expect(fold.foldedBalance18).toBe(100_000_000_000_000_000_000n);
  });

  it("nets a self-transfer to nothing", () => {
    const fold = foldEvents(
      [transfer(HOLDER, HOLDER, 5_000_000_000_000_000_000n, { block: 2 })],
      HOLDER,
    );
    expect(fold.foldedBalance18).toBe(0n);
  });
});

describe("buildCostBasis", () => {
  it("prices the whole balance when every token came from a subscription", () => {
    const events = [
      subscribed(HOLDER, 1_000_000_000n, 1_000_000_000_000_000_000_000n, 1_000_000n, { block: 4 }),
      transfer(ZERO, HOLDER, 1_000_000_000_000_000_000_000n, { block: 4, logIndex: 1 }),
    ];
    const basis = costBasisFor(events, HOLDER, {
      balance18: 1_000_000_000_000_000_000_000n,
      nav6: 1_000_000n,
      ...COMPLETE,
    });

    // Nothing has left the wallet, so the basis is exactly the USDC that was paid — not a
    // multiplication through a rounded average.
    expect(basis.costBasis6).toBe(1_000_000_000n);
    expect(basis.uncoveredTokens18).toBe(0n);
    expect(basis.complete).toBe(true);
    expect(basis.caveats).toEqual([]);
    expect(basis.balanceMatchesFold).toBe(true);
  });

  it("excludes tokens that arrived by transfer, and says so", () => {
    const basis = costBasisFor(holderHistory(), HOLDER, {
      balance18: HOLDER_BALANCE_18,
      nav6: NAV_1_25,
      ...COMPLETE,
    });

    // 1,400 subscribed − 500 disposed = 900 priced tokens still held, of a 1,000 balance.
    expect(basis.coveredTokens18).toBe(900_000_000_000_000_000_000n);
    expect(basis.uncoveredTokens18).toBe(100_000_000_000_000_000_000n);
    // 1,500.000000 USDC × 900 / 1,400, floored.
    expect(basis.costBasis6).toBe(964_285_714n);
    expect(basis.complete).toBe(false);
    expect(basis.caveats[0]).toContain("arrived by transfer");
  });

  it("values the covered tokens with the contract's own arithmetic", () => {
    const basis = costBasisFor(holderHistory(), HOLDER, {
      balance18: HOLDER_BALANCE_18,
      nav6: NAV_1_25,
      ...COMPLETE,
    });
    // 900e18 × 1.25 / 1e18 = 1,125.000000 USDC.
    expect(basis.coveredValue6).toBe(1_125_000_000n);
    expect(basis.unrealised6).toBe(1_125_000_000n - 964_285_714n);
  });

  it("takes disposals from the priced pool first, which can only shrink what it claims to know", () => {
    const events = [
      subscribed(HOLDER, 100_000_000n, 100_000_000_000_000_000_000n, 1_000_000n, { block: 4 }),
      transfer(ZERO, HOLDER, 100_000_000_000_000_000_000n, { block: 4, logIndex: 1 }),
      transfer(OTHER, HOLDER, 100_000_000_000_000_000_000n, { block: 6 }),
      transfer(HOLDER, OTHER, 100_000_000_000_000_000_000n, { block: 8 }),
    ];
    const basis = costBasisFor(events, HOLDER, {
      balance18: 100_000_000_000_000_000_000n,
      nav6: 1_000_000n,
      ...COMPLETE,
    });

    // 100 subscribed − 100 sent on = nothing priced left, even though 100 tokens are held.
    expect(basis.coveredTokens18).toBe(0n);
    expect(basis.uncoveredTokens18).toBe(100_000_000_000_000_000_000n);
    expect(basis.costBasis6).toBeNull();
  });

  it("reports zero rather than 'not known' for an address holding nothing", () => {
    const basis = costBasisFor([], HOLDER, { balance18: 0n, nav6: 1_000_000n, ...COMPLETE });
    expect(basis.costBasis6).toBe(0n);
    expect(basis.averagePrice6).toBeNull();
    expect(basis.uncoveredTokens18).toBe(0n);
  });

  it("weights the average price across every subscription", () => {
    const basis = costBasisFor(holderHistory(), HOLDER, {
      balance18: HOLDER_BALANCE_18,
      nav6: NAV_1_25,
      ...COMPLETE,
    });
    // 1,500.000000 USDC for 1,400 tokens = 1.071428 USDC each, floored at six decimals.
    expect(basis.averagePrice6).toBe(1_071_428n);
  });

  it("surfaces a disagreement with the chain's balance instead of smoothing it", () => {
    const fold = foldEvents(holderHistory(), HOLDER);
    const basis = buildCostBasis(fold, {
      // The chain says there are more tokens than the events account for: the history is partial.
      balance18: HOLDER_BALANCE_18 + 1n,
      nav6: NAV_1_25,
      historyComplete: true,
    });
    expect(basis.balanceMatchesFold).toBe(false);
    expect(basis.complete).toBe(false);
    expect(basis.caveats.join(" ")).toContain("does not equal the balance the token reports");
    // The chain's balance is what the basis is computed against, not the folded one.
    expect(basis.balance18).toBe(HOLDER_BALANCE_18 + 1n);
  });

  it("falls back to the folded balance when the chain has not answered", () => {
    const basis = costBasisFor(holderHistory(), HOLDER, {
      balance18: null,
      nav6: null,
      ...COMPLETE,
    });
    expect(basis.balance18).toBe(HOLDER_BALANCE_18);
    expect(basis.balanceMatchesFold).toBeNull();
    expect(basis.coveredValue6).toBeNull();
    expect(basis.unrealised6).toBeNull();
  });

  it("never reports a negative balance from a partial history", () => {
    // A transfer out whose matching mint was never read: the fold goes negative, the position does
    // not. Nothing on the chain can hold less than nothing.
    const basis = costBasisFor(
      [transfer(HOLDER, OTHER, 5_000_000_000_000_000_000n, { block: 9 })],
      HOLDER,
      { balance18: null, nav6: 1_000_000n, historyComplete: false },
    );
    expect(basis.balance18).toBe(0n);
    expect(basis.coveredTokens18).toBe(0n);
    expect(basis.uncoveredTokens18).toBe(0n);
    expect(basis.costBasis6).toBe(0n);
  });

  it("marks an incomplete history as a floor", () => {
    const basis = costBasisFor(holderHistory(), HOLDER, {
      balance18: HOLDER_BALANCE_18,
      nav6: NAV_1_25,
      historyComplete: false,
    });
    expect(basis.complete).toBe(false);
    expect(basis.caveats.join(" ")).toContain("incomplete");
  });
});
