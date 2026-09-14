/**
 * Turns the published engine documents into the exact strings the Overview
 * renders.
 *
 * Two rules shape everything here:
 *
 *  1. **Every figure is formatted from the 6-decimal integer** (PLAN.md D22).
 *     Engine display strings go through `toUsdc6` first, so the UI and the chain
 *     round the same way. Yields, durations and convexities are the only values
 *     that legitimately arrive as floats — they are risk analytics, not money.
 *  2. **Formatting happens on the server.** The charts are client components and
 *     receive strings; the only numbers that cross the boundary are chart
 *     geometry (the same integers) and integer axis ticks.
 */

import type { CompositionSlice } from "@/components/charts/composition-donut";
import type { MaturityBar } from "@/components/charts/maturity-ladder-chart";
import type { NavHistoryPoint } from "@/components/charts/nav-history-chart";
import {
  CHART_NEUTRAL,
  CHART_NEUTRAL_2,
  CHART_SERIES,
  MAX_ORDINAL_SEGMENTS,
  rampScale,
} from "@/components/charts/palette";
import { integerAxisScale, type AxisScale } from "@/components/charts/ticks";
import {
  formatDate,
  formatFixed,
  formatNumber,
  formatPercent,
  formatUsdString,
  formatUsdcExact,
  toUsdc6,
  USDC_DECIMALS,
} from "@/lib/format";
import type { HoldingsDocument, NavDocument, NavHistoryDocument } from "@/lib/schemas";

/** `"2026-09-08"` -> `"8 Sep"`. The year is in the axis title, not on every tick. */
function shortDate(isoDate: string): string {
  return formatDate(isoDate).replace(/\s\d{4}$/, "");
}

/**
 * `value / total` as a percentage string, computed entirely in integer
 * arithmetic on the 6-decimal values and rounded half-up at the last shown digit.
 */
function shareOfTotal(value6: bigint, total6: bigint): string {
  if (total6 <= 0n) return "—";
  // percent scaled by 1e4, rounded half-up: (v/total) * 100 * 1e4
  const scaled = (value6 * 1_000_000n * 2n + total6) / (total6 * 2n);
  return `${formatFixed(scaled, 4, { displayDecimals: 2 })}%`;
}

// --------------------------------------------------------------------------- headline metrics

export interface Metric {
  key: string;
  label: string;
  /** Formatted figure, or `null` when the engine has not produced one yet. */
  value: string | null;
  /** Shown in place of the figure when `value` is `null`. Never a zero. */
  unavailable?: string;
  /** Unit and as-of line. */
  hint: string;
  /** Longer explanation, rendered under the row. */
  note?: string;
}

export function buildMetrics(nav: NavDocument): Metric[] {
  const asOf = formatDate(nav.as_of);
  const yieldBlock = nav.distribution_yield;

  return [
    {
      key: "nav",
      label: "NAV per token",
      value: formatUsdcExact(BigInt(nav.nav.usdc_6dec)),
      hint: `USDC per hbTRS · as of ${asOf}`,
    },
    {
      key: "ytm",
      label: "Weighted yield to maturity",
      value: formatPercent(nav.portfolio.weighted_ytm_pct),
      hint: `per annum, market-value weighted · as of ${asOf}`,
    },
    {
      key: "duration",
      label: "Modified duration",
      value: formatNumber(nav.portfolio.modified_duration),
      hint: `years · as of ${asOf}`,
    },
    {
      key: "distribution-yield",
      label: "Trailing distribution yield",
      // `annualized_pct` is null until the trailing window reaches 30 days. A
      // zero here would read as "this fund pays nothing", which is a different
      // claim from "not enough history yet".
      value: yieldBlock.annualized_pct === null ? null : formatPercent(yieldBlock.annualized_pct),
      unavailable: "Not yet available",
      hint:
        yieldBlock.annualized_pct === null
          ? `annualised · ${yieldBlock.window_days}-day window since inception`
          : `annualised · ${yieldBlock.window_days}-day trailing window · as of ${asOf}`,
      note: yieldBlock.note,
    },
  ];
}

// --------------------------------------------------------------------------- composition

export interface CompositionModel {
  /** Donut segments and table rows: the same rows, so the two can never disagree. */
  rows: CompositionSlice[];
  /** Total assets = bond market value + cash. Formatted. */
  totalAssets: string;
  /** Liability deducted from NAV; shown in the note, not in the chart. */
  feesPayable: string;
  navTotal: string;
  positionsCount: number;
}

export function buildComposition(holdings: HoldingsDocument): CompositionModel {
  // Maturity order: the ramp encodes it, so the data has to be in it.
  const positions = [...holdings.positions].sort((a, b) => a.maturity.localeCompare(b.maturity));
  const cash6 = toUsdc6(holdings.cash_usd);
  const total6 = positions.reduce((sum, p) => sum + toUsdc6(p.market_value_usd), cash6);

  // The ramp has a fixed number of validated steps; a generated sixth would sit
  // too close to its neighbours to be told apart, so a long book folds its tail
  // into one "Other" bucket instead. Not exercised by the committed
  // three-position fixture.
  const named =
    positions.length > MAX_ORDINAL_SEGMENTS
      ? positions.slice(0, MAX_ORDINAL_SEGMENTS - 1)
      : positions;
  const tail = positions.slice(named.length);
  const colors = named.length > 0 ? rampScale(named.length) : [];

  const rows: CompositionSlice[] = named.map((position, index) => {
    const value6 = toUsdc6(position.market_value_usd);
    return {
      key: `position-${index}`,
      label: position.name,
      value: Number(value6),
      // `rampScale` returns exactly `named.length` steps; the fallback only
      // exists for the index signature, and is a bond colour, never cash's.
      color: colors[index] ?? CHART_SERIES,
      amount: formatUsdString(position.market_value_usd),
      share: shareOfTotal(value6, total6),
    };
  });

  if (tail.length > 0) {
    const value6 = tail.reduce((sum, p) => sum + toUsdc6(p.market_value_usd), 0n);
    rows.push({
      key: "other-positions",
      label: `Other (${tail.length} positions)`,
      value: Number(value6),
      color: CHART_NEUTRAL_2,
      amount: formatFixed(value6, USDC_DECIMALS, { displayDecimals: 2 }),
      share: shareOfTotal(value6, total6),
    });
  }

  rows.push({
    key: "cash",
    label: "Cash",
    value: Number(cash6),
    color: CHART_NEUTRAL,
    amount: formatUsdString(holdings.cash_usd),
    share: shareOfTotal(cash6, total6),
  });

  return {
    rows,
    totalAssets: formatFixed(total6, USDC_DECIMALS, { displayDecimals: 2 }),
    feesPayable: formatUsdString(holdings.fees_payable_usd),
    navTotal: formatUsdString(holdings.nav_total_usd),
    positionsCount: positions.length,
  };
}

// --------------------------------------------------------------------------- maturity ladder

export interface MaturityRow extends MaturityBar {
  /** Share of total bond market value in this bucket. */
  share: string;
}

export interface MaturityLadderModel {
  bars: MaturityRow[];
  scale: AxisScale;
  /** Formatted total bond market value across all buckets. */
  total: string;
}

export function buildMaturityLadder(holdings: HoldingsDocument): MaturityLadderModel {
  const buckets = new Map<string, { value6: bigint; names: string[] }>();

  for (const position of holdings.positions) {
    const year = position.maturity.slice(0, 4);
    const bucket = buckets.get(year) ?? { value6: 0n, names: [] };
    bucket.value6 += toUsdc6(position.market_value_usd);
    bucket.names.push(position.name);
    buckets.set(year, bucket);
  }

  const years = [...buckets.keys()].sort();
  const total6 = years.reduce((sum, year) => sum + (buckets.get(year)?.value6 ?? 0n), 0n);

  const bars: MaturityRow[] = years.map((year) => {
    const bucket = buckets.get(year) ?? { value6: 0n, names: [] };
    return {
      key: year,
      label: year,
      value: Number(bucket.value6),
      amount: formatFixed(bucket.value6, USDC_DECIMALS, { displayDecimals: 2 }),
      detail: bucket.names.join(", "),
      share: shareOfTotal(bucket.value6, total6),
    };
  });

  const max = bars.reduce((highest, bar) => Math.max(highest, bar.value), 0);

  return {
    bars,
    // Bars grow from a baseline, so the axis must include zero.
    scale: integerAxisScale(0, max, { zeroBased: true, targetIntervals: 5 }),
    total: formatFixed(total6, USDC_DECIMALS, { displayDecimals: 2 }),
  };
}

// --------------------------------------------------------------------------- NAV history

export interface NavHistoryRow extends NavHistoryPoint {
  /** Book-weighted yield to maturity on that date. */
  ytm: string;
  /** Modified duration on that date. */
  duration: string;
  /** Cumulative distributions per unit to that date. */
  distributions: string;
}

export interface NavHistoryModel {
  points: NavHistoryRow[];
  scale: AxisScale;
  firstDate: string;
  lastDate: string;
  latest: string | null;
  count: number;
}

export function buildNavHistory(history: NavHistoryDocument): NavHistoryModel {
  const entries = [...history.entries].sort((a, b) => a.date.localeCompare(b.date));

  const points: NavHistoryRow[] = entries.map((entry) => ({
    date: entry.date,
    label: shortDate(entry.date),
    fullLabel: formatDate(entry.date),
    value: entry.usdc_6dec,
    amount: formatUsdcExact(BigInt(entry.usdc_6dec)),
    ytm: formatPercent(entry.weighted_ytm_pct),
    duration: formatNumber(entry.modified_duration),
    distributions: formatUsdString(entry.distributions_per_unit_cum, 6),
  }));

  const values = points.map((point) => point.value);
  const first = points[0];
  const last = points[points.length - 1];
  // `Math.min()` of an empty list is Infinity; an empty series gets a nominal
  // 1.000000 axis instead, and the section renders an empty state over it.
  const scale =
    values.length > 0
      ? integerAxisScale(Math.min(...values), Math.max(...values))
      : integerAxisScale(0, 1_000_000, { zeroBased: true });

  return {
    points,
    scale,
    firstDate: first ? formatDate(first.date) : "—",
    lastDate: last ? formatDate(last.date) : "—",
    latest: last ? last.amount : null,
    count: points.length,
  };
}
