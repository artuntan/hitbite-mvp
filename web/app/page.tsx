import type { Metadata } from "next";

import { ComparisonCard } from "@/components/overview/comparison-card";
import { CompositionCard } from "@/components/overview/composition-card";
import { CtaCard } from "@/components/overview/cta-card";
import { DataProvenance } from "@/components/overview/data-provenance";
import { Hero } from "@/components/overview/hero";
import { HowItWorks } from "@/components/overview/how-it-works";
import { KeyMetrics } from "@/components/overview/key-metrics";
import { MaturityCard } from "@/components/overview/maturity-card";
import { NavHistoryCard } from "@/components/overview/nav-history-card";
import { Section } from "@/components/overview/section";
import {
  buildComposition,
  buildMaturityLadder,
  buildMetrics,
  buildNavHistory,
} from "@/components/overview/view-model";
import { ACTIVE_CHAIN } from "@/lib/chains";
import { TESTNET_NOTICE_SHORT, TOKEN } from "@/lib/copy";
import { getPublishedDataset } from "@/lib/data";
import { formatDate } from "@/lib/format";

/**
 * No `title` here on purpose. Next's `title.template` in `app/layout.tsx` applies
 * to *child* route segments, and `app/page.tsx` is the same segment as that
 * layout — setting `title: "Overview"` would produce the bare document title
 * "Overview" rather than the templated one every other page gets. Leaving it
 * unset falls through to the layout's `title.default`, which is the right title
 * for the site root anyway.
 */
export const metadata: Metadata = {
  description: `Live simulated NAV, portfolio composition, maturity ladder and NAV history for ${TOKEN.symbol}. ${TESTNET_NOTICE_SHORT}`,
};

/**
 * Overview — BUILD_PROMPT 7.2.
 *
 * A **server component**. It reads the published engine documents through the
 * data layer and renders them; the only client code it pulls is the three
 * Recharts leaves, each of which receives plain strings and integers. Nothing
 * here imports wagmi, RainbowKit or `lib/wagmi.ts`: the wallet bundle is what
 * would cost this page its Lighthouse performance score (PLAN.md D16), and the
 * page has nothing to do with a connected wallet.
 *
 * The testnet banner and the footer disclaimer come from the root layout, so
 * they are not repeated here.
 */
export default function OverviewPage() {
  const { nav, holdings, history } = getPublishedDataset();

  const metrics = buildMetrics(nav);
  const composition = buildComposition(holdings);
  const ladder = buildMaturityLadder(holdings);
  const navHistory = buildNavHistory(history);

  const asOf = formatDate(nav.as_of);

  return (
    <>
      <Hero asOf={nav.as_of} generatedAt={nav.generated_at} chainLabel={ACTIVE_CHAIN.label} />

      <KeyMetrics metrics={metrics} />

      <Section
        id="portfolio"
        title="Portfolio"
        description="What the simulated book holds, and when it matures. Both charts read from the same holdings document the public API serves."
        aside={
          <>
            As of <span className="num">{asOf}</span>
          </>
        }
      >
        <div className="grid gap-6 xl:grid-cols-3">
          <CompositionCard model={composition} className="xl:col-span-2" />
          <MaturityCard model={ladder} />
        </div>
      </Section>

      <Section
        id="nav-history"
        title="NAV history"
        description="One observation per engine run since inception. Subscriptions and redemptions settle at this number."
      >
        <NavHistoryCard model={navHistory} />
      </Section>

      <Section
        id="how-it-works"
        title="How it works"
        description="Five steps, from a verified wallet to a redemption."
      >
        <HowItWorks />
      </Section>

      <Section
        id="comparison"
        title="Comparison"
        description="A reference point for the yield, with the parts that are placeholders marked as placeholders."
      >
        <ComparisonCard nav={nav} />
      </Section>

      <Section
        id="about-this-data"
        title="About this data"
        description="Everything on this page is simulated and labelled as such. This is the engine's own account of how it was produced."
      >
        <DataProvenance sourceNote={nav.source_note} generatedAt={nav.generated_at} />
      </Section>

      <Section
        id="next-steps"
        title="Verification and subscription"
        description="Where the investor flow goes next, and what is available today."
      >
        <CtaCard />
      </Section>
    </>
  );
}
