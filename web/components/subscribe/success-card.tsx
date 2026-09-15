"use client";

/**
 * What actually settled.
 *
 * The numbers here come from the `Subscribed(account, usdcIn, tokensOut, nav)` event in the
 * receipt, not from the quote that preceded it: between the quote and the block, the oracle can
 * have moved NAV. Quoting back the estimate would be the one place on this page where the UI and
 * the chain could silently disagree. When the log cannot be decoded the card says so and falls back
 * to the receipt's own facts rather than inventing them.
 */

import * as React from "react";
import { CircleCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TxExplorerLink } from "@/components/wallet/tx-status";
import { TOKEN } from "@/lib/copy";
import { formatTokens, formatTokensExact, formatUsdcExact } from "@/lib/format";
import type { ExplorerLink } from "@/lib/tx";
import { cn } from "@/lib/utils";

export interface SettledSubscription {
  readonly usdcIn6: bigint;
  readonly tokensOut18: bigint;
  readonly nav6: bigint;
}

export interface SuccessCardProps {
  /** Decoded from the receipt's `Subscribed` log, or `null` when no log could be decoded. */
  settled: SettledSubscription | null;
  hash: string | undefined;
  link: ExplorerLink | null;
  onSubscribeAgain: () => void;
  className?: string;
}

export function SuccessCard({
  settled,
  hash,
  link,
  onSubscribeAgain,
  className,
}: SuccessCardProps) {
  return (
    <Card
      className={cn("border-success-surface", className)}
      role="status"
      data-testid="subscribe-success"
    >
      <CardHeader className="flex-row items-start gap-3">
        <CircleCheck aria-hidden="true" className="text-success mt-0.5 size-5 shrink-0" />
        <CardTitle as="h3">Subscription confirmed</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {settled ? (
          <>
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-muted text-xs tracking-wide uppercase">Subscribed</dt>
                <dd className="num text-ink text-lg">{formatUsdcExact(settled.usdcIn6)} USDC</dd>
              </div>
              <div>
                <dt className="text-muted text-xs tracking-wide uppercase">Minted</dt>
                <dd className="num text-ink text-lg">
                  {formatTokens(settled.tokensOut18, 6)} {TOKEN.symbol}
                </dd>
              </div>
              <div>
                <dt className="text-muted text-xs tracking-wide uppercase">NAV at settlement</dt>
                <dd className="num text-ink text-lg">{formatUsdcExact(settled.nav6)} USDC</dd>
              </div>
            </dl>
            <p className="text-muted text-xs">
              Read from the <span className="num">Subscribed</span> event in the transaction
              receipt, so these are the chain&rsquo;s numbers rather than the estimate above. Exact
              balance minted: <span className="num">{formatTokensExact(settled.tokensOut18)}</span>{" "}
              {TOKEN.symbol}.
            </p>
          </>
        ) : (
          <p className="text-muted text-sm">
            The transaction confirmed, but its <span className="num">Subscribed</span> event could
            not be decoded from the receipt, so no amount is quoted here rather than a guessed one.
            The transaction itself is the record — open it below.
          </p>
        )}

        {hash ? <TxExplorerLink link={link} hash={hash} /> : null}

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onSubscribeAgain}>
            Subscribe again
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
