import type { Metadata } from "next";

import { AdminApp } from "@/components/admin/admin-app";
import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { ACTIVE_CHAIN } from "@/lib/chains";
import { GATE_IS_NOT_A_BOUNDARY } from "@/components/admin/copy";
import { TESTNET_NOTICE_SHORT, TOKEN } from "@/lib/copy";

export const metadata: Metadata = {
  title: "Admin",
  description: `Operator console for ${TOKEN.symbol} on ${ACTIVE_CHAIN.label}: verification queue, country blocklist, NAV, coupon distribution, pause and operational corrections. Gated by on-chain roles. ${TESTNET_NOTICE_SHORT}`,
};

/**
 * Admin console — BUILD_PROMPT 7.2.
 *
 * A **server component** that renders the heading and hands over to `AdminApp`, so the wallet stack
 * stays inside one subtree and the shell around it stays free of wagmi and RainbowKit.
 *
 * There is nothing for the server to fetch here. Every figure this console shows is read from the
 * deployed contracts in the browser, and every action it offers is a transaction the connected
 * wallet signs; no published document can stand in for either.
 */
export default function AdminPage() {
  return (
    <Container className="flex flex-col gap-8 py-8 sm:py-10">
      <header className="flex max-w-3xl flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{ACTIVE_CHAIN.label}</Badge>
          <Badge tone="warning">Roles read from the chain</Badge>
        </div>
        <h1 className="text-ink text-3xl font-semibold tracking-tight sm:text-4xl">
          Admin console
        </h1>
        <p className="text-muted text-sm leading-relaxed sm:text-base">
          The operational controls for {TOKEN.symbol} and the identity registry on{" "}
          {ACTIVE_CHAIN.label}: the verification queue, the country blocklist, NAV, coupon
          distribution, pause, and the mint and burn corrections. Every action shows the exact
          calldata before it is signed, and the destructive ones ask for a typed confirmation first.
        </p>
        <p className="text-muted text-sm leading-relaxed">{GATE_IS_NOT_A_BOUNDARY}</p>
      </header>

      <AdminApp />
    </Container>
  );
}
