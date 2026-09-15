"use client";

/**
 * Where the cost basis came from, and what it does not cover.
 *
 * BUILD_PROMPT 7.2 asks for "cost basis from events" and this page states the convention on the
 * page itself rather than in a comment, because a basis is only meaningful next to its method. The
 * method and its limits live in `cost-basis.ts`; this card renders them, the fold behind them, and
 * the one comparison that can falsify the whole thing — the balance folded from `Transfer` against
 * the balance the token reports.
 */

import * as React from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CostBasis } from "@/components/portfolio/cost-basis";
import { TOKEN } from "@/lib/copy";
import { formatTokens, formatUsdcExact } from "@/lib/format";

export interface CostBasisCardProps {
  basis: CostBasis;
  /** True when the history behind the fold is the whole history. */
  complete: boolean;
}

export function CostBasisCard({ basis, complete }: CostBasisCardProps) {
  const fold = basis.fold;
  const rows: Array<{ label: string; tokens: string | null; usdc: string | null }> = [
    {
      label: `Subscribed (${fold.subscriptions})`,
      tokens: `+${formatTokens(fold.subscribedTokens18, 6)}`,
      usdc: `-${formatUsdcExact(fold.subscribedUsdc6)}`,
    },
    {
      label: `Redeemed (${fold.redemptions})`,
      tokens:
        fold.redeemedTokens18 === 0n ? "0.000000" : `-${formatTokens(fold.redeemedTokens18, 6)}`,
      usdc: fold.redeemedUsdc6 === 0n ? "0.000000" : `+${formatUsdcExact(fold.redeemedUsdc6)}`,
    },
    {
      label: "Received by transfer",
      tokens:
        fold.transferredInTokens18 === 0n
          ? "0.000000"
          : `+${formatTokens(fold.transferredInTokens18, 6)}`,
      usdc: null,
    },
    {
      label: "Sent by transfer",
      tokens:
        fold.transferredOutTokens18 === 0n
          ? "0.000000"
          : `-${formatTokens(fold.transferredOutTokens18, 6)}`,
      usdc: null,
    },
    {
      label: `Coupons claimed (${fold.claims})`,
      tokens: null,
      usdc: fold.claimedUsdc6 === 0n ? "0.000000" : `+${formatUsdcExact(fold.claimedUsdc6)}`,
    },
  ];

  return (
    <Card data-testid="cost-basis-card">
      <CardHeader>
        <CardTitle as="h2">How the cost basis is worked out</CardTitle>
        <CardDescription>
          Average cost across this address&rsquo;s <span className="num">Subscribed</span> events —
          the only events that record test USDC and {TOKEN.symbol} changing hands at a NAV this app
          can see. Everything below is folded from those events as integers, never from a rounded
          figure.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <Table aria-label="Events behind the cost basis">
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead numeric>{TOKEN.symbol}</TableHead>
              <TableHead numeric>USDC</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell>{row.label}</TableCell>
                <TableCell numeric>{row.tokens ?? "—"}</TableCell>
                <TableCell numeric>{row.usdc ?? "—"}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-medium">Priced tokens still held</TableCell>
              <TableCell numeric data-testid="covered-tokens">
                {formatTokens(basis.coveredTokens18, 6)}
              </TableCell>
              <TableCell numeric data-testid="basis-usdc">
                {basis.costBasis6 === null ? "—" : formatUsdcExact(basis.costBasis6)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <div className="text-muted flex flex-col gap-2 text-sm">
          <p>
            The basis is the share of what was actually paid that belongs to the tokens still held:{" "}
            <span className="num">covered × Σ usdcIn / Σ tokensOut</span>, one integer division, so
            with nothing sent out it is exactly the USDC paid. Tokens leaving the address are taken
            from the priced pool first, which can only reduce the number of tokens this page claims
            to know the price of.
          </p>
          <p>
            <strong className="text-ink">What it excludes.</strong> Tokens that arrived by transfer
            or by an issuer mint: what was paid for those happened somewhere this app cannot see,
            and a price invented for them would be a made-up number on a page whose whole point is
            that every figure comes from the chain. Claimed coupons are income passed through from
            the portfolio, not a return of capital, so they do not reduce the basis. Gas is paid in
            the chain&rsquo;s native token and is not part of a USDC cost. Tokens already redeemed
            or sent on are out of scope — this is the basis of what is held now, not a realised
            profit and loss.
          </p>
        </div>

        {basis.caveats.length > 0 ? (
          <Alert tone="warning" data-testid="basis-caveats">
            <AlertTitle>What this figure does not cover</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-5">
                {basis.caveats.map((caveat) => (
                  <li key={caveat}>{caveat}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : complete ? (
          <Alert tone="success" data-testid="basis-complete">
            <AlertTitle>Every token in this balance is priced</AlertTitle>
            <AlertDescription>
              Nothing arrived by transfer, the event history is complete, and the balance folded
              from <span className="num">Transfer</span> equals the balance the token reports. The
              basis above is the whole position&rsquo;s.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
