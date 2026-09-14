import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5 whitespace-nowrap",
  {
    variants: {
      /** Colour carries meaning here, so it is always paired with text. */
      tone: {
        neutral: "border-border bg-surface-sunken text-muted",
        accent: "border-accent-surface bg-accent-surface text-accent-ink",
        success: "border-success-surface bg-success-surface text-success",
        warning: "border-warning-surface bg-warning-surface text-warning",
        danger: "border-danger-surface bg-danger-surface text-danger",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, tone, ...props },
  ref,
) {
  return <span ref={ref} className={cn(badgeVariants({ tone }), className)} {...props} />;
});

/**
 * Status dot + label. The dot is decorative; the label is what conveys the
 * state, because colour alone never does (WCAG 1.4.1).
 */
const StatusBadge = React.forwardRef<HTMLSpanElement, BadgeProps & { children: React.ReactNode }>(
  function StatusBadge({ className, tone = "neutral", children, ...props }, ref) {
    return (
      <Badge ref={ref} tone={tone} className={className} {...props}>
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
        {children}
      </Badge>
    );
  },
);

export { Badge, StatusBadge, badgeVariants };
