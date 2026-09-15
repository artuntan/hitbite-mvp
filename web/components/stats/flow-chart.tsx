"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { CHART_GRID, CHART_HOVER, CHART_LABEL } from "@/components/charts/palette";
import { ChartTooltipCard, firstTooltipDatum } from "@/components/charts/chart-tooltip";
import { formatFixed, USDC_DECIMALS } from "@/lib/format";

import { FLOW_IN, FLOW_OUT, FLOW_ZERO } from "./flow-colors";

import "@/components/charts/chart-theme.css";
import "./flow-theme.css";

export interface FlowBar {
  /** Stable key: the UTC date the bucket covers. */
  key: string;
  /** Short axis label, e.g. "8 Sep". */
  label: string;
  /** Full date for the tooltip, e.g. "8 Sep 2026". */
  fullLabel: string;
  /**
   * Geometry only: subscriptions in, as the 6-decimal integer the contract
   * emitted, summed as a bigint on the server. Never negative.
   */
  in: number;
  /**
   * Geometry only: redemptions out, as the **negative** of the same 6-decimal
   * integer. The sign is what puts the arm below the zero rule.
   */
  out: number;
  /** Pre-formatted subscriptions in, e.g. "1,000.00". */
  inAmount: string;
  /** Pre-formatted redemptions out, as a magnitude, e.g. "400.00". */
  outAmount: string;
  /** Pre-formatted net, signed, e.g. "+600.00". */
  netAmount: string;
  subscriptions: number;
  redemptions: number;
}

interface FlowChartProps {
  data: FlowBar[];
  ariaLabel: string;
  /** Integer domain from `integerAxisScale`, spanning zero. */
  domain: [number, number];
  /** Integer tick values, so every tick can be formatted exactly from a bigint. */
  ticks: number[];
}

/** Axis ticks are 6-decimal USDC integers; whole dollars are enough on an axis. */
function formatTick(value: number): string {
  return formatFixed(BigInt(Math.round(value)), USDC_DECIMALS, { displayDecimals: 0 });
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Subscriptions and redemptions by UTC day, as a diverging column chart.
 *
 * The two series are one measure — USDC moving through the vault — on one axis,
 * separated by direction rather than by a second scale: subscriptions grow up
 * from the zero rule, redemptions down from it. That is what makes the day's net
 * readable as the difference between two arms, and it is why this is not two
 * charts and never a second y-axis.
 *
 * The zero rule is drawn in a neutral grey, one step stronger than a gridline,
 * because a diverging midpoint has to read as "nothing" — see `./flow-theme.css`
 * for the palette and its validator output.
 *
 * Both arms stack on the same `stackId`, so each day is one column: Recharts
 * stacks the positive series up and the negative one down from the baseline, and
 * the two never touch, so no surface gap is needed between them. The rounded
 * corner is on each arm's data end and square at the baseline.
 *
 * `accessibilityLayer` is off on purpose. Recharts' keyboard layer puts
 * `role="application"` and a tab stop on the SVG, but the wrapper here is a
 * single labelled `role="img"`, so that tab stop would be a focus stop whose
 * contents assistive tech cannot reach. Every value in this chart is also in the
 * table rendered with it, and that table is the accessible channel — so the
 * chart is one named image and nothing inside it is focusable.
 */
export function FlowChart({ data, ariaLabel, domain, ticks }: FlowChartProps) {
  return (
    <div className="hb-chart hb-stats-flow h-full w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          accessibilityLayer={false}
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          barCategoryGap="30%"
          stackOffset="sign"
        >
          <CartesianGrid stroke={CHART_GRID} vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: CHART_GRID }}
            tick={{ fill: CHART_LABEL, fontSize: 12, className: "num" }}
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
            width={70}
            tick={{ fill: CHART_LABEL, fontSize: 12, className: "num" }}
          />
          <Tooltip
            isAnimationActive={false}
            cursor={{ fill: CHART_HOVER }}
            wrapperStyle={{ outline: "none" }}
            content={({ active, payload }) => {
              const bar = active ? firstTooltipDatum<FlowBar>(payload) : undefined;
              if (!bar) return null;
              return (
                <ChartTooltipCard
                  title={bar.fullLabel}
                  rows={[
                    {
                      color: FLOW_IN,
                      name: "Subscriptions — USDC in",
                      value: bar.inAmount,
                      detail: plural(bar.subscriptions, "subscription"),
                    },
                    {
                      color: FLOW_OUT,
                      name: "Redemptions — USDC out",
                      value: bar.outAmount,
                      detail: plural(bar.redemptions, "redemption"),
                    },
                    { color: FLOW_ZERO, name: "Net USDC in", value: bar.netAmount },
                  ]}
                />
              );
            }}
          />
          <ReferenceLine y={0} stroke={FLOW_ZERO} strokeWidth={1} />
          <Bar
            dataKey="in"
            stackId="flow"
            fill={FLOW_IN}
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
          <Bar
            dataKey="out"
            stackId="flow"
            fill={FLOW_OUT}
            maxBarSize={24}
            // Mirrored: this arm's data end is its bottom edge, square at the rule.
            radius={[0, 0, 4, 4]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
