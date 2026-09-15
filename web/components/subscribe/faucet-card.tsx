"use client";

/**
 * The MockUSDC faucet (PLAN.md D14).
 *
 * `MockUSDC.faucet` caps a call at 10,000 mUSDC and an address at 10,000 mUSDC per fixed 24-hour
 * window anchored at its first use. The cap is read from the contract (`FAUCET_CAP`,
 * `faucetRemaining`, `windowStart`, `FAUCET_WINDOW`), not assumed, and when it is spent the card
 * says when it comes back instead of letting somebody spend gas discovering
 * `FaucetDailyCapExceeded`.
 */

import * as React from "react";
import { Droplet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TxStatus, type TxStatusView } from "@/components/wallet/tx-status";
import type { FaucetReading } from "@/components/subscribe/quote";
import { formatUsdcExact } from "@/lib/format";

export interface FaucetCardProps {
  faucet: FaucetReading;
  /** Test USDC held by the connected address, when it could be read. */
  balance6: bigint | null;
  tx: TxStatusView;
  onMint: () => void;
  onReset: () => void;
  busy: boolean;
  /** False when there is no wallet, no deployment or the wrong network — with the reason. */
  enabled: boolean;
  disabledReason: string | null;
  className?: string;
}

export function FaucetCard({
  faucet,
  balance6,
  tx,
  onMint,
  onReset,
  busy,
  enabled,
  disabledReason,
  className,
}: FaucetCardProps) {
  const canMint =
    enabled && !busy && faucet.status === "available" && (faucet.mintable6 ?? 0n) > 0n;

  return (
    <Card className={className} data-testid="faucet-card">
      <CardHeader>
        <CardTitle as="h3">Test USDC faucet</CardTitle>
        <CardDescription>
          MockUSDC is a six-decimal stand-in deployed only on test networks. It is not USDC, it is
          not backed by anything, and anyone may mint it.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <dt className="text-muted text-xs">Your balance</dt>
            <dd className="num text-ink" data-testid="faucet-balance">
              {balance6 === null ? "—" : `${formatUsdcExact(balance6)} mUSDC`}
            </dd>
          </div>
          <div>
            <dt className="text-muted text-xs">Left in this 24-hour window</dt>
            <dd className="num text-ink" data-testid="faucet-remaining">
              {faucet.mintable6 === null ? "—" : `${formatUsdcExact(faucet.mintable6)} mUSDC`}
            </dd>
          </div>
        </dl>

        <p className="text-muted text-sm" data-testid="faucet-detail">
          {faucet.detail}
        </p>

        {disabledReason ? <p className="text-muted text-sm">{disabledReason}</p> : null}

        <div>
          <Button variant="secondary" onClick={onMint} disabled={!canMint}>
            <Droplet aria-hidden="true" />
            {faucet.mintable6 !== null && faucet.mintable6 > 0n
              ? `Mint ${formatUsdcExact(faucet.mintable6)} mUSDC`
              : "Mint test USDC"}
          </Button>
        </div>

        <TxStatus tx={tx} onRetry={onMint} retryLabel="Mint again" onReset={onReset} />
      </CardContent>
    </Card>
  );
}
