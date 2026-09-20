"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { type Address, type TransactionReceipt } from "viem";
import { hBTokenAbi } from "@hitbite/config/abi";
import { config, deployment, short, units, type Snapshot } from "@/lib/chain";
import { Action, Receipt } from "./action";
import { Activity } from "./activity";
import { Subscribe, Redeem } from "./investment-forms";
import { Alert, ProductSymbol, Status } from "./ui";

export function Portfolio({
  address,
  data,
  receipt,
  onComplete,
  error,
  retry,
}: {
  address: Address;
  data: Snapshot;
  receipt?: TransactionReceipt;
  onComplete: (receipt: TransactionReceipt) => void;
  error: boolean;
  retry: () => void;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, []);
  const [order, setOrder] = useState<"subscribe" | "redeem">("subscribe");
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderNumber, setOrderNumber] = useState(0);
  const position = ((data.tokens ?? 0n) * data.nav) / 10n ** 18n;
  const complete = (confirmed: TransactionReceipt) => {
    onComplete(confirmed);
    setOrderNumber((n) => n + 1);
  };
  const updated = new Date(Number(data.navTime) * 1000).toISOString();
  return (
    <main className="page portfolio-page">
      <div className="portfolio-heading">
        <div>
          <span className="workspace-label">INVESTMENT ACCOUNT</span>
          <h1 ref={title} tabIndex={-1}>
            Portfolio
          </h1>
        </div>
        <div className="account-status">
          <span className="mono">{short(address)}</span>
          <Status tone={data.verified ? "good" : "neutral"}>
            {data.verified ? "Verified" : "Not verified"}
          </Status>
        </div>
      </div>
      {error && (
        <Alert>
          Balances could not refresh.{" "}
          <button className="text-button" onClick={retry}>
            Retry
          </button>
        </Alert>
      )}
      {data.paused && (
        <Alert>
          Transactions are paused by the issuer. Your balances remain visible.
        </Alert>
      )}
      <section className="portfolio-metrics" aria-label="Account balances">
        <div className="portfolio-metric primary-metric">
          <span>Position value</span>
          <strong data-testid="portfolio-value">
            {units(position, 6, 6)} <small>USDC</small>
          </strong>
          <span>{units(data.tokens, 18, 6)} hbTRS at current NAV</span>
        </div>
        <div className="portfolio-metric">
          <span>Wallet balance</span>
          <strong>
            {units(data.usdc, 6, 6)} <small>USDC</small>
          </strong>
          <span>Available to subscribe · includes gas</span>
        </div>
        <section
          className={`portfolio-metric coupon-metric${data.coupon && !data.paused ? " claim-ready" : ""}`}
          aria-label="Claimable coupons"
        >
          <span>Claimable coupons</span>
          <strong data-testid="portfolio-coupons">
            {units(data.coupon, 6, 6)} <small>USDC</small>
          </strong>
          <Action
            compact
            inline
            secondary={!data.coupon || data.paused}
            title="Claim coupons"
            label="Claim"
            fn="claimCoupon"
            address={deployment!.addresses.HBToken}
            abi={hBTokenAbi}
            description="Ready to withdraw to your wallet."
            disabled={
              data.paused
                ? "Claims are paused by the issuer."
                : !data.coupon
                  ? "No coupons to claim yet."
                  : undefined
            }
          />
        </section>
      </section>
      <div className="terminal-grid">
        <div className="terminal-main">
          <section
            className="card terminal-card positions-card"
            aria-label="Your holdings"
          >
            <div className="terminal-section-heading">
              <h2>Positions</h2>
              <span className="workspace-label">01 ASSET</span>
            </div>
            <div className="position-instrument">
              <div className="product-name">
                <ProductSymbol />
                <div>
                  <strong>hbTRS</strong>
                  <span>Simulated sovereign bond fund</span>
                </div>
              </div>
              <span className="asset-network">ARC</span>
            </div>
            <dl className="position-grid">
              <div>
                <dt>Quantity</dt>
                <dd>
                  {units(data.tokens, 18, 6)}
                  <small>hbTRS</small>
                </dd>
              </div>
              <div>
                <dt>NAV / token</dt>
                <dd data-testid="app-nav">
                  {units(data.nav, 6, 6)}
                  <small>USDC</small>
                </dd>
              </div>
              <div>
                <dt>Value</dt>
                <dd>
                  {units(position, 6, 6)}
                  <small>USDC</small>
                </dd>
              </div>
            </dl>
            <div className="settlement-data">
              <div>
                <span>NAV published</span>
                <time dateTime={updated} className="mono">
                  {updated.slice(0, 10)} · {updated.slice(11, 16)} UTC
                </time>
              </div>
              <div>
                <span>Vault liquidity</span>
                <span className="mono">{units(data.liquidity, 6, 6)} USDC</span>
              </div>
            </div>
            <div className="position-card-footer">
              <span>Simulated portfolio</span>
              <Link href="/transparency">Fund data & contracts ↗</Link>
            </div>
          </section>
          <Activity address={address} table />
        </div>
        <div className="terminal-side">
          <section
            className="card terminal-card order-card"
            aria-label="Place an order"
          >
            <div className="terminal-section-heading">
              <h2>Order</h2>
              <span className="workspace-label">hbTRS / USDC</span>
            </div>
            <div className="order-tabs" role="tablist" aria-label="Order type">
              {(["subscribe", "redeem"] as const).map((kind) => (
                <button
                  key={kind}
                  id={`tab-${kind}`}
                  type="button"
                  role="tab"
                  aria-selected={order === kind}
                  disabled={orderBusy}
                  aria-controls="order-panel"
                  tabIndex={order === kind ? 0 : -1}
                  onClick={() => setOrder(kind)}
                  onKeyDown={(e) => {
                    if (orderBusy) return;
                    if (
                      ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                    ) {
                      e.preventDefault();
                      const next =
                        e.key === "Home"
                          ? "subscribe"
                          : e.key === "End"
                            ? "redeem"
                            : order === "subscribe"
                              ? "redeem"
                              : "subscribe";
                      setOrder(next);
                      document.getElementById(`tab-${next}`)?.focus();
                    }
                  }}
                >
                  {kind === "subscribe" ? "Subscribe" : "Redeem"}
                </button>
              ))}
            </div>
            <div
              id="order-panel"
              role="tabpanel"
              aria-labelledby={`tab-${order}`}
              key={`${order}-${orderNumber}`}
            >
              {order === "subscribe" ? (
                <Subscribe
                  data={data}
                  embedded
                  onComplete={complete}
                  onBusyChange={setOrderBusy}
                />
              ) : (
                <Redeem
                  data={data}
                  embedded
                  onComplete={complete}
                  onBusyChange={setOrderBusy}
                />
              )}
            </div>
            {receipt && (
              <div className="latest-receipt" role="status">
                <span>Latest confirmation</span>
                <Receipt receipt={receipt} />
              </div>
            )}
          </section>
        </div>
      </div>
      <div className="workspace-status">
        <span>
          <span className={`live-dot${error ? " stale" : ""}`} />
          {error ? "Refresh unavailable" : "Synced"}
          <span className="mono">#{data.blockNumber.toString()}</span>
        </span>
        <span>{config.chain.name} · Test funds only</span>
      </div>
    </main>
  );
}
