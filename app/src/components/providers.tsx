"use client";
import type { Chain } from "viem";
import { useEffect, useState } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import {
  RainbowKitProvider,
  lightTheme,
  getDefaultConfig,
} from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "@/lib/chain";
import "@rainbow-me/rainbowkit/styles.css";

const chains = [config.chain as Chain] as const;
const walletConfig = config.walletConnectProjectId
  ? getDefaultConfig({
      appName: "HitBite Testnet",
      projectId: config.walletConnectProjectId,
      chains,
      transports: { [config.chain.id]: http(config.rpcUrl) },
      ssr: true,
    })
  : createConfig({
      chains,
      connectors: [injected()],
      transports: { [config.chain.id]: http(config.rpcUrl) },
      ssr: true,
    });
const theme = lightTheme({
  accentColor: "#1465d4",
  accentColorForeground: "#ffffff",
  borderRadius: "small",
  fontStack: "system",
  overlayBlur: "small",
});
export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const preventImageDrag = (event: DragEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("img, picture, svg")
      ) {
        event.preventDefault();
      }
    };
    // Also covers images rendered later or in wallet-modal portals.
    document.addEventListener("dragstart", preventImageDrag, true);
    return () =>
      document.removeEventListener("dragstart", preventImageDrag, true);
  }, []);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
      }),
  );
  return (
    <WagmiProvider config={walletConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
