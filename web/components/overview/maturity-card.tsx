import { ChartFigure } from "@/components/charts/chart-figure";
import { MaturityLadderChart } from "@/components/charts/maturity-ladder-chart";
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
import type { MaturityLadderModel } from "@/components/overview/view-model";
import { cn } from "@/lib/utils";

interface MaturityCardProps {
  model: MaturityLadderModel;
  className?: string;
}

/**
 * Maturity ladder: bond market value by the calendar year each holding matures.
 *
 * One colour for every bar. The x-axis already carries the order and the bar
 * length already carries the value, so a colour ramp here would re-encode what
 * the reader can see and spend the identity channel for nothing.
 */
export function MaturityCard({ model, className }: MaturityCardProps) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <CardTitle as="h3">Maturity ladder</CardTitle>
        <CardDescription>
          Market value by the calendar year in which each holding matures. Years with no holding are
          not shown.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1">
        {model.bars.length === 0 ? (
          <EmptyState
            title="No maturities to show"
            description="The engine has not written any positions to holdings.json yet."
          />
        ) : (
          <ChartFigure
            caption={`Column chart of bond market value by maturity year, totalling ${model.total} US dollars. The same figures are in the data table below the chart.`}
            height="sm"
            tableMode="below"
            note="Market value in US dollars, including accrued interest, as a share of the bond book. Cash is not in this chart; it has no maturity."
            table={
              <Table aria-label="Bond market value by maturity year">
                <TableCaption srOnly>
                  Each maturity year with the market value of the holdings maturing in it, in US
                  dollars, and their share of the bond book. Every position is named in the
                  portfolio composition table.
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Year</TableHead>
                    <TableHead numeric>Market value (USD)</TableHead>
                    <TableHead numeric>Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {model.bars.map((bar) => (
                    <TableRow key={bar.key}>
                      <TableCell numeric className="text-left">
                        {bar.label}
                      </TableCell>
                      <TableCell numeric>{bar.amount}</TableCell>
                      <TableCell numeric>{bar.share}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            }
          >
            <MaturityLadderChart
              data={model.bars}
              ariaLabel="Bond market value by maturity year"
              domain={model.scale.domain}
              ticks={model.scale.ticks}
            />
          </ChartFigure>
        )}
      </CardContent>
    </Card>
  );
}
