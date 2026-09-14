import * as React from "react";

import { cn } from "@/lib/utils";

interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /** Classes for the scroll container that wraps the table. */
  containerClassName?: string;
}

/**
 * Data table. The scroll container is focusable and labelled so a keyboard-only
 * user can reach and scroll a wide table (WCAG 2.1.1). Pass `aria-label`, or a
 * `<TableCaption>` plus `aria-labelledby`, on every table.
 */
const Table = React.forwardRef<HTMLTableElement, TableProps>(function Table(
  { className, containerClassName, ...props },
  ref,
) {
  const label = props["aria-label"];
  return (
    <div
      className={cn(
        "border-border bg-surface relative w-full overflow-x-auto rounded-lg border",
        "focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-2",
        containerClassName,
      )}
      // Focusable so the scroll area is reachable by keyboard; only promoted
      // to a landmark when it has a name, since an unnamed region is noise.
      tabIndex={0}
      {...(label ? { role: "region", "aria-label": label } : {})}
    >
      <table
        ref={ref}
        className={cn("w-full caption-bottom border-collapse text-sm", className)}
        {...props}
      />
    </div>
  );
});

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(function TableHeader({ className, ...props }, ref) {
  return <thead ref={ref} className={cn("border-border border-b", className)} {...props} />;
});

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(function TableBody({ className, ...props }, ref) {
  return <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
});

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(function TableFooter({ className, ...props }, ref) {
  return (
    <tfoot
      ref={ref}
      className={cn(
        "border-border bg-surface-sunken border-t font-medium [&>tr]:last:border-b-0",
        className,
      )}
      {...props}
    />
  );
});

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  function TableRow({ className, ...props }, ref) {
    return (
      <tr
        ref={ref}
        className={cn(
          "border-border hover:bg-surface-sunken border-b transition-colors",
          className,
        )}
        {...props}
      />
    );
  },
);

interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** Right-align the column and reserve it for figures. */
  numeric?: boolean;
}

const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(function TableHead(
  { className, numeric = false, scope = "col", ...props },
  ref,
) {
  return (
    <th
      ref={ref}
      scope={scope}
      className={cn(
        "bg-surface px-4 py-2.5 text-left align-middle",
        "text-muted text-xs font-semibold tracking-wide uppercase",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  );
});

interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  /**
   * Render the value in IBM Plex Mono with tabular, slashed-zero figures and
   * right-align it, so decimal points line up down the column.
   */
  numeric?: boolean;
}

const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(function TableCell(
  { className, numeric = false, ...props },
  ref,
) {
  return (
    <td
      ref={ref}
      className={cn("text-ink px-4 py-2.5 align-middle", numeric && "num text-right", className)}
      {...props}
    />
  );
});

interface TableCaptionProps extends React.HTMLAttributes<HTMLTableCaptionElement> {
  /** Keep the caption for assistive tech but hide it visually. */
  srOnly?: boolean;
}

const TableCaption = React.forwardRef<HTMLTableCaptionElement, TableCaptionProps>(
  function TableCaption({ className, srOnly = false, ...props }, ref) {
    return (
      <caption
        ref={ref}
        className={cn(
          srOnly ? "sr-only" : "text-muted mt-3 px-4 pb-3 text-left text-xs",
          className,
        )}
        {...props}
      />
    );
  },
);

export { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell, TableCaption };
