"use client";

/**
 * The wallet provider stack. **A page opts into this; the root layout must not.**
 *
 * `app/layout.tsx` renders every route, including `/` and `/transparency`, and those two hold a
 * Lighthouse performance score above 90 precisely because wagmi, viem's wallet paths, RainbowKit
 * and TanStack Query are nowhere near them. Mounting this in the layout would move roughly the
 * whole wallet bundle onto pages that never ask a wallet for anything.
 *
 * Three habits keep that mistake hard to make rather than merely discouraged:
 *
 *  1. **No barrel.** There is no `components/wallet/index.ts`. Every consumer imports the exact
 *     file it needs, so no server component can pull the provider stack in by accident while
 *     reaching for a type or a formatter.
 *  2. **Client-only by construction.** Every file in this folder starts with `"use client"`, and so
 *     does `lib/wagmi.ts`. A server component that imports one gets a client reference it cannot
 *     call, and the error arrives at build time.
 *  3. **Pure helpers live in `lib/tx.ts`,** which imports none of this. A page that only wants to
 *     format a hash or build an explorer link takes it from there and stays server-rendered.
 *
 * ---------------------------------------------------------------------------------------------
 * BUILD PREREQUISITE, one line in `next.config.ts` (not owned by this module).
 *
 * RainbowKit's entry point imports `wagmi/connectors`, whose barrel reaches `@base-org/account` and
 * then `@coinbase/cdp-sdk`. That SDK statically imports four `@x402/*` packages it declares as
 * **optional** peer dependencies, so pnpm correctly does not install them and webpack correctly
 * cannot resolve them — `next build` fails the moment any route imports this file. The fix is to
 * alias them away; nothing in this app uses the x402 payment paths, and the Base Account wallet
 * they belong to is not in our connector list.
 *
 *     // next.config.ts
 *     webpack: (config) => {
 *       config.resolve.alias = {
 *         ...config.resolve.alias,
 *         "@x402/core/client": false,
 *         "@x402/evm": false,
 *         "@x402/evm/exact/client": false,
 *         "@x402/evm/upto/client": false,
 *         "@x402/svm/exact/client": false,
 *       };
 *       return config;
 *     },
 *
 * Verified: with that alias a page rendering `WalletProviders` compiles; without it the build stops
 * with five "Module not found" errors. The remaining `pino-pretty` and `@react-native-async-storage`
 * notices are warnings every wagmi app emits, and do not fail a build.
 * ---------------------------------------------------------------------------------------------
 *
 * Usage, at the top of a wallet page (or its route-group layout):
 *
 * ```tsx
 * "use client";
 * import { WalletProviders } from "@/components/wallet/providers";
 *
 * export default function SubscribePage() {
 *   return <WalletProviders>{…}</WalletProviders>;
 * }
 * ```
 */

import "@rainbow-me/rainbowkit/styles.css";

import * as React from "react";
import { RainbowKitProvider, type DisclaimerComponent } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";

import { hitbiteRainbowKitTheme } from "@/components/wallet/rainbow-theme";
import { WalletToaster } from "@/components/wallet/toaster";
import { ACTIVE_CHAIN } from "@/lib/chains";
import { TESTNET_NOTICE_SHORT } from "@/lib/copy";
import { APP_NAME, wagmiConfig } from "@/lib/wagmi";

/**
 * Shown under the wallet list. The banner in the shell says the same thing, but somebody about to
 * connect a wallet is exactly the person who needs to read it, and the modal covers the banner.
 */
const Disclaimer: DisclaimerComponent = ({ Text }) => <Text>{TESTNET_NOTICE_SHORT}</Text>;

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Chain reads are cheap and go stale quickly; a short window still collapses the burst of
        // duplicate reads a page makes on mount.
        staleTime: 5_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: {
        // A write is never retried automatically. Re-sending a transaction is a decision a person
        // makes, not something a query client does on their behalf.
        retry: 0,
      },
    },
  });
}

export interface WalletProvidersProps {
  children: React.ReactNode;
  /**
   * Mount the toast surface. Leave it on unless the page already renders `WalletToaster` itself —
   * two `<Toaster>` elements would show every toast twice.
   */
  toaster?: boolean;
}

export function WalletProviders({ children, toaster = true }: WalletProvidersProps) {
  // One client for the life of the tree. Created in state rather than at module scope so a second
  // mount (fast refresh, a test) does not inherit the first one's cache.
  const [queryClient] = React.useState(createQueryClient);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={hitbiteRainbowKitTheme}
          // The only chain the config carries, so the chain modal has exactly one target.
          initialChain={ACTIVE_CHAIN.viemChain}
          modalSize="compact"
          appInfo={{ appName: APP_NAME, disclaimer: Disclaimer }}
          // RainbowKit's own recent-transaction store would be a second, quieter source of truth
          // next to `useTx`. One is enough.
          showRecentTransactions={false}
        >
          {children}
          {toaster ? <WalletToaster /> : null}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
