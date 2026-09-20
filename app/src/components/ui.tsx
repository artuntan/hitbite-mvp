"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useQuery } from "@tanstack/react-query";
import { config, snapshot, short, type NavData } from "@/lib/chain";

const subscribe = (callback: () => void) => {
  window.addEventListener("storage", callback);
  window.addEventListener("walkthrough", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("walkthrough", callback);
  };
};
export function useWalkthrough() {
  return useSyncExternalStore(
    subscribe,
    () => localStorage.getItem("hitbite.walkthrough") === "true",
    () => false,
  );
}
export function Caption({ children }: { children: React.ReactNode }) {
  const visible = useWalkthrough();
  return visible ? <p className="caption walkthrough">↳ {children}</p> : null;
}
export function WalletButton() {
  const { isConnected, address, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { connect, connectors, isPending, error } = useConnect();
  const {
    switchChain,
    isPending: switching,
    error: switchError,
  } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  if (isConnected && chainId !== config.chain.id)
    return (
      <>
        <button
          onClick={() => switchChain({ chainId: config.chain.id })}
          disabled={switching}
        >
          {switching ? "Switching…" : `Add / switch to ${config.chain.name}`}
        </button>
        {switchError && (
          <p role="alert" className="error">
            Network switch declined. Try again in your wallet.
          </p>
        )}
      </>
    );
  return (
    <div className="wallet-control">
      <button
        className={isConnected ? "secondary" : ""}
        disabled={isPending}
        onClick={() =>
          isConnected
            ? disconnect()
            : config.walletConnectProjectId
              ? openConnectModal?.()
              : connectors[0] && connect({ connector: connectors[0] })
        }
      >
        {isConnected
          ? `${short(address!)} · Disconnect`
          : isPending
            ? "Connecting…"
            : "Connect wallet"}
      </button>
      {error && (
        <p role="alert" className="error">
          {error.message.includes("not found")
            ? "Install a browser wallet such as MetaMask, then reload."
            : "Connection declined or unavailable. Try again in your wallet."}
        </p>
      )}
    </div>
  );
}
export function Header() {
  const path = usePathname();
  const walkthrough = useWalkthrough();
  return (
    <header className="shell-header">
      <Link className="wordmark" href="/" aria-label="HitBite overview">
        <span className="brand-mark" aria-hidden="true">
          h
        </span>
        HitBite<span className="testnet-tag">TESTNET</span>
      </Link>
      <nav aria-label="Main navigation">
        {[
          ["/", "Overview"],
          ["/app", "The app"],
          ["/transparency", "Transparency"],
          ["/admin", "Admin"],
        ].map(([href, label]) => (
          <Link
            key={href}
            href={href!}
            aria-current={path === href ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      <label className="toggle">
        <input
          type="checkbox"
          checked={walkthrough}
          onChange={(e) => {
            localStorage.setItem(
              "hitbite.walkthrough",
              String(e.target.checked),
            );
            window.dispatchEvent(new Event("walkthrough"));
          }}
        />
        <span>Walkthrough</span>
      </label>
    </header>
  );
}
export function useSnapshot() {
  const { address } = useAccount();
  return useQuery({
    queryKey: ["chain", address],
    queryFn: () => snapshot(address),
    refetchInterval: 20000,
  });
}
export function useNav() {
  return useQuery({
    queryKey: ["nav"],
    queryFn: async () => {
      const r = await fetch("/data/nav.json", { cache: "no-store" });
      if (!r.ok) throw new Error("NAV snapshot is unavailable.");
      return (await r.json()) as NavData;
    },
    refetchInterval: 60000,
  });
}
export function Status({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "pending";
}) {
  return (
    <span className={`status ${tone}`}>
      <span aria-hidden="true" />
      {children}
    </span>
  );
}
export function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
}) {
  return (
    <div className="metric">
      <span className="eyebrow small">{label}</span>
      <div className="metric-value">{value}</div>
      {detail && <div className="caption muted">{detail}</div>}
    </div>
  );
}
export function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div className="notice" role="status">
      {children}
    </div>
  );
}
