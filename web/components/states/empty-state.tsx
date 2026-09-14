import * as React from "react";
import { Inbox } from "lucide-react";

import { cn } from "@/lib/utils";

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: React.ReactNode;
  /** Defaults to an inbox glyph; pass any lucide icon component. */
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  /** Usually a <Button asChild><Link .../></Button>. */
  action?: React.ReactNode;
}

/** "Nothing here yet" — a normal outcome, not a failure. */
export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "border-border-strong flex flex-col items-center gap-3 rounded-lg border border-dashed",
        "bg-surface px-6 py-12 text-center",
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className="text-muted size-6" />
      <p className="text-ink text-sm font-medium">{title}</p>
      {description ? <div className="text-muted max-w-prose text-sm">{description}</div> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
