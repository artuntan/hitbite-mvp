import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TOKEN } from "@/lib/copy";
import { formatRatio1e18, formatTokens, formatUsdc } from "@/lib/format";

import {
  backingAssetsUsdc6,
  tokensOutstandingValueUsdc6,
  type ChainFacts,
  type ChainFactsOk,
} from "./chain-facts";

/**
 * `HBToken.supplyBackedRatio()` (PLAN.md D20), with its inputs and its limits.
 *
 * The number on its own invites the reading "the fund is covered", which on a testnet with a
 * simulated portfolio it cannot support. So the card shows the arithmetic — which USDC counts,
 * which does not, and what the tokens outstanding are valued at — and says in as many words what
 * the figure is not.
 */
function Term({ label, value, note }: { label: string; value: string; note: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-2">
      <dt className="text-muted text-xs font-medium tracking-wide uppercase">{label}</dt>
      <dd className="num text-ink text-sm">{value}</dd>
      <dd className="text-muted text-xs leading-relaxed">{note}</dd>
    </div>
  );
}

function RatioDetail({ chain }: { chain: ChainFactsOk }) {
  const assets = backingAssetsUsdc6(chain);
  const liabilities = tokensOutstandingValueUsdc6(chain);

  return (
    <>
      <div className="border-border bg-surface-sunken flex flex-col gap-1 rounded-lg border p-4">
        <p className="text-muted text-xs font-medium tracking-wide uppercase">
          Ratio on {chain.label}
        </p>
        <p className="num text-ink text-3xl leading-none" data-testid="ratio-value">
          {formatRatio1e18(chain.supplyBackedRatio, 4)}
        </p>
        <p className="text-muted text-xs">
          Raw value <span className="num">{chain.supplyBackedRatio.toString()}</span>, 1e18 scaled.
        </p>
      </div>

      <dl className="divide-border grid gap-x-8 divide-y sm:grid-cols-2 sm:divide-y-0">
        <Term
          label="Assets counted"
          value={`${formatUsdc(assets)} USDC`}
          note={
            <>
              Payable USDC <span className="num">{formatUsdc(chain.availableLiquidity)}</span> plus
              reported AUM <span className="num">{formatUsdc(chain.reportedAum)}</span>. The coupon
              reserve of <span className="num">{formatUsdc(chain.couponReserve)}</span> USDC is
              excluded: it is already owed to holders and is not backing for anything.
            </>
          }
        />
        <Term
          label="Tokens outstanding, at NAV"
          value={`${formatUsdc(liabilities)} USDC`}
          note={
            <>
              <span className="num">
                {formatTokens(chain.totalSupply)} {TOKEN.symbol}
              </span>{" "}
              in circulation, valued at the on-chain NAV.
              {liabilities === 0n
                ? " With no supply there is nothing to back, and the contract returns exactly 1e18 rather than dividing by zero."
                : null}
            </>
          }
        />
      </dl>
    </>
  );
}

export function SupplyBackedRatio({ chain }: { chain: ChainFacts }) {
  return (
    <section aria-labelledby="ratio-heading" data-testid="supply-backed-ratio">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle as="h2" id="ratio-heading" className="text-lg">
              Supply-backed ratio
            </CardTitle>
            <Badge tone="warning">Illustrative</Badge>
          </div>
          <CardDescription>
            <code className="addr">supplyBackedRatio()</code> compares the USDC the contract could
            pay out today, plus the value of the book it reports, against every token in circulation
            priced at the current NAV. It is scaled by 1e18, so 1.0000 means the two sides are
            equal.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          {chain.status === "ok" ? (
            <RatioDetail chain={chain} />
          ) : (
            <Alert tone="warning">
              <AlertTitle>The ratio could not be read.</AlertTitle>
              <AlertDescription>
                {chain.reason} No figure is shown here rather than a placeholder one.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <h3 className="text-ink text-sm font-semibold">What it means</h3>
              <p className="text-muted text-xs leading-relaxed">
                That the contract&rsquo;s own accounting adds up: the USDC it can pay out now, plus
                the AUM the oracle has reported, against what it would cost to redeem every token at
                the NAV it is quoting. It is computed on-chain, from state anyone can read, and it
                moves when a subscription, a redemption, a distribution or a NAV push moves it.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <h3 className="text-ink text-sm font-semibold">What it does not mean</h3>
              <p className="text-muted text-xs leading-relaxed">
                It is not an audit, not a proof of reserves, and not a statement that any bond
                exists. On this testnet the reported AUM comes from a simulated book and the USDC is
                MockUSDC, so the ratio is illustrative: it demonstrates the mechanism, not the
                solvency of a fund. In production the AUM side would come from the fund
                administrator and the custodian, not from us.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
