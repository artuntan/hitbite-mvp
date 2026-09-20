"use client";
import { useState } from "react";
import { useAccount } from "wagmi";
import { erc20Abi, formatUnits } from "viem";
import { hBTokenAbi } from "@hitbite/config/abi";
import { copy } from "@hitbite/config/copy";
import {
  amount,
  config,
  deployment,
  units,
  short,
  type Snapshot,
} from "@/lib/chain";
import { Caption, WalletButton, Status, useSnapshot, Alert } from "./ui";
import { Verify } from "./verify";
import { Action } from "./action";
import { Activity } from "./activity";

const steps = [
  ["Connect", "Your wallet, your access"],
  ["Verify", "A simulated eligibility check"],
  ["Subscribe", "Exchange USDC for hbTRS"],
  ["Hold", "See your tokens and coupons"],
  ["Redeem", "Return tokens for USDC"],
] as const;
export function Flow() {
  const { address, chainId } = useAccount();
  const { data, error, isPending, refetch } = useSnapshot();
  const [chosen, setChosen] = useState<number | null>(null);
  const auto =
    !address || chainId !== config.chain.id
      ? 0
      : !data?.verified
        ? 1
        : data.tokens === 0n
          ? 2
          : 3;
  const active = chosen ?? auto;
  const disconnected = !address || chainId !== config.chain.id;
  return (
    <main className="page flow-page">
      <div className="page-intro compact">
        <div>
          <p className="eyebrow">THE APP / {config.chain.name.toUpperCase()}</p>
          <h1>
            Your path from
            <br />
            USDC to hbTRS.
          </h1>
        </div>
        <WalletButton />
      </div>
      <div className="flow-layout">
        <aside className="stepper" aria-label="Investment steps">
          {steps.map(([title, description], i) => (
            <button
              className={`step ${active === i ? "active" : ""}`}
              key={title}
              onClick={() => setChosen(i)}
              aria-current={active === i ? "step" : undefined}
            >
              <span className="step-number">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>
                <strong>{title}</strong>
                <small>{description}</small>
              </span>
              {active === i && <span aria-hidden="true">↗</span>}
            </button>
          ))}
          <div className="stepper-note">
            <span className="eyebrow small">ONE SIMPLE FLOW</span>
            <p className="caption muted">
              Every action is yours to review.
              <br />
              Every receipt stays on-chain.
            </p>
          </div>
        </aside>
        <section className="flow-center">
          <div className="card active-card">
            <div className="step-topline">
              <span className="eyebrow small">
                STEP {String(active + 1).padStart(2, "0")} / 05
              </span>
              <span className="mono caption">hbTRS</span>
            </div>
            {error && (
              <Alert>
                Live balances are unavailable.{" "}
                <button className="text-button" onClick={() => void refetch()}>
                  Retry
                </button>
              </Alert>
            )}
            {active === 0 ? (
              <ConnectStep data={data} onNext={() => setChosen(1)} />
            ) : disconnected ? (
              <>
                <h2>Connect to continue.</h2>
                <p>Use a wallet on {config.chain.name} to open this step.</p>
                <WalletButton />
              </>
            ) : isPending ? (
              <p>Loading your on-chain position…</p>
            ) : !data ? (
              <p>Restore the RPC connection to continue.</p>
            ) : active === 1 ? (
              <Verify
                key={address}
                verified={data.verified ?? false}
                country={data.country}
                onNext={() => setChosen(2)}
              />
            ) : active === 2 ? (
              <Subscribe data={data} onNext={() => setChosen(3)} />
            ) : active === 3 ? (
              <Hold data={data} onNext={() => setChosen(4)} />
            ) : (
              <Redeem data={data} />
            )}
          </div>
          {active === 3 && address && <Activity address={address} />}
          <p className="flow-disclaimer caption">{copy.vaultNotice}</p>
        </section>
        <aside className="card position">
          <div className="section-heading">
            <h3>Your position</h3>
            <span className="position-dot" />
          </div>
          <p className="caption muted">
            {address ? short(address) : "Connect a wallet to begin"}
          </p>
          <div className="position-main">
            <span className="eyebrow small">hbTRS BALANCE</span>
            <strong>{units(data?.tokens, 18, 4)}</strong>
            <span className="caption muted">
              {data?.tokens !== undefined
                ? `${units((data.tokens * data.nav) / 10n ** 18n)} USDC at current NAV`
                : "Your tokens will appear here"}
            </span>
          </div>
          <dl className="data-list">
            <div>
              <dt>USDC balance</dt>
              <dd>{units(data?.usdc)}</dd>
            </div>
            <div>
              <dt>Accrued coupons</dt>
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
          <Caption>
            Your token value changes with the published simulated NAV. Coupons
            are separate claimable USDC.
          </Caption>
          <div className="position-bottom caption">
            {data ? (
              <>
                <span className="live-dot" /> Read at block{" "}
                {data.blockNumber.toString()}
              </>
            ) : (
              "Reading the testnet…"
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
function ConnectStep({
  data,
  onNext,
}: {
  data?: Snapshot;
  onNext: () => void;
}) {
  const { address, chainId } = useAccount();
  return (
    <>
      <h2>
        A wallet is all
        <br />
        you need to start.
      </h2>
      <p className="muted">
        Connect a browser wallet, then add a little test USDC. You stay in
        control of every transaction.
      </p>
      <Caption>
        Your wallet is your account. Connecting shares your public address and
        does not move funds.
      </Caption>
      <div className="connect-illustration" aria-hidden="true">
        <div className="wallet-glyph">
          <span>↗</span>
          <span className="mono">USDC</span>
        </div>
        <span className="illustration-line" />
        <div className="token-glyph">
          hb<span>TRS</span>
        </div>
      </div>
      <WalletButton />
      {address && chainId === config.chain.id && (
        <>
          <dl className="data-list">
            <div>
              <dt>Connected wallet</dt>
              <dd className="mono">{short(address)}</dd>
            </div>
            <div>
              <dt>USDC balance</dt>
              <dd>{units(data?.usdc, 6, 4)} USDC</dd>
            </div>
          </dl>
          <button onClick={onNext}>Continue to verify →</button>
        </>
      )}
      <div className="notice">
        <strong>Test funds. Real transactions.</strong>
        <p>{copy.gasNotice}</p>
        <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">
          Get test USDC from the Circle faucet ↗
        </a>
        <Caption>
          Select Arc Testnet, paste your public wallet address and request USDC.
        </Caption>
      </div>
      {!config.walletConnectProjectId && (
        <p className="caption muted">
          Use an installed browser wallet or open this app in your mobile
          wallet&apos;s browser.
        </p>
      )}
    </>
  );
}
function Subscribe({ data, onNext }: { data: Snapshot; onNext: () => void }) {
  const [input, setInput] = useState("1");
  const value = amount(input);
  const preview = value ? (value * 10n ** 18n) / data.nav : 0n;
  const d = deployment!;
  const reason = !data.verified
    ? "Verify your wallet before subscribing."
    : data.paused
      ? "Subscriptions are paused by the issuer."
      : !value
        ? "Enter a positive amount with up to 6 decimals."
        : value > (data.usdc ?? 0n) - 50_000n
          ? "Keep at least 0.05 USDC for gas. Lower the amount or use the faucet."
          : preview === 0n
            ? "The amount is too small to mint a token fraction."
            : undefined;
  const approved = !!value && (data.allowance ?? 0n) >= value;
  return (
    <>
      <h2>
        USDC in.
        <br />
        hbTRS in your wallet.
      </h2>
      <p className="muted">
        Subscribe at the current published NAV. Approving and subscribing are
        two separate transactions.
      </p>
      <label>
        Amount to subscribe
        <div className="amount-input">
          <input
            inputMode="decimal"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="USDC amount"
          />
          <span>USDC</span>
        </div>
      </label>
      <dl className="data-list preview">
        <div>
          <dt>You receive</dt>
          <dd>{units(preview, 18, 6)} hbTRS</dd>
        </div>
        <div>
          <dt>Current NAV</dt>
          <dd>{units(data.nav, 6, 6)} USDC</dd>
        </div>
        <div>
          <dt>Subscription fee</dt>
          <dd>0 USDC</dd>
        </div>
      </dl>
      <p className="caption muted">
        Estimate only. Execution uses the NAV at inclusion. {copy.gasNotice}
      </p>
      <Action
        title="1. Approve USDC"
        contract="USDC"
        fn="approve"
        address={d.addresses.USDC}
        abi={erc20Abi}
        args={[d.addresses.HBToken, value ?? 0n]}
        description={`Allow HBToken to spend exactly ${value ? formatUnits(value, 6) : "0"} USDC for your subscription.`}
        disabled={
          reason || (approved ? "This amount is already approved." : undefined)
        }
        label="Approve USDC"
      />
      <Action
        title="2. Subscribe"
        contract="HBToken"
        fn="subscribe"
        address={d.addresses.HBToken}
        abi={hBTokenAbi}
        args={[value ?? 0n]}
        description="Transfer the approved USDC to the vault and mint hbTRS to your verified wallet."
        disabled={
          reason ||
          (!approved ? "Complete the USDC approval first." : undefined)
        }
        label="Subscribe"
      />
      <button className="text-button next-link" onClick={onNext}>
        View your position →
      </button>
    </>
  );
}
function Hold({ data, onNext }: { data: Snapshot; onNext: () => void }) {
  return (
    <>
      <div className="section-heading">
        <h2>
          Your position,
          <br />
          in plain sight.
        </h2>
        <Status tone="good">On-chain</Status>
      </div>
      <div className="hold-balance">
        <span className="eyebrow small">YOU HOLD</span>
        <strong>
          {units(data.tokens, 18, 6)} <small>hbTRS</small>
        </strong>
        <span className="muted">
          {units(((data.tokens ?? 0n) * data.nav) / 10n ** 18n)} USDC at current
          NAV
        </span>
      </div>
      <Caption>
        hbTRS represents simulated fund units. These testnet tokens have no
        claim on real bonds.
      </Caption>
      <Action
        title="Claim coupons"
        contract="HBToken"
        fn="claimCoupon"
        address={deployment!.addresses.HBToken}
        abi={hBTokenAbi}
        description={`Receive ${units(data.coupon, 6, 6)} USDC from your accrued share of funded coupon distributions.`}
        disabled={
          data.paused
            ? "Claims are paused by the issuer."
            : !data.coupon
              ? "No coupons are available yet. The issuer must fund a distribution."
              : undefined
        }
      />
      <button className="text-button next-link" onClick={onNext}>
        Continue to redeem →
      </button>
    </>
  );
}
function Redeem({ data }: { data: Snapshot }) {
  const [input, setInput] = useState("");
  const value = amount(input, 18);
  const out = value ? (value * data.nav) / 10n ** 18n : 0n;
  const reason = data.paused
    ? "Redemptions are paused by the issuer."
    : !value
      ? "Enter a positive token amount with up to 18 decimals."
      : value > (data.tokens ?? 0n)
        ? "This exceeds your hbTRS balance."
        : out === 0n
          ? "The amount is too small to receive one micro-USDC."
          : out > data.liquidity
            ? "The vault cannot cover this redemption. Reduce the amount or wait for admin funding."
            : undefined;
  return (
    <>
      <h2>Back to USDC.</h2>
      <p className="muted">
        Return your hbTRS tokens to the contract. They are burned and the vault
        pays USDC at the current NAV.
      </p>
      <label>
        Tokens to redeem
        <div className="amount-input">
          <input
            inputMode="decimal"
            aria-label="hbTRS amount"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <span>hbTRS</span>
        </div>
      </label>
      <button
        className="text-button"
        onClick={() => setInput(formatUnits(data.tokens ?? 0n, 18))}
      >
        Use full token balance
      </button>
      <dl className="data-list preview">
        <div>
          <dt>You receive</dt>
          <dd>{units(out, 6, 6)} USDC</dd>
        </div>
        <div>
          <dt>Available vault liquidity</dt>
          <dd>{units(data.liquidity, 6, 6)} USDC</dd>
        </div>
      </dl>
      <Alert>{copy.vaultNotice}</Alert>
      <p className="caption muted">
        Estimate only. Execution uses NAV at inclusion. Accrued coupons remain
        claimable after redemption.
      </p>
      <Action
        title="Redeem tokens"
        contract="HBToken"
        fn="redeem"
        address={deployment!.addresses.HBToken}
        abi={hBTokenAbi}
        args={[value ?? 0n]}
        description={`Burn ${value ? formatUnits(value, 18) : "0"} hbTRS and receive the resulting USDC from the vault.`}
        disabled={reason}
      />
    </>
  );
}
