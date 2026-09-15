"use client";

/**
 * Distribute a coupon.
 *
 * Two things have to be on screen before the wallet opens, and both are easy to leave out:
 *
 *  1. **The per-token figure**, because that — not the total — is what the contract writes into the
 *     coupon index and subtracts from NAV.
 *  2. **The NAV drop** (PLAN.md D26). A fund's NAV falls on the ex-distribution date; this contract
 *     does the same thing in the same transaction, and an operator who does not expect it will read
 *     the next transparency page as a bug.
 *
 * The three refusals the contract can raise — `NoSupply`, `DistributionTooSmall`,
 * `DistributionExceedsNav` — are computed here from the same integers, so an amount the contract
 * would reject is reported as a sentence with the bound beside it, rather than as a revert.
 *
 * `distributeCoupon` pulls the USDC with `safeTransferFrom`, so there is an approval first. It is a
 * separate transaction with its own machine, exactly as on `/subscribe`: a failure on the second
 * step must not erase the fact that the first one succeeded.
 */

import * as React from "react";
import { useAccount } from "wagmi";

import { encodeCall, type EncodeResult } from "@/components/admin/calldata";
import { ActionCard, RuleNote } from "@/components/admin/action-card";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import {
  DISTRIBUTE_INTRO,
  DISTRIBUTE_NAV_DROP,
  DISTRIBUTE_PAUSED_NOTE,
  DISTRIBUTE_TRUNCATION_NOTE,
} from "@/components/admin/copy";
import {
  assessDistribution,
  checkFunding,
  largestDistribution6,
  smallestDistribution6,
} from "@/components/admin/distribution";
import { AdminField, AdminInput, FactList, FactRow, QuickFills } from "@/components/admin/fields";
import { getAction, permissionFor, type RoleHoldings } from "@/components/admin/roles";
import type { AdminChainState } from "@/components/admin/use-admin-chain";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TxStatus } from "@/components/wallet/tx-status";
import { useTx } from "@/components/wallet/use-tx";
import { hbTokenAbi, mockUsdcAbi } from "@/lib/generated/abis";
import { formatFixed, formatUsdc, formatUsdcExact, parseAmount } from "@/lib/format";

const PHRASE = "DISTRIBUTE";

export interface DistributeCardProps {
  chain: AdminChainState;
  holdings: RoleHoldings;
  walletConnected: boolean;
  canSign: boolean;
}

export function DistributeCard({ chain, holdings, walletConnected, canSign }: DistributeCardProps) {
  const { address } = useAccount();
  const token = chain.token;
  const action = getAction("distribute");
  const permission = permissionFor(action, holdings);

  const [amountText, setAmountText] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);

  const approveTx = useTx({
    action: "Approval",
    contract: "MockUSDC",
    successTitle: "Allowance set",
    onConfirmed: () => chain.refresh(),
  });
  const distributeTx = useTx({
    action: "Coupon distribution",
    contract: "HBToken",
    successTitle: "Coupon distributed",
    onConfirmed: () => {
      setConfirming(false);
      chain.refresh();
    },
  });

  const parsed = parseAmount(amountText, 6);
  const amount6 = parsed.ok ? parsed.value : null;
  const amountError = parsed.ok ? null : amountText.trim() === "" ? null : parsed.error;

  const readable = token.supply18 !== null && token.nav6 !== null;
  const assessment =
    amount6 !== null && readable
      ? assessDistribution(amount6, {
          supply18: token.supply18!,
          nav6: token.nav6!,
          reportedAum6: token.reportedAum6 ?? 0n,
          anchor6: token.anchor6 ?? 0n,
        })
      : null;

  const funding = checkFunding(amount6 ?? 0n, chain.funds.balance6, chain.funds.allowance6);
  const preview = assessment?.ok ? assessment.preview : null;
  const refusal = assessment && !assessment.ok ? assessment.refusal : null;

  const encoded: EncodeResult | null =
    amount6 === null || amountError !== null
      ? null
      : encodeCall({
          contract: "HBToken",
          address: chain.addresses?.token ?? null,
          abi: hbTokenAbi,
          functionName: "distributeCoupon",
          args: [{ value: amount6, display: `${formatUsdcExact(amount6)} USDC` }],
        });

  const approveEncoded: EncodeResult | null =
    amount6 === null || chain.addresses === null
      ? null
      : encodeCall({
          contract: "MockUSDC",
          address: chain.addresses.usdc,
          abi: mockUsdcAbi,
          functionName: "approve",
          args: [
            { value: chain.addresses.token, display: "the hbTRS token contract" },
            { value: amount6, display: `${formatUsdcExact(amount6)} USDC` },
          ],
        });

  /**
   * Where the write goes. `null` when this network has no recorded deployment: the calldata above
   * is still real, but there is nowhere to send it, so nothing can be signed.
   */
  const to = encoded?.ok ? encoded.call.address : null;

  const paused = token.paused === true;
  const ready =
    canSign &&
    permission === "allowed" &&
    preview !== null &&
    to !== null &&
    !paused &&
    funding.balance !== "short" &&
    !funding.needsApproval &&
    !distributeTx.isBusy;

  const smallest = token.supply18 === null ? null : smallestDistribution6(token.supply18);
  const largest =
    token.supply18 === null || token.nav6 === null
      ? null
      : largestDistribution6(token.supply18, token.nav6);

  return (
    <>
      <ActionCard
        id="distribute"
        action={action}
        permission={permission}
        walletConnected={walletConnected}
        title="Distribute a coupon"
        description={DISTRIBUTE_INTRO}
        encoded={encoded}
        tx={distributeTx}
        confirmPhrase={PHRASE}
        footer={
          <>
            <Button variant="danger" disabled={!ready} onClick={() => setConfirming(true)}>
              Distribute
            </Button>
            {paused ? (
              <span className="text-danger text-xs">
                The token is paused, so distributeCoupon reverts EnforcedPause.
              </span>
            ) : null}
          </>
        }
      >
        <FactList className="border-border bg-surface-sunken rounded-md border p-3">
          <FactRow
            label="Supply"
            value={
              token.supply18 === null
                ? "—"
                : `${formatFixed(token.supply18, 18, { displayDecimals: 4, rounding: "trunc" })} hbTRS`
            }
          />
          <FactRow
            label="NAV now"
            value={token.nav6 === null ? "—" : `${formatUsdcExact(token.nav6)} USDC`}
          />
          <FactRow
            label="Distributions so far"
            value={token.distributionCount === null ? "—" : token.distributionCount.toString()}
          />
          <FactRow
            label="USDC paid in to date"
            value={
              token.totalDistributed6 === null ? "—" : `${formatUsdc(token.totalDistributed6)} USDC`
            }
          />
          <FactRow
            label="Coupon reserve"
            value={token.couponReserve6 === null ? "—" : `${formatUsdc(token.couponReserve6)} USDC`}
          />
          <FactRow
            label="Your test USDC"
            value={chain.funds.balance6 === null ? "—" : `${formatUsdc(chain.funds.balance6)} USDC`}
            tone={funding.balance === "short" ? "danger" : undefined}
          />
          <FactRow
            label="Approved to the token"
            value={
              chain.funds.allowance6 === null ? "—" : `${formatUsdc(chain.funds.allowance6)} USDC`
            }
            tone={funding.needsApproval ? "warning" : undefined}
          />
        </FactList>

        <AdminField
          id="admin-coupon"
          label="Coupon to distribute"
          error={amountError}
          hint={
            smallest !== null && largest !== null
              ? `The contract accepts ${formatUsdcExact(smallest)} to ${formatUsdcExact(largest)} USDC at the current supply and NAV: below that the per-token increment truncates to zero, above it the per-token amount would not be below NAV.`
              : "Six decimals, the integer the contract stores."
          }
          control={(props) => (
            <AdminInput
              {...props}
              suffix="USDC"
              placeholder="12.000000"
              inputMode="decimal"
              value={amountText}
              invalid={amountError !== null}
              onChange={(event) => setAmountText(event.target.value)}
            />
          )}
        >
          <QuickFills>
            {smallest !== null && smallest > 0n ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAmountText(formatUsdcExact(smallest))}
              >
                Smallest ({formatUsdcExact(smallest)})
              </Button>
            ) : null}
            {chain.funds.balance6 !== null && chain.funds.balance6 > 0n ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAmountText(formatUsdcExact(chain.funds.balance6!))}
              >
                Your balance ({formatUsdc(chain.funds.balance6)})
              </Button>
            ) : null}
          </QuickFills>
        </AdminField>

        {refusal ? (
          <RuleNote tone="danger" title={`The contract would revert ${refusal.code}`}>
            <p>{refusal.reason}</p>
            {refusal.minimum6 !== null || refusal.maximum6 !== null ? (
              <p className="mt-1">
                {refusal.minimum6 !== null ? (
                  <>
                    Smallest accepted:{" "}
                    <span className="num">{formatUsdcExact(refusal.minimum6)}</span> USDC.{" "}
                  </>
                ) : null}
                {refusal.maximum6 !== null ? (
                  <>
                    Largest accepted:{" "}
                    <span className="num">{formatUsdcExact(refusal.maximum6)}</span> USDC.
                  </>
                ) : null}
              </p>
            ) : null}
          </RuleNote>
        ) : null}

        {preview ? (
          <div data-testid="distribution-preview">
            <RuleNote tone="warning" title="What this distribution does">
              <FactList className="text-xs">
                <FactRow label="Per token" value={`${formatUsdcExact(preview.perToken6)} USDC`} />
                <FactRow
                  label="Allocated to holders"
                  value={`${formatUsdcExact(preview.allocated6)} USDC`}
                />
                <FactRow
                  label="Truncation remainder"
                  value={`${formatUsdcExact(preview.remainder6)} USDC`}
                />
                <FactRow
                  label="NAV"
                  value={`${formatUsdcExact(preview.navBefore6)} → ${formatUsdcExact(preview.navAfter6)} USDC`}
                  tone="warning"
                />
                <FactRow
                  label="Reported AUM"
                  value={`${formatUsdc(preview.reportedAumBefore6)} → ${formatUsdc(preview.reportedAumAfter6)} USDC`}
                />
                <FactRow
                  label="Rail anchor"
                  value={`${formatUsdcExact(preview.anchorBefore6)} → ${formatUsdcExact(preview.anchorAfter6)} USDC`}
                />
              </FactList>
              {preview.remainder6 > 0n ? (
                <p className="mt-2">{DISTRIBUTE_TRUNCATION_NOTE}</p>
              ) : null}
            </RuleNote>
          </div>
        ) : null}

        {funding.balance === "short" && funding.balanceShortfall6 !== null ? (
          <RuleNote tone="danger" title="Not enough test USDC">
            This wallet is {formatUsdcExact(funding.balanceShortfall6)} USDC short. The transfer is
            the first thing <span className="addr">distributeCoupon</span> does, so the whole
            transaction reverts with an ERC-20 error before any coupon accounting happens. Use the
            faucet on <span className="addr">/subscribe</span>.
          </RuleNote>
        ) : null}

        {funding.needsApproval && amount6 !== null ? (
          <div className="border-border bg-surface flex flex-col gap-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="warning">Approval needed first</StatusBadge>
              <span className="text-muted text-xs">
                distributeCoupon pulls the USDC with safeTransferFrom, so the token contract needs
                an allowance.
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={!canSign || approveTx.isBusy || !approveEncoded?.ok}
              onClick={() => {
                if (!approveEncoded?.ok || chain.addresses === null || amount6 === null) return;
                void approveTx.send({
                  address: chain.addresses.usdc,
                  abi: mockUsdcAbi,
                  functionName: "approve",
                  args: [chain.addresses.token, amount6],
                });
              }}
            >
              Approve {formatUsdcExact(amount6)} USDC
            </Button>
            <TxStatus tx={approveTx} onReset={approveTx.reset} />
          </div>
        ) : null}

        <RuleNote tone="warning" title="NAV falls at distribution">
          {DISTRIBUTE_NAV_DROP}
        </RuleNote>

        {paused ? <RuleNote tone="warning">{DISTRIBUTE_PAUSED_NOTE}</RuleNote> : null}
      </ActionCard>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Distribute a coupon"
        description="Test USDC leaves your wallet and NAV falls in the same transaction."
        tone="danger"
        phrase={PHRASE}
        confirmLabel="Distribute the coupon"
        encoded={encoded}
        busy={distributeTx.isBusy}
        consequences={
          preview
            ? [
                <>
                  <span className="num">{formatUsdcExact(preview.amount6)}</span> USDC moves from{" "}
                  <span className="addr">{address ?? "your wallet"}</span> into the vault.
                </>,
                <>
                  Every holder becomes entitled to{" "}
                  <span className="num">{formatUsdcExact(preview.perToken6)}</span> USDC per token,
                  claimable at any time.
                </>,
                <>
                  NAV falls from <span className="num">{formatUsdcExact(preview.navBefore6)}</span>{" "}
                  to <span className="num">{formatUsdcExact(preview.navAfter6)}</span> USDC per
                  token, in this transaction. There is no way to undo it.
                </>,
                <>
                  The rail anchor falls by the same per-token amount, so this does not eat the
                  oracle&rsquo;s rail budget for the day.
                </>,
              ]
            : []
        }
        onConfirm={() => {
          if (to === null || amount6 === null) return;
          void distributeTx.send({
            address: to,
            abi: hbTokenAbi,
            functionName: "distributeCoupon",
            args: [amount6],
          });
        }}
      />
    </>
  );
}
