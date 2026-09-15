import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { PortfolioApp } from "@/components/portfolio/portfolio-app";
import { Badge } from "@/components/ui/badge";
import { ACTIVE_CHAIN } from "@/lib/chains";
import { TESTNET_NOTICE_SHORT, TOKEN } from "@/lib/copy";

export const metadata: Metadata = {
  title: "Portfolio",
  description: `What a wallet holds in ${TOKEN.symbol} on ${ACTIVE_CHAIN.label}: balance, value at NAV, cost basis from events, pending coupon, redemption and full transaction history. ${TESTNET_NOTICE_SHORT}`,
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Portfolio — BUILD_PROMPT 7.2.
 *
 * A **server component** whose only job is the heading and one query parameter. Every figure below
 * it comes from the chain or from this address's own events, so there is nothing for the server to
 * fetch: no published document can stand in for a balance.
 *
 * `?address=0x…` makes the page a read-only view of any address, which is what lets a reviewer with
 * no test wallet see a real position — and what lets `e2e/portfolio.spec.ts` assert the empty state
 * of an address with no history without faking a wallet. It is validated here so the client is
 * never handed something that is not an address.
 *
 * The wallet stack lives entirely inside `PortfolioApp`, so this file — and the shell around it —
 * stay free of wagmi and RainbowKit.
 */
export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = typeof params.address === "string" ? params.address.trim() : null;
  const initialAddress = raw !== null && ADDRESS_RE.test(raw) ? raw : null;

  return (
    <Container className="flex flex-col gap-8 py-8 sm:py-10">
      <header className="flex max-w-3xl flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{ACTIVE_CHAIN.label}</Badge>
          <Badge tone="warning">Simulated portfolio</Badge>
        </div>
        <h1 className="text-ink text-3xl font-semibold tracking-tight sm:text-4xl">Portfolio</h1>
        <p className="text-muted text-sm leading-relaxed sm:text-base">
          What an address holds in {TOKEN.symbol}, what it is worth at the contract&rsquo;s net
          asset value, what it cost, what it is owed in coupons, and how to get out. Every figure is
          read from the token on {ACTIVE_CHAIN.label} or folded from that address&rsquo;s own events
          — none of it is stored by this app, and none of it is carried over from a published
          document.
        </p>
      </header>

      <PortfolioApp initialAddress={initialAddress} />
    </Container>
  );
}
