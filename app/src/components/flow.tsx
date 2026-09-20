"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useAccount } from "wagmi";
import type { TransactionReceipt } from "viem";
import { config, deployment, units, type Snapshot } from "@/lib/chain";
import { WalletButton, Icon, ProductSymbol, useSnapshot, Alert } from "./ui";
import { Verify } from "./verify";
import { Subscribe } from "./investment-forms";
import { Portfolio } from "./portfolio";

const subscribeToWorkspace = (notify: () => void) => {
  window.addEventListener("storage", notify);
  window.addEventListener("hitbite-workspace", notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener("hitbite-workspace", notify);
  };
};
function rememberWorkspace(key: string) {
  try {
    localStorage.setItem(key, "true");
    window.dispatchEvent(new Event("hitbite-workspace"));
  } catch {
    // Storage is optional; confirmed on-chain balances still open the workspace.
  }
}
export function Flow() {
  const { address, chainId } = useAccount();
  const { data, error, refetch } = useSnapshot();
  const connected = !!address && chainId === config.chain.id;
  if (connected && !data)
    return (
      <main className="page flow-page">
        <div className="flow-loading" role="status">
          <h1>
            {error ? "Your position is unavailable." : "Loading your position…"}
          </h1>
          {error && (
            <button className="secondary" onClick={() => void refetch()}>
              Try again
            </button>
          )}
        </div>
      </main>
    );
  return (
    <InvestorFlow
      key={`${address || "guest"}-${chainId}`}
      data={data}
      connected={connected}
      error={!!error}
      retry={() => void refetch()}
    />
  );
}
function InvestorFlow({
  data,
  connected,
  error,
  retry,
}: {
  data?: Snapshot;
  connected: boolean;
  error: boolean;
  retry: () => void;
}) {
  const { address } = useAccount();
  const storageKey = `hitbite.workspace.${config.chain.id}.${deployment?.addresses.HBToken.toLowerCase()}.${address?.toLowerCase()}`;
  // This is a per-wallet presentation preference, never an eligibility check.
  const remembered = useSyncExternalStore(
    subscribeToWorkspace,
    () => {
      try {
        return localStorage.getItem(storageKey) === "true";
      } catch {
        return false;
      }
    },
    () => false,
  );
  const [receipt, setReceipt] = useState<TransactionReceipt>();
  const [invested, setInvested] = useState(false);
  const hasPosition = connected && !!(data?.tokens || data?.coupon);
  useEffect(() => {
    if (hasPosition) rememberWorkspace(storageKey);
  }, [hasPosition, storageKey]);
  const complete = (confirmed: TransactionReceipt) => {
    setReceipt(confirmed);
    setInvested(true);
    rememberWorkspace(storageKey);
  };
  if (connected && address && data && (hasPosition || remembered || invested)) {
    return (
      <Portfolio
        address={address}
        data={data}
        receipt={receipt}
        onComplete={complete}
        error={error}
        retry={retry}
      />
    );
  }
  const step = !connected ? 0 : !data?.verified ? 1 : 2;
  return (
    <main className="page flow-page">
      <h1 className="sr-only">Your HitBite investment</h1>
      <div className="investment-product">
        <div className="product-name">
          <ProductSymbol />
          <div>
            <strong>hbTRS</strong>
            <span>Simulated bond fund</span>
          </div>
        </div>
        <div className="product-nav">
          <span>Price / token</span>
          <strong data-testid="app-nav">
            {units(data?.nav, 6, 6)} <small>USDC</small>
          </strong>
        </div>
      </div>
      <div
        className="setup-progress"
        aria-label={`Account setup: step ${step + 1} of 3`}
      >
        <span>Account setup</span>
        <span className="mono">0{step + 1} / 03</span>
        <div aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className={i <= step ? "complete" : ""} />
          ))}
        </div>
      </div>
      <section
        className="card active-card"
        aria-label={
          ["Connect wallet", "Verify eligibility", "First subscription"][step]
        }
      >
        {error && (
          <Alert>
            Live balances are unavailable.{" "}
            <button className="text-button" onClick={retry}>
              Retry
            </button>
          </Alert>
        )}
        {step === 0 ? (
          <ConnectStep />
        ) : (
          data &&
          (step === 1 ? (
            <Verify verified={false} country={data.country} onNext={retry} />
          ) : (
            <Subscribe data={data} onComplete={complete} />
          ))
        )}
      </section>
      <p className="flow-network">
        <span className="live-dot" />
        {config.chain.name}
        <span aria-hidden="true">·</span>Test funds only
      </p>
    </main>
  );
}
function ConnectStep() {
  return (
    <div className="connect-step">
      <span className="welcome-icon">
        <Icon name="wallet" />
      </span>
      <h2>Connect your wallet.</h2>
      <p className="step-description">
        Subscribe to hbTRS with test USDC on Arc.
      </p>
      <WalletButton />
      <p className="connect-faucet">
        Need test USDC?{" "}
        <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">
          Get funds ↗
        </a>
      </p>
    </div>
  );
}
