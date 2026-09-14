import Link from "next/link";
import type * as React from "react";

import { Container } from "@/components/layout/container";
import { NAV_ITEMS } from "@/components/layout/nav-items";
import { NavLink } from "@/components/layout/nav-link";
import { ThemeToggle } from "@/components/layout/theme-toggle";

interface HeaderProps {
  /**
   * WALLET SLOT — Phase 7.
   *
   * The root layout deliberately passes nothing here. RainbowKit/wagmi must not
   * be imported by the shell: the public pages have to stay free of the wallet
   * bundle to hold Lighthouse performance >= 90.
   *
   * Two supported ways to fill it, both keeping the shell wallet-free:
   *  1. Portal into `#wallet-slot` from a client component rendered by a wallet
   *     page (`createPortal(<ConnectButton />, document.getElementById("wallet-slot"))`).
   *  2. Give the wallet routes their own route-group layout that renders
   *     `<Header walletSlot={<ConnectButton />} />` instead of the root one.
   */
  walletSlot?: React.ReactNode;
}

export function Header({ walletSlot }: HeaderProps) {
  return (
    <header className="border-border bg-paper/95 supports-[backdrop-filter]:bg-paper/80 sticky top-0 z-40 border-b backdrop-blur">
      <Container className="flex h-14 items-center gap-6">
        <Link
          href="/"
          className="focus-visible:outline-ring flex shrink-0 items-baseline gap-2 rounded focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span className="text-ink text-base font-semibold tracking-tight">HitBite</span>
          <span className="num text-muted text-xs">hbTRS</span>
        </Link>

        <nav aria-label="Main" className="flex min-w-0 flex-1 items-center gap-5 overflow-x-auto">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          {/* Wallet mounts here in Phase 7 — see HeaderProps.walletSlot. */}
          <div id="wallet-slot" data-slot="wallet" className="contents">
            {walletSlot}
          </div>
          <ThemeToggle />
        </div>
      </Container>
    </header>
  );
}
