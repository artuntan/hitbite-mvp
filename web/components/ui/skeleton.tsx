import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Placeholder block for content that is still loading. Marked `aria-hidden`
 * because the live region announcing "loading" belongs on the container
 * (see components/states/loading-skeleton.tsx), not on every shimmer.
 */
const Skeleton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function Skeleton({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        aria-hidden="true"
        className={cn("bg-skeleton animate-pulse rounded-md", className)}
        {...props}
      />
    );
  },
);

export { Skeleton };
