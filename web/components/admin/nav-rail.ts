/**
 * The NAV rail, reproduced exactly, so the warning arrives before the signature.
 *
 * `HBToken.setNAV` refuses a non-forced move of more than `maxNavMoveBps` away from
 * `railAnchorNav` — the NAV at the **start of the current 24-hour window**, not the previous call
 * (PLAN.md D5, D27). A console that let an operator find that out from a revert would be teaching
 * them the rule one wasted transaction at a time, so the whole comparison is done here first, in
 * the contract's own integers and with the contract's own comparison:
 *
 *     delta * 10_000 > anchor * maxNavMoveBps   →   NavMoveExceedsRail(anchor, newNav, maxBps)
 *
 * Note what is *not* done: no float, no percentage recomputed from a rendered string. The pass/fail
 * answer is an exact integer comparison (PLAN.md D22); the basis-point figure exists only to be
 * read, and is carried as hundredths of a basis point so even that is formatted from an integer.
 *
 * ## Two anchors, when the window is about to roll
 *
 * `setNAV` rolls the window itself when `block.timestamp >= railWindowStart + RAIL_WINDOW`, and the
 * roll re-anchors on the *current* NAV. An operator signing within a couple of minutes of the edge
 * cannot know which side of it their transaction will mine on, so a move that clears one anchor and
 * not the other is a coin flip. The engine's oracle push takes the same position (PLAN.md D31);
 * this module reaches the same answer in the browser, and reports both checks rather than picking
 * one and hoping.
 */

import { MAX_INPUT, TOKEN_SCALE } from "@/lib/format";

/** Basis-point denominator, matching `HBToken.MAX_BPS`. */
export const MAX_BPS = 10_000n;

/** How close to the window edge counts as "this could mine on either side of it" (PLAN.md D31). */
export const ROLL_SAFETY_SECONDS = 120n;

export interface RailFacts {
  /** `nav()` — the value the update replaces. */
  readonly nav6: bigint;
  /** `railAnchorNav()`. */
  readonly anchor6: bigint;
  /** `railWindowStart()`, unix seconds. */
  readonly windowStart: bigint;
  /** `RAIL_WINDOW()`, seconds. 86 400 on the deployed contract. */
  readonly railWindow: bigint;
  /** `maxNavMoveBps()`. */
  readonly maxBps: bigint;
  /** The browser's clock, unix seconds. */
  readonly nowSeconds: bigint;
}

export interface RailBand {
  readonly min6: bigint;
  readonly max6: bigint;
}

export interface RailAnchor {
  readonly anchor6: bigint;
  /** Why this value could be the anchor when the transaction mines. */
  readonly label: string;
}

export interface RailCheck {
  readonly anchor: RailAnchor;
  /** |newNav − anchor|. */
  readonly delta6: bigint;
  /** The move in hundredths of a basis point, floored. Display only. */
  readonly deltaBpsHundredths: bigint;
  readonly breaches: boolean;
  /** The values this anchor would accept. */
  readonly band: RailBand;
}

/** `partial` is the dangerous one: it depends on which block mines the transaction. */
export type RailVerdict = "inside" | "breach" | "partial";

export interface RailAssessment {
  readonly checks: readonly RailCheck[];
  readonly verdict: RailVerdict;
  /** The band that clears **every** anchor in play: the intersection, not the union. */
  readonly band: RailBand;
  readonly windowEndsAt: bigint;
  /** The 24 h has already elapsed, so this call rolls the window and re-anchors on the current NAV. */
  readonly windowRolled: boolean;
  /** Close enough to the edge that both anchors have to be cleared (PLAN.md D31). */
  readonly windowRollsSoon: boolean;
  readonly maxBps: bigint;
}

/** `newNav` values `setNAV` rejects outright, before any role or rail check. */
export type NavInputVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: "InvalidNav"; readonly reason: string };

export function checkNavInput(newNav6: bigint): NavInputVerdict {
  if (newNav6 <= 0n) {
    return {
      ok: false,
      error: "InvalidNav",
      reason:
        "setNAV reverts InvalidNav on a NAV of zero. A fund with no value per unit is not a NAV.",
    };
  }
  if (newNav6 > MAX_INPUT) {
    return {
      ok: false,
      error: "InvalidNav",
      reason: `setNAV reverts InvalidNav above MAX_INPUT (${MAX_INPUT.toString()}), the uint128 bound every amount in the contract is held under (PLAN.md D28).`,
    };
  }
  return { ok: true };
}

/** `reportedAUM > MAX_INPUT` reverts `AmountTooLarge` before the role is even checked. */
export function checkReportedAumInput(aum6: bigint): boolean {
  return aum6 >= 0n && aum6 <= MAX_INPUT;
}

/** The widest move an anchor tolerates: `floor(anchor * maxBps / 10_000)`. */
export function maxDeltaFor(anchor6: bigint, maxBps: bigint): bigint {
  if (anchor6 <= 0n || maxBps <= 0n) return 0n;
  return (anchor6 * maxBps) / MAX_BPS;
}

function bandFor(anchor6: bigint, maxBps: bigint): RailBand {
  const delta = maxDeltaFor(anchor6, maxBps);
  const min = anchor6 - delta;
  // A NAV of zero reverts InvalidNav, so the floor of the band is 1, not 0.
  return { min6: min < 1n ? 1n : min, max6: anchor6 + delta };
}

/**
 * Every value that could be the anchor when this transaction is mined.
 *
 * One entry in the ordinary case. Two while the window is within `ROLL_SAFETY_SECONDS` of its end,
 * because the roll happens inside `setNAV` itself and depends on the block timestamp.
 */
export function possibleAnchors(facts: RailFacts): readonly RailAnchor[] {
  const windowEndsAt = facts.windowStart + facts.railWindow;
  const current: RailAnchor = {
    anchor6: facts.anchor6,
    label: "the anchor of the window that is open now",
  };
  const rolled: RailAnchor = {
    anchor6: facts.nav6,
    label: "the NAV now, which becomes the anchor when the 24-hour window rolls",
  };

  if (facts.nowSeconds >= windowEndsAt) return [rolled];
  if (facts.nowSeconds + ROLL_SAFETY_SECONDS >= windowEndsAt) {
    return facts.anchor6 === facts.nav6 ? [current] : [current, rolled];
  }
  return [current];
}

export function assessNavMove(newNav6: bigint, facts: RailFacts): RailAssessment {
  const windowEndsAt = facts.windowStart + facts.railWindow;
  const anchors = possibleAnchors(facts);

  const checks: RailCheck[] = anchors.map((anchor) => {
    const delta = newNav6 > anchor.anchor6 ? newNav6 - anchor.anchor6 : anchor.anchor6 - newNav6;
    return {
      anchor,
      delta6: delta,
      // 10_000 bp in a whole, × 100 to keep two decimals as an integer.
      deltaBpsHundredths: anchor.anchor6 === 0n ? 0n : (delta * MAX_BPS * 100n) / anchor.anchor6,
      // The contract's comparison, verbatim.
      breaches: delta * MAX_BPS > anchor.anchor6 * facts.maxBps,
      band: bandFor(anchor.anchor6, facts.maxBps),
    };
  });

  const breaching = checks.filter((check) => check.breaches).length;
  const verdict: RailVerdict =
    breaching === 0 ? "inside" : breaching === checks.length ? "breach" : "partial";

  // The intersection: a value is safe only if every anchor that could apply accepts it.
  const band = checks.reduce<RailBand>(
    (accumulator, check) => ({
      min6: check.band.min6 > accumulator.min6 ? check.band.min6 : accumulator.min6,
      max6: check.band.max6 < accumulator.max6 ? check.band.max6 : accumulator.max6,
    }),
    { min6: 1n, max6: MAX_INPUT },
  );

  return {
    checks,
    verdict,
    band,
    windowEndsAt,
    windowRolled: facts.nowSeconds >= windowEndsAt,
    windowRollsSoon:
      facts.nowSeconds < windowEndsAt && facts.nowSeconds + ROLL_SAFETY_SECONDS >= windowEndsAt,
    maxBps: facts.maxBps,
  };
}

/**
 * `reportedAUM` consistent with the NAV being written, given the supply on chain.
 *
 * PLAN.md D19: one token is one reference unit, so the AUM the contract reports is
 * `nav × totalSupply`. Offered as a suggestion the operator can overwrite — the engine computes the
 * published figure, and this is the arithmetic that keeps a hand-entered one from disagreeing with
 * it by an order of magnitude.
 */
export function suggestedReportedAum6(nav6: bigint, supply18: bigint): bigint {
  if (nav6 <= 0n || supply18 <= 0n) return 0n;
  return (nav6 * supply18) / TOKEN_SCALE;
}
