import { ChartFigure } from "@/components/charts/chart-figure";
import { NavHistoryChart } from "@/components/charts/nav-history-chart";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/badge";
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

import type { NavModel } from "./view-model";

interface NavCardProps {
  model: NavModel;
  indexComplete: boolean;
}

/**
 * NAV history as the chain recorded it: one point per `NAVUpdated`.
 *
 * This is a different series from the one on the Overview, and deliberately so.
 * The Overview plots what the engine published, one observation per run; this
 * plots what the contract accepted, which also includes the ex-distribution drop
 * `distributeCoupon` applies (PLAN.md D26) and any change an admin forced past
 * the oracle rail. Where the two disagree, this one is the one a third party can
 * check against the chain.
 *
 * The horizontal axis is the sequence of NAV changes, not a time scale: NAV
 * moves when the oracle pushes and when a coupon is distributed, so the points
 * are not evenly spaced in time. The note says so rather than letting an evenly
 * spaced axis imply otherwise.
 */
export function NavCard({ model, indexComplete }: NavCardProps) {
  return (
    <Card data-testid="stats-nav">
      <CardHeader>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <CardTitle as="h3">NAV recorded on chain</CardTitle>
          {model.latest ? (
            <p className="text-muted text-xs">
              Latest <span className="num text-ink font-medium">{model.latest}</span>{" "}
              {TOKEN.quoteSymbol} per {TOKEN.symbol}
            </p>
          ) : null}
        </div>
        <CardDescription>
          Every <code className="addr text-xs">NAVUpdated</code> the token has emitted, in block
          order — oracle pushes and the ex-distribution drop a coupon applies, which is a NAV change
          like any other.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {model.rows.length === 0 ? (
          <EmptyState
            title="NAV has never been changed on chain"
            description={
              indexComplete
                ? "The scan covered the whole range from the deploy block and found no NAVUpdated event. The token is still priced at the NAV it was deployed with."
                : "No NAVUpdated event was found, but the scan has a gap, so read this as nothing found rather than as nothing happened."
            }
          />
        ) : (
          <ChartFigure
            caption={`Line chart of net asset value per token in test USDC as recorded on chain, over ${model.shown} NAV change(s). The same figures are in the data table behind the disclosure below the chart.`}
            height="md"
            tableLabel="Show every NAV change"
            note={
              <>
                Points are spaced evenly by NAV change, not by time: NAV moves when the oracle
                pushes and when a coupon is distributed. The vertical axis is zoomed to the observed
                range and does not start at zero, so movement looks larger than it is. Values are
                the 6-decimal integers the contract stores.
                {model.truncated
                  ? ` The ${model.shown} most recent of ${model.total} changes are shown; the older ones are on chain and in /api/stats.`
                  : ""}
                {model.undated > 0
                  ? ` ${model.undated} point(s) have no resolved block timestamp and are labelled by block instead.`
                  : ""}
                {model.forced > 0
                  ? ` ${model.forced} change(s) were forced past the oracle rail by an admin and are marked in the table.`
                  : ""}
              </>
            }
            table={
              <Table aria-label="On-chain NAV changes">
                <TableCaption srOnly>
                  Each NAV change with its block, time, the NAV before and after, the change, the
                  reported assets under management and whether the oracle rail was bypassed.
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead numeric>Block</TableHead>
                    <TableHead>Time (UTC)</TableHead>
                    <TableHead numeric>Previous NAV</TableHead>
                    <TableHead numeric>New NAV</TableHead>
                    <TableHead numeric>Change</TableHead>
                    <TableHead numeric>Reported AUM</TableHead>
                    <TableHead>Rail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {model.rows.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell numeric>{row.blockNumber}</TableCell>
                      <TableCell>
                        {row.time && row.isoTime ? (
                          <time dateTime={row.isoTime} className="num">
                            {row.time}
                          </time>
                        ) : (
                          <span className="text-muted">Not resolved</span>
                        )}
                      </TableCell>
                      <TableCell numeric>{row.previousAmount}</TableCell>
                      <TableCell numeric>{row.amount}</TableCell>
                      <TableCell numeric>{row.changeAmount}</TableCell>
                      <TableCell numeric>{row.reportedAum}</TableCell>
                      <TableCell>
                        {row.forced ? (
                          <Badge tone="warning">Forced</Badge>
                        ) : (
                          <span className="text-muted text-xs">Within rail</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            }
          >
            <NavHistoryChart
              data={model.rows}
              ariaLabel="Net asset value per token recorded on chain"
              domain={model.scale.domain}
              ticks={model.scale.ticks}
            />
          </ChartFigure>
        )}
      </CardContent>
    </Card>
  );
}
