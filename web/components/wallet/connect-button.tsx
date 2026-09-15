"use client";

/**
 * Connect / disconnect, in HitBite's design system.
 *
 * RainbowKit's own `<ConnectButton />` is not used: it ships its own typography, radii and colours
 * and would be the one control on the page that does not look like the rest of it. `ConnectButton.Custom`
 * gives the same behaviour — modal orchestration, ENS, pending-transaction state — as a render prop,
 * so the markup here is ours and built from `ui/button.tsx` and `ui/badge.tsx`. The modals it opens
 * are re-coloured in `rainbow-theme.ts`.
 *
 * Must be rendered inside `WalletProviders`.
 */

import * as React from "react";
import {
  ConnectButton,
  useAccountModal,
  useChainModal,
  useConnectModal,
} from "@rainbow-me/rainbowkit";
import { AlertTriangle, LogOut, Wallet } from "lucide-react";
import { useAccount, useDisconnect } from "wagmi";

import { StatusBadge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface WalletConnectButtonProps {
  /** Matches `Button`'s scale. `sm` is the right size in the header. */
  size?: ButtonProps["size"];
  /** Text on the disconnected control. */
  label?: string;
  /** Show the network chip beside the address once connected. Default `true`. */
  showNetwork?: boolean;
  className?: string;
}

/**
 * The control itself. Four states:
 *
 *  - **not hydrated** — a disabled placeholder of the same size, hidden from assistive tech, so the
 *    header does not jump when wagmi finishes reconnecting;
 *  - **disconnected** — a primary button that opens the wallet picker;
 *  - **wrong network** — a warning-toned button that opens the chain modal. `NetworkGuard` is what
 *    actually offers the one-click switch; this is the header's acknowledgement that something is
 *    off, so that the state is visible from every page;
 *  - **connected** — the network chip plus the address, opening the account modal (which is where
 *    RainbowKit puts Disconnect).
 */
export function WalletConnectButton({
  size = "sm",
  label = "Connect wallet",
  showNetwork = true,
  className,
}: WalletConnectButtonProps) {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        mounted,
        authenticationStatus,
        openAccountModal,
        openChainModal,
        openConnectModal,
      }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const connected = ready && account && chain;

        if (!ready) {
          return (
            <Button
              size={size}
              variant="secondary"
              disabled
              aria-hidden="true"
              tabIndex={-1}
              className={cn("pointer-events-none opacity-0", className)}
            >
              {label}
            </Button>
          );
        }

        if (!connected) {
          return (
            <Button size={size} variant="primary" onClick={openConnectModal} className={className}>
              <Wallet aria-hidden="true" />
              {label}
            </Button>
          );
        }

        if (chain.unsupported) {
          return (
            <Button
              size={size}
              variant="secondary"
              onClick={openChainModal}
              // Token classes only. The icon and the words carry the meaning; the colour repeats it.
              className={cn("border-danger text-danger hover:bg-danger-surface", className)}
            >
              <AlertTriangle aria-hidden="true" />
              Wrong network
            </Button>
          );
        }

        return (
          <div className={cn("flex items-center gap-2", className)}>
            {showNetwork ? (
              <StatusBadge tone="success" className="hidden sm:inline-flex">
                {chain.name ?? "Connected"}
              </StatusBadge>
            ) : null}
            <Button
              size={size}
              variant="secondary"
              onClick={openAccountModal}
              className="addr"
              aria-label={`Wallet ${account.displayName}. Open account details.`}
            >
              {account.displayName}
            </Button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

/**
 * An explicit disconnect, for a page that wants one outside RainbowKit's account modal. Renders
 * nothing while disconnected: a control that cannot do anything is worse than no control.
 */
export function DisconnectButton({
  size = "sm",
  className,
}: {
  size?: ButtonProps["size"];
  className?: string;
}) {
  const { isConnected } = useAccount();
  const { disconnect, isPending } = useDisconnect();
  if (!isConnected) return null;
  return (
    <Button
      size={size}
      variant="ghost"
      onClick={() => disconnect()}
      disabled={isPending}
      className={className}
    >
      <LogOut aria-hidden="true" />
      Disconnect
    </Button>
  );
}

export interface WalletControls {
  /** `undefined` until a wallet is connected. */
  address: `0x${string}` | undefined;
  isConnected: boolean;
  /** wagmi's connection status: `connecting`, `reconnecting`, `connected`, `disconnected`. */
  status: ReturnType<typeof useAccount>["status"];
  /** `undefined` when the modal cannot be opened (already open, or not mounted yet). */
  openConnectModal: (() => void) | undefined;
  openAccountModal: (() => void) | undefined;
  openChainModal: (() => void) | undefined;
  disconnect: () => void;
}

/**
 * The same handles the button uses, for a page that needs its own connect affordance — a call to
 * action inside a card, an empty state, a step in a flow.
 */
export function useWalletControls(): WalletControls {
  const { address, isConnected, status } = useAccount();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();
  const { openAccountModal } = useAccountModal();
  const { openChainModal } = useChainModal();

  return React.useMemo(
    () => ({
      address,
      isConnected,
      status,
      openConnectModal,
      openAccountModal,
      openChainModal,
      disconnect: () => disconnect(),
    }),
    [address, isConnected, status, openConnectModal, openAccountModal, openChainModal, disconnect],
  );
}
