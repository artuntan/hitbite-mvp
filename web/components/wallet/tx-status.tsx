"use client";

/**
 * How a transaction looks while it is happening.
 *
 * `useTx` decides what the state is; this file decides how it reads. Two shapes:
 *
 *  - `TxStatus` — one write, one panel. The toast is a convenience that dismisses itself; this is
 *    the record that stays on the page for somebody who looked away.
 *  - `TxStepList` — several writes in order, which is the shape `/subscribe` needs (approve, then
 *    subscribe) and `/portfolio` needs for redeem. Each step owns its own machine, so a failure on
 *    step two does not erase the fact that step one succeeded.
 *
 * Whatever the state, the panel keeps a way forward: an explorer link once a hash exists, the full
 * hash when the chain has no explorer, a retry when retrying could work, and the decoded reason
 * when the contract refused. A dead end is a bug in this file.
 */

import * as React from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  ExternalLink,
  LoaderCircle,
  PenLine,
  RefreshCw,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatTxHash } from "@/lib/format";
import {
  describeTxPhase,
  type ExplorerLink,
  type TxPhase,
  type TxPhaseDescription,
  type TxState,
} from "@/lib/tx";
import { cn } from "@/lib/utils";

/** The slice of `UseTxResult` this file renders. Anything structurally like it will do. */
export interface TxStatusView {
  state: TxState;
  link: ExplorerLink | null;
  description: TxPhaseDescription;
  walletNote?: string | null;
}

const TONE_TO_ALERT = {
  neutral: "info",
  accent: "accent",
  success: "success",
  danger: "danger",
} as const;

const PHASE_ICON: Record<TxPhase, typeof CircleDashed> = {
  idle: CircleDashed,
  "awaiting-signature": PenLine,
  pending: LoaderCircle,
  confirmed: CircleCheck,
  failed: CircleAlert,
};

const PHASE_ICON_CLASS: Record<TxPhase, string> = {
  idle: "text-muted",
  "awaiting-signature": "text-accent-ink",
  // `motion-safe` so the spin respects prefers-reduced-motion, which globals.css also honours.
  pending: "text-accent-ink motion-safe:animate-spin",
  confirmed: "text-success",
  failed: "text-danger",
};

/**
 * The explorer link, or the honest alternative. Anvil has no explorer, so rather than a disabled
 * button this prints the whole hash — which is exactly what somebody would paste into `cast`.
 */
export function TxExplorerLink({
  link,
  hash,
  className,
}: {
  link: ExplorerLink | null;
  hash?: string;
  className?: string;
}) {
  if (!link) return null;
  if (link.available) {
    return (
      <a
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "text-accent-ink focus-visible:outline-ring inline-flex items-center gap-1.5 rounded text-sm font-medium underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2",
          className,
        )}
      >
        {hash ? formatTxHash(hash) : "View on the explorer"}
        <ExternalLink aria-hidden="true" className="size-3.5" />
        <span className="sr-only"> (opens {link.host} in a new tab)</span>
      </a>
    );
  }
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-muted text-xs">{link.reason}</p>
      {hash ? <p className="addr text-ink mt-1 text-xs">{hash}</p> : null}
    </div>
  );
}

/** The decoded arguments of a custom error, as a definition list. */
export function TxFailureDetails({
  details,
  className,
}: {
  details: readonly { label: string; value: string; mono?: "num" | "addr" }[] | undefined;
  className?: string;
}) {
  if (!details || details.length === 0) return null;
  return (
    <dl className={cn("mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]", className)}>
      {details.map((detail) => (
        <React.Fragment key={detail.label}>
          <dt className="text-muted">{detail.label}</dt>
          <dd
            className={cn(
              "text-ink",
              detail.mono === "num" && "num",
              detail.mono === "addr" && "addr",
            )}
          >
            {detail.value}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export interface TxStatusProps {
  tx: TxStatusView;
  /** Re-runs the write. Shown only when the failure is one a retry could clear. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Clears the panel back to idle. */
  onReset?: () => void;
  /** Render nothing while idle. Default `true`. */
  hideWhenIdle?: boolean;
  /** Extra content inside the panel, e.g. what was minted. */
  children?: React.ReactNode;
  className?: string;
}

export function TxStatus({
  tx,
  onRetry,
  retryLabel = "Try again",
  onReset,
  hideWhenIdle = true,
  children,
  className,
}: TxStatusProps) {
  const { state, link, description, walletNote } = tx;
  const hash =
    state.phase === "pending" || state.phase === "confirmed" || state.phase === "failed"
      ? state.hash
      : undefined;
  const failure = state.phase === "failed" ? state.failure : undefined;
  const Icon = PHASE_ICON[state.phase];

  // The live region is rendered even when empty. A region that appears at the same moment as its
  // content is unreliable in screen readers — it has to exist first for the change to be announced.
  return (
    <div
      aria-live={description.tone === "danger" ? "assertive" : "polite"}
      aria-atomic="true"
      className={className}
    >
      {state.phase === "idle" && hideWhenIdle ? null : (
        <Alert
          tone={TONE_TO_ALERT[description.tone]}
          hideIcon
          role="presentation"
          className="flex-col items-start"
        >
          <div className="flex w-full items-start gap-3">
            <Icon
              aria-hidden="true"
              className={cn("mt-0.5 size-4 shrink-0", PHASE_ICON_CLASS[state.phase])}
            />
            <div className="min-w-0 flex-1">
              <AlertTitle>{failure ? failure.title : description.label}</AlertTitle>
              <AlertDescription>{failure ? failure.message : description.message}</AlertDescription>
              {failure ? <TxFailureDetails details={failure.details} /> : null}
              {walletNote ? <p className="text-muted mt-2 text-xs">{walletNote}</p> : null}
              {children ? <div className="text-muted mt-3 text-sm">{children}</div> : null}

              {hash ? (
                <div className="mt-3">
                  <TxExplorerLink link={link} hash={hash} />
                </div>
              ) : null}

              {failure?.raw ? (
                <details className="mt-3">
                  <summary className="text-muted cursor-pointer text-xs underline underline-offset-4">
                    Technical detail
                  </summary>
                  <p className="addr text-muted mt-1 text-xs">{failure.raw}</p>
                </details>
              ) : null}
            </div>
          </div>

          {(onRetry && failure?.retryable) || onReset ? (
            <div className="flex flex-wrap gap-2 pl-7">
              {onRetry && failure?.retryable ? (
                <Button variant="secondary" size="sm" onClick={onRetry}>
                  <RefreshCw aria-hidden="true" />
                  {retryLabel}
                </Button>
              ) : null}
              {onReset ? (
                <Button variant="ghost" size="sm" onClick={onReset}>
                  Dismiss
                </Button>
              ) : null}
            </div>
          ) : null}
        </Alert>
      )}
    </div>
  );
}

export interface TxStep {
  /** Stable key. */
  id: string;
  label: string;
  /** One line of context, e.g. "Lets the token contract move 1,000.00 USDC on your behalf." */
  description?: string;
  state: TxState;
  link?: ExplorerLink | null;
}

/**
 * Several writes in order.
 *
 * Every step keeps its own state, so "approved, then the subscription was refused" is legible as
 * two facts instead of one aggregate failure — and the approval, having actually happened, is not
 * quietly repeated on the retry.
 */
export function TxStepList({ steps, className }: { steps: readonly TxStep[]; className?: string }) {
  return (
    <ol className={cn("flex flex-col gap-3", className)}>
      {steps.map((step, index) => {
        const description = describeTxPhase(step.state, step.label);
        const Icon = PHASE_ICON[step.state.phase];
        const hash =
          step.state.phase === "pending" ||
          step.state.phase === "confirmed" ||
          step.state.phase === "failed"
            ? step.state.hash
            : undefined;
        const failure = step.state.phase === "failed" ? step.state.failure : undefined;

        return (
          <li
            key={step.id}
            className="border-border bg-surface flex items-start gap-3 rounded-lg border p-4"
          >
            <span
              aria-hidden="true"
              className="border-border bg-surface-sunken text-muted num flex size-6 shrink-0 items-center justify-center rounded-full border text-xs"
            >
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-ink text-sm font-medium">{step.label}</span>
                <StatusBadge tone={description.tone}>{description.label}</StatusBadge>
              </div>
              {step.description ? (
                <p className="text-muted mt-1 text-sm">{step.description}</p>
              ) : null}
              {failure ? <p className="text-danger mt-1 text-sm">{failure.message}</p> : null}
              {hash ? (
                <div className="mt-2">
                  <TxExplorerLink link={step.link ?? null} hash={hash} />
                </div>
              ) : null}
            </div>
            <Icon
              aria-hidden="true"
              className={cn("mt-0.5 size-4 shrink-0", PHASE_ICON_CLASS[step.state.phase])}
            />
          </li>
        );
      })}
    </ol>
  );
}
