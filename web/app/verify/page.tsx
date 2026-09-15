import type { Metadata } from "next";

import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { VERIFY_INTRO } from "@/components/verify/copy";
import { HowVerificationWorks, NotKycNotice, WhatIsStored } from "@/components/verify/disclosures";
import { VerifyApp } from "@/components/verify/verify-app";
import { ACTIVE_CHAIN } from "@/lib/chains";

/**
 * `/verify` — BUILD_PROMPT.md 7.2, PLAN.md D7, D8, D21, D23.
 *
 * A server component that renders one client island. The heading, the "this is not KYC" notice, the
 * flow description and the storage disclosure are all in the HTML before any JavaScript runs, which
 * is deliberate: they are the things somebody should be able to read *before* connecting a wallet,
 * and they must not depend on a bundle loading.
 *
 * Everything wallet-shaped is inside `VerifyApp`, which mounts `WalletProviders` for this route
 * only. `/` and `/transparency` stay free of wagmi and RainbowKit, and their Lighthouse scores stay
 * where Phase 6 left them.
 */
export const metadata: Metadata = {
  title: "Verify",
  description:
    "Put a testnet wallet on the IdentityRegistry whitelist. Not a KYC check: no identity document is requested, read or stored, and approval is a simulated registrar on a public test network.",
};

export default function VerifyPage() {
  return (
    <Container className="flex flex-col gap-8 py-10 sm:gap-10 sm:py-12">
      <header className="flex max-w-3xl flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="warning">Simulated registrar</Badge>
          <Badge tone="neutral">{ACTIVE_CHAIN.label}</Badge>
        </div>
        <h1 className="text-ink text-3xl font-semibold tracking-tight sm:text-4xl">
          Verify your wallet
        </h1>
        <p className="text-muted text-sm leading-relaxed sm:text-base">{VERIFY_INTRO}</p>
      </header>

      <NotKycNotice />

      <VerifyApp />

      <HowVerificationWorks />
      <WhatIsStored />
    </Container>
  );
}
