"use client";

/**
 * Puts the connect control into the header's `#wallet-slot` without the shell importing wagmi.
 *
 * `components/layout/header.tsx` renders an empty `<div id="wallet-slot">` and its `walletSlot`
 * prop is deliberately unused by `app/layout.tsx` — the shell is rendered on every route, and the
 * public pages have a Lighthouse budget that the wallet bundle would eat. Portalling from a wallet
 * page is the option that leaves the shell untouched (the other, a route-group layout rendering
 * `<Header walletSlot={…} />`, would mean owning a second copy of the shell).
 *
 * Render it once per wallet page, inside `WalletProviders`.
 */

import * as React from "react";
import { createPortal } from "react-dom";

import {
  WalletConnectButton,
  type WalletConnectButtonProps,
} from "@/components/wallet/connect-button";

export interface HeaderWalletSlotProps extends WalletConnectButtonProps {
  /** Override the target element id. Only useful in a test or a second shell. */
  slotId?: string;
}

export function HeaderWalletSlot({ slotId = "wallet-slot", ...props }: HeaderWalletSlotProps) {
  const [target, setTarget] = React.useState<HTMLElement | null>(null);

  // The slot belongs to the server-rendered shell, so it exists by the time effects run — but not
  // during render, and not on the server. Reading it in an effect is what makes this safe.
  React.useEffect(() => {
    setTarget(document.getElementById(slotId));
  }, [slotId]);

  if (!target) return null;
  return createPortal(<WalletConnectButton {...props} />, target);
}
