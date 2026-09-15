"use client";

/**
 * Pause and unpause, with what the pause actually stops written out (PLAN.md D3).
 *
 * "Pause" sounds like it stops trading. On this contract it stops trading *and* it stops holders
 * claiming coupons they are already owed — their money stays in the vault and the index still
 * remembers it, but `claimCoupon` reverts until somebody unpauses. That is a decision about other
 * people's access to their own money, and it is the one thing an operator must understand before
 * clicking, so it is stated on its own rather than buried in a list.
 *
 * The card offers exactly one action: whichever of pause / unpause the current state allows. A
 * console with both buttons live is a console where the wrong one gets clicked.
 */

import * as React from "react";

import { encodeCall, type EncodeResult } from "@/components/admin/calldata";
import { ActionCard, RuleNote } from "@/components/admin/action-card";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import {
  PAUSE_CLAIM_WARNING,
  PAUSE_ISSUER_BURN_NOTE,
  PAUSE_KEEPS,
  PAUSE_STOPS,
} from "@/components/admin/copy";
import { getAction, permissionFor, type RoleHoldings } from "@/components/admin/roles";
import type { AdminChainState } from "@/components/admin/use-admin-chain";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTx } from "@/components/wallet/use-tx";
import { hbTokenAbi } from "@/lib/generated/abis";

export interface PauseCardProps {
  chain: AdminChainState;
  holdings: RoleHoldings;
  walletConnected: boolean;
  canSign: boolean;
}

export function PauseCard({ chain, holdings, walletConnected, canSign }: PauseCardProps) {
  const paused = chain.token.paused;
  const unpausing = paused === true;
  const action = getAction(unpausing ? "unpause" : "pause");
  const permission = permissionFor(action, holdings);
  const functionName = unpausing ? "unpause" : "pause";
  const phrase = unpausing ? "UNPAUSE" : "PAUSE";

  const [confirming, setConfirming] = React.useState(false);

  const tx = useTx({
    action: unpausing ? "Unpause" : "Pause",
    contract: "HBToken",
    successTitle: unpausing ? "Token unpaused" : "Token paused",
    onConfirmed: () => {
      setConfirming(false);
      chain.refresh();
    },
  });

  const encoded: EncodeResult | null = encodeCall({
    contract: "HBToken",
    address: chain.addresses?.token ?? null,
    abi: hbTokenAbi,
    functionName,
  });

  /**
   * Where the write goes. `null` when this network has no recorded deployment: the calldata above
   * is still real, but there is nowhere to send it, so nothing can be signed.
   */
  const to = encoded?.ok ? encoded.call.address : null;

  const ready = canSign && permission === "allowed" && paused !== null && to !== null && !tx.isBusy;

  return (
    <>
      <ActionCard
        id="pause"
        action={action}
        permission={permission}
        walletConnected={walletConnected}
        title={unpausing ? "Unpause the token" : "Pause the token"}
        description={
          paused === null
            ? "The token did not answer paused(), so this card cannot tell you which way round it is."
            : unpausing
              ? "The token is paused. Unpausing restores transfers, subscriptions, redemptions, distributions and claims."
              : "Pausing stops every movement of value, including coupon claims."
        }
        encoded={encoded}
        tx={tx}
        confirmPhrase={phrase}
        footer={
          <>
            <Button
              variant={unpausing ? "primary" : "danger"}
              disabled={!ready}
              onClick={() => setConfirming(true)}
            >
              {unpausing ? "Unpause" : "Pause"}
            </Button>
            <StatusBadge tone={paused === null ? "neutral" : paused ? "danger" : "success"}>
              {paused === null ? "State unknown" : paused ? "Paused" : "Live"}
            </StatusBadge>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <RuleNote tone="danger" title="A pause stops">
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {PAUSE_STOPS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </RuleNote>
          <RuleNote title="A pause does not stop">
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {PAUSE_KEEPS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </RuleNote>
        </div>

        <RuleNote tone="warning" title="Holders cannot claim while paused">
          {PAUSE_CLAIM_WARNING}
        </RuleNote>

        <RuleNote>{PAUSE_ISSUER_BURN_NOTE}</RuleNote>
      </ActionCard>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={unpausing ? "Unpause the token" : "Pause the token"}
        description={
          unpausing
            ? "Everything the pause stopped starts working again in the next block."
            : "Every movement of value stops in the next block."
        }
        tone={unpausing ? "warning" : "danger"}
        phrase={phrase}
        confirmLabel={unpausing ? "Unpause" : "Pause"}
        encoded={encoded}
        busy={tx.isBusy}
        consequences={
          unpausing
            ? [
                "Transfers, subscribe, redeem, mint, burn, distributeCoupon and claimCoupon all work again.",
                "Nothing accrued while paused is lost: the coupon index kept every entitlement, and holders can claim from the next block.",
              ]
            : [
                "No holder can transfer, subscribe, redeem, or be minted or burned.",
                "No holder can claim a coupon, including one already accrued to them. Their money stays in the vault and is claimable the moment you unpause.",
                "setNAV and every registry change keep working, so the oracle and the registrar are unaffected.",
              ]
        }
        onConfirm={() => {
          if (to === null) return;
          void tx.send({
            address: to,
            abi: hbTokenAbi,
            functionName,
          });
        }}
      />
    </>
  );
}
