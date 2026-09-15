import Link from "next/link";

import { Container } from "@/components/layout/container";
import { NAV_ITEMS, SECONDARY_NAV_ITEMS } from "@/components/layout/nav-items";

/**
 * Footer disclaimer, verbatim from BUILD_PROMPT Section 15. Do not edit.
 */
export const FOOTER_DISCLAIMER =
  "This is a technical demonstration on a public test network. Portfolio data, prices and attestations are simulated or illustrative and are labelled as such. Nothing here is an offer, solicitation or recommendation to buy any security. HitBite is not a licensed financial institution.";

export function Footer() {
  return (
    <footer className="border-border bg-surface mt-16 border-t">
      <Container className="flex flex-col gap-6 py-8">
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-muted hover:text-ink transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <nav aria-label="Reference" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {SECONDARY_NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-muted hover:text-ink transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <p className="text-muted max-w-3xl text-xs leading-relaxed">{FOOTER_DISCLAIMER}</p>

        <p className="text-muted text-xs">
          <span className="num">Base Sepolia · chain 84532</span> — test network only. No mainnet
          deployment exists.
        </p>
      </Container>
    </footer>
  );
}
