"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatFixed, USDC_DECIMALS } from "@/lib/format";

import { CHART_GRID, CHART_HOVER, CHART_LABEL, CHART_SERIES } from "./palette";
import { ChartTooltipCard, firstTooltipDatum } from "./chart-tooltip";

import "./chart-theme.css";

export interface MaturityBar {
  key: string;
  /** Category label — the maturity year. */
  label: string;
  /** Geometry only: market value as a 6-decimal integer. */
  value: number;
  /** Pre-formatted market value, e.g. "401,266.67". */
  amount: string;
  /** Which positions fall in this bucket. */
  detail: string;
}

interface MaturityLadderChartProps {
  data: MaturityBar[];
  ariaLabel: string;
  /** Integer domain from `integerAxisScale`, always starting at zero for bars. */
  domain: [number, number];
  /** Integer tick values, so every tick can be formatted exactly from a bigint. */
  ticks: number[];
}

/** Axis ticks are 6-decimal integers; whole dollars are enough on an axis. */
function formatTick(value: number): string {
  return formatFixed(BigInt(Math.round(value)), USDC_DECIMALS, { displayDecimals: 0 });
}

/**
 * Maturity ladder: market value by the calendar year each holding matures.
 *
 * One series, so one colour — the app accent — for every bar. Colouring the bars
 * by their own value would spend the identity channel re-encoding what bar length
 * already shows. The x-axis carries the order, the y-axis the magnitude, and the
 * table view carries the exact figures.
 *
 * The y-axis starts at zero and its ticks are supplied as integers: a bar's
 * length *is* its value, so a truncated axis would misstate it, and a float tick
 * could not be formatted from the 6-decimal integer the engine published.
 *
 * `accessibilityLayer` is off on purpose. Recharts' keyboard layer puts
 * `role="application"` and a tab stop on the SVG, but the wrapper here is a
 * single labelled `role="img"`, so that tab stop would be a focus stop whose
 * contents assistive tech cannot reach. Every value in this chart is also in the
 * table rendered with it, and that table is the accessible channel — so the
 * chart is one named image and nothing inside it is focusable.
 */
export function MaturityLadderChart({ data, ariaLabel, domain, ticks }: MaturityLadderChartProps) {
  return (
    <div className="hb-chart h-full w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          accessibilityLayer={false}
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          barCategoryGap="30%"
        >
          <CartesianGrid stroke={CHART_GRID} vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: CHART_GRID }}
            tick={{ fill: CHART_LABEL, fontSize: 12, className: "num" }}
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
            cursor={{ fill: CHART_HOVER }}
            wrapperStyle={{ outline: "none" }}
            content={({ active, payload }) => {
              const bar = active ? firstTooltipDatum<MaturityBar>(payload) : undefined;
              if (!bar) return null;
              return (
                <ChartTooltipCard
                  title={`Maturing ${bar.label}`}
                  rows={[
                    {
                      color: CHART_SERIES,
                      name: "Market value (USD)",
                      value: bar.amount,
                      detail: bar.detail,
                    },
                  ]}
                />
              );
            }}
          />
          <Bar
            dataKey="value"
            fill={CHART_SERIES}
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
