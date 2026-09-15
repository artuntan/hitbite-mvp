"use client";

/**
 * The pending coupon and the claim.
 *
 * `pendingCoupon(address)` is read from the contract and shown as it came back. It is not
 * recomputed here, and that is the whole design of this card: the contract settles lazily —
 * `accrued + balance × (couponIndex − userIndex) / 1e18`, where `userIndex` is the index at this
 * address's last settlement — so a figure reconstructed in the browser from the distribution history
 * would disagree with what `claimCoupon` actually pays. One of them would be wrong, and it would be
 * this one.
 *
 * The claim is deliberately not gated on eligibility. `claimCoupon` checks the pause and the accrued
 * balance, and nothing else (PLAN.md D4): an address removed from the registry keeps every coupon it
 * earned and can still take it.
 */

import * as React from "react";
import { Coins } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TxStatus, type TxStatusView } from "@/components/wallet/tx-status";
import type { ClaimReadiness } from "@/components/portfolio/position";
import { formatUsdcExact } from "@/lib/format";

export interface CouponCardProps {
  /** `pendingCoupon(address)`, 6 decimals. `null` when the read has not answered. */
  pending6: bigint | null;
  readiness: ClaimReadiness;
  tx: TxStatusView;
  busy: boolean;
  onClaim: () => void;
  onReset: () => void;
  /** What the confirmed transaction's `CouponClaimed` log actually recorded. */
  settled6: bigint | null;
  confirmed: boolean;
}

export function CouponCard({
  pending6,
  readiness,
  tx,
  busy,
  onClaim,
  onReset,
  settled6,
  confirmed,
}: CouponCardProps) {
  return (
    <Card data-testid="coupon-card">
      <CardHeader>
        <CardTitle as="h2">Coupon</CardTitle>
        <CardDescription>
          Distributions are passed through pro rata using a cumulative index, so nobody iterates a
          holder list and a distribution costs the same whether there are two holders or two
          thousand. What is owed to this address is read from{" "}
          <span className="num">pendingCoupon(address)</span>, never recomputed here.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div>
            <p className="text-muted text-xs font-medium tracking-wide uppercase">Claimable now</p>
            <p className="num text-ink text-3xl leading-tight" data-testid="coupon-pending">
              {pending6 === null ? "Not readable" : formatUsdcExact(pending6)}
            </p>
            <p className="text-muted text-xs">
              {pending6 === null
                ? "The token has not answered `pendingCoupon` on this chain."
                : "USDC, to six decimals — exactly what `claimCoupon` would pay in the next block."}
            </p>
          </div>

          <Button
            variant="primary"
            size="lg"
            onClick={onClaim}
            disabled={!readiness.canClaim || busy || confirmed}
            data-testid="claim-action"
          >
            <Coins aria-hidden="true" />
            {pending6 !== null && pending6 > 0n
              ? `Claim ${formatUsdcExact(pending6)} USDC`
              : "Claim coupon"}
          </Button>
        </div>

        {readiness.reason !== null ? (
          <p className="text-muted text-sm" data-testid="claim-blocked-reason">
            {readiness.reason}
          </p>
        ) : null}

        {confirmed ? (
          <Alert tone="success" data-testid="claim-settled">
            <AlertTitle>Coupon claimed</AlertTitle>
            <AlertDescription>
              {settled6 === null
                ? "The transaction confirmed, but no `CouponClaimed` log could be decoded from its receipt, so this card will not state an amount it cannot read back."
                : `The chain recorded ${formatUsdcExact(settled6)} USDC paid to this address — read from the CouponClaimed log in the receipt, not from the figure quoted before signing.`}
            </AlertDescription>
          </Alert>
        ) : null}

        <TxStatus tx={tx} onRetry={onClaim} retryLabel="Claim again" onReset={onReset} />
      </CardContent>
    </Card>
  );
}
