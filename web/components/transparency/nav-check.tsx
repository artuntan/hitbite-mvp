import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatDate,
  formatFixed,
  formatUnixSeconds,
  formatUsdcExact,
  USDC_DECIMALS,
} from "@/lib/format";
import type { NavDocument } from "@/lib/schemas";
import { cn } from "@/lib/utils";

import { AddressLink } from "./address-link";
import type { ChainFacts } from "./chain-facts";

/**
 * Published NAV against the NAV the contract holds.
 *
 * This is the claim the rest of the page rests on: that the numbers are read from somewhere, not
 * asserted. Both sides are six-decimal integers — the engine publishes `usdc_6dec`, the contract
 * stores `nav()` — so the comparison is integer equality and no float ever enters it.
 *
 * Three outcomes, three different things said:
 *   - `match`       — the two integers are equal.
 *   - `mismatch`    — they are not, and that is stated in red rather than smoothed over.
 *   - `unavailable` — the on-chain side could not be read, which is **not** a pass.
 */
type Verdict = "match" | "mismatch" | "unavailable";

function Source({
  label,
  source,
  value,
  suffix,
  detail,
  testId,
  muted = false,
}: {
  label: string;
  source: React.ReactNode;
  value: string;
  suffix?: string;
  detail: React.ReactNode;
  testId?: string;
  muted?: boolean;
}) {
  return (
    <div className="border-border bg-surface-sunken flex flex-col gap-2 rounded-lg border p-4">
      <p className="text-muted text-xs font-medium tracking-wide uppercase">{label}</p>
      <p className="flex flex-wrap items-baseline gap-1.5">
        <span
          data-testid={testId}
          className={cn("num text-3xl leading-none", muted ? "text-muted" : "text-ink")}
        >
          {value}
        </span>
        {suffix ? <span className="text-muted text-sm">{suffix}</span> : null}
      </p>
      <p className="text-muted text-xs">{source}</p>
      <div className="text-muted mt-1 text-xs leading-relaxed">{detail}</div>
    </div>
  );
}

export function NavCheck({ nav, chain }: { nav: NavDocument; chain: ChainFacts }) {
  const published = BigInt(nav.nav.usdc_6dec);
  const onchain = chain.status === "ok" ? chain.nav : null;
  const state: Verdict =
    onchain === null ? "unavailable" : onchain === published ? "match" : "mismatch";

  const badge =
    state === "match" ? (
      <StatusBadge tone="success">Match</StatusBadge>
    ) : state === "mismatch" ? (
      <StatusBadge tone="danger">Mismatch</StatusBadge>
    ) : (
      <StatusBadge tone="warning">Not checked</StatusBadge>
    );

  return (
    <section
      aria-labelledby="nav-check-heading"
      data-testid="nav-check"
      data-state={state}
      className="scroll-mt-20"
      id="nav-check"
    >
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle as="h2" id="nav-check-heading" className="text-lg">
              The NAV check
            </CardTitle>
            {badge}
          </div>
          <CardDescription>
            The NAV this app publishes and the NAV the token contract prices subscriptions and
            redemptions at, side by side. Both are the same six-decimal integer on the same scale as
            USDC, so the comparison is exact.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Source
              label="Published NAV per token"
              testId="published-nav"
              value={formatUsdcExact(published)}
              suffix="USDC"
              source={
                <>
                  Source: <code className="addr">nav.json</code>, written by the NAV engine.
                </>
              }
              detail={
                <>
                  As of {formatDate(nav.as_of)}. Stored as the integer{" "}
                  <span className="num">{nav.nav.usdc_6dec}</span> at six decimals; the string{" "}
                  <span className="num">{nav.nav.per_token_usd}</span> is the same number.
                </>
              }
            />

            {chain.status === "ok" ? (
              <Source
                label="On-chain NAV per token"
                testId="onchain-nav"
                value={formatUsdcExact(chain.nav)}
                suffix="USDC"
                source={
                  <>
                    Source: <code className="addr">HBToken.nav()</code> on {chain.label}.
                  </>
                }
                detail={
                  <>
                    <AddressLink value={chain.tokenAddress} chainId={chain.chainId} />
                    <br />
                    Stored as the integer <span className="num">{chain.nav.toString()}</span>.{" "}
                    {chain.navUpdatedAt === 0n
                      ? "No NAV has been pushed to this deployment yet, so the contract is still at its deployment value."
                      : `Last pushed ${formatUnixSeconds(chain.navUpdatedAt)}.`}
                  </>
                }
              />
            ) : (
              <Source
                label="On-chain NAV per token"
                testId="onchain-nav"
                value="—"
                muted
                source={
                  <>
                    Source: <code className="addr">HBToken.nav()</code> on {chain.label} — not read.
                  </>
                }
                detail={chain.reason}
              />
            )}
          </div>

          {state === "match" ? (
            <Alert tone="success">
              <AlertTitle>The published NAV equals the on-chain NAV.</AlertTitle>
              <AlertDescription>
                Both sides are the integer <span className="num">{published.toString()}</span>.
                Nothing is rounded to make them agree — the engine writes the integer it computed
                and the oracle pushes that same integer to the contract.
              </AlertDescription>
            </Alert>
          ) : null}

          {state === "mismatch" && onchain !== null ? (
            <Alert tone="danger">
              <AlertTitle>The published NAV does not equal the on-chain NAV.</AlertTitle>
              <AlertDescription>
                Published <span className="num">{published.toString()}</span>, on-chain{" "}
                <span className="num">{onchain.toString()}</span>, a difference of{" "}
                <span className="num">
                  {formatFixed(onchain - published, USDC_DECIMALS, {
                    displayDecimals: USDC_DECIMALS,
                    signDisplay: "always",
                  })}
                </span>{" "}
                USDC per token. Either the oracle push has not run since this document was
                generated, or one of the two is stale. Subscriptions and redemptions settle at the
                on-chain value, so that is the one that decides what a transaction pays.
              </AlertDescription>
            </Alert>
          ) : null}

          {chain.status !== "ok" ? (
            <Alert tone="warning">
              <AlertTitle>The check could not be performed.</AlertTitle>
              <AlertDescription>
                {chain.reason} Read this as &ldquo;not checked&rdquo;, not as a pass: with only one
                side of the comparison there is nothing here that confirms the published NAV.
              </AlertDescription>
            </Alert>
          ) : null}

          <p className="text-muted max-w-3xl text-xs leading-relaxed">
            Why it matters: every other figure on this page is computed from a simulated book, and a
            simulated book can say anything. This check is the one place where a number that was
            computed off-chain has to equal a number a third party can read out of the contract
            themselves — with viem,{" "}
            <code className="addr">readContract(&#123; functionName: &quot;nav&quot; &#125;)</code>,
            or with <code className="addr">cast call</code>.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
