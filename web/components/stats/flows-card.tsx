import { ChartFigure } from "@/components/charts/chart-figure";
import { EmptyState } from "@/components/states/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TOKEN } from "@/lib/copy";

import { FlowChart } from "./flow-chart";
import { FLOW_IN, FLOW_OUT } from "./flow-colors";
import type { FlowModel } from "./view-model";

import "@/components/charts/chart-theme.css";
import "./flow-theme.css";

interface FlowsCardProps {
  model: FlowModel;
  /** Events with no resolved block timestamp, and therefore in no day. */
  undatedEvents: number;
  /** `false` when the index left empty days out because the span was too long. */
  indexComplete: boolean;
}

const LEGEND = [
  { color: FLOW_IN, label: "Subscriptions — USDC in", direction: "above the line" },
  { color: FLOW_OUT, label: "Redemptions — USDC out", direction: "below the line" },
] as const;

/**
 * Subscriptions and redemptions over time (BUILD_PROMPT 7.2), by UTC day.
 *
 * One measure, one axis, two directions. Money into the vault grows up from the
 * zero rule and money out grows down from it, so a day's net is the difference
 * between two arms rather than a third series — and there is never a second
 * y-scale to make two unrelated ranges look correlated.
 *
 * Both series are in the legend and all of them are in the table, so colour is a
 * convenience here and never the only channel. Days are the index's own UTC
 * buckets, summed as integers; an event whose block timestamp is not resolved
 * belongs to no day and is counted separately rather than guessed into one.
 */
export function FlowsCard({ model, undatedEvents, indexComplete }: FlowsCardProps) {
  const range =
    model.firstDate && model.lastDate
      ? model.firstDate === model.lastDate
        ? model.firstDate
        : `${model.firstDate} to ${model.lastDate}`
      : null;

  return (
    <Card data-testid="stats-flows">
      <CardHeader>
        <CardTitle as="h3">Subscriptions and redemptions over time</CardTitle>
        <CardDescription>
          {range
            ? `${model.daysShown} UTC day(s), ${range}, in test ${TOKEN.quoteSymbol}. A day with no activity is a zero row, not a missing one.`
            : `Daily subscriptions and redemptions in test ${TOKEN.quoteSymbol}.`}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {!model.hasActivity ? (
          <EmptyState
            title={
              model.emptyEverywhere
                ? "No subscriptions or redemptions yet"
                : "No subscriptions or redemptions in this window"
            }
            description={
              model.emptyEverywhere
                ? indexComplete
                  ? "The scan covered the whole range from the deploy block and found no Subscribed and no Redeemed event. Nobody has subscribed or redeemed on this deployment."
                  : "No Subscribed and no Redeemed event was found, but the scan has a gap, so read this as nothing found rather than as nothing happened."
                : "Every subscription and redemption in this index is older than the days shown here."
            }
          />
        ) : (
          <div className="hb-chart hb-stats-flow flex flex-col gap-4">
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
              {LEGEND.map((entry) => (
                <li key={entry.label} className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="text-ink font-medium">{entry.label}</span>
                  <span className="text-muted">({entry.direction})</span>
                </li>
              ))}
            </ul>

            <ChartFigure
              caption={`Diverging column chart of daily subscriptions and redemptions in test USDC${
                range ? `, ${range}` : ""
              }. Subscriptions rise above the zero line and redemptions fall below it. The same figures are in the data table below the chart.`}
              height="md"
              tableMode="below"
              note={
                <>
                  Both arms are the same measure on one axis: subscriptions above the zero rule,
                  redemptions below it, so the ticks below zero are money leaving the vault. Every
                  amount is the exact sum of the 6-decimal integers the contract emitted, shown here
                  rounded to two decimals; <code className="addr">/api/stats</code> carries the
                  integers.
                  {model.truncated
                    ? ` The ${model.daysShown} most recent of ${model.daysTotal} indexed days are shown; the older ones are in /api/stats.`
                    : ""}
                  {!model.daysFilled
                    ? " Days with no activity are omitted rather than shown as zero rows: the span between the first and last event is too long to enumerate."
                    : ""}
                  {undatedEvents > 0
                    ? ` ${undatedEvents} event(s) have no resolved block timestamp and are in no day below; they are counted in the index summary instead of guessed into a bucket.`
                    : ""}
                </>
              }
              table={
                <Table aria-label="Daily subscriptions and redemptions">
                  <TableCaption srOnly>
                    Each UTC day with the number of subscriptions and the USDC they paid in, the
                    number of redemptions and the USDC they paid out, the net, and the day&rsquo;s
                    closing NAV per token.
                  </TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead numeric>Subscriptions</TableHead>
                      <TableHead numeric>USDC in</TableHead>
                      <TableHead numeric>Redemptions</TableHead>
                      <TableHead numeric>USDC out</TableHead>
                      <TableHead numeric>Net USDC</TableHead>
                      <TableHead numeric>NAV close</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {model.rows.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell>
                          <time dateTime={row.date} className="num">
                            {row.fullLabel}
                          </time>
                        </TableCell>
                        <TableCell numeric>{row.subscriptions}</TableCell>
                        <TableCell numeric>{row.inAmount}</TableCell>
                        <TableCell numeric>{row.redemptions}</TableCell>
                        <TableCell numeric>{row.outAmount}</TableCell>
                        <TableCell numeric>{row.netAmount}</TableCell>
                        <TableCell numeric>
                          {row.navClose ?? <span className="text-muted font-sans">—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              }
            >
              <FlowChart
                data={model.rows}
                ariaLabel="Daily subscriptions and redemptions in test USDC"
                domain={model.scale.domain}
                ticks={model.scale.ticks}
              />
            </ChartFigure>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
