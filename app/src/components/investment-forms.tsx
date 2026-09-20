"use client";
import { useState } from "react";
import { erc20Abi, formatUnits, type TransactionReceipt } from "viem";
import { hBTokenAbi } from "@hitbite/config/abi";
import { copy } from "@hitbite/config/copy";
import { amount, deployment, units, type Snapshot } from "@/lib/chain";
import { Icon } from "./ui";
import { Action, Receipt } from "./action";

type OrderProps = {
  data: Snapshot;
  onComplete: (receipt: TransactionReceipt) => void;
  embedded?: boolean;
  onBusyChange?: (busy: boolean) => void;
};
export function Subscribe({
  data,
  onComplete,
  embedded = false,
  onBusyChange,
}: OrderProps) {
  const [input, setInput] = useState(embedded ? "" : "1");
  const [busy, setBusy] = useState(false);
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
  return (
    <>
      {!embedded && (
        <>
          <h2>Subscribe to hbTRS.</h2>
          <p className="step-description">Choose how much USDC to invest.</p>
        </>
      )}
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
            disabled={busy}
            placeholder="0"
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
      <ol className="approval-progress" aria-label="Subscription transactions">
        <li
          className={approved ? "done" : "current"}
          aria-current={!approved ? "step" : undefined}
        >
          <span className="step-indicator" aria-hidden="true">
            {approved ? <Icon name="check" /> : "1"}
          </span>
          <span>
            Approve USDC
            {approved && <span className="sr-only">, complete</span>}
          </span>
        </li>
        <li
          className={approved ? "current" : ""}
          aria-current={approved ? "step" : undefined}
        >
          <span className="step-indicator" aria-hidden="true">
            2
          </span>
          <span>Subscribe</span>
        </li>
      </ol>
      <Action
        key={approved ? "subscribe" : "approve"}
        compact
        onBusyChange={(pending) => {
          setBusy(pending);
          onBusyChange?.(pending);
        }}
        title={approved ? "Subscribe" : "Approve USDC"}
        contract={approved ? "HBToken" : "USDC"}
        fn={approved ? "subscribe" : "approve"}
        address={approved ? d.addresses.HBToken : d.addresses.USDC}
        abi={approved ? hBTokenAbi : erc20Abi}
        args={approved ? [value ?? 0n] : [d.addresses.HBToken, value ?? 0n]}
        description={
          approved
            ? "Confirm to exchange your USDC for hbTRS."
            : value
              ? `Allow exactly ${formatUnits(value, 6)} USDC. This step moves no funds.`
              : "Approve USDC, then confirm your subscription."
        }
        disabled={busy ? "Waiting for confirmation." : reason}
        onSuccess={approved ? onComplete : setApprovalReceipt}
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

export function Redeem({
  data,
  onComplete,
  embedded = false,
  onBusyChange,
}: OrderProps) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
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
  return (
    <>
      {!embedded && (
        <>
          <h2>Redeem your tokens.</h2>
          <p className="step-description">Exchange hbTRS back to USDC.</p>
        </>
      )}
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
            disabled={busy}
            placeholder="0"
            aria-label="hbTRS amount"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoComplete="off"
          />
          <span>hbTRS</span>
          <button
            type="button"
            className="max-button"
            aria-label="Use full token balance"
            disabled={busy}
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
        onBusyChange={(pending) => {
          setBusy(pending);
          onBusyChange?.(pending);
        }}
        title="Redeem tokens"
        contract="HBToken"
        fn="redeem"
        address={deployment!.addresses.HBToken}
        abi={hBTokenAbi}
        args={[value ?? 0n]}
        description="Confirm to return your tokens and receive USDC."
        disabled={busy ? "Waiting for confirmation." : reason}
        onSuccess={onComplete}
      />
      <p className="redemption-note">{copy.vaultNotice}</p>
    </>
  );
}
