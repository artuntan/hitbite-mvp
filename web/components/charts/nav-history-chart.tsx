"use client";

import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatFixed, USDC_DECIMALS } from "@/lib/format";

import { CHART_AXIS, CHART_GRID, CHART_LABEL, CHART_SERIES, CHART_SURFACE } from "./palette";
import { ChartTooltipCard, firstTooltipDatum } from "./chart-tooltip";

import "./chart-theme.css";

export interface NavHistoryPoint {
  /** ISO date, used as the category key. */
  date: string;
  /** Short axis label, e.g. "8 Sep". */
  label: string;
  /** Full date for the tooltip, e.g. "8 Sep 2026". */
  fullLabel: string;
  /**
   * The published 6-decimal integer, plotted directly. The line's geometry is
   * the chain's own number; nothing is re-derived from a float.
   */
  value: number;
  /** Pre-formatted NAV per token, e.g. "1.003061". */
  amount: string;
}

interface NavHistoryChartProps {
  data: NavHistoryPoint[];
  ariaLabel: string;
  domain: [number, number];
  ticks: number[];
}

/** NAV per token moves in the fourth decimal; two would flatten the axis to a single value. */
function formatTick(value: number): string {
  return formatFixed(BigInt(Math.round(value)), USDC_DECIMALS, { displayDecimals: 4 });
}

/**
 * NAV per token over time — one series, so no legend box: the card title says
 * what is plotted.
 *
 * The vertical axis is zoomed to the observed range rather than anchored at
 * zero. That is correct for a line (unlike a bar, whose length is the value) and
 * it is stated in the figure's note, because a zoomed axis exaggerates movement
 * and the reader is owed that.
 *
 * `accessibilityLayer` is off on purpose. Recharts' keyboard layer puts
 * `role="application"` and a tab stop on the SVG, but the wrapper here is a
 * single labelled `role="img"`, so that tab stop would be a focus stop whose
 * contents assistive tech cannot reach. Every value in this chart is also in the
 * table rendered with it, and that table is the accessible channel — so the
 * chart is one named image and nothing inside it is focusable.
 */
export function NavHistoryChart({ data, ariaLabel, domain, ticks }: NavHistoryChartProps) {
  return (
    <div className="hb-chart h-full w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          accessibilityLayer={false}
          data={data}
          margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
        >
          <CartesianGrid stroke={CHART_GRID} vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: CHART_GRID }}
            tick={{ fill: CHART_LABEL, fontSize: 12 }}
            interval="preserveStartEnd"
            minTickGap={16}
            dy={4}
          />
          <YAxis
            domain={domain}
            ticks={ticks}
            tickFormatter={formatTick}
            tickLine={false}
            axisLine={false}
            width={62}
            tick={{ fill: CHART_LABEL, fontSize: 12, className: "num" }}
          />
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: CHART_AXIS, strokeWidth: 1 }}
            wrapperStyle={{ outline: "none" }}
            content={({ active, payload }) => {
              const point = active ? firstTooltipDatum<NavHistoryPoint>(payload) : undefined;
              if (!point) return null;
              return (
                <ChartTooltipCard
                  title={point.fullLabel}
                  rows={[
                    {
                      color: CHART_SERIES,
                      name: "NAV per token (USDC)",
                      value: point.amount,
                    },
                  ]}
                />
              );
            }}
          />
          <Line
            type="linear"
            dataKey="value"
            stroke={CHART_SERIES}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            // >= 8px across, with the 2px surface ring that keeps it legible
            // where it crosses the line or a gridline.
            activeDot={{ r: 4, fill: CHART_SERIES, stroke: CHART_SURFACE, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
