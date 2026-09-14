import * as React from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

import "./chart-theme.css";

interface ChartFigureProps {
  /**
   * What the figure shows. Rendered into the `<figcaption>` for assistive tech;
   * the visible heading is the surrounding card's title, so this is not repeated
   * on screen.
   */
  caption: string;
  /** Height of the plot area. The box is reserved before the chart mounts, so nothing shifts. */
  height?: "sm" | "md";
  /** The client chart component. */
  children: React.ReactNode;
  /**
   * The same numbers as a real table. Mandatory: a chart is never the only way
   * to read a value, and this is what keeps the colour encoding non-essential.
   */
  table: React.ReactNode;
  /**
   * `"inline"` shows the table beside the plot — use it when the table is also
   * doing the legend's job, because a legend hidden inside a disclosure is not a
   * legend. `"below"` shows it under the plot. `"disclosure"` (the default) tucks
   * it behind a summary, which is enough when the chart already carries its own
   * axis labels and the table would only add length.
   */
  tableMode?: "disclosure" | "inline" | "below";
  /** Label on the disclosure that reveals the table. Ignored when `tableMode` is `"inline"`. */
  tableLabel?: string;
  /** Note rendered under the plot — axis caveats, units, rounding. */
  note?: React.ReactNode;
  className?: string;
}

const heights = {
  sm: "h-56",
  md: "h-72",
} as const;

/**
 * Frame shared by every chart on the page: a fixed-height plot box, an
 * accessible caption, an optional note, and the table view.
 *
 * Server component. `.hb-chart` scopes the chart colour variables
 * (`./chart-theme.css`), so the client chart inside only ever names roles.
 *
 * The plot box has a fixed height on purpose: Recharts measures its container
 * on the client, so without a reserved box the card would jump on hydration.
 */
export function ChartFigure({
  caption,
  height = "sm",
  children,
  table,
  tableMode = "disclosure",
  tableLabel = "Show the data table",
  note,
  className,
}: ChartFigureProps) {
  const plot = (
    <figure className="m-0 min-w-0">
      <div className={cn("w-full", heights[height])}>{children}</div>
      <figcaption className="sr-only">{caption}</figcaption>
    </figure>
  );

  if (tableMode === "inline") {
    return (
      <div className={cn("hb-chart flex flex-col gap-4", className)}>
        <div className="grid items-center gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-6">
          {plot}
          <div className="min-w-0">{table}</div>
        </div>
        {note ? <p className="text-muted text-xs leading-relaxed">{note}</p> : null}
      </div>
    );
  }

  if (tableMode === "below") {
    return (
      <div className={cn("hb-chart flex flex-col gap-4", className)}>
        {plot}
        {note ? <p className="text-muted text-xs leading-relaxed">{note}</p> : null}
        <div className="min-w-0">{table}</div>
      </div>
    );
  }

  return (
    <div className={cn("hb-chart flex flex-col gap-3", className)}>
      {plot}

      {note ? <p className="text-muted text-xs leading-relaxed">{note}</p> : null}

      <details className="group border-border border-t pt-3">
        <summary
          className={cn(
            "text-muted hover:text-ink flex cursor-pointer list-none items-center gap-1.5",
            "focus-visible:outline-ring rounded text-xs font-medium transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-2",
            "[&::-webkit-details-marker]:hidden",
          )}
        >
          <ChevronRight
            aria-hidden="true"
            className="size-3.5 transition-transform group-open:rotate-90"
          />
          {tableLabel}
        </summary>
        <div className="mt-3">{table}</div>
      </details>
    </div>
  );
}
