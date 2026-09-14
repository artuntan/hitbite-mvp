"use client";

import * as React from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { CHART_SURFACE } from "./palette";
import { ChartTooltipCard, firstTooltipDatum } from "./chart-tooltip";

import "./chart-theme.css";

export interface CompositionSlice {
  key: string;
  /** Segment name. Untrusted text from the published JSON — rendered as text, never as HTML. */
  label: string;
  /**
   * Geometry only: the 6-decimal integer market value. The reader never sees
   * this number; every figure on screen is a pre-formatted string computed on the
   * server from the same integer.
   */
  value: number;
  /** A `var(--hb-...)` role from `./palette`. */
  color: string;
  /** Pre-formatted market value, e.g. "401,266.67". */
  amount: string;
  /** Pre-formatted share of total assets, e.g. "39.46%". */
  share: string;
}

interface CompositionDonutProps {
  data: CompositionSlice[];
  /** Names the figure for assistive tech. */
  ariaLabel: string;
  /** Small label in the hole, e.g. "Total assets". */
  centerLabel: string;
  /** Pre-formatted total in the hole. */
  centerValue: string;
  /** Unit suffix under the total, e.g. "USD". */
  centerUnit?: string;
}

/**
 * Portfolio composition as a donut.
 *
 * Segments are separated by a 2px stroke in the surface colour — the surface gap
 * that the marks spec asks for — never by a contrasting border. Colour is an
 * ordinal ramp ordered by maturity, so the segments read in order; the exact
 * shares live in the table beside the chart, which also serves as the legend, so
 * nothing here depends on telling two blues apart.
 *
 * Animation is off: the page is a calm, data-first dashboard, and Recharts'
 * entrance animation ignores `prefers-reduced-motion`.
 *
 * `accessibilityLayer` is off on purpose. Recharts' keyboard layer puts
 * `role="application"` and a tab stop on the SVG, but the wrapper here is a
 * single labelled `role="img"`, so that tab stop would be a focus stop whose
 * contents assistive tech cannot reach. Every value in this chart is also in the
 * table rendered beside it, and that table is the accessible channel — so the
 * chart is one named image and nothing inside it is focusable.
 */
export function CompositionDonut({
  data,
  ariaLabel,
  centerLabel,
  centerValue,
  centerUnit,
}: CompositionDonutProps) {
  return (
    <div className="hb-chart relative h-full w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart accessibilityLayer={false} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="64%"
            outerRadius="94%"
            stroke={CHART_SURFACE}
            strokeWidth={2}
            // Recharts gives the pie group a tab stop by default; see the note on
            // `accessibilityLayer` in this file's header for why this chart has none.
            rootTabIndex={-1}
            isAnimationActive={false}
            startAngle={90}
            endAngle={-270}
          >
            {data.map((slice) => (
              <Cell key={slice.key} fill={slice.color} />
            ))}
          </Pie>
          <Tooltip
            isAnimationActive={false}
            wrapperStyle={{ outline: "none" }}
            content={({ active, payload }) => {
              const slice = active ? firstTooltipDatum<CompositionSlice>(payload) : undefined;
              if (!slice) return null;
              return (
                <ChartTooltipCard
                  title={slice.label}
                  rows={[
                    {
                      color: slice.color,
                      name: "Market value (USD)",
                      value: slice.amount,
                      detail: `${slice.share} of assets`,
                    },
                  ]}
                />
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* The hole is the natural home for the total. `pointer-events-none` keeps
          it out of the way of the segments' hover targets. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-muted text-[0.6875rem] font-medium tracking-wide uppercase">
          {centerLabel}
        </span>
        <span className="num text-ink text-base leading-tight font-medium">{centerValue}</span>
        {centerUnit ? <span className="text-muted text-xs">{centerUnit}</span> : null}
      </div>
    </div>
  );
}
