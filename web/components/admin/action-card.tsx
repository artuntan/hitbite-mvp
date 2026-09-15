"use client";

/**
 * The shell every action on `/admin` is rendered in.
 *
 * One shape for all ten, so an operator learns the layout once: what the action is, which role it
 * needs and whether this wallet holds it, the rule behind it, the form, the encoded call, and the
 * transaction's own state kept on the page after the toast has gone.
 *
 * The permission notice is the part worth being careful about. Four states, and they are not
 * interchangeable: no wallet, role still being read, role not held, role held. Rendering "you do
 * not hold this role" while the read is in flight would send somebody looking for a wallet they are
 * already connected to.
 */

import * as React from "react";

import type { EncodeResult } from "@/components/admin/calldata";
import { EncodedCallPanel } from "@/components/admin/encoded-call";
import {
  missingRoleSentence,
  type AdminActionDefinition,
  type Permission,
} from "@/components/admin/roles";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TxStatus } from "@/components/wallet/tx-status";
import type { UseTxResult } from "@/components/wallet/use-tx";
import { cn } from "@/lib/utils";

export interface ActionCardProps {
  action: AdminActionDefinition;
  permission: Permission;
  /** False when no wallet is connected: a different sentence from "the role is not held". */
  walletConnected: boolean;
  title: string;
  description: React.ReactNode;
  /** The form, and the rules that belong beside it. */
  children: React.ReactNode;
  /** `undefined` hides the panel; `null` shows "nothing to encode yet". */
  encoded?: EncodeResult | null;
  tx?: UseTxResult;
  /**
   * The phrase the confirmation dialog will ask for, printed on the card.
   *
   * The dialog is where the phrase is typed, but the dialog only opens for a wallet that can
   * actually send the action — so without this line the console's most important safety property
   * would be invisible to anyone reading the page, which is most people who ever open it.
   */
  confirmPhrase?: string | null;
  /** The submit control. */
  footer?: React.ReactNode;
  id?: string;
  className?: string;
}

interface PermissionNotice {
  tone: "success" | "neutral" | "warning";
  badge: string;
  sentence: string | null;
}

function noticeFor(
  action: AdminActionDefinition,
  permission: Permission,
  walletConnected: boolean,
): PermissionNotice {
  if (!walletConnected) {
    return {
      tone: "neutral",
      badge: "No wallet",
      sentence:
        action.role === null
          ? null
          : `${action.call} is restricted to ${action.role.toUpperCase().replace(/-/g, " ")}. Connect the wallet that holds it to send this; you can fill the form and read the encoded call without one.`,
    };
  }
  if (permission === "unknown") {
    return { tone: "neutral", badge: "Checking the chain", sentence: null };
  }
  if (permission === "refused") {
    return { tone: "warning", badge: "Role not held", sentence: missingRoleSentence(action) };
  }
  return { tone: "success", badge: "This wallet can send it", sentence: null };
}

export function ActionCard({
  action,
  permission,
  walletConnected,
  title,
  description,
  children,
  encoded,
  tx,
  confirmPhrase,
  footer,
  id,
  className,
}: ActionCardProps) {
  const notice = noticeFor(action, permission, walletConnected);

  return (
    <Card id={id} data-testid={`action-${action.id}`} className={cn("scroll-mt-24", className)}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle as="h3">{title}</CardTitle>
          <StatusBadge tone={notice.tone}>{notice.badge}</StatusBadge>
        </div>
        <CardDescription>{description}</CardDescription>
        <p className="addr text-muted mt-1 text-xs">{action.call}</p>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {notice.sentence ? (
          <p className="border-border bg-surface-sunken text-muted rounded-md border p-3 text-xs leading-relaxed">
            {notice.sentence}
          </p>
        ) : null}

        {children}

        {encoded !== undefined ? <EncodedCallPanel encoded={encoded} labelSuffix={title} /> : null}

        {tx ? <TxStatus tx={tx} onReset={tx.reset} /> : null}

        {confirmPhrase ? (
          <p data-testid="typed-confirmation" className="text-muted text-xs leading-relaxed">
            Destructive: the confirmation asks you to type{" "}
            <span className="num text-ink font-semibold">{confirmPhrase}</span> before anything is
            signed.
          </p>
        ) : null}

        {footer ? <div className="flex flex-wrap items-center gap-3">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}

/** The block of prose each card carries: the contract rule, in words, above the form. */
export function RuleNote({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "danger";
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-3 text-xs leading-relaxed",
        tone === "info" && "border-border bg-surface-sunken text-muted",
        tone === "warning" && "border-warning-surface bg-warning-surface text-ink",
        tone === "danger" && "border-danger-surface bg-danger-surface text-ink",
      )}
    >
      {title ? <p className="text-ink mb-1 font-semibold">{title}</p> : null}
      {children}
    </div>
  );
}
