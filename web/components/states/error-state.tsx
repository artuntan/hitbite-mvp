"use client";

import * as React from "react";
import { CircleAlert, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: string;
  description?: React.ReactNode;
  /** Recovery action: re-runs the thing that failed. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Extra recovery route, e.g. a link back to the overview. */
  action?: React.ReactNode;
  /**
   * Correlation id (Next.js gives one on `error.digest`). Shown in mono so a
   * reader can quote it verbatim; never put an exception message here.
   */
  detail?: string;
}

/**
 * Something failed. Always offers at least one way forward — this component
 * refuses to be a dead end, which is why `onRetry` falls back to a full
 * reload rather than rendering no action at all.
 */
export function ErrorState({
  title = "Something went wrong",
  description = "The data could not be loaded. This is a testnet demonstration, so a retry usually clears it.",
  onRetry,
  retryLabel = "Try again",
  action,
  detail,
  className,
  ...props
}: ErrorStateProps) {
  const retry = onRetry ?? (() => window.location.reload());

  return (
    <div
      role="alert"
      className={cn(
        "border-danger-surface bg-danger-surface flex flex-col items-start gap-3 rounded-lg border p-5",
        className,
      )}
      {...props}
    >
      <div className="flex items-start gap-3">
        <CircleAlert aria-hidden="true" className="text-danger mt-0.5 size-5 shrink-0" />
        <div className="min-w-0">
          <p className="text-ink text-sm font-semibold">{title}</p>
          {description ? <div className="text-muted mt-1 text-sm">{description}</div> : null}
          {detail ? <p className="addr text-muted mt-2 text-xs">Reference: {detail}</p> : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-8">
        <Button variant="secondary" size="sm" onClick={retry}>
          <RefreshCw aria-hidden="true" />
          {retryLabel}
        </Button>
        {action}
      </div>
    </div>
  );
}
