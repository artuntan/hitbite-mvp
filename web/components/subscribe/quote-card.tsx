"use client";

/**
 * What the subscription settles at, quoted from integers.
 *
 * Three things a reviewer will check, so all three are on the card rather than in a tooltip:
 *
 *  - the **NAV used**, with where it came from and when it was set, because the number moves daily;
 *  - the **token amount**, floored exactly as `HBToken.previewSubscribe` floors it (D52), with the
 *    truncation stated when the division leaves a remainder;
 *  - the **fee**, which on a subscription is nothing: the whole amount buys tokens at NAV. The fees
 *    that do exist accrue daily *inside* NAV and are named here so "no fee" cannot be mistaken for
 *    "no costs".
 */

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PublishedFacts, SubscribeQuote } from "@/components/subscribe/quote";
import { TOKEN } from "@/lib/copy";
import { formatDate, formatTokens, formatTokensExact, formatUsdcExact } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface QuoteCardProps {
  quote: SubscribeQuote;
  /** `minSubscription()` from the token, or `null` when it could not be read. */
  minimum6: bigint | null;
  published: PublishedFacts;
  className?: string;
}

export function QuoteCard({ quote, minimum6, published, className }: QuoteCardProps) {
  const { nav, amount6, tokensOut18 } = quote;
  const indicative = nav !== null && !nav.settles;

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle as="h3">Your quote</CardTitle>
          <p className="text-muted text-sm">
            Computed the way the contract computes it: {TOKEN.symbol} ={" "}
            <span className="num">amount × 1e18 ÷ NAV</span>, floored.
          </p>
        </div>
        {nav ? (
          <Badge tone={indicative ? "warning" : "accent"} data-testid="quote-nav-source">
            {indicative ? "Indicative" : "Live NAV"}
          </Badge>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <dl className="flex flex-col gap-3">
          <Row label="You send">
            <span data-testid="quote-amount">
              {amount6 === null ? "—" : `${formatUsdcExact(amount6)} USDC`}
            </span>
          </Row>

          <Row
            label="NAV used"
            hint={
              nav === null
                ? undefined
                : nav.settles
                  ? `On-chain nav(), last set ${nav.asOf}.`
                  : `Published by the NAV engine for ${formatDate(nav.asOf)}. This is not the number a subscription would settle at.`
            }
          >
            <span data-testid="quote-nav">
              {nav === null ? "—" : `${formatUsdcExact(nav.nav6)} USDC`}
            </span>
          </Row>

          <Row
            label={`${TOKEN.symbol} you receive`}
            hint={
              quote.truncatedTokens
                ? "The division leaves a remainder, so the mint is floored to this amount — the chain does the same, and never rounds up."
                : undefined
            }
          >
            <span data-testid="quote-tokens">
              {tokensOut18 === null ? "—" : `${formatTokens(tokensOut18, 6)} ${TOKEN.symbol}`}
            </span>
          </Row>

          <Row
            label="Subscription fee"
            hint="hbTRS charges nothing to subscribe. The whole amount buys tokens at NAV."
          >
            <span data-testid="quote-fee">0.000000 USDC</span>
          </Row>

          <Row
            label="Minimum subscription"
            hint={
              minimum6 === null
                ? "Read from minSubscription() on the token, which an admin can change. It has not answered, so this app will not guess at it."
                : "Read from minSubscription() on the token. Below it, subscribe reverts with BelowMinimum."
            }
          >
            <span data-testid="quote-minimum">
              {minimum6 === null ? "Not readable" : `${formatUsdcExact(minimum6)} USDC`}
            </span>
          </Row>
        </dl>

        {tokensOut18 !== null ? (
          <details className="text-muted text-xs">
            <summary className="cursor-pointer underline underline-offset-4">
              All eighteen decimals
            </summary>
            <p className="num text-ink mt-1 break-all">{formatTokensExact(tokensOut18)}</p>
          </details>
        ) : null}

        <p className="text-muted border-border border-t pt-3 text-xs">
          Ongoing fees are not charged on this transaction: a {published.managementFeePctPa}%
          management fee and {published.fundExpensesPctPa}% of simulated fund expenses per annum
          accrue daily inside the NAV above (ACT/365F), so the NAV is already net of them. Figures
          from the engine&rsquo;s published document for {formatDate(published.asOf)}.
        </p>
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between")}>
      <div className="min-w-0">
        <dt className="text-ink text-sm">{label}</dt>
        {hint ? <p className="text-muted mt-0.5 max-w-prose text-xs">{hint}</p> : null}
      </div>
      <dd className="num text-ink shrink-0 text-sm sm:text-right">{children}</dd>
    </div>
  );
}
