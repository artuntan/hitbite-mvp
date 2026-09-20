"use client";
import { useState } from "react";
import { useAccount } from "wagmi";
import { erc20Abi, formatUnits, type TransactionReceipt } from "viem";
import { hBTokenAbi } from "@hitbite/config/abi";
import { copy } from "@hitbite/config/copy";
import { amount, config, deployment, units, type Snapshot } from "@/lib/chain";
import { Caption, WalletButton, Icon, useSnapshot, Alert } from "./ui";
import { Action, Receipt } from "./action";
import { Verify } from "./verify";
import { Activity } from "./activity";

const steps = ["Connect", "Verify", "Subscribe", "Hold", "Redeem"];
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
  const [active, setActive] = useState(
    !connected ? 0 : !data?.verified ? 1 : data.tokens ? 3 : 2,
  );
  const [activityOpen, setActivityOpen] = useState(false);
  return (
    <main className="page flow-page">
      <h1 className="sr-only">Your HitBite investment</h1>
      <div className="investment-product">
        <div className="product-name">
          <span className="product-symbol" aria-hidden="true">
            hB
          </span>
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
      <nav className="stepper" aria-label="Investment steps">
        {steps.map((title, i) => (
          <button
            className={`step${active === i ? " active" : ""}`}
            key={title}
            onClick={() => setActive(i)}
            disabled={!connected && i > 0}
            aria-current={active === i ? "step" : undefined}
          >
            <span className="step-number">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span>{title}</span>
          </button>
        ))}
      </nav>
      <section
        className="card active-card"
        aria-label={`${steps[active]} step`}
      >
        {error && (
          <Alert>
            Live balances are unavailable.{" "}
            <button className="text-button" onClick={retry}>
              Retry
            </button>
          </Alert>
        )}
        {active === 0 ? (
          <ConnectStep
            connected={connected}
            onNext={() => setActive(data?.verified ? 2 : 1)}
          />
        ) : !connected || !data ? (
          <WalletButton />
        ) : active === 1 ? (
          <Verify
            verified={data.verified ?? false}
            country={data.country}
            onNext={() => setActive(2)}
          />
        ) : active === 2 ? (
          <Subscribe data={data} onNext={() => setActive(3)} />
        ) : active === 3 ? (
          <Hold
            data={data}
            onNext={() => setActive(4)}
            onSubscribe={() => setActive(2)}
          />
        ) : (
          <Redeem data={data} onNext={() => setActive(3)} />
        )}
      </section>
      {connected && address && (
        <details
          className="flow-activity"
          onToggle={(e) => setActivityOpen(e.currentTarget.open)}
        >
          <summary>
            Recent activity <Icon name="chevron" />
          </summary>
          {activityOpen && <Activity address={address} />}
        </details>
      )}
      <p className="flow-network">
        <span className="live-dot" />
        {config.chain.name}
        <span aria-hidden="true">·</span>Test funds only
      </p>
    </main>
  );
}
function ConnectStep({
  connected,
  onNext,
}: {
  connected: boolean;
  onNext: () => void;
}) {
  return (
    <div className="connect-step">
      <span className={`welcome-icon${connected ? " connected" : ""}`}>
        <Icon name={connected ? "check" : "wallet"} />
      </span>
      <h2>{connected ? "Wallet connected." : "Connect your wallet."}</h2>
      <p className="step-description">
        {connected
          ? "Your next step is ready."
          : "Subscribe to hbTRS with test USDC on Arc."}
      </p>
      <Caption>
        Connecting shares your public address. It does not move funds. Use a
        browser wallet or your mobile wallet’s browser.
      </Caption>
      {connected ? (
        <button className="primary-action" onClick={onNext}>
          Continue <Icon name="arrow" />
        </button>
      ) : (
        <WalletButton />
      )}
      <p className="connect-faucet">
        Need test USDC?{" "}
        <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">
          Get funds ↗
        </a>
      </p>
      <Caption>{copy.gasNotice} Choose Arc Testnet in the faucet.</Caption>
    </div>
  );
}
function Completion({
  title,
  description,
  receipt,
  onNext,
}: {
  title: string;
  description: string;
  receipt: TransactionReceipt;
  onNext: () => void;
}) {
  return (
    <div className="completion">
      <span className="completion-icon">
        <Icon name="check" />
      </span>
      <h2>{title}</h2>
      <p className="step-description">{description}</p>
      <Receipt receipt={receipt} />
      <button className="primary-action" onClick={onNext}>
        View your position <Icon name="arrow" />
      </button>
    </div>
  );
}
function Subscribe({ data, onNext }: { data: Snapshot; onNext: () => void }) {
  const [input, setInput] = useState("1");
  const [completed, setCompleted] = useState<TransactionReceipt>();
  const [approvalReceipt, setApprovalReceipt] = useState<TransactionReceipt>();
  const value = amount(input);
  const preview = value ? (value * 10n ** 18n) / data.nav : 0n;
  const d = deployment!;
  const reason = !data.verified
    ? "Verify your wallet before subscribing."
    : data.paused
      ? "Subscriptions are paused by the issuer."
      : !value
        ? "Enter a positive USDC amount."
        : value > (data.usdc ?? 0n) - 50_000n
          ? "Keep 0.05 USDC for gas. Lower the amount or use the faucet."
          : preview === 0n
            ? "This amount is too small."
            : undefined;
  const approved = !!value && (data.allowance ?? 0n) >= value;
  if (completed)
    return (
      <Completion
        title="Subscription complete."
        description="Your hbTRS tokens are now in your wallet."
        receipt={completed}
        onNext={onNext}
      />
    );
  return (
    <>
      <h2>Subscribe to hbTRS.</h2>
      <p className="step-description">Choose how much USDC to invest.</p>
      <label className="amount-label">
        <span>
          Amount
          <span className="input-balance">
            Available: {units(data.usdc)} USDC
          </span>
        </span>
        <div className="amount-input">
          <input
            inputMode="decimal"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="USDC amount"
            autoComplete="off"
          />
          <span>USDC</span>
        </div>
      </label>
      <dl className="data-list preview">
        <div>
          <dt>You receive</dt>
          <dd>
            {units(preview, 18, 6)} <span>hbTRS</span>
          </dd>
        </div>
      </dl>
      <details className="transaction-details">
        <summary>
          Price & fees <Icon name="chevron" />
        </summary>
        <dl className="data-list">
          <div>
            <dt>NAV / token</dt>
            <dd>{units(data.nav, 6, 6)} USDC</dd>
          </div>
          <div>
            <dt>Subscription fee</dt>
            <dd>0 USDC</dd>
          </div>
        </dl>
        <p className="caption muted">
          Estimates use the current NAV. Final amounts use NAV at confirmation.{" "}
          {copy.gasNotice}
        </p>
      </details>
      <div className="approval-progress" aria-label="Subscription transactions">
        <span className={approved ? "done" : "current"}>
          {approved ? <Icon name="check" /> : <span>1</span>} Approve USDC
        </span>
        <span className={approved ? "current" : ""}>
          <span>2</span> Subscribe
        </span>
      </div>
      <Action
        key={approved ? "subscribe" : "approve"}
        compact
        title={approved ? "Subscribe" : "Approve USDC"}
        contract={approved ? "HBToken" : "USDC"}
        fn={approved ? "subscribe" : "approve"}
        address={approved ? d.addresses.HBToken : d.addresses.USDC}
        abi={approved ? hBTokenAbi : erc20Abi}
        args={approved ? [value ?? 0n] : [d.addresses.HBToken, value ?? 0n]}
        description={
          approved
            ? "Confirm to exchange your USDC for hbTRS."
            : `Allow exactly ${value ? formatUnits(value, 6) : "0"} USDC. This step moves no funds.`
        }
        disabled={reason}
        onSuccess={approved ? setCompleted : setApprovalReceipt}
      />
      {approved && approvalReceipt && (
        <details className="transaction-details approval-receipt">
          <summary>
            Approval receipt <Icon name="chevron" />
          </summary>
          <Receipt receipt={approvalReceipt} />
        </details>
      )}
    </>
  );
}
function Hold({
  data,
  onNext,
  onSubscribe,
}: {
  data: Snapshot;
  onNext: () => void;
  onSubscribe: () => void;
}) {
  const hasTokens = !!data.tokens;
  return (
    <>
      <h2>Your investment.</h2>
      <div className="hold-balance">
        <strong>
          {units(((data.tokens ?? 0n) * data.nav) / 10n ** 18n)}{" "}
          <small>USDC</small>
        </strong>
        <span>{units(data.tokens, 18, 6)} hbTRS</span>
      </div>
      <dl className="data-list coupon-summary">
        <div>
          <dt>Claimable coupons</dt>
          <dd>{units(data.coupon, 6, 6)} USDC</dd>
        </div>
      </dl>
      <Action
        compact
        secondary={!data.coupon}
        title="Claim coupons"
        contract="HBToken"
        fn="claimCoupon"
        address={deployment!.addresses.HBToken}
        abi={hBTokenAbi}
        description="Coupons are paid to your wallet in USDC."
        disabled={
          data.paused
            ? "Claims are paused by the issuer."
            : !data.coupon
              ? "No coupons available. Check back after the next funded distribution."
              : undefined
        }
      />
      <div className="position-actions">
        <button className={hasTokens ? "secondary" : ""} onClick={onSubscribe}>
          Subscribe
        </button>
        <button
          className={data.coupon ? "secondary" : ""}
          onClick={onNext}
          disabled={!hasTokens}
        >
          Redeem <Icon name="arrow" />
        </button>
      </div>
      <Caption>
        Position value uses the published simulated NAV. Coupons are separate.
        These tokens have no claim on real bonds.
      </Caption>
    </>
  );
}
function Redeem({ data, onNext }: { data: Snapshot; onNext: () => void }) {
  const [input, setInput] = useState("");
  const [completed, setCompleted] = useState<TransactionReceipt>();
  const value = amount(input, 18);
  const out = value ? (value * data.nav) / 10n ** 18n : 0n;
  const reason = data.paused
    ? "Redemptions are paused by the issuer."
    : !value
      ? "Enter a token amount."
      : value > (data.tokens ?? 0n)
        ? "This exceeds your hbTRS balance."
        : out === 0n
          ? "This amount is too small."
          : out > data.liquidity
            ? "The vault cannot cover this amount. Reduce it or wait for funding."
            : undefined;
  if (completed)
    return (
      <Completion
        title="Redemption complete."
        description="Your USDC has been returned to your wallet."
        receipt={completed}
        onNext={onNext}
      />
    );
  return (
    <>
      <h2>Redeem your tokens.</h2>
      <p className="step-description">Exchange hbTRS back to USDC.</p>
      <label className="amount-label">
        <span>
          Amount
          <span className="input-balance">
            Available: {units(data.tokens, 18, 4)} hbTRS
          </span>
        </span>
        <div className="amount-input">
          <input
            inputMode="decimal"
            aria-label="hbTRS amount"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="0"
            autoComplete="off"
          />
          <span>hbTRS</span>
          <button
            type="button"
            className="max-button"
            aria-label="Use full token balance"
            onClick={() => setInput(formatUnits(data.tokens ?? 0n, 18))}
          >
            Max
          </button>
        </div>
      </label>
      <dl className="data-list preview">
        <div>
          <dt>You receive</dt>
          <dd>
            {units(out, 6, 6)} <span>USDC</span>
          </dd>
        </div>
      </dl>
      <details className="transaction-details">
        <summary>
          Price & liquidity <Icon name="chevron" />
        </summary>
        <dl className="data-list">
          <div>
            <dt>NAV / token</dt>
            <dd>{units(data.nav, 6, 6)} USDC</dd>
          </div>
          <div>
            <dt>Available liquidity</dt>
            <dd>{units(data.liquidity, 6, 6)} USDC</dd>
          </div>
        </dl>
        <p className="caption muted">
          Final amounts use NAV at confirmation. Accrued coupons remain
          claimable after redemption.
        </p>
      </details>
      <Action
        compact
        title="Redeem tokens"
        contract="HBToken"
        fn="redeem"
        address={deployment!.addresses.HBToken}
        abi={hBTokenAbi}
        args={[value ?? 0n]}
        description="Confirm to return your tokens and receive USDC."
        disabled={reason}
        onSuccess={setCompleted}
      />
      <p className="redemption-note">{copy.vaultNotice}</p>
    </>
  );
}
