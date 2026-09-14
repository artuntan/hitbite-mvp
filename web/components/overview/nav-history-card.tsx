import { ChartFigure } from "@/components/charts/chart-figure";
import { NavHistoryChart } from "@/components/charts/nav-history-chart";
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
import type { NavHistoryModel } from "@/components/overview/view-model";

interface NavHistoryCardProps {
  model: NavHistoryModel;
}

/** NAV per token since inception, from `nav_history.json`. */
export function NavHistoryCard({ model }: NavHistoryCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <CardTitle as="h3">NAV per token</CardTitle>
          {model.latest ? (
            <p className="text-muted text-xs">
              Latest <span className="num text-ink font-medium">{model.latest}</span>{" "}
              {TOKEN.quoteSymbol} on <span className="num">{model.lastDate}</span>
            </p>
          ) : null}
        </div>
        <CardDescription>
          {model.count > 0
            ? `${model.count} daily observations from ${model.firstDate} to ${model.lastDate}, in test USDC per ${TOKEN.symbol}.`
            : `Daily observations in test USDC per ${TOKEN.symbol}.`}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {model.count === 0 ? (
          <EmptyState
            title="No NAV history yet"
            description="The engine appends one entry per run to nav_history.json. Nothing has been published so far."
          />
        ) : (
          <ChartFigure
            caption={`Line chart of net asset value per token in test USDC, from ${model.firstDate} to ${model.lastDate}. The same figures are in the data table below the chart.`}
            height="md"
            note="The vertical axis is zoomed to the observed range and does not start at zero, so day-to-day movement looks larger than it is. Values are the published 6-decimal integers, the same numbers the token contract stores."
            table={
              <Table aria-label="Net asset value per token by date">
                <TableCaption srOnly>
                  Each observation date with NAV per token, weighted yield to maturity, modified
                  duration and cumulative distributions per unit.
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead numeric>NAV per token (USDC)</TableHead>
                    <TableHead numeric>Weighted YTM</TableHead>
                    <TableHead numeric>Modified duration</TableHead>
                    <TableHead numeric>Distributions per unit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {model.points.map((point) => (
                    <TableRow key={point.date}>
                      <TableCell>
                        <time dateTime={point.date} className="num">
                          {point.fullLabel}
                        </time>
                      </TableCell>
                      <TableCell numeric>{point.amount}</TableCell>
                      <TableCell numeric>{point.ytm}</TableCell>
                      <TableCell numeric>{point.duration}</TableCell>
                      <TableCell numeric>{point.distributions}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            }
          >
            <NavHistoryChart
              data={model.points}
              ariaLabel="Net asset value per token over time"
              domain={model.scale.domain}
              ticks={model.scale.ticks}
            />
          </ChartFigure>
        )}
      </CardContent>
    </Card>
  );
}
