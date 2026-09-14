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
import {
  formatDate,
  formatFixed,
  formatNumber,
  formatPercent,
  formatUsdString,
  parseFixed,
} from "@/lib/format";
import type { HoldingsDocument, HoldingPosition } from "@/lib/schemas";

/**
 * The holdings, in two tables: what each position is worth, and what each position is.
 *
 * Every field the engine publishes appears somewhere here — nothing is dropped to make the table
 * narrower, because "we showed you the book" is the point of the page. Money columns are
 * right-aligned monospace with tabular figures (`numeric` on the cell), so decimal points line up
 * down the column.
 *
 * The `illustrative` flag is not decoration: these coupons and maturities are placeholders chosen
 * to sit near an observed yield level, the ISINs are `TBD`, and no bond is held anywhere. The
 * label travels with every row.
 */

/** Sum a column of fixed-scale decimal strings exactly, via integers. */
function sumFixed(values: readonly string[], decimals: number): bigint {
  return values.reduce((total, value) => total + parseFixed(value, decimals), 0n);
}

function PositionName({ position }: { position: HoldingPosition }) {
  return (
    <div className="flex min-w-[12rem] flex-col gap-1">
      <span className="text-ink font-medium">{position.name}</span>
      <span className="text-muted text-xs">
        ISIN <span className="addr">{position.isin}</span>
      </span>
    </div>
  );
}

export function HoldingsTable({ holdings }: { holdings: HoldingsDocument }) {
  const { positions } = holdings;
  const anyScaled = positions.some((position) => position.scaled_face_usd !== null);

  const faceTotal = sumFixed(
    positions.map((position) => position.face_usd),
    2,
  );
  const accruedTotal = sumFixed(
    positions.map((position) => position.accrued_usd),
    2,
  );
  const marketValueTotal = sumFixed(
    positions.map((position) => position.market_value_usd),
    2,
  );
  const weightTotal = positions.reduce((total, position) => total + position.weight_pct, 0);

  return (
    <section aria-labelledby="holdings-heading" className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle as="h2" id="holdings-heading" className="text-lg">
              Holdings
            </CardTitle>
            <Badge tone="warning">Illustrative positions</Badge>
          </div>
          <CardDescription>
            The simulated reference book as of {formatDate(holdings.as_of)}. Coupons, maturities and
            prices are illustrative placeholders; the ISINs are <span className="addr">TBD</span>{" "}
            until they are taken from an official source. No bonds are held.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-8">
          <Table aria-label="Holdings valuation" data-testid="holdings-table">
            <TableCaption>
              Valuation. Face, accrued, and market value are in USD; clean and dirty are prices per
              100 of face. Dirty price = clean price + accrued interest (30/360 US); market value =
              face × dirty price ÷ 100. Weights are shares of the total market value, so they
              exclude cash.
              {holdings.scaled_by === null
                ? " Supply-scaled faces are not shown: no on-chain supply has been read, so there is no factor to scale the reference book by."
                : ` Supply-scaled faces use a factor of ${holdings.scaled_by}.`}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Position</TableHead>
                <TableHead numeric>Face</TableHead>
                {anyScaled ? <TableHead numeric>Scaled face</TableHead> : null}
                <TableHead numeric>Clean</TableHead>
                <TableHead numeric>Accrued</TableHead>
                <TableHead numeric>Dirty</TableHead>
                <TableHead numeric>Market value</TableHead>
                <TableHead numeric>Weight</TableHead>
                <TableHead numeric>YTM</TableHead>
                <TableHead numeric>Mod. dur.</TableHead>
                <TableHead numeric>Convexity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.map((position) => (
                <TableRow key={`${position.name}-${position.maturity}`}>
                  <TableCell>
                    <PositionName position={position} />
                  </TableCell>
                  <TableCell numeric>{formatUsdString(position.face_usd)}</TableCell>
                  {anyScaled ? (
                    <TableCell numeric>
                      {position.scaled_face_usd === null
                        ? "—"
                        : formatUsdString(position.scaled_face_usd)}
                    </TableCell>
                  ) : null}
                  <TableCell numeric>{position.clean_price}</TableCell>
                  <TableCell numeric>{formatUsdString(position.accrued_usd)}</TableCell>
                  <TableCell numeric>{position.dirty_price}</TableCell>
                  <TableCell numeric>{formatUsdString(position.market_value_usd)}</TableCell>
                  <TableCell numeric>{formatPercent(position.weight_pct)}</TableCell>
                  <TableCell numeric>{formatPercent(position.ytm_pct)}</TableCell>
                  <TableCell numeric>{formatNumber(position.modified_duration)}</TableCell>
                  <TableCell numeric>{formatNumber(position.convexity)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                <TableCell numeric>{formatFixed(faceTotal, 2)}</TableCell>
                {anyScaled ? <TableCell numeric /> : null}
                <TableCell numeric />
                <TableCell numeric>{formatFixed(accruedTotal, 2)}</TableCell>
                <TableCell numeric />
                <TableCell numeric>{formatFixed(marketValueTotal, 2)}</TableCell>
                <TableCell numeric>{formatPercent(weightTotal)}</TableCell>
                <TableCell numeric />
                <TableCell numeric />
                <TableCell numeric />
              </TableRow>
            </TableFooter>
          </Table>

          <Table aria-label="Holdings terms">
            <TableCaption>
              Terms. Every instrument here is a placeholder: the coupon and maturity were chosen to
              sit near the yield levels quoted in the source note below, not taken from a security
              that was bought.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Position</TableHead>
                <TableHead numeric>Coupon</TableHead>
                <TableHead>Maturity</TableHead>
                <TableHead>Day count</TableHead>
                <TableHead numeric>Payments / yr</TableHead>
                <TableHead>Previous coupon</TableHead>
                <TableHead>Next coupon</TableHead>
                <TableHead>Label</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.map((position) => (
                <TableRow key={`${position.name}-${position.maturity}-terms`}>
                  <TableCell>
                    <PositionName position={position} />
                  </TableCell>
                  <TableCell numeric>{formatPercent(position.coupon_pct)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <time dateTime={position.maturity}>{formatDate(position.maturity)}</time>
                  </TableCell>
                  <TableCell>{position.day_count}</TableCell>
                  <TableCell numeric>{position.frequency}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <time dateTime={position.prev_coupon_date}>
                      {formatDate(position.prev_coupon_date)}
                    </time>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <time dateTime={position.next_coupon_date}>
                      {formatDate(position.next_coupon_date)}
                    </time>
                  </TableCell>
                  <TableCell>
                    {position.illustrative ? <Badge tone="warning">Illustrative</Badge> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <p className="text-muted max-w-3xl text-xs leading-relaxed">{holdings.source_note}</p>
        </CardContent>
      </Card>
    </section>
  );
}
