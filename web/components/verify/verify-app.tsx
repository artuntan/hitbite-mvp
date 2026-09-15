"use client";

/**
 * The only client boundary on `/verify`.
 *
 * `WalletProviders` is mounted here rather than in `app/layout.tsx` so wagmi, RainbowKit and
 * TanStack Query land on this route and nowhere else: `/` and `/transparency` hold a Lighthouse
 * performance score above 90 precisely because none of that is in their bundles
 * (see the header of `components/wallet/providers.tsx`).
 *
 * `HeaderWalletSlot` portals the connect control into the shell's existing `#wallet-slot`, which is
 * what lets the header carry a wallet button without `components/layout/` importing a line of wagmi.
 */

import { HeaderWalletSlot } from "@/components/wallet/wallet-slot";
import { WalletProviders } from "@/components/wallet/providers";
import { VerifyFlow } from "@/components/verify/verify-flow";

export function VerifyApp() {
  return (
    <WalletProviders>
      <HeaderWalletSlot />
      <VerifyFlow />
    </WalletProviders>
  );
}
