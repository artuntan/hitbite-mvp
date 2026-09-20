"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useQuery } from "@tanstack/react-query";
import { config, snapshot, short, units, type NavData } from "@/lib/chain";

export function ProductSymbol() {
  return (
    <Image
      className="product-symbol"
      src="/brand/hbtrs.png"
      alt=""
      width={40}
      height={40}
      sizes="40px"
      loading="eager"
      draggable={false}
    />
  );
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
export function Icon({
  name,
  className = "",
}: {
  name: "wallet" | "check" | "chevron" | "arrow";
  className?: string;
}) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "wallet" ? (
        <>
          <path d="M20 8V6a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v10H6a3 3 0 0 1-3-3V7" />
          <path d="M20 12h-5v5h5" />
          <path d="M16.5 14.5h.01" />
        </>
      ) : name === "check" ? (
        <path d="m5 12 4 4L19 6" />
      ) : name === "chevron" ? (
        <path d="m8 10 4 4 4-4" />
      ) : (
        <>
          <path d="M5 12h14" />
          <path d="m14 7 5 5-5 5" />
        </>
      )}
    </svg>
  );
}
export function Header() {
  const path = usePathname();
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const reveal = Math.min(1, Math.max(0, (window.scrollY - 8) / 72));
      header.current?.style.setProperty("--header-reveal", String(reveal));
    };
    const scroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", scroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", scroll);
      cancelAnimationFrame(frame);
    };
  }, [path]);
  const { address, chainId } = useAccount();
  const { data, error } = useSnapshot();
  const connected = !!address && chainId === config.chain.id;
  const value =
    connected && data?.tokens !== undefined
      ? (data.tokens * data.nav) / 10n ** 18n
      : undefined;
  return (
    <header className="shell-header" ref={header}>
      <Link
        className="wordmark"
        href="/app"
        aria-label="HitBite app"
        draggable={false}
      >
        <Image
          className="brand-logo"
          src="/brand/hitbite.avif"
          alt="HitBite"
          width={512}
          height={151}
          loading="eager"
          draggable={false}
          unoptimized
        />
      </Link>
      <nav aria-label="Main navigation">
        <Link
          href="/transparency"
          aria-current={path === "/transparency" ? "page" : undefined}
        >
          Transparency
        </Link>
        <button
          className="position-trigger"
          popoverTarget="position-summary"
          aria-label="Your position"
        >
          <span className="position-avatar">
            <Icon name="wallet" />
          </span>
          <span className="position-trigger-copy">
            <span>Your position</span>
            <strong>
              {!address
                ? "Not connected"
                : !connected
                  ? "Switch network"
                  : error
                    ? "Unavailable"
                    : `${units(value)} USDC`}
            </strong>
          </span>
          <Icon name="chevron" />
        </button>
      </nav>
      <div id="position-summary" className="position-popover" popover="auto">
        <div className="section-heading">
          <h2>Your position</h2>
          <span className="testnet-tag">TESTNET</span>
        </div>
        {connected ? (
          <>
            <p className="position-wallet mono">{short(address)}</p>
            <strong className="position-value">
              {units(value)} <small>USDC</small>
            </strong>
            <p className="caption muted">{units(data?.tokens, 18, 6)} hbTRS</p>
            {error ? (
              <p role="status" className="error">
                Balances are temporarily unavailable.
              </p>
            ) : (
              <dl className="data-list">
                <div>
                  <dt>Wallet balance</dt>
                  <dd>{units(data?.usdc)} USDC</dd>
                </div>
                <div>
                  <dt>Claimable coupons</dt>
                  <dd>{units(data?.coupon, 6, 6)} USDC</dd>
                </div>
                <div>
                  <dt>NAV / token</dt>
                  <dd>{units(data?.nav, 6, 6)} USDC</dd>
                </div>
                <div>
                  <dt>Verification</dt>
                  <dd>
                    <Status tone={data?.verified ? "good" : "neutral"}>
                      {data?.verified ? "Verified" : "Not verified"}
                    </Status>
                  </dd>
                </div>
              </dl>
            )}
          </>
        ) : (
          <p className="muted">
            {address
              ? `Switch to ${config.chain.name} to see your position.`
              : "Connect your wallet to see your balance and coupons."}
          </p>
        )}
        <WalletButton />
        {(data?.issuer || data?.oracle || data?.registrar) && (
          <Link
            className="operator-link"
            href="/admin"
            onClick={() =>
              document.getElementById("position-summary")?.hidePopover()
            }
          >
            Open admin →
          </Link>
        )}
      </div>
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
