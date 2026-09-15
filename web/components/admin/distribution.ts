/**
 * What `distributeCoupon` will do, worked out before it is sent.
 *
 * `HBToken.distributeCoupon` has three ways to refuse an amount — `NoSupply`,
 * `DistributionTooSmall` and `DistributionExceedsNav` — and one very large consequence that no
 * revert will ever tell you about: NAV falls by the per-token amount at the instant of
 * distribution (PLAN.md D26). An operator typing a coupon into a box deserves to see both halves of
 * that before the wallet opens, so the whole calculation is reproduced here in the contract's
 * integers, in the contract's order:
 *
 *     perToken  = usdcAmount * 1e18 / totalSupply            (truncating)
 *     allocated = ceil(perToken * totalSupply / 1e18)        (rounded up; never above usdcAmount)
 *     nav      -= perToken
 *     anchor   -= perToken, floored at 1
 *     reportedAUM -= usdcAmount, floored at 0
 *
 * The remainder — `usdcAmount − allocated` — is the truncation dust from PLAN.md D29. It is not
 * lost and it is not locked: it stays in the vault as ordinary liquidity, because the coupon
 * reserve is tracked from `allocated` rather than from what was pulled. The preview names it for
 * the same reason the contract separates it: an operator who sees "12.000000 in, 11.999998
 * allocated" and no explanation will assume something is broken.
 */

import { MAX_INPUT, TOKEN_SCALE } from "@/lib/format";

export type DistributionErrorCode =
  "ZeroAmount" | "AmountTooLarge" | "NoSupply" | "DistributionTooSmall" | "DistributionExceedsNav";

export interface DistributionRefusal {
  readonly code: DistributionErrorCode;
  /** A sentence naming the rule, fit to render in place of a revert. */
  readonly reason: string;
  /** The smallest amount that would not be refused, when one exists. */
  readonly minimum6: bigint | null;
  /** The largest amount that would not be refused, when one exists. */
  readonly maximum6: bigint | null;
}

export interface DistributionPreview {
  readonly amount6: bigint;
  readonly supply18: bigint;
  /** The coupon index increment, in the same 6-decimal units as NAV. */
  readonly perToken6: bigint;
  /** What the reserve grows by: `ceil(perToken * supply / 1e18)`. */
  readonly allocated6: bigint;
  /** `amount − allocated`: truncation dust that becomes ordinary vault liquidity (PLAN.md D29). */
  readonly remainder6: bigint;
  readonly navBefore6: bigint;
  readonly navAfter6: bigint;
  readonly reportedAumBefore6: bigint;
  readonly reportedAumAfter6: bigint;
  readonly anchorBefore6: bigint;
  readonly anchorAfter6: bigint;
}

export type DistributionAssessment =
  | { readonly ok: true; readonly preview: DistributionPreview }
  | { readonly ok: false; readonly refusal: DistributionRefusal };

export interface DistributionFacts {
  readonly supply18: bigint;
  readonly nav6: bigint;
  readonly reportedAum6: bigint;
  readonly anchor6: bigint;
}

/** The smallest amount whose per-token increment does not truncate to zero: `ceil(supply / 1e18)`. */
export function smallestDistribution6(supply18: bigint): bigint {
  if (supply18 <= 0n) return 0n;
  return (supply18 + TOKEN_SCALE - 1n) / TOKEN_SCALE;
}

/**
 * The largest amount whose per-token increment stays strictly below NAV.
 *
 * `perToken < nav` ⟺ `amount * 1e18 < nav * supply` for positive integers, so the bound is
 * `floor((nav * supply − 1) / 1e18)`.
 */
export function largestDistribution6(supply18: bigint, nav6: bigint): bigint {
  if (supply18 <= 0n || nav6 <= 0n) return 0n;
  const bound = (nav6 * supply18 - 1n) / TOKEN_SCALE;
  return bound > MAX_INPUT ? MAX_INPUT : bound;
}

export function assessDistribution(
  amount6: bigint,
  facts: DistributionFacts,
): DistributionAssessment {
  const smallest = smallestDistribution6(facts.supply18);
  const largest = largestDistribution6(facts.supply18, facts.nav6);

  if (amount6 <= 0n) {
    return {
      ok: false,
      refusal: {
        code: "ZeroAmount",
        reason: "distributeCoupon reverts ZeroAmount. There is nothing to distribute.",
        minimum6: facts.supply18 > 0n ? smallest : null,
        maximum6: facts.supply18 > 0n ? largest : null,
      },
    };
  }

  if (amount6 > MAX_INPUT) {
    return {
      ok: false,
      refusal: {
        code: "AmountTooLarge",
        reason: `distributeCoupon reverts AmountTooLarge above MAX_INPUT (${MAX_INPUT.toString()} units), the uint128 bound every amount is held under (PLAN.md D28).`,
        minimum6: null,
        maximum6: MAX_INPUT,
      },
    };
  }

  if (facts.supply18 <= 0n) {
    return {
      ok: false,
      refusal: {
        code: "NoSupply",
        reason:
          "distributeCoupon reverts NoSupply: no token is outstanding, so there is no holder to " +
          "distribute to and no supply to divide by. Note that the USDC transfer happens before " +
          "this check, so the whole transaction reverts and nothing leaves your wallet.",
        minimum6: null,
        maximum6: null,
      },
    };
  }

  const perToken6 = (amount6 * TOKEN_SCALE) / facts.supply18;

  if (perToken6 === 0n) {
    return {
      ok: false,
      refusal: {
        code: "DistributionTooSmall",
        reason:
          "distributeCoupon reverts DistributionTooSmall: the per-token increment would truncate " +
          "to zero, so the whole amount would sit in the vault allocated to nobody. The contract " +
          "refuses it rather than locking it.",
        minimum6: smallest,
        maximum6: largest,
      },
    };
  }

  if (perToken6 >= facts.nav6) {
    return {
      ok: false,
      refusal: {
        code: "DistributionExceedsNav",
        reason:
          "distributeCoupon reverts DistributionExceedsNav: the per-token amount is not below " +
          "NAV, and NAV falls by exactly that amount at distribution (PLAN.md D26), so this would " +
          "leave a NAV of zero or less. Set a NAV that supports the coupon first, or distribute less.",
        minimum6: smallest,
        maximum6: largest,
      },
    };
  }

  // Rounded up, so the reserve always covers every holder's floor-rounded claim; never above the
  // amount pulled.
  const allocated6 = (perToken6 * facts.supply18 + TOKEN_SCALE - 1n) / TOKEN_SCALE;

  return {
    ok: true,
    preview: {
      amount6,
      supply18: facts.supply18,
      perToken6,
      allocated6,
      remainder6: amount6 - allocated6,
      navBefore6: facts.nav6,
      navAfter6: facts.nav6 - perToken6,
      reportedAumBefore6: facts.reportedAum6,
      reportedAumAfter6: facts.reportedAum6 > amount6 ? facts.reportedAum6 - amount6 : 0n,
      anchorBefore6: facts.anchor6,
      anchorAfter6: facts.anchor6 > perToken6 ? facts.anchor6 - perToken6 : 1n,
    },
  };
}

// --------------------------------------------------------------------------- funding

export type FundingStatus = "ok" | "short" | "unknown";

export interface FundingCheck {
  readonly balance: FundingStatus;
  readonly allowance: FundingStatus;
  /** How much more test USDC the wallet needs, when it is short. */
  readonly balanceShortfall6: bigint | null;
  /** Whether an `approve` is needed before the distribution. */
  readonly needsApproval: boolean;
}

/**
 * `distributeCoupon` pulls the USDC with `safeTransferFrom`, so the issuer must have approved the
 * token contract first. That is an ERC-20 rule rather than one of HBToken's own, which is exactly
 * why it is worth stating separately: the revert it produces names an allowance, not a coupon.
 */
export function checkFunding(
  amount6: bigint,
  balance6: bigint | null,
  allowance6: bigint | null,
): FundingCheck {
  const balance: FundingStatus =
    balance6 === null ? "unknown" : balance6 >= amount6 ? "ok" : "short";
  const allowance: FundingStatus =
    allowance6 === null ? "unknown" : allowance6 >= amount6 ? "ok" : "short";
  return {
    balance,
    allowance,
    balanceShortfall6: balance6 !== null && balance6 < amount6 ? amount6 - balance6 : null,
    needsApproval: allowance === "short",
  };
}
