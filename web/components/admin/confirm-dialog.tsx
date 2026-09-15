"use client";

/**
 * The typed confirmation (BUILD_PROMPT 7.2: "destructive ones require typed confirmation").
 *
 * The dialog is the last thing between an operator and a signature, so it repeats the three things
 * that matter and nothing else: what will happen, the encoded call, and a phrase that has to be
 * typed. The phrase is shown rather than hidden — it is not a password, and the point is not
 * secrecy but deliberateness. It names the action and, where the argument is the dangerous part,
 * the argument: `BLOCK 840` cannot be confirmed by muscle memory from `BLOCK 792`.
 *
 * The match is exact and case-sensitive. A confirmation that accepts `burn` for `BURN` is a
 * confirmation that can be typed without reading it.
 */

import * as React from "react";

import { EncodedCallPanel } from "@/components/admin/encoded-call";
import type { EncodeResult } from "@/components/admin/calldata";
import { AdminField, AdminInput } from "@/components/admin/fields";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  /** What this transaction will do, one consequence per line. */
  consequences?: readonly React.ReactNode[];
  /**
   * The phrase that must be typed exactly. `null` confirms with the button alone — right for an
   * action that is reversible and cheap, wrong for anything on the destructive list.
   */
  phrase: string | null;
  confirmLabel: string;
  tone?: "danger" | "warning";
  encoded?: EncodeResult | null;
  /** The wallet or the chain owes an answer; the confirm button waits. */
  busy?: boolean;
  /**
   * Fields the action needs that are only meaningful at the point of confirmation — a rejection
   * reason, for instance, which is part of what gets signed and so cannot be collected afterwards.
   */
  extra?: React.ReactNode;
  /** Refuse the confirmation for a reason of the caller's own, e.g. an empty `extra` field. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  consequences,
  phrase,
  confirmLabel,
  tone = "danger",
  encoded,
  busy = false,
  extra,
  confirmDisabled = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [typed, setTyped] = React.useState("");
  const inputId = React.useId();

  // A phrase typed for one confirmation must never carry over into the next.
  React.useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const matches = phrase === null || typed.trim() === phrase;
  const canConfirm = matches && !confirmDisabled && !busy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="confirm-dialog"
        className="max-w-xl"
        onOpenAutoFocus={(event) => {
          // Focus the field that has to be filled in, not the close button.
          if (phrase === null) return;
          event.preventDefault();
          document.getElementById(inputId)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {consequences && consequences.length > 0 ? (
            <Alert tone={tone} hideIcon role="presentation">
              <AlertTitle>What this does</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
                  {consequences.map((consequence, index) => (
                    <li key={index}>{consequence}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          {extra}

          {encoded !== undefined ? (
            <EncodedCallPanel encoded={encoded} labelSuffix={title} />
          ) : null}

          {phrase === null ? null : (
            <AdminField
              id={inputId}
              label={
                <>
                  Type <span className="num text-ink font-semibold">{phrase}</span> to confirm
                </>
              }
              hint="Exact match, including capitals. This is not a password; it is there so the action has to be read before it is sent."
              control={(controlProps) => (
                <AdminInput
                  {...controlProps}
                  value={typed}
                  placeholder={phrase}
                  onChange={(event) => setTyped(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && canConfirm) onConfirm();
                  }}
                />
              )}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {busy ? "Waiting for your wallet…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
