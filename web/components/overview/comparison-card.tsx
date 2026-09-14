import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { formatNumber, formatPercent } from "@/lib/format";
import type { NavDocument } from "@/lib/schemas";

interface ComparisonCardProps {
  nav: NavDocument;
}

const NOT_PUBLISHED = "Not published in this demo";

/**
 * hbTRS against a tokenized US T-bill reference.
 *
 * The reference is parameterised in `engine/data/config.yaml` under
 * `comparison.tokenized_tbill_reference` and is an **illustrative placeholder**,
 * not a quoted yield from any real instrument. That is stated on the card
 * itself — in the header badge, in the column heading and in an alert under the
 * table — never hidden in a tooltip, and every cell the demo cannot source
 * honestly says so rather than guessing.
 */
export function ComparisonCard({ nav }: ComparisonCardProps) {
  const reference = nav.comparison.tokenized_tbill_reference;

  const rows = [
    {
      key: "yield",
      metric: "Yield per annum",
      hbtrs: `${formatPercent(nav.portfolio.weighted_ytm_pct)} weighted YTM`,
      reference: formatPercent(reference.yield_pct),
    },
    {
      key: "duration",
      metric: "Modified duration",
      hbtrs: `${formatNumber(nav.portfolio.modified_duration)} years`,
      reference: NOT_PUBLISHED,
    },
    {
      key: "underlying",
      metric: "Underlying",
      hbtrs: `Türkiye USD sovereign bonds — ${nav.portfolio.positions_count} simulated positions`,
      reference: reference.label,
    },
    {
      key: "charges",
      metric: "Ongoing charges per annum",
      hbtrs: `${formatPercent(nav.fees.management_fee_pct_pa)} management + ${formatPercent(
        nav.fees.fund_expenses_pct_pa,
      )} fund expenses`,
      reference: NOT_PUBLISHED,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle as="h3">hbTRS against a tokenized US T-bill reference</CardTitle>
          <Badge tone="warning">Illustrative placeholder — not a quoted yield</Badge>
        </div>
        <CardDescription>
          The hbTRS column is computed by the NAV engine from the simulated reference book. The
          reference column is a parameter in the engine configuration, not a price taken from any
          market or product.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <Table aria-label="hbTRS compared with a tokenized US T-bill reference">
          <TableCaption srOnly>
            Each metric with the simulated hbTRS figure and the illustrative reference figure.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Metric</TableHead>
              <TableHead>{TOKEN.symbol} (simulated)</TableHead>
              <TableHead>Reference (illustrative placeholder)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableHead scope="row" className="bg-transparent normal-case">
                  <span className="text-ink text-sm font-medium tracking-normal">{row.metric}</span>
                </TableHead>
                <TableCell>{row.hbtrs}</TableCell>
                <TableCell className="text-muted">{row.reference}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Alert tone="warning">
          <AlertTitle>The reference figure is a placeholder</AlertTitle>
          <AlertDescription>
            <p>{reference.source_note}</p>
            <p className="mt-1">
              A higher yield here reflects the credit and duration risk of Türkiye USD sovereign
              bonds. It is not a like-for-like comparison and nothing on this card is a
              recommendation.
            </p>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
