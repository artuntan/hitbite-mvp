"use client";

/**
 * Wrong-network detection and the one-click switch (BUILD_PROMPT 7.3).
 *
 * The wagmi config carries exactly one chain, so "wrong network" is unambiguous and there is only
 * ever one switch target. Two failure modes are handled rather than assumed away:
 *
 *  - **The wallet refuses.** A declined switch is reported as a decline, and the alert keeps the
 *    button plus the network's details so the switch can be done by hand.
 *  - **The wallet does not know the chain.** wagmi's injected connector answers EIP-1193 `4902` by
 *    calling `wallet_addEthereumChain`, so the parameters it needs — name, RPC URL, currency,
 *    explorer — are passed on every attempt. When even that fails, the same details are printed for
 *    a manual add. A local Anvil is the common case: no wallet ships with it configured.
 */

import * as React from "react";
import { AlertTriangle, ArrowLeftRight, Wallet } from "lucide-react";
import { useAccount, useSwitchChain } from "wagmi";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { WalletConnectButton } from "@/components/wallet/connect-button";
import { ACTIVE_CHAIN, getChainConfig, isSupportedChainId } from "@/lib/chains";
import {
  decodeTxError,
  walletNetworkFacts,
  type TxFailure,
  type WalletNetworkFacts,
} from "@/lib/tx";
import { cn } from "@/lib/utils";
import { REQUIRED_CHAIN_ID, REQUIRED_CHAIN_LABEL } from "@/lib/wagmi";

export type NetworkStatus =
  /** Hydrating, or wagmi is reconnecting a previously connected wallet. */
  "connecting" | "disconnected" | "wrong-network" | "ready";

export interface NetworkState {
  status: NetworkStatus;
  /** True only when a wallet is connected **and** on the configured chain. */
  isReady: boolean;
  /** The chain the wallet is on, if any. */
  chainId: number | undefined;
  /** Its label when we recognise it, otherwise `null` — most wrong networks are ones we do not carry. */
  currentChainLabel: string | null;
  requiredChainId: number;
  requiredChainLabel: string;
  /** Everything needed to add or select the network by hand. */
  facts: WalletNetworkFacts;
  /** Ask the wallet to switch. Safe to call when already on the right chain — it is a no-op then. */
  switchToRequiredChain: () => void;
  isSwitching: boolean;
  /** The last switch failure, already turned into a sentence. */
  switchFailure: TxFailure | null;
  dismissSwitchFailure: () => void;
}

/**
 * Connection and network state, with the switch attached.
 *
 * Before hydration the status is `connecting` rather than `disconnected`: wagmi only learns about a
 * previously connected wallet on the client, and flashing "Connect wallet" at somebody who is
 * already connected is a worse lie than a moment of "checking".
 */
export function useNetworkStatus(): NetworkState {
  const { chainId, isConnected, status: accountStatus } = useAccount();
  const { switchChain, isPending, error, reset } = useSwitchChain();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const facts = React.useMemo(() => walletNetworkFacts(REQUIRED_CHAIN_ID), []);

  const status: NetworkStatus =
    !mounted || accountStatus === "connecting" || accountStatus === "reconnecting"
      ? "connecting"
      : !isConnected
        ? "disconnected"
        : chainId === REQUIRED_CHAIN_ID
          ? "ready"
          : "wrong-network";

  const switchToRequiredChain = React.useCallback(() => {
    reset();
    switchChain({
      chainId: REQUIRED_CHAIN_ID,
      // Everything `wallet_addEthereumChain` needs, so a wallet that has never heard of this
      // network can add it in the same click instead of failing with 4902.
      addEthereumChainParameter: {
        chainName: facts.label,
        nativeCurrency: ACTIVE_CHAIN.viemChain.nativeCurrency,
        rpcUrls: [facts.rpcUrl],
        ...(facts.explorerUrl ? { blockExplorerUrls: [facts.explorerUrl] } : {}),
      },
    });
  }, [facts, reset, switchChain]);

  const switchFailure = React.useMemo(
    () => (error ? decodeTxError(error, { action: "The network switch" }) : null),
    [error],
  );

  const currentChainLabel =
    chainId !== undefined && isSupportedChainId(chainId) ? getChainConfig(chainId).label : null;

  return {
    status,
    isReady: status === "ready",
    chainId,
    currentChainLabel,
    requiredChainId: REQUIRED_CHAIN_ID,
    requiredChainLabel: REQUIRED_CHAIN_LABEL,
    facts,
    switchToRequiredChain,
    isSwitching: isPending,
    switchFailure,
    dismissSwitchFailure: reset,
  };
}

/** The network's details as a definition list, for adding it to a wallet by hand. */
export function NetworkFactsList({
  facts,
  className,
}: {
  facts: WalletNetworkFacts;
  className?: string;
}) {
  const rows: Array<[string, string]> = [
    ["Network name", facts.label],
    ["Chain id", `${facts.chainId} (${facts.chainIdHex})`],
    ["RPC URL", facts.rpcUrl],
    ["Currency symbol", facts.currencySymbol],
    ...(facts.explorerUrl
      ? ([["Block explorer", facts.explorerUrl]] as Array<[string, string]>)
      : []),
  ];
  return (
    <dl className={cn("mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]", className)}>
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="text-muted">{label}</dt>
          <dd className="addr text-ink">{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export interface WrongNetworkAlertProps {
  network: NetworkState;
  className?: string;
}

/**
 * The wrong-network message and its switch button. Exported separately from `NetworkGuard` so a
 * page can place it where it wants — at the top of a form, say, while the form stays visible.
 */
export function WrongNetworkAlert({ network, className }: WrongNetworkAlertProps) {
  const {
    currentChainLabel,
    chainId,
    facts,
    isSwitching,
    requiredChainLabel,
    switchFailure,
    switchToRequiredChain,
  } = network;
  const on = currentChainLabel ?? (chainId !== undefined ? `chain ${chainId}` : "another network");

  return (
    <Alert tone="warning" className={cn("flex-col items-start", className)} hideIcon>
      <div className="flex items-start gap-3">
        <AlertTriangle aria-hidden="true" className="text-warning mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <AlertTitle>Wrong network</AlertTitle>
          <AlertDescription>
            Your wallet is on {on}. This app only talks to {requiredChainLabel} (chain id{" "}
            {facts.chainId}), and nothing can be signed until you switch.
          </AlertDescription>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pl-7">
        <Button variant="primary" size="sm" onClick={switchToRequiredChain} disabled={isSwitching}>
          <ArrowLeftRight aria-hidden="true" />
          {isSwitching ? "Waiting for your wallet…" : `Switch to ${requiredChainLabel}`}
        </Button>
      </div>

      {switchFailure ? (
        <div className="pl-7" role="status">
          <p className="text-ink text-sm font-medium">{switchFailure.title}</p>
          <p className="text-muted text-sm">{switchFailure.message}</p>
          {/* A failed switch must not be a dead end: the same network, addable by hand. */}
          <details className="mt-2">
            <summary className="text-accent-ink cursor-pointer text-sm underline underline-offset-4">
              Add {requiredChainLabel} to your wallet manually
            </summary>
            <NetworkFactsList facts={facts} />
          </details>
        </div>
      ) : null}
    </Alert>
  );
}

export interface ConnectPromptProps {
  /** What the page needs a wallet for, e.g. "to subscribe". */
  purpose?: string;
  className?: string;
}

/** "Connect a wallet to …", with the connect control. */
export function ConnectPrompt({ purpose, className }: ConnectPromptProps) {
  return (
    <Alert tone="accent" className={cn("flex-col items-start", className)} hideIcon>
      <div className="flex items-start gap-3">
        <Wallet aria-hidden="true" className="text-accent-ink mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <AlertTitle>Connect a wallet</AlertTitle>
          <AlertDescription>
            Connect a wallet {purpose ? `${purpose} ` : ""}on {REQUIRED_CHAIN_LABEL}. This is a test
            network: the funds and the portfolio behind them are simulated.
          </AlertDescription>
        </div>
      </div>
      <div className="pl-7">
        <WalletConnectButton size="md" showNetwork={false} />
      </div>
    </Alert>
  );
}

export interface NetworkGuardProps {
  children: React.ReactNode;
  /** What the page needs a wallet for, woven into the connect prompt. */
  purpose?: string;
  /**
   * `"block"` (default) hides the children until a wallet is connected to the right chain, which is
   * what a form that would only revert should do. `"warn"` shows the message above the children and
   * lets the page decide what to disable — right for a read-only view with one wallet action in it.
   */
  mode?: "block" | "warn";
  /** Replaces the built-in connect prompt. */
  fallback?: React.ReactNode;
  className?: string;
}

/**
 * Renders `children` only when a wallet is connected to the configured chain.
 *
 * The "connecting" state renders nothing rather than a skeleton: reconnection is usually a single
 * frame, and a flash of placeholder is more distracting than a blank one.
 */
export function NetworkGuard({
  children,
  purpose,
  mode = "block",
  fallback,
  className,
}: NetworkGuardProps) {
  const network = useNetworkStatus();

  if (network.status === "connecting") {
    // In "warn" mode the page is readable without a wallet, so it stays on screen while wagmi
    // reconnects. In "block" mode there is nothing safe to show yet.
    return (
      <div className={className} aria-busy="true">
        {mode === "warn" ? children : null}
      </div>
    );
  }

  if (network.status === "disconnected") {
    const prompt = fallback ?? <ConnectPrompt purpose={purpose} />;
    return (
      <div className={cn("flex flex-col gap-4", className)}>
        {prompt}
        {mode === "warn" ? children : null}
      </div>
    );
  }

  if (network.status === "wrong-network") {
    return (
      <div className={cn("flex flex-col gap-4", className)}>
        <WrongNetworkAlert network={network} />
        {mode === "warn" ? children : null}
      </div>
    );
  }

  return <>{children}</>;
}
