"use client";

/**
 * The client boundary for `/admin`.
 *
 * `WalletProviders` is mounted here, on the route, and not in `app/layout.tsx`: the shell renders
 * `/`, `/transparency` and `/stats` too, and those hold their Lighthouse performance score
 * precisely because wagmi, RainbowKit and TanStack Query are nowhere near them (PLAN.md D63).
 *
 * `HeaderWalletSlot` portals the connect control into the shell's empty `#wallet-slot`, so the
 * header gains a wallet button on this route without the shell ever importing wagmi.
 */

import * as React from "react";

import { AdminConsole } from "@/components/admin/admin-console";
import { WalletProviders } from "@/components/wallet/providers";
import { HeaderWalletSlot } from "@/components/wallet/wallet-slot";

export function AdminApp() {
  return (
    <WalletProviders>
      <HeaderWalletSlot size="sm" />
      <AdminConsole />
    </WalletProviders>
  );
}
