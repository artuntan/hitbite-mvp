"use client";

/**
 * The checklist of everything `subscribe` requires, passing and failing alike.
 *
 * A greyed-out button tells somebody that they cannot continue. It does not tell them which of the
 * six on-chain rules is in the way, which is the only thing they actually need. So the whole list
 * is rendered, each row carrying the rule it comes from and, where one exists, the control that
 * clears it.
 */

import * as React from "react";
import { Check, CircleHelp, Minus, X } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import type { Gate, GateStatus } from "@/components/subscribe/quote";
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

export interface GateListProps {
  gates: readonly Gate[];
  /** Ask the wallet to switch to the required chain. */
  onSwitchNetwork?: () => void;
  /** Mint test USDC. Omitted when the faucet itself is unavailable. */
  onFaucet?: () => void;
  /** Move focus to the amount box. */
  onFocusAmount?: () => void;
  /** The connect control, supplied by the page so this file never imports RainbowKit. */
  connectControl?: React.ReactNode;
  className?: string;
}

export function GateList({
  gates,
  onSwitchNetwork,
  onFaucet,
  onFocusAmount,
  connectControl,
  className,
}: GateListProps) {
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
                onFaucet={onFaucet}
                onFocusAmount={onFocusAmount}
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
  onFaucet,
  onFocusAmount,
  connectControl,
}: {
  gate: Gate;
  onSwitchNetwork?: () => void;
  onFaucet?: () => void;
  onFocusAmount?: () => void;
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
    case "verify":
      return (
        <Button asChild variant="primary" size="sm" className="mt-2">
          <Link href="/verify">Request verification</Link>
        </Button>
      );
    case "faucet":
      return onFaucet ? (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onFaucet}>
          Use the faucet
        </Button>
      ) : null;
    case "amount":
      return onFocusAmount ? (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onFocusAmount}>
          Change the amount
        </Button>
      ) : null;
    // "approve" is the first step of the flow below, which has its own button.
    default:
      return null;
  }
}
