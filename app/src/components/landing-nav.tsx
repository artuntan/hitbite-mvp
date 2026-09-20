"use client";
import { useEffect, useState } from "react";
import { landingNav } from "@/lib/landing-nav";
export function LandingNav() {
  const [nav, setNav] = useState<ReturnType<typeof landingNav>>(null);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch("/data/nav.json", {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(8000),
          ]),
        });
        const next = response.ok ? landingNav(await response.json()) : null;
        if (active) setNav(next);
      } catch {
        if (active) setNav(null);
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 60_000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(interval);
    };
  }, []);
  if (!nav) return null;
  return (
    <span data-testid="landing-nav">
      NAV {nav.value} USDC · Arc Testnet · updated{" "}
      <time dateTime={nav.timestamp}>{nav.relative}</time>
    </span>
  );
}
