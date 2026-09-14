import { ChartFigure } from "@/components/charts/chart-figure";
import { CompositionDonut } from "@/components/charts/composition-donut";
import { EmptyState } from "@/components/states/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CompositionModel } from "@/components/overview/view-model";
import { cn } from "@/lib/utils";

interface CompositionCardProps {
  model: CompositionModel;
  className?: string;
}

/**
 * Portfolio composition.
 *
 * The table beside the donut is the legend and the table view at once — every
 * share and every amount is readable without hovering and without telling two
 * steps of the ramp apart, which is what lets the colour encoding stay
 * decorative rather than load-bearing.
 */
export function CompositionCard({ model, className }: CompositionCardProps) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle as="h3">Portfolio composition</CardTitle>
          <Badge tone="warning">Illustrative positions</Badge>
        </div>
        <CardDescription>
          Bond market value and cash, by holding. Coupons, maturities and prices are illustrative
          placeholders and ISINs are marked TBD until official reference data is available.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1">
        {model.rows.length === 0 ? (
          <EmptyState
            title="No holdings published"
            description="The engine has not written any positions to holdings.json yet."
          />
        ) : (
          <ChartFigure
            caption={`Donut chart of portfolio composition by holding. Total assets ${model.totalAssets} US dollars across ${model.positionsCount} bond positions and cash. The same figures are in the table beside the chart.`}
            tableMode="inline"
            height="sm"
            note={
              <>
                Shares are of total assets (bond market value plus cash), computed from the
                published 6-decimal values and rounded, so they may not sum to exactly 100%. Fees
                payable of <span className="num">{model.feesPayable}</span> USD are a liability
                deducted from NAV and are not shown in the chart; NAV total is{" "}
                <span className="num">{model.navTotal}</span> USD.
              </>
            }
            table={
              <Table aria-label="Portfolio composition by holding">
                <TableCaption srOnly>
                  Each holding with its market value in US dollars and its share of total assets.
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-3 sm:px-4">Holding</TableHead>
                    <TableHead numeric className="px-3 sm:px-4">
                      Market value (USD)
                    </TableHead>
                    <TableHead numeric className="px-3 sm:px-4">
                      Share
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {model.rows.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="px-3 sm:px-4">
                        <span className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="size-2.5 shrink-0 rounded-[2px]"
                            style={{ backgroundColor: row.color }}
                          />
                          <span className="min-w-0">{row.label}</span>
                        </span>
                      </TableCell>
                      <TableCell numeric className="px-3 sm:px-4">
                        {row.amount}
                      </TableCell>
                      <TableCell numeric className="px-3 sm:px-4">
                        {row.share}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="px-3 sm:px-4">Total assets</TableCell>
                    <TableCell numeric className="px-3 sm:px-4">
                      {model.totalAssets}
                    </TableCell>
                    <TableCell numeric aria-hidden="true" className="px-3 sm:px-4">
                      —
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            }
          >
            <CompositionDonut
              data={model.rows}
              ariaLabel="Portfolio composition by holding"
              centerLabel="Total assets"
              centerValue={model.totalAssets}
              centerUnit="USD"
            />
          </ChartFigure>
        )}
      </CardContent>
    </Card>
  );
}
