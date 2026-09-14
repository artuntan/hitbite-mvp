import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface LoadingSkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Shape of the content being waited on. */
  variant?: "text" | "stats" | "card" | "table" | "chart";
  /** Rows (table), lines (text) or tiles (stats). Ignored by card/chart. */
  rows?: number;
  /** Announced to screen readers while the placeholder is on screen. */
  label?: string;
}

/**
 * Loading placeholder. One polite live region wraps the whole thing; the
 * individual bars are `aria-hidden`, so assistive tech hears "Loading X" once
 * instead of a stream of empty boxes.
 */
export function LoadingSkeleton({
  variant = "text",
  rows = 3,
  label = "Loading",
  className,
  ...props
}: LoadingSkeletonProps) {
  return (
    <div role="status" aria-busy="true" className={cn("w-full", className)} {...props}>
      <span className="sr-only">{label}</span>

      {variant === "text" ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: rows }, (_, i) => (
            <Skeleton key={i} className={cn("h-4", i === rows - 1 ? "w-2/3" : "w-full")} />
          ))}
        </div>
      ) : null}

      {variant === "stats" ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-32" />
            </div>
          ))}
        </div>
      ) : null}

      {variant === "card" ? (
        <div className="border-border bg-surface flex flex-col gap-3 rounded-lg border p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
        </div>
      ) : null}

      {variant === "chart" ? (
        <div className="border-border bg-surface rounded-lg border p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-4 h-56 w-full" />
        </div>
      ) : null}

      {variant === "table" ? (
        <div className="border-border bg-surface overflow-hidden rounded-lg border">
          <div className="border-border border-b p-3">
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="flex flex-col gap-3 p-3">
            {Array.from({ length: rows }, (_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
