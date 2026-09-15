"use client";

/**
 * The headline figures: what this address holds, what it is worth, what it cost and what it is owed.
 *
 * Every number here is formatted from the integer the contract holds (PLAN.md D22) — 18 decimals for
 * the balance, 6 for everything denominated in test USDC — and the value is `balance × nav / 1e18`
 * in integer arithmetic, which is `previewRedeem`'s formula and therefore the number a redemption of
 * the whole position would settle at, before liquidity.
 *
 * A figure the chain has not answered for renders as "Not readable" with the reason beside it. A
 * dash that might mean zero is the one thing this card must never show.
 */

import * as React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Stat,
  StatList,
} from "@/components/ui/card";
import type { CostBasis } from "@/components/portfolio/cost-basis";
import { valueAtNav, type PortfolioChainState } from "@/components/portfolio/position";
import { TOKEN } from "@/lib/copy";
import {
  formatTokens,
  formatTokensExact,
  formatUnixSeconds,
  formatUsdc,
  formatUsdcExact,
} from "@/lib/format";

const NOT_READABLE = "Not readable";

export interface PositionCardProps {
  chain: PortfolioChainState;
  basis: CostBasis | null;
  /** True when the history behind the basis is the whole history. */
  historyReady: boolean;
}

export function PositionCard({ chain, basis, historyReady }: PositionCardProps) {
  const balance18 = chain.balance18;
  const value6 = valueAtNav(balance18, chain.nav6);
  const costBasis6 = basis?.costBasis6 ?? null;
  const unrealised6 = basis?.unrealised6 ?? null;

  return (
    <Card data-testid="position-card">
      <CardHeader>
        <CardTitle as="h2">This position</CardTitle>
        <CardDescription>
          Read from the token contract, one address at a time. The value is{" "}
          <span className="num">balance × nav / 1e18</span> — the same integer arithmetic{" "}
          <span className="num">previewRedeem</span> performs, so it is what the whole position
          would pay out if there were liquidity for all of it.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <StatList className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Stat
            label={`${TOKEN.symbol} balance`}
            value={
              <span data-testid="position-balance">
                {balance18 === null ? NOT_READABLE : formatTokens(balance18, 6)}
              </span>
            }
            hint={
              balance18 === null
                ? "`balanceOf` has not answered on this chain."
                : `${formatTokensExact(balance18)} at full precision`
            }
          />

          <Stat
            label="Value at NAV"
            value={
              <span data-testid="position-value">
                {value6 === null ? NOT_READABLE : formatUsdc(value6)}
              </span>
            }
            hint={
              chain.nav6 === null
                ? "`nav()` has not answered, so the position cannot be valued here."
                : `at ${formatUsdcExact(chain.nav6)} USDC per token${
                    chain.navUpdatedAt !== null && chain.navUpdatedAt > 0n
                      ? `, set ${formatUnixSeconds(chain.navUpdatedAt)}`
                      : ""
                  }`
            }
          />

          <Stat
            label="Pending coupon"
            value={
              <span data-testid="position-pending-coupon">
                {chain.pendingCoupon6 === null
                  ? NOT_READABLE
                  : formatUsdcExact(chain.pendingCoupon6)}
              </span>
            }
            hint={
              chain.pendingCoupon6 === null
                ? "`pendingCoupon(address)` has not answered."
                : "read from `pendingCoupon(address)`, which is exactly what a claim would pay now"
            }
          />

          <Stat
            label="Cost basis"
            value={
              <span data-testid="position-cost-basis">
                {!historyReady ? "—" : costBasis6 === null ? "Not known" : formatUsdc(costBasis6)}
              </span>
            }
            hint={
              !historyReady
                ? "Folded from this address's Subscribed events, which have not been read here."
                : basis && basis.uncoveredTokens18 > 0n
                  ? `covers ${formatTokens(basis.coveredTokens18, 4)} of ${formatTokens(basis.balance18, 4)} ${TOKEN.symbol} — the rest arrived without a price this app can see`
                  : "average cost across this address's subscriptions"
            }
          />

          <Stat
            label="Unrealised"
            value={
              <span data-testid="position-unrealised">
                {!historyReady || unrealised6 === null
                  ? "—"
                  : `${unrealised6 > 0n ? "+" : unrealised6 < 0n ? "-" : ""}${formatUsdc(
                      unrealised6 < 0n ? -unrealised6 : unrealised6,
                    )}`}
              </span>
            }
            hint={
              unrealised6 === null
                ? "Needs both a NAV and a cost basis."
                : "value minus basis, on the priced tokens only — not a realised profit and loss"
            }
          />

          <Stat
            label="Average price paid"
            value={
              <span data-testid="position-average-price">
                {basis?.averagePrice6 == null ? "—" : formatUsdcExact(basis.averagePrice6)}
              </span>
            }
            hint={
              basis?.averagePrice6 == null
                ? "No subscription from this address has been indexed."
                : `weighted across ${basis.fold.subscriptions} subscription${
                    basis.fold.subscriptions === 1 ? "" : "s"
                  }, in USDC per token`
            }
          />
        </StatList>
      </CardContent>
    </Card>
  );
}
