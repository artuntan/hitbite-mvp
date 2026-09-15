"use client";

/**
 * The checklist of everything `redeem` requires, passing and failing alike.
 *
 * A greyed-out button says that somebody cannot continue. It does not say which of the contract's
 * rules is in the way, which is the only thing they can act on. So the whole list is rendered, each
 * row naming the rule it comes from and carrying the control that clears it — most usefully on the
 * liquidity row, where the way forward is an amount the vault can actually pay.
 *
 * Shaped like `components/subscribe/gate-list.tsx` on purpose: the two pages should read as one
 * app. The types are this page's own because the gates are — a redemption has a liquidity rule and
 * no allowance, and deliberately no eligibility rule at all (PLAN.md D4).
 */

import * as React from "react";
import { Check, CircleHelp, Minus, X } from "lucide-react";

import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Gate, GateStatus } from "@/components/portfolio/position";
import { cn } from "@/lib/utils";

const STATUS_META: Record<
  GateStatus,
  { tone: "success" | "danger" | "neutral" | "warning"; label: string; icon: typeof Check }
> = {
  ok: { tone: "success", label: "Satisfied", icon: Check },
  blocked: { tone: "danger", label: "In the way", icon: X },
  waiting: { tone: "neutral", label: "Not checked yet", icon: Minus },
  unknown: { tone: "warning", label: "Cannot be checked", icon: CircleHelp },
};

export interface RedeemGateListProps {
  gates: readonly Gate[];
  onSwitchNetwork?: () => void;
  onFocusAmount?: () => void;
  /** Fill the box with the whole balance. */
  onUseBalance?: () => void;
  /** Fill the box with the most available liquidity can pay for. */
  onUseMaxLiquidity?: () => void;
  /** The connect control, supplied by the page so this file never imports RainbowKit. */
  connectControl?: React.ReactNode;
  className?: string;
}

export function RedeemGateList({
  gates,
  onSwitchNetwork,
  onFocusAmount,
  onUseBalance,
  onUseMaxLiquidity,
  connectControl,
  className,
}: RedeemGateListProps) {
  return (
    <ul className={cn("flex flex-col gap-3", className)}>
      {gates.map((gate) => {
        const meta = STATUS_META[gate.status];
        const Icon = meta.icon;
        return (
          <li key={gate.id} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                gate.status === "ok" && "border-success-surface bg-success-surface text-success",
                gate.status === "blocked" && "border-danger-surface bg-danger-surface text-danger",
                gate.status === "unknown" &&
                  "border-warning-surface bg-warning-surface text-warning",
                gate.status === "waiting" && "border-border bg-surface-sunken text-muted",
              )}
            >
              <Icon className="size-3" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-ink text-sm font-medium">{gate.label}</span>
                <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
              </div>
              <p className="text-muted mt-1 text-sm">{gate.detail}</p>
              <GateAction
                gate={gate}
                onSwitchNetwork={onSwitchNetwork}
                onFocusAmount={onFocusAmount}
                onUseBalance={onUseBalance}
                onUseMaxLiquidity={onUseMaxLiquidity}
                connectControl={connectControl}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function GateAction({
  gate,
  onSwitchNetwork,
  onFocusAmount,
  onUseBalance,
  onUseMaxLiquidity,
  connectControl,
}: {
  gate: Gate;
  onSwitchNetwork?: () => void;
  onFocusAmount?: () => void;
  onUseBalance?: () => void;
  onUseMaxLiquidity?: () => void;
  connectControl?: React.ReactNode;
}) {
  if (gate.status !== "blocked") return null;

  switch (gate.action) {
    case "connect":
      return connectControl ? <div className="mt-2">{connectControl}</div> : null;
    case "switch":
      return onSwitchNetwork ? (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onSwitchNetwork}>
          Switch network
        </Button>
      ) : null;
    case "amount":
      return onFocusAmount ? (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onFocusAmount}>
          Change the amount
        </Button>
      ) : null;
    case "max-balance":
      return onUseBalance ? (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onUseBalance}>
          Use the whole balance
        </Button>
      ) : null;
    case "max-liquidity":
      return onUseMaxLiquidity ? (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onUseMaxLiquidity}>
          Redeem the most available
        </Button>
      ) : null;
    default:
      return null;
  }
}
