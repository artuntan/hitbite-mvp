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

import type { DistributionsModel } from "./view-model";

interface DistributionsCardProps {
  model: DistributionsModel;
}

/**
 * Distributions to date.
 *
 * "To date" is ambiguous between two different numbers and this card picks one
 * and says so: **the USDC the issuer paid into the vault**, summed over every
 * `CouponDistributed` in the indexed range. The other number — what the
 * cumulative coupon index actually attributed to holders — sits on the next row,
 * and the difference between them is the PLAN.md D29 truncation remainder.
 *
 * That remainder is not lost and it is not a liability. `distributeCoupon`
 * raises the index by `usdcAmount * 1e18 / totalSupply`, truncated; the part
 * that truncates away stays in the vault as ordinary liquidity rather than being
 * locked in the coupon reserve, which is why `couponReserve` uses
 * `totalAllocated` and not `totalDistributed`. It is sub-cent by construction,
 * so every figure here is shown to all six decimals — at two, the remainder
 * would round to `0.00` and look like nothing.
 */
export function DistributionsCard({ model }: DistributionsCardProps) {
  return (
    <Card data-testid="stats-distributions">
      <CardHeader>
        <CardTitle as="h3">Distributions to date</CardTitle>
        <CardDescription>
          Every <code className="addr text-xs">CouponDistributed</code> the token has emitted in the
          indexed range. Coupons are paid pro rata through a cumulative index, so distributing costs
          the same whether there are two holders or two thousand.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-muted text-xs font-medium tracking-wide uppercase">
            Paid into the vault
          </p>
          <p className="num text-ink text-2xl leading-tight" data-testid="distributions-paid-in">
            {model.paidIn}
          </p>
          <p className="text-muted text-xs">
            {TOKEN.quoteSymbol} across {model.count} distribution(s)
            {model.latestAt ? ` · most recent ${model.latestAt}` : ""}
          </p>
        </div>

        <Table aria-label="Coupon distributions to date">
          <TableCaption srOnly>
            USDC paid into the vault, the part the cumulative index attributed to holders, the
            truncation remainder between them, and what holders have claimed.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Figure</TableHead>
              <TableHead numeric>{TOKEN.quoteSymbol}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>
                Paid into the vault
                <span className="text-muted block text-xs">
                  <code className="addr">CouponDistributed.usdcAmount</code>
                </span>
              </TableCell>
              <TableCell numeric>{model.paidIn}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                Allocated to holders
                <span className="text-muted block text-xs">
                  <code className="addr">CouponDistributed.usdcAllocated</code>
                </span>
              </TableCell>
              <TableCell numeric data-testid="distributions-allocated">
                {model.allocated}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                Truncation remainder
                <span className="text-muted block text-xs">
                  paid in minus allocated — vault liquidity, not a liability
                </span>
              </TableCell>
              <TableCell numeric data-testid="distributions-remainder">
                {model.remainder}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                Claimed by holders
                <span className="text-muted block text-xs">
                  {model.claims} claim(s) by {model.claimAccounts} address(es)
                </span>
              </TableCell>
              <TableCell numeric data-testid="distributions-claimed">
                {model.claimed}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                Allocated and not yet claimed
                <span className="text-muted block text-xs">
                  the coupon reserve, which redemptions may never draw on
                </span>
              </TableCell>
              <TableCell numeric data-testid="distributions-unclaimed">
                {model.unclaimed ?? <span className="text-muted font-sans">—</span>}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <div className="text-muted flex flex-col gap-2 text-xs leading-relaxed">
          <p>
            <span className="text-ink font-medium">
              &ldquo;Distributions to date&rdquo; on this page means the USDC paid into the vault.
            </span>{" "}
            The amount attributed to holders is smaller by the index truncation remainder above: the
            cumulative index is raised by whole units per token, and what will not divide stays in
            the vault as ordinary liquidity rather than being locked in the coupon reserve (PLAN.md
            D29).
          </p>
          <p>
            Paying a coupon lowers NAV per token by the same per-token amount, exactly as a
            fund&rsquo;s NAV drops on its ex-distribution date (PLAN.md D26). Those drops are in the
            NAV series below, as <code className="addr">NAVUpdated</code> events like any other.
          </p>
          {model.unclaimed === null ? (
            <p className="text-danger">
              Claims exceed allocations in this index, which cannot happen on a complete log set.
              The scan is missing <code className="addr">CouponDistributed</code> events, so the
              reserve is not shown rather than shown as a negative number.
            </p>
          ) : null}
          <p>
            Every figure is the six-decimal integer the contract emitted, summed exactly. The
            remainder is sub-cent by construction, so it is shown to six decimals; rounded to two it
            would read as zero.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
