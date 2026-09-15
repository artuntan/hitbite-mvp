"use client";

/**
 * The client boundary for `/portfolio`.
 *
 * `WalletProviders` is mounted **here**, on the route, and not in `app/layout.tsx`: the shell
 * renders `/` and `/transparency` too, and those hold their Lighthouse performance score precisely
 * because wagmi, RainbowKit and TanStack Query are nowhere near them (PLAN.md D63). Everything
 * wallet-shaped this page needs is inside this subtree.
 *
 * `HeaderWalletSlot` portals the connect control into the shell's empty `#wallet-slot`, so the
 * header gains a wallet button on this route without the shell ever importing wagmi.
 */

import * as React from "react";

import { PortfolioView } from "@/components/portfolio/portfolio-view";
import { WalletProviders } from "@/components/wallet/providers";
import { HeaderWalletSlot } from "@/components/wallet/wallet-slot";

export interface PortfolioAppProps {
  initialAddress: string | null;
}

export function PortfolioApp({ initialAddress }: PortfolioAppProps) {
  return (
    <WalletProviders>
      <HeaderWalletSlot size="sm" />
      <PortfolioView initialAddress={initialAddress} />
    </WalletProviders>
  );
}
