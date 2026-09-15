import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { SubscribeApp } from "@/components/subscribe/subscribe-app";
import { ACTIVE_CHAIN } from "@/lib/chains";
import { TESTNET_NOTICE_SHORT, TOKEN } from "@/lib/copy";
import { getNavDocument } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Subscribe",
  description: `Subscribe to ${TOKEN.symbol} in test USDC at the current net asset value on ${ACTIVE_CHAIN.label}. ${TESTNET_NOTICE_SHORT}`,
};

/**
 * Subscribe — BUILD_PROMPT 7.2.
 *
 * A **server component** that reads the published NAV document and hands the handful of fields the
 * client needs down as plain data. The wallet stack lives entirely inside `SubscribeApp`, so this
 * file — and the shell around it — stay free of wagmi and RainbowKit.
 *
 * The published NAV is not what a subscription settles at: the contract's own `nav()` is, and the
 * client reads it. It is passed down for the fee line (management fee and fund expenses, which
 * accrue inside NAV rather than being charged on a subscription) and as the clearly-labelled
 * fallback that keeps the arithmetic visible where no deployment exists to quote against.
 */
export default function SubscribePage() {
  const nav = getNavDocument();

  return (
    <Container className="py-8 sm:py-10">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-ink text-2xl font-semibold tracking-tight">Subscribe</h1>
        <p className="text-muted max-w-2xl text-sm leading-relaxed">
          Send test USDC to the vault and receive {TOKEN.symbol} at net asset value. The amount, the
          NAV, the minimum and every eligibility rule below are read from the contracts on{" "}
          {ACTIVE_CHAIN.label}; the arithmetic on this page is the contract&rsquo;s arithmetic,
          floored the same way, so the quote is the number that settles. Published NAV for{" "}
          {formatDate(nav.as_of)}: <span className="num">{nav.nav.per_token_usd}</span> USDC.
        </p>
      </div>

      <SubscribeApp
        published={{
          navUsdc6: nav.nav.usdc_6dec,
          asOf: nav.as_of,
          generatedAt: nav.generated_at,
          managementFeePctPa: nav.fees.management_fee_pct_pa,
          fundExpensesPctPa: nav.fees.fund_expenses_pct_pa,
        }}
      />
    </Container>
  );
}
