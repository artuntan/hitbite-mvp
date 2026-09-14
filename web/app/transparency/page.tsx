import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { AttestationPanel } from "@/components/transparency/attestation-panel";
import { BookSummary } from "@/components/transparency/book-summary";
import { readChainFacts } from "@/components/transparency/chain-facts";
import { ContractsPanel } from "@/components/transparency/contracts-panel";
import { HoldingsTable } from "@/components/transparency/holdings-table";
import { NavCheck } from "@/components/transparency/nav-check";
import { SupplyBackedRatio } from "@/components/transparency/supply-backed-ratio";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getHoldingsDocument, getNavDocument, readAttestation } from "@/lib/data";
import { formatDate, formatDateTimeUtc } from "@/lib/format";

/**
 * `/transparency` — the page that has to survive a sceptic.
 *
 * A server component end to end. The only client JavaScript it can load is the signature verify
 * button, and that renders only when an attestation exists, so today the page ships no wallet
 * code and no interactive bundle at all.
 *
 * `revalidate = 60` matches the cache policy of the public API: the published documents change
 * once a day, the contract reads are cheap but not free, and a reader refreshing the page should
 * not be able to hammer an RPC. With no deployment on the configured chain the chain read makes
 * no network call at all, so `next build` prerenders this page offline.
 */
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Transparency",
  description:
    "Holdings, cash and fees, the published NAV checked against the on-chain NAV, the supply-backed ratio, the signed attestation and the deployed contract addresses. Simulated portfolio on a public test network.",
};

export default async function TransparencyPage() {
  const nav = getNavDocument();
  const holdings = getHoldingsDocument();
  const [chain, attestation] = await Promise.all([readChainFacts(), readAttestation()]);

  return (
    <Container className="flex flex-col gap-8 py-10 sm:gap-10 sm:py-12">
      <header className="flex max-w-3xl flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="warning">Simulated portfolio</Badge>
          <Badge tone="neutral">{chain.label}</Badge>
        </div>
        <h1 className="text-ink text-3xl font-semibold tracking-tight sm:text-4xl">Transparency</h1>
        <p className="text-muted text-sm leading-relaxed sm:text-base">
          Every figure below is either read out of a document this app publishes or read out of the
          token contract. The portfolio is simulated — the positions are illustrative placeholders,
          labelled as such on every row, and no bond is held anywhere. What is not simulated is the
          arithmetic: the NAV the engine computes is the NAV the contract prices at, and the check
          at the top of this page compares the two or says plainly that it could not.
        </p>
        <dl className="text-muted grid gap-x-8 gap-y-2 text-xs sm:grid-cols-3">
          <div className="flex flex-col gap-0.5">
            <dt className="font-medium tracking-wide uppercase">Valuation date</dt>
            <dd className="num text-ink">
              <time dateTime={nav.as_of}>{formatDate(nav.as_of)}</time>
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="font-medium tracking-wide uppercase">Documents generated</dt>
            <dd className="num text-ink">
              <time dateTime={nav.generated_at}>{formatDateTimeUtc(nav.generated_at)}</time>
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="font-medium tracking-wide uppercase">Positions</dt>
            <dd className="num text-ink">{holdings.positions.length}</dd>
          </div>
        </dl>
      </header>

      <NavCheck nav={nav} chain={chain} />
      <SupplyBackedRatio chain={chain} />
      <BookSummary nav={nav} />
      <HoldingsTable holdings={holdings} />
      <AttestationPanel result={attestation} nav={nav} chainId={chain.chainId} />
      <ContractsPanel chain={chain} />

      <section aria-labelledby="sources-heading">
        <Card>
          <CardHeader>
            <CardTitle as="h2" id="sources-heading" className="text-lg">
              The same numbers, as JSON
            </CardTitle>
            <CardDescription>
              Nothing on this page is computed in a way you have to take on trust. These endpoints
              return the documents it renders, with the caching headers a partner would poll
              against.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {[
                { href: "/api/nav", label: "NAV, portfolio analytics, distribution yield, fees" },
                { href: "/api/holdings", label: "Every position in the reference book" },
                {
                  href: "/api/stats",
                  label: "The two NAVs and their agreement, plus the on-chain state",
                },
                {
                  href: "/api/attestation",
                  label: "The attestation, or a description of why there is none",
                },
                { href: "/api/events", label: "Recent contract events, when a chain is reachable" },
              ].map((endpoint) => (
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

      <p className="text-muted max-w-3xl text-xs leading-relaxed">{nav.source_note}</p>
    </Container>
  );
}
