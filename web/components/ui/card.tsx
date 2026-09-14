import * as React from "react";

import { cn } from "@/lib/utils";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function Card(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn("border-border bg-surface shadow-raised rounded-lg border", className)}
      {...props}
    />
  );
});

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardHeader({ className, ...props }, ref) {
    return <div ref={ref} className={cn("flex flex-col gap-1 p-5", className)} {...props} />;
  },
);

interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Heading level. Pick the one that keeps the page outline correct. */
  as?: "h2" | "h3" | "h4";
}

const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(function CardTitle(
  { className, as: Comp = "h3", ...props },
  ref,
) {
  return (
    <Comp
      ref={ref}
      className={cn("text-ink text-base font-semibold tracking-tight", className)}
      {...props}
    />
  );
});

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(function CardDescription({ className, ...props }, ref) {
  return <p ref={ref} className={cn("text-muted text-sm", className)} {...props} />;
});

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardContent({ className, ...props }, ref) {
    return <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />;
  },
);

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn("border-border flex items-center gap-3 border-t px-5 py-4", className)}
        {...props}
      />
    );
  },
);

/**
 * `StatList` + `Stat` render a definition list of headline figures. `Stat` must
 * sit inside a `StatList`: HTML5 allows `<dl><div><dt/><dd/></div></dl>`, and
 * that wrapper is what lets the grid lay the pairs out.
 *
 *   <StatList className="grid gap-6 sm:grid-cols-3">
 *     <Stat label="NAV per token" value="1.003061" hint="as of 2026-09-14" />
 *   </StatList>
 */
const StatList = React.forwardRef<HTMLDListElement, React.HTMLAttributes<HTMLDListElement>>(
  function StatList({ className, ...props }, ref) {
    return <dl ref={ref} className={cn("grid gap-6", className)} {...props} />;
  },
);

interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
  /** Secondary line: as-of date, "simulated", a delta. */
  hint?: React.ReactNode;
}

const Stat = React.forwardRef<HTMLDivElement, StatProps>(function Stat(
  { className, label, value, hint, ...props },
  ref,
) {
  return (
    <div ref={ref} className={cn("flex flex-col gap-1", className)} {...props}>
      <dt className="text-muted text-xs font-medium tracking-wide uppercase">{label}</dt>
      <dd className="num text-ink text-2xl leading-tight">{value}</dd>
      {hint ? <dd className="text-muted text-xs">{hint}</dd> : null}
    </div>
  );
});

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, StatList, Stat };
