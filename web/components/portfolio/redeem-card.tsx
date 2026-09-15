"use client";

/**
 * Redeem: the preview, the liquidity check, then the signature — in that order.
 *
 * BUILD_PROMPT 7.2 is explicit that the preview and the liquidity check both happen **before** a
 * wallet is asked for anything, and this card is built around that order:
 *
 *  1. `previewRedeem(amount)` is read from the token, with the same arithmetic reproduced locally
 *     from the NAV this page read. Both are shown when they differ, because the only way they can
 *     is a NAV update between the two reads — and the chain's answer is the one that settles.
 *  2. `availableLiquidity()` is compared against the payout, with the vault and the coupon reserve
 *     shown beside it. Coupon money is ring-fenced (PLAN.md D6): it is owed to the holders who
 *     earned it and is never used to pay a redemption. When the ask is too large the card says so
 *     with both numbers — the same pair `InsufficientLiquidity(available, requested)` carries —
 *     and offers the largest amount that would go through.
 *  3. Only then is the button live.
 *
 * There is no verification gate on this card. `_update` skips `canHold(from)` on a burn (PLAN.md
 * D4, COMPLIANCE_RULES section 4), so a de-verified holder can always exit; refusing them here
 * would trap money the contract deliberately does not trap.
 */

import * as React from "react";
import { ArrowRight } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { RedeemGateList } from "@/components/portfolio/gate-list";
import { TokenAmountField } from "@/components/portfolio/token-amount-field";
import type {
  Gate,
  PortfolioChainState,
  RedeemQuote,
  RedeemReadiness,
  TokenAmountReading,
} from "@/components/portfolio/position";
import { TxStatus, type TxStatusView } from "@/components/wallet/tx-status";
import { TOKEN } from "@/lib/copy";
import { formatTokens, formatUsdcExact } from "@/lib/format";

export interface SettledRedemption {
  readonly tokensIn18: bigint;
  readonly usdcOut6: bigint;
  readonly nav6: bigint;
}

export interface RedeemCardProps {
  chain: PortfolioChainState;
  amountText: string;
  onAmountChange: (next: string) => void;
  amount: TokenAmountReading;
  quote: RedeemQuote;
  gates: readonly Gate[];
  readiness: RedeemReadiness;
  maxRedeemable18: bigint | null;
  tx: TxStatusView;
  busy: boolean;
  confirmed: boolean;
  settled: SettledRedemption | null;
  onRedeem: () => void;
  onReset: () => void;
  onSwitchNetwork: () => void;
  onUseBalance: () => void;
  onUseMaxLiquidity: () => void;
  connectControl?: React.ReactNode;
}

export function RedeemCard({
  chain,
  amountText,
  onAmountChange,
  amount,
  quote,
  gates,
  readiness,
  maxRedeemable18,
  tx,
  busy,
  confirmed,
  settled,
  onRedeem,
  onReset,
  onSwitchNetwork,
  onUseBalance,
  onUseMaxLiquidity,
  connectControl,
}: RedeemCardProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const onFocusAmount = React.useCallback(() => inputRef.current?.focus(), []);

  return (
    <Card data-testid="redeem-card">
      <CardHeader>
        <CardTitle as="h2">Redeem for test USDC</CardTitle>
        <CardDescription>
          A redemption burns {TOKEN.symbol} and pays{" "}
          <span className="num">tokenAmount × nav / 1e18</span> out of the vault&rsquo;s available
          liquidity. Verification is <strong>not</strong> checked: the contract skips the
          eligibility test on a burn, so an address removed from the registry can still take its
          money out.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <TokenAmountField
          value={amountText}
          onChange={onAmountChange}
          reading={amount}
          inputRef={inputRef}
          balance18={chain.balance18}
          maxRedeemable18={maxRedeemable18}
          available6={chain.availableLiquidity6}
          disabled={confirmed}
        />

        <div className="border-border bg-surface-sunken flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-muted text-sm">You would receive</span>
            <span className="num text-ink text-xl" data-testid="redeem-quote-usdc">
              {quote.usdcOut6 === null ? "—" : `${formatUsdcExact(quote.usdcOut6)} USDC`}
            </span>
          </div>

          <p className="text-muted text-xs" data-testid="redeem-quote-source">
            {quote.usdcOut6 === null
              ? "Enter an amount to quote it against the contract."
              : quote.source === "chain"
                ? "Read from `previewRedeem` on the token — the contract's own view function, on this exact amount."
                : "Computed with the contract's arithmetic from the NAV this page read; `previewRedeem` has not answered yet."}
          </p>

          {quote.mismatch && quote.chain6 !== null && quote.local6 !== null ? (
            <p className="text-warning text-xs" data-testid="redeem-quote-mismatch">
              The contract answered {formatUsdcExact(quote.chain6)} USDC and this page computed{" "}
              {formatUsdcExact(quote.local6)} from the NAV it last read, so the NAV moved between
              the two reads. The contract&rsquo;s number is the one shown, and a redemption settles
              at the NAV in the block that includes it.
            </p>
          ) : null}

          {quote.truncatedPayout ? (
            <p className="text-muted text-xs">
              The payout divides with a remainder, so it is floored to the micro-USDC below — the
              same truncation the contract performs, never a rounding up.
            </p>
          ) : null}

          <Separator />

          <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
            <dt className="text-muted">Vault balance</dt>
            <dd className="num text-ink" data-testid="redeem-vault">
              {chain.vaultBalance6 === null
                ? "Not readable"
                : `${formatUsdcExact(chain.vaultBalance6)} USDC`}
            </dd>
            <dt className="text-muted">Coupon reserve</dt>
            <dd className="num text-ink" data-testid="redeem-reserve">
              {chain.couponReserve6 === null
                ? "Not readable"
                : `${formatUsdcExact(chain.couponReserve6)} USDC`}
            </dd>
            <dt className="text-muted">Available for redemptions</dt>
            <dd className="num text-ink" data-testid="redeem-available">
              {chain.availableLiquidity6 === null
                ? "Not readable"
                : `${formatUsdcExact(chain.availableLiquidity6)} USDC`}
            </dd>
          </dl>
          <p className="text-muted text-xs">
            Available liquidity is the vault minus the coupon reserve. The reserve is money already
            distributed and not yet claimed; it belongs to the holders who earned it, so a
            redemption never draws on it.
          </p>
        </div>

        {confirmed ? (
          <Alert tone="success" data-testid="redeem-settled">
            <AlertTitle>Redemption confirmed</AlertTitle>
            <AlertDescription>
              {settled === null
                ? "The transaction confirmed, but no `Redeemed` log could be decoded from its receipt, so this card will not state an amount it cannot read back."
                : `The chain recorded ${formatTokens(settled.tokensIn18, 6)} ${TOKEN.symbol} burned for ${formatUsdcExact(settled.usdcOut6)} USDC at a NAV of ${formatUsdcExact(settled.nav6)} — read from the Redeemed log in the receipt, not from the quote above it.`}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="lg"
              onClick={onRedeem}
              disabled={!readiness.canRedeem || busy}
              data-testid="redeem-action"
            >
              {quote.usdcOut6 === null
                ? "Redeem"
                : `Redeem for ${formatUsdcExact(quote.usdcOut6)} USDC`}
              <ArrowRight aria-hidden="true" />
            </Button>
            {readiness.blockers.length > 0 ? (
              <p className="text-muted text-sm" data-testid="redeem-blocker-summary">
                {describeBlockers(readiness.blockers.map((gate) => gate.label))}
              </p>
            ) : null}
          </div>
        )}

        <TxStatus tx={tx} onRetry={onRedeem} retryLabel="Redeem again" onReset={onReset} />

        <div>
          <h3 className="text-ink mb-3 text-sm font-semibold">What has to be true</h3>
          <p className="text-muted mb-3 text-sm">
            Every condition <span className="num">redeem</span> imposes, in the order the contract
            checks them. All of them are enforced on-chain; this list reads them back so nothing has
            to be learned from a reverted transaction.
          </p>
          <RedeemGateList
            gates={gates}
            onSwitchNetwork={onSwitchNetwork}
            onFocusAmount={onFocusAmount}
            onUseBalance={onUseBalance}
            onUseMaxLiquidity={onUseMaxLiquidity}
            connectControl={connectControl}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * "Waiting on 2 things: an amount to redeem, enough available liquidity." — the button's reason, in
 * words. Only the first letter is lowered, so a chain name stays a proper noun.
 */
function describeBlockers(labels: readonly string[]): string {
  if (labels.length === 0) return "";
  const listed = labels.map((label) => label.charAt(0).toLowerCase() + label.slice(1)).join(", ");
  if (labels.length === 1) return `Waiting on one thing: ${listed}.`;
  return `Waiting on ${labels.length} things: ${listed}.`;
}
