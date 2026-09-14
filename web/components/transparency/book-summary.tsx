import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Stat,
  StatList,
} from "@/components/ui/card";
import {
  formatFixed,
  formatNumber,
  formatPercent,
  formatUsdString,
  parseFixed,
} from "@/lib/format";
import type { NavDocument } from "@/lib/schemas";

/**
 * Cash, fees payable and the line that ties them to NAV.
 *
 * The reconciliation is recomputed here from the published strings, in exact integer arithmetic
 * (`parseFixed` to 2-decimal cents, never a float), and the page says whether it ties. If the
 * engine ever publishes a total that does not equal its own parts, a reader sees that rather than
 * a number that merely looks authoritative.
 */
export function BookSummary({ nav }: { nav: NavDocument }) {
  const { portfolio, fees } = nav;

  const marketValue = parseFixed(portfolio.sum_market_value_usd, 2);
  const cash = parseFixed(portfolio.cash_usd, 2);
  const feesPayable = parseFixed(portfolio.fees_payable_usd, 2);
  const total = parseFixed(nav.nav.total_usd, 2);
  const computed = marketValue + cash - feesPayable;
  const ties = computed === total;

  const totalFeeRate = fees.management_fee_pct_pa + fees.fund_expenses_pct_pa;

  return (
    <section aria-labelledby="book-heading" data-testid="book-summary">
      <Card>
        <CardHeader>
          <CardTitle as="h2" id="book-heading" className="text-lg">
            Cash, fees and the NAV total
          </CardTitle>
          <CardDescription>
            The reference book behind the NAV above: what the positions are worth, the cash beside
            them, and the fee that has accrued and not yet been paid.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          <StatList className="grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3">
            <Stat
              label="Market value of positions"
              value={formatUsdString(portfolio.sum_market_value_usd)}
              hint={`USD · ${portfolio.positions_count} positions, dirty prices`}
            />
            <Stat
              label="Cash"
              value={formatUsdString(portfolio.cash_usd)}
              hint="USD · uninvested balance in the reference book"
            />
            <Stat
              label="Fees payable"
              value={formatUsdString(portfolio.fees_payable_usd)}
              hint="USD · accrued, not yet paid; subtracted from NAV"
            />
            <Stat
              label="NAV total"
              value={formatUsdString(nav.nav.total_usd)}
              hint="USD · positions + cash − fees payable"
            />
            <Stat
              label="Reference units"
              value={formatFixed(parseFixed(nav.nav.reference_units, 10), 10, {
                displayDecimals: 4,
              })}
              hint="Units the book is divided into (PLAN.md D19)"
            />
            <Stat
              label="NAV per token"
              value={nav.nav.per_token_usd}
              hint="USDC · NAV total ÷ reference units"
            />
          </StatList>

          <div className="border-border bg-surface-sunken rounded-lg border p-4">
            <p className="text-muted text-xs font-medium tracking-wide uppercase">Reconciliation</p>
            <p className="num text-ink mt-2 text-sm break-words">
              {formatUsdString(portfolio.sum_market_value_usd)} +{" "}
              {formatUsdString(portfolio.cash_usd)} − {formatUsdString(portfolio.fees_payable_usd)}{" "}
              = {formatUsdString(nav.nav.total_usd)}
            </p>
            <p className="text-muted mt-2 text-xs leading-relaxed">
              {ties ? (
                <>
                  Recomputed here in exact cent arithmetic from the published strings; it ties to
                  the published NAV total.
                </>
              ) : (
                <>
                  These figures do not tie. The parts add to{" "}
                  <span className="num">{formatFixed(computed, 2)}</span> USD but the document
                  reports <span className="num">{formatUsdString(nav.nav.total_usd)}</span> USD.
                  Treat every figure on this page as suspect until the engine is re-run.
                </>
              )}
            </p>
          </div>

          <StatList className="grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
            <Stat
              label="Weighted YTM"
              value={formatPercent(portfolio.weighted_ytm_pct)}
              hint="Market-value weighted"
            />
            <Stat
              label="Modified duration"
              value={formatNumber(portfolio.modified_duration)}
              hint="Years, first order"
            />
            <Stat label="Convexity" value={formatNumber(portfolio.convexity)} hint="Second order" />
            <Stat
              label="Fee schedule"
              value={formatPercent(totalFeeRate)}
              hint={`per annum: ${formatPercent(fees.management_fee_pct_pa)} management + ${formatPercent(fees.fund_expenses_pct_pa)} expenses, accrued daily`}
            />
          </StatList>
        </CardContent>
      </Card>
    </section>
  );
}
