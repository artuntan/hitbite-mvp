/**
 * Cost basis, folded from this address's own events — and an explicit account of what it leaves out.
 *
 * BUILD_PROMPT 7.2 asks for "cost basis from events". Events can only price what this app watched
 * being paid for, and the honest version of the feature is therefore a stated convention plus a
 * stated exclusion, not a single confident number.
 *
 * ## The convention
 *
 *  - **Only `Subscribed` events carry a price.** They are the only place USDC and tokens are
 *    exchanged at a NAV this app can see (`usdcIn` against `tokensOut`). Average cost across all of
 *    them: `average = Σ usdcIn × 1e18 / Σ tokensOut`, integer arithmetic throughout.
 *  - **Tokens that arrived any other way have no basis.** A transfer in came from somewhere this
 *    app cannot see — bought on a desk, sent by a colleague, minted by the issuer as a correction.
 *    Inventing a price for them would be inventing a number, so they are counted, named and
 *    excluded, and the figure on the page says how many they are.
 *  - **Disposals are taken from subscribed tokens first.** Tokens sent out or burned reduce the
 *    priced pool before the unpriced one. That is the conservative direction: it can only *shrink*
 *    the number of tokens this page claims to know the price of.
 *  - **Basis is pro-rated from what was actually paid,** `covered × Σ usdcIn / Σ tokensOut`, in one
 *    integer division rather than by multiplying a rounded average, so the whole balance's basis is
 *    exactly the USDC paid when nothing has left the wallet.
 *
 * ## What it excludes, always
 *
 *  - Tokens received by transfer or by issuer mint (counted as `uncoveredTokens18`).
 *  - Claimed coupons. They are income, not a return of capital, so they do not reduce the basis.
 *    The total is folded anyway and shown beside it.
 *  - Realised gains on tokens already redeemed or sent out.
 *  - Gas. It is paid in the chain's native token and is not part of a USDC cost.
 *
 * Balances are folded from `Transfer` alone, exactly as `lib/server/events.ts` does it: every mint
 * and burn already emits one, so adding `Subscribed` or `OperationalMint` to the fold would
 * double-count them. That folded balance is then compared with `balanceOf` from the chain, and a
 * disagreement is surfaced rather than smoothed over — it is the signal that the history this page
 * read is not the whole history.
 */

import { eventAddress, eventInt, isZeroAddress, sameAddress } from "@/components/portfolio/args";
import { TOKEN_SCALE, previewRedeemUsdc } from "@/lib/format";
import type { ChainEvent } from "@/lib/schemas";

export interface CostBasisFold {
  /** Events that contributed to the fold. */
  readonly considered: number;
  readonly subscriptions: number;
  readonly subscribedUsdc6: bigint;
  readonly subscribedTokens18: bigint;
  readonly redemptions: number;
  readonly redeemedTokens18: bigint;
  readonly redeemedUsdc6: bigint;
  readonly claims: number;
  readonly claimedUsdc6: bigint;
  /** `Transfer` from the zero address: the mint leg of a subscription or an issuer mint. */
  readonly mintedTokens18: bigint;
  /** `Transfer` to the zero address: the burn leg of a redemption or an issuer burn. */
  readonly burnedTokens18: bigint;
  readonly transferredInTokens18: bigint;
  readonly transferredOutTokens18: bigint;
  /** Mints + transfers in − transfers out − burns. Folded from `Transfer` and nothing else. */
  readonly foldedBalance18: bigint;
}

export const EMPTY_FOLD: CostBasisFold = {
  considered: 0,
  subscriptions: 0,
  subscribedUsdc6: 0n,
  subscribedTokens18: 0n,
  redemptions: 0,
  redeemedTokens18: 0n,
  redeemedUsdc6: 0n,
  claims: 0,
  claimedUsdc6: 0n,
  mintedTokens18: 0n,
  burnedTokens18: 0n,
  transferredInTokens18: 0n,
  transferredOutTokens18: 0n,
  foldedBalance18: 0n,
};

export function foldEvents(events: readonly ChainEvent[], account: string): CostBasisFold {
  let considered = 0;
  let subscriptions = 0;
  let subscribedUsdc6 = 0n;
  let subscribedTokens18 = 0n;
  let redemptions = 0;
  let redeemedTokens18 = 0n;
  let redeemedUsdc6 = 0n;
  let claims = 0;
  let claimedUsdc6 = 0n;
  let mintedTokens18 = 0n;
  let burnedTokens18 = 0n;
  let transferredInTokens18 = 0n;
  let transferredOutTokens18 = 0n;

  for (const event of events) {
    switch (event.name) {
      case "Subscribed": {
        if (!sameAddress(eventAddress(event, "account"), account)) break;
        const usdcIn = eventInt(event, "usdcIn");
        const tokensOut = eventInt(event, "tokensOut");
        if (usdcIn === null || tokensOut === null) break;
        subscriptions += 1;
        subscribedUsdc6 += usdcIn;
        subscribedTokens18 += tokensOut;
        considered += 1;
        break;
      }
      case "Redeemed": {
        if (!sameAddress(eventAddress(event, "account"), account)) break;
        const tokensIn = eventInt(event, "tokensIn");
        const usdcOut = eventInt(event, "usdcOut");
        if (tokensIn === null || usdcOut === null) break;
        redemptions += 1;
        redeemedTokens18 += tokensIn;
        redeemedUsdc6 += usdcOut;
        considered += 1;
        break;
      }
      case "CouponClaimed": {
        if (!sameAddress(eventAddress(event, "account"), account)) break;
        const amount = eventInt(event, "usdcAmount");
        if (amount === null) break;
        claims += 1;
        claimedUsdc6 += amount;
        considered += 1;
        break;
      }
      case "Transfer": {
        const from = eventAddress(event, "from");
        const to = eventAddress(event, "to");
        const value = eventInt(event, "value");
        if (value === null) break;
        const inbound = sameAddress(to, account);
        const outbound = sameAddress(from, account);
        // A self-transfer is both legs of the same movement and nets to nothing.
        if (inbound && outbound) {
          considered += 1;
          break;
        }
        if (inbound) {
          if (isZeroAddress(from)) mintedTokens18 += value;
          else transferredInTokens18 += value;
          considered += 1;
        } else if (outbound) {
          if (isZeroAddress(to)) burnedTokens18 += value;
          else transferredOutTokens18 += value;
          considered += 1;
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    considered,
    subscriptions,
    subscribedUsdc6,
    subscribedTokens18,
    redemptions,
    redeemedTokens18,
    redeemedUsdc6,
    claims,
    claimedUsdc6,
    mintedTokens18,
    burnedTokens18,
    transferredInTokens18,
    transferredOutTokens18,
    foldedBalance18:
      mintedTokens18 + transferredInTokens18 - transferredOutTokens18 - burnedTokens18,
  };
}

export interface CostBasisInput {
  /** `balanceOf` from the chain. `null` when it could not be read; the fold is used instead. */
  readonly balance18: bigint | null;
  /** `nav()` from the chain, for the value of the covered tokens. `null` when unreadable. */
  readonly nav6: bigint | null;
  /** False when the event history behind the fold is known to be partial. */
  readonly historyComplete: boolean;
}

export interface CostBasis {
  readonly fold: CostBasisFold;
  /** The balance this basis is computed against: the chain's when there is one. */
  readonly balance18: bigint;
  /** True when the chain's balance and the balance folded from `Transfer` agree exactly. */
  readonly balanceMatchesFold: boolean | null;
  /** `Σ usdcIn × 1e18 / Σ tokensOut` — the weighted average NAV paid, 6 decimals. */
  readonly averagePrice6: bigint | null;
  /** Tokens in the balance that subscriptions can account for. */
  readonly coveredTokens18: bigint;
  /** Tokens in the balance that arrived without a price this app can see. */
  readonly uncoveredTokens18: bigint;
  /** The share of what was actually paid that corresponds to `coveredTokens18`. */
  readonly costBasis6: bigint | null;
  /** `coveredTokens18 × nav / 1e18`, the contract's own arithmetic. */
  readonly coveredValue6: bigint | null;
  /** Value minus basis, on the covered tokens only. */
  readonly unrealised6: bigint | null;
  /** True when every token held is priced, so the basis covers the whole position. */
  readonly complete: boolean;
  /** Why the basis is partial, when it is. Rendered as-is, in order. */
  readonly caveats: readonly string[];
}

/**
 * The basis for a position, from a fold and what the chain says the balance is.
 *
 * The chain's `balanceOf` outranks the folded one wherever they differ: the fold is a reconstruction
 * and the balance is the fact. The disagreement is reported rather than hidden, because on a partial
 * history it is the one visible sign that the reconstruction is missing something.
 */
export function buildCostBasis(fold: CostBasisFold, input: CostBasisInput): CostBasis {
  // A folded balance can only go negative on a partial history — a transfer out whose matching mint
  // was never read. The chain cannot hold a negative balance, so the fallback is floored at zero
  // rather than propagated into a negative cost basis; the mismatch below is what reports it.
  const foldedBalance18 = fold.foldedBalance18 > 0n ? fold.foldedBalance18 : 0n;
  const balance18 = input.balance18 ?? foldedBalance18;
  const balanceMatchesFold =
    input.balance18 === null ? null : input.balance18 === fold.foldedBalance18;

  const averagePrice6 =
    fold.subscribedTokens18 > 0n
      ? (fold.subscribedUsdc6 * TOKEN_SCALE) / fold.subscribedTokens18
      : null;

  const disposed18 = fold.transferredOutTokens18 + fold.burnedTokens18;
  const remainingPriced18 =
    fold.subscribedTokens18 > disposed18 ? fold.subscribedTokens18 - disposed18 : 0n;
  const coveredTokens18 = balance18 < remainingPriced18 ? balance18 : remainingPriced18;
  const uncoveredTokens18 = balance18 > coveredTokens18 ? balance18 - coveredTokens18 : 0n;

  // Zero basis is only ever reported for a zero balance. An address holding tokens none of which
  // can be priced gets `null` — "not known" — because printing 0.00 would read as "it cost nothing".
  const costBasis6 =
    coveredTokens18 > 0n && fold.subscribedTokens18 > 0n
      ? (coveredTokens18 * fold.subscribedUsdc6) / fold.subscribedTokens18
      : balance18 === 0n
        ? 0n
        : null;

  const coveredValue6 =
    input.nav6 !== null && input.nav6 > 0n ? previewRedeemUsdc(coveredTokens18, input.nav6) : null;

  const unrealised6 =
    coveredValue6 !== null && costBasis6 !== null ? coveredValue6 - costBasis6 : null;

  const caveats: string[] = [];
  if (uncoveredTokens18 > 0n) {
    caveats.push(
      "Part of this balance arrived by transfer or by an issuer mint. What was paid for those tokens happened somewhere this app cannot see, so they are excluded from the basis rather than given a price they might not have.",
    );
  }
  if (fold.claims > 0) {
    caveats.push(
      "Claimed coupons are not deducted from the basis. A coupon is income passed through from the portfolio, not a return of capital, so subtracting it would understate what the position cost.",
    );
  }
  if (fold.redemptions > 0 || fold.transferredOutTokens18 > 0n) {
    caveats.push(
      "Tokens already redeemed or sent on are out of scope: this is the basis of what is held now, not a realised profit and loss.",
    );
  }
  if (balanceMatchesFold === false) {
    caveats.push(
      "The balance folded from this address's Transfer events does not equal the balance the token reports. The token is right; it means the event history read here is incomplete, and every figure derived from it is a floor rather than a total.",
    );
  }
  if (!input.historyComplete) {
    caveats.push(
      "The event history behind these figures is incomplete — see the coverage note under the history below — so treat each of them as a floor.",
    );
  }

  return {
    fold,
    balance18,
    balanceMatchesFold,
    averagePrice6,
    coveredTokens18,
    uncoveredTokens18,
    costBasis6,
    coveredValue6,
    unrealised6,
    complete: uncoveredTokens18 === 0n && balanceMatchesFold !== false && input.historyComplete,
    caveats,
  };
}

/** Fold and build in one call, which is what the page does. */
export function costBasisFor(
  events: readonly ChainEvent[],
  account: string,
  input: CostBasisInput,
): CostBasis {
  return buildCostBasis(foldEvents(events, account), input);
}
