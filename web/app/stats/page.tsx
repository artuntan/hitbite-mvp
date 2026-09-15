import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { Definitions } from "@/components/stats/definitions";
import { DistributionsCard } from "@/components/stats/distributions-card";
import { FlowsCard } from "@/components/stats/flows-card";
import { IndexCard } from "@/components/stats/index-card";
import { NavCard } from "@/components/stats/nav-card";
import { readStats } from "@/components/stats/source";
import { StatsEmpty } from "@/components/stats/stats-empty";
import { StatsFigures } from "@/components/stats/stats-figures";
import { SupplyCard } from "@/components/stats/supply-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TESTNET_NOTICE_SHORT, TOKEN } from "@/lib/copy";

/**
 * `/stats` — BUILD_PROMPT 7.2: holders, supply, distributions to date, NAV
 * history, and subscriptions and redemptions over time, all from events.
 *
 * A **server component**, and a public one. It reads the event index in this
 * process — the same 60-second index `/api/stats` answers from, folded by the
 * same pure `aggregate()` — so the figures here and the figures in the JSON are
 * the same numbers by construction. Nothing on this page imports wagmi,
 * RainbowKit or `lib/wagmi.ts`; the only client code it pulls is the two
 * Recharts leaves, each of which receives plain strings and integers (PLAN.md
 * D63). The public pages' Lighthouse scores depend on that staying true.
 *
 * `revalidate = 60` matches the index TTL and the `s-maxage=60` the public API
 * carries: a reader refreshing this page must not be able to make a fresh scan
 * of the whole chain per keystroke. With no deployment on the configured chain
 * the indexer makes no network call at all, so `next build` prerenders this page
 * offline, exactly as `/transparency` does.
 *
 * The one rule this page is built around: **a number that was not measured is
 * not rendered.** No deployment, an RPC that will not answer, or a node whose
 * head is below the deploy block all produce an explanation and no figures. A
 * zero would be a claim about the chain, and none has been measured.
 */
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Stats",
  description: `Holders, supply, distributions to date, on-chain NAV history and daily subscriptions and redemptions for ${TOKEN.symbol}, folded from contract logs. ${TESTNET_NOTICE_SHORT}`,
};

const ENDPOINTS = [
  {
    href: "/api/stats",
    label: "Every figure on this page, plus the published NAV documents",
  },
  {
    href: "/api/events",
    label: "The decoded events themselves, filterable and paginated",
  },
] as const;

export default async function StatsPage() {
  const stats = await readStats();
  const model = stats.status === "ok" ? stats.model : null;
  const coverage = model?.coverage ?? null;

  return (
    <Container className="flex flex-col gap-8 py-10 sm:gap-10 sm:py-12">
      <header className="flex max-w-3xl flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{stats.label}</Badge>
          <Badge tone="accent">From contract logs</Badge>
        </div>
        <h1 className="text-ink text-3xl font-semibold tracking-tight sm:text-4xl">Stats</h1>
        <p className="text-muted text-sm leading-relaxed sm:text-base">
          Everything below is counted from events the contracts emitted, read straight from the
          chain and folded here — not from a database, and not from the published documents. The
          portfolio those numbers value is simulated; the activity is not. Where the scan could not
          read a range, this page says so and treats the counts as floors rather than as answers.
        </p>
        {model && coverage ? (
          <dl className="text-muted grid gap-x-8 gap-y-2 text-xs sm:grid-cols-3">
            <div className="flex flex-col gap-0.5">
              <dt className="font-medium tracking-wide uppercase">Blocks scanned</dt>
              <dd className="num text-ink">
                {coverage.fromBlock} – {coverage.toBlock}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="font-medium tracking-wide uppercase">Events indexed</dt>
              <dd className="num text-ink">{model.totalEvents}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="font-medium tracking-wide uppercase">Index built</dt>
              <dd className="num text-ink">{coverage.indexedAt}</dd>
            </div>
          </dl>
        ) : null}
      </header>

      {model && coverage && model.measurable && !coverage.complete ? (
        <Alert tone="warning" data-testid="stats-truncated">
          <AlertTitle>This history is incomplete</AlertTitle>
          <AlertDescription>
            {coverage.gaps.length} range(s) totalling {coverage.gapBlocks} block(s) could not be
            read, so events inside them are missing from every figure on this page. Counts are
            floors, not answers, and sums are lower bounds. The ranges and the reason each one
            failed are listed under &ldquo;What this page read&rdquo;.
          </AlertDescription>
        </Alert>
      ) : null}

      {model && coverage && model.measurable && coverage.complete && coverage.stale ? (
        <Alert tone="warning" data-testid="stats-stale">
          <AlertTitle>Serving the previous index</AlertTitle>
          <AlertDescription>
            {coverage.staleReason ??
              "The rebuild failed and the previous index was served rather than nothing."}{" "}
            It is {coverage.cacheAgeSeconds} second(s) old, so anything that happened since is not
            here yet.
          </AlertDescription>
        </Alert>
      ) : null}

      <section
        aria-labelledby="activity-heading"
        data-testid="stats-activity"
        data-state={stats.status === "ok" && stats.model.measurable ? "ok" : "unavailable"}
      >
        <h2 id="activity-heading" className="sr-only">
          On-chain activity
        </h2>

        {model && model.measurable ? (
          <div className="flex flex-col gap-6">
            <StatsFigures figures={model.figures} />

            <div className="grid gap-6 xl:grid-cols-2">
              <SupplyCard model={model.supply} />
              <DistributionsCard model={model.distributions} />
            </div>

            <FlowsCard
              model={model.flows}
              undatedEvents={model.undatedEventCount}
              indexComplete={model.coverage.complete}
            />

            <NavCard model={model.nav} indexComplete={model.coverage.complete} />

            <IndexCard
              coverage={model.coverage}
              eventCounts={model.eventCounts}
              totalEvents={model.totalEvents}
              limitations={model.limitations}
              tokenAddress={model.tokenAddress}
              registryAddress={model.registryAddress}
            />
          </div>
        ) : (
          <StatsEmpty
            chainLabel={stats.label}
            reason={
              stats.status === "unavailable"
                ? stats.reason
                : `The node's head is block ${coverage?.headBlock ?? "?"} and the contracts are recorded at deploy block ${coverage?.deployBlock ?? "?"}, so no block containing them has been scanned.`
            }
            detail={
              stats.status === "ok"
                ? "Either the node is still syncing, or it is not the chain these addresses were deployed to. Until a scanned block exists there is nothing to count, and every figure would be a zero nobody measured."
                : undefined
            }
          />
        )}
      </section>

      <Definitions />

      <section aria-labelledby="stats-sources-heading">
        <Card>
          <CardHeader>
            <CardTitle as="h2" id="stats-sources-heading" className="text-lg">
              The same numbers, as JSON
            </CardTitle>
            <CardDescription>
              This page renders what these endpoints return, from the same index in the same
              process. Both carry the caching headers a partner would poll against.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {ENDPOINTS.map((endpoint) => (
                <li key={endpoint.href} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <a
                    href={endpoint.href}
                    className="addr text-accent-ink text-sm underline underline-offset-4 hover:no-underline"
                  >
                    {endpoint.href}
                  </a>
                  <span className="text-muted text-xs">{endpoint.label}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>
    </Container>
  );
}
