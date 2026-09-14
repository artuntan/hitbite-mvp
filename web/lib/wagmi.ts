"use client";

/**
 * The wallet stack: wagmi + RainbowKit, configured for one testnet.
 *
 * **Client only.** The `"use client"` directive above is the enforcement, not a comment: a server
 * component that imports `wagmiConfig` receives a client reference it cannot call, so the mistake
 * surfaces immediately instead of quietly dragging the wallet bundle into a public page. Public
 * pages (`/`, `/transparency`, `/rules`, `/risks`) must never import this module — they render
 * from JSON through `lib/data.ts`, which is why they can hold a Lighthouse score above 90.
 *
 * Chain safety is inherited from `lib/chains.ts`: `ACTIVE_CHAIN` is a `SupportedChainId`, so the
 * only chains that can ever reach a wallet are Base Sepolia and Anvil.
 */

import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { http } from "viem";
import { createConfig, type Config } from "wagmi";

import { ACTIVE_CHAIN, ANVIL_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID, getPublicRpcUrl } from "./chains";
import { TESTNET_NOTICE_SHORT } from "./copy";

/** Shown in the wallet-connection modal. */
export const APP_NAME = "HitBite (Testnet)";

/**
 * WalletConnect Cloud project id. **Optional.**
 *
 * Without it, WalletConnect's relay cannot be used — mobile QR pairing and the WalletConnect and
 * MetaMask-over-QR entries are simply not offered. Injected wallets (a browser extension such as
 * MetaMask, Rabby or Brave) work exactly as before, which is enough to run the whole demo. That
 * is why this file degrades instead of throwing: a reviewer cloning the repo with no accounts
 * anywhere should still be able to connect and subscribe.
 *
 * Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` to turn the rest on.
 */
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ?? "";

/** True when WalletConnect wallets are available. The UI may say so rather than leaving a gap. */
export const WALLETCONNECT_ENABLED = projectId.length > 0;

/** One sentence explaining the reduced wallet list, for a tooltip or a help panel. */
export const WALLETCONNECT_STATUS_NOTE = WALLETCONNECT_ENABLED
  ? "WalletConnect is enabled: mobile wallets can pair by QR code."
  : "WalletConnect is not configured (NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is unset), so only browser-extension wallets are offered. Everything in this demo works with an injected wallet.";

/**
 * `injectedWallet` is the only entry that never touches the WalletConnect relay, so it is the only
 * one offered when there is no project id. The others are added when one exists: RainbowKit throws
 * from `getWalletConnectConnector` if asked to build a WalletConnect connector without a project
 * id, and `metaMaskWallet` falls back to exactly that on a desktop with no MetaMask extension
 * installed — so listing it unconditionally would turn a missing environment variable into a crash
 * in the connect modal.
 *
 * Safe is deliberately absent: a Safe App runs inside an iframe, and `vercel.json` sends
 * `X-Frame-Options: DENY`. Offering a wallet that cannot connect is worse than not offering it.
 */
const wallets = WALLETCONNECT_ENABLED
  ? [injectedWallet, metaMaskWallet, coinbaseWallet, walletConnectWallet]
  : [injectedWallet];

const connectors = connectorsForWallets([{ groupName: "Wallets", wallets }], {
  appName: APP_NAME,
  appDescription: TESTNET_NOTICE_SHORT,
  projectId,
});

/**
 * Exactly one chain is offered to the wallet: the one this deployment is pointed at. Any other
 * network the user is connected to is unambiguously "wrong network", with a single switch target
 * (BUILD_PROMPT.md 7.3). Transports are declared for both testnets because wagmi's types require
 * an entry per supported chain id; only the active one is reachable.
 */
const chains = [ACTIVE_CHAIN.viemChain] as const;

const transports = {
  [BASE_SEPOLIA_CHAIN_ID]: http(getPublicRpcUrl(BASE_SEPOLIA_CHAIN_ID)),
  [ANVIL_CHAIN_ID]: http(getPublicRpcUrl(ANVIL_CHAIN_ID)),
} as const;

/**
 * The wagmi config. Built once at module scope; `ssr: true` so wagmi does not try to read
 * `localStorage` while the client component tree is being rendered on the server.
 */
export const wagmiConfig: Config = createConfig({
  chains,
  transports,
  connectors,
  ssr: true,
});

/** The chain id every wallet interaction must be on. Re-exported so providers need one import. */
export const REQUIRED_CHAIN_ID = ACTIVE_CHAIN.id;

/** Human label for the required network, e.g. "Base Sepolia". */
export const REQUIRED_CHAIN_LABEL = ACTIVE_CHAIN.label;
