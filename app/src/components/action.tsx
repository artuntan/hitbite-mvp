"use client";
import { useId, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import {
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  type Abi,
  type Address,
  type TransactionReceipt,
} from "viem";
import { hBTokenAbi, identityRegistryAbi } from "@hitbite/config/abi";
import { ARC_MIN_MAX_FEE_PER_GAS } from "@hitbite/config/chains";
import { client, config, short, txUrl } from "@/lib/chain";
import { Caption, Icon } from "./ui";

export function Receipt({ receipt }: { receipt: TransactionReceipt }) {
  const names = receipt.logs.flatMap((log) => {
    for (const abi of [hBTokenAbi, identityRegistryAbi, erc20Abi])
      try {
        const event = decodeEventLog({
          abi,
          data: log.data,
          topics: log.topics,
        });
        return [event.eventName];
      } catch {}
    return [];
  });
  return (
    <div className="receipt" data-testid="receipt">
      <span className="receipt-state">
        <Icon name="check" />
        {receipt.status === "success" ? "Confirmed" : "Reverted"}
      </span>
      <a
        className="mono hash"
        href={txUrl(receipt.transactionHash)}
        target="_blank"
        rel="noreferrer"
      >
        {short(receipt.transactionHash)} ↗
      </a>
      <span className="caption">
        Block {receipt.blockNumber.toString()} ·{" "}
        {Array.from(new Set(names)).join(", ") || "No contract events"}
      </span>
    </div>
  );
}
export function Action({
  title,
  description,
  contract,
  fn,
  address,
  abi,
  args = [],
  disabled,
  onSuccess,
  onBusyChange,
  label,
  compact = false,
  secondary = false,
  inline = false,
}: {
  title: string;
  description: string;
  contract: string;
  fn: string;
  address: Address;
  abi: Abi;
  args?: readonly unknown[];
  disabled?: string;
  onSuccess?: (receipt: TransactionReceipt) => void;
  onBusyChange?: (busy: boolean) => void;
  label?: string;
  compact?: boolean;
  secondary?: boolean;
  inline?: boolean;
}) {
  const descriptionId = useId();
  const { address: account, chainId } = useAccount();
  const { data: wallet } = useWalletClient();
  const query = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<TransactionReceipt>();
  const [error, setError] = useState("");
  const [pendingHash, setPendingHash] = useState<string>();
  const reason =
    disabled ||
    (!account
      ? "Connect a wallet to continue."
      : chainId !== config.chain.id
        ? `Switch to ${config.chain.name} to continue.`
        : undefined);
  async function send() {
    if (reason || !wallet || !account) return;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    setReceipt(undefined);
    setPendingHash(undefined);
    let submittedHash: string | undefined;
    try {
      if (
        (await client.getChainId()) !== config.chain.id ||
        (await wallet.getChainId()) !== config.chain.id
      )
        throw new Error("Wrong testnet.");
      const data = encodeFunctionData({ abi, functionName: fn, args });
      const estimated = await client.estimateFeesPerGas();
      const floor =
        config.chainName === "arc-testnet" ? ARC_MIN_MAX_FEE_PER_GAS : 0n;
      const fees = {
        maxFeePerGas:
          estimated.maxFeePerGas > floor ? estimated.maxFeePerGas : floor,
        maxPriorityFeePerGas: estimated.maxPriorityFeePerGas,
      };
      const gas = await client.estimateGas({
        account,
        to: address,
        data,
        ...fees,
      });
      const hash = await wallet.sendTransaction({
        account,
        to: address,
        data,
        chain: config.chain,
        gas: (gas * 12n) / 10n,
        ...fees,
      });
      submittedHash = hash;
      setPendingHash(hash);
      const confirmed = await client.waitForTransactionReceipt({
        hash,
        timeout: 120000,
      });
      setReceipt(confirmed);
      if (confirmed.status !== "success")
        throw new Error("Transaction reverted. No action was completed.");
      await query.invalidateQueries({ queryKey: ["chain"] });
      await query.invalidateQueries({ queryKey: ["activity"] });
      onSuccess?.(confirmed);
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      setError(
        /reject|denied/i.test(message)
          ? "Signature declined. You can try again."
          : /insufficient/i.test(message)
            ? "Insufficient balance or vault liquidity. Keep USDC for gas."
            : submittedHash
              ? "Confirmation is delayed. Check the transaction link before trying again."
              : "The transaction could not complete. Refresh the balances and check your wallet.",
      );
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <section
      className={`action-card${compact ? " action-compact" : ""}${inline ? " action-inline" : ""}`}
      aria-busy={busy}
    >
      {!compact && <h3>{title}</h3>}
      <p className="action-description" id={descriptionId}>
        {inline ? reason || description : description}
      </p>
      {inline && (
        <span className="sr-only" role="status">
          {busy
            ? pendingHash
              ? "Confirming your coupon claim."
              : "Confirm the coupon claim in your wallet."
            : receipt?.status === "success"
              ? "Coupons claimed successfully."
              : ""}
        </span>
      )}
      <Caption>
        Calls {contract}.{fn}() at {short(address)}. You approve it in your
        wallet.
      </Caption>
      <button
        className={secondary ? "secondary" : undefined}
        aria-label={inline && !busy ? title : undefined}
        aria-describedby={descriptionId}
        onClick={send}
        disabled={Boolean(reason) || busy || !wallet}
      >
        {busy
          ? receipt?.status === "success"
            ? "Confirmed"
            : pendingHash
              ? "Confirming…"
              : "Check your wallet…"
          : label || title}
        {inline && !busy && <Icon name="arrow" />}
      </button>
      {reason && !receipt && !inline && (
        <p className="caption muted action-reason">{reason}</p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {pendingHash && !receipt && (
        <a
          className="pending-link caption"
          href={txUrl(pendingHash)}
          target="_blank"
          rel="noreferrer"
        >
          View pending transaction ↗
        </a>
      )}
      {receipt &&
        (inline ? (
          <details className="inline-confirmation">
            <summary>
              <Icon name="check" />
              <span>
                {receipt.status === "success"
                  ? "Claim confirmed"
                  : "Transaction reverted"}
              </span>
              <Icon name="chevron" />
            </summary>
            <Receipt receipt={receipt} />
          </details>
        ) : (
          <Receipt receipt={receipt} />
        ))}
    </section>
  );
}
