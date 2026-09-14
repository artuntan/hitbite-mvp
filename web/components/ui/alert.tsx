import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CircleAlert, CircleCheck, Info } from "lucide-react";

import { cn } from "@/lib/utils";

const alertVariants = cva(
  "flex w-full gap-3 rounded-lg border p-4 text-sm [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4",
  {
    variants: {
      tone: {
        info: "border-border bg-surface text-ink",
        accent: "border-accent-surface bg-accent-surface text-ink",
        success: "border-success-surface bg-success-surface text-ink",
        warning: "border-warning-surface bg-warning-surface text-ink",
        danger: "border-danger-surface bg-danger-surface text-ink",
      },
    },
    defaultVariants: { tone: "info" },
  },
);

const iconByTone = {
  info: Info,
  accent: Info,
  success: CircleCheck,
  warning: AlertTriangle,
  danger: CircleAlert,
} as const;

const iconClassByTone = {
  info: "text-muted",
  accent: "text-accent-ink",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
} as const;

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  /** Omit the leading icon (e.g. inside a card that already carries one). */
  hideIcon?: boolean;
}

/**
 * Static, in-page message. `danger` is announced assertively, everything else
 * politely; pass an explicit `role` to override.
 */
const Alert = React.forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { className, tone = "info", hideIcon = false, children, role, ...props },
  ref,
) {
  const key = tone ?? "info";
  const Icon = iconByTone[key];
  return (
    <div
      ref={ref}
      role={role ?? (key === "danger" ? "alert" : "status")}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    >
      {hideIcon ? null : (
        <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", iconClassByTone[key])} />
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
});

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(function AlertTitle({ className, ...props }, ref) {
  return <p ref={ref} className={cn("text-ink font-semibold", className)} {...props} />;
});

const AlertDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function AlertDescription({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn("text-muted text-sm [&:not(:first-child)]:mt-1", className)}
        {...props}
      />
    );
  },
);

export { Alert, AlertTitle, AlertDescription, alertVariants };
