"use client";

import * as React from "react";

export interface ChartTooltipRow {
  /** Series colour, drawn as a short stroke key. Decorative — the name carries identity. */
  color: string;
  name: string;
  /** Already formatted. Client charts never do arithmetic on a value. */
  value: string;
  /** Optional second line under the value, e.g. a share or a unit. */
  detail?: string;
}

interface ChartTooltipCardProps {
  /** The category the reader pointed at: a date, a maturity year, a position. */
  title?: string;
  rows: ChartTooltipRow[];
}

/**
 * Tooltip body shared by every chart, in the app's own tokens.
 *
 * The value leads and the series name follows — the inverse of a legend's
 * hierarchy, because by the time someone is hovering they know which series they
 * want and are after the number. Series identity is keyed by a short stroke of
 * the series colour, never by colouring the text.
 *
 * Tooltips here only ever enhance: every number in one is also in the figure's
 * table view, which is why hover is not a gate on reading the chart.
 */
export function ChartTooltipCard({ title, rows }: ChartTooltipCardProps) {
  return (
    <div className="border-border bg-surface shadow-overlay min-w-40 rounded-md border px-3 py-2">
      {title ? <p className="text-muted mb-1.5 text-xs font-medium">{title}</p> : null}
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.name} className="flex items-baseline gap-2">
            <span
              aria-hidden="true"
              className="mt-1 h-0.5 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: row.color }}
            />
            <span className="flex min-w-0 flex-col">
              <span className="num text-ink text-sm leading-tight font-medium">{row.value}</span>
              <span className="text-muted text-xs leading-tight">{row.name}</span>
              {row.detail ? (
                <span className="text-muted text-xs leading-tight">{row.detail}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The datum behind the first entry of a Recharts tooltip payload.
 *
 * Recharts types the payload loosely because it cannot know the row shape; every
 * chart in this directory feeds it its own pre-formatted row type, so the cast is
 * to that type and `undefined` is handled by the caller.
 */
export function firstTooltipDatum<T>(
  payload: ReadonlyArray<{ payload?: unknown }> | undefined,
): T | undefined {
  return payload?.[0]?.payload as T | undefined;
}
