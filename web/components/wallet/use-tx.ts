"use client";

/**
 * One hook for every write the app makes.
 *
 * It owns the state machine in `lib/tx.ts`, the wallet round trip, the receipt wait, the toast, and
 * the translation of a failure into something worth reading. A page describes *what* it wants to
 * send; everything about *how it goes wrong* lives here, so no two screens can disagree about it.
 *
 * The order inside `send` is deliberate:
 *
 *  1. **Simulate.** `eth_call` against the current state, decoded against the contract's own ABI.
 *     This is where a custom error is available with its arguments intact — `BelowMinimum(100, 40)`
 *     rather than "execution reverted" — so the person finds out *before* they sign, and before any
 *     gas is spent. Skippable with `simulate: false`, and skipped silently when no public client is
 *     available, because a missing simulation must never be the reason a valid write is blocked.
 *  2. **Sign and broadcast.** A rejection here is reported as a rejection, not as an error.
 *  3. **Wait for the receipt** over the app's own transport, not the wallet's. That is what lets a
 *     disconnect mid-transaction keep resolving: the transaction is the chain's business once it is
 *     broadcast, and this page carries on watching it.
 *
 * A receipt that comes back `reverted` despite a clean simulation gets a plainly-worded failure
 * rather than a guess: a receipt carries no reason, and replaying the call against a later state
 * could produce a *different* error, which would be worse than admitting the reason is unknown.
 */

import * as React from "react";
import { toast } from "sonner";
import type { Abi, Address, Hex, TransactionReceipt } from "viem";
import { useAccount, usePublicClient, useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import type { ContractName } from "@/lib/generated/abis";
import {
  TX_IDLE,
  decodeTxError,
  describeTxPhase,
  isBusyPhase,
  revertedReceiptFailure,
  txExplorerLink,
  txHashOf,
  txReducer,
  walletDisconnectedFailure,
  type ExplorerLink,
  type TxFailure,
  type TxPhase,
  type TxPhaseDescription,
  type TxState,
} from "@/lib/tx";
import { REQUIRED_CHAIN_ID } from "@/lib/wagmi";

/**
 * A contract write.
 *
 * `abi` is deliberately the whole contract ABI (`hbTokenAbi`, `mockUsdcAbi`, …) rather than a
 * narrowed fragment: viem uses it to decode the revert, and a fragment containing only the function
 * would throw away every custom error the contract can raise.
 */
export interface TxRequest {
  readonly address: Address;
  readonly abi: Abi | readonly unknown[];
  readonly functionName: string;
  readonly args?: readonly unknown[];
  readonly value?: bigint;
}

export interface UseTxOptions {
  /** The verb this machine performs, e.g. `"Subscribe"`. Used in every message it produces. */
  action: string;
  /**
   * The contract being written to. With the request's `functionName` this is what decides the
   * decimals of a shared ERC-20 error — see `DecodeTxErrorOptions.functionName` in `lib/tx.ts`.
   */
  contract?: ContractName;
  /** Replaces the default "… confirmed" toast title. */
  successTitle?: string;
  /** Extra sentence on the success toast, e.g. "1,000.00 USDC subscribed for 997.0 hbTRS." */
  successMessage?: string;
  /** Pre-flight `eth_call`. Default `true`; turn it off only where the state genuinely cannot be read. */
  simulate?: boolean;
  /** Receipt confirmations to wait for. Default 1, which is what a testnet warrants. */
  confirmations?: number;
  /** Emit toasts. Default `true`. The inline `TxStatus` is rendered either way. */
  toasts?: boolean;
  /** Resolves an ISO 3166-1 numeric country code for `CountryBlocked`. */
  countryName?: (code: number) => string | null;
  onConfirmed?: (receipt: TransactionReceipt) => void;
  onFailed?: (failure: TxFailure) => void;
}

export interface UseTxResult {
  state: TxState;
  phase: TxPhase;
  /** Present from the moment the wallet returns one, and kept through a failure. */
  hash: Hex | undefined;
  /** The wallet or the chain owes an answer. Disable the submit control while true. */
  isBusy: boolean;
  isConfirmed: boolean;
  failure: TxFailure | undefined;
  receipt: TransactionReceipt | undefined;
  /** `null` until a hash exists; then a link, or the reason there is none (Anvil). */
  link: ExplorerLink | null;
  /** Label, sentence and tone for the current phase. */
  description: TxPhaseDescription;
  /**
   * The wallet disconnected or switched accounts while a broadcast transaction was still pending.
   * The transaction is unaffected and is still being watched; `walletNote` says so.
   */
  walletChanged: boolean;
  walletNote: string | null;
  /** Sends the write. Resolves with the hash, or `null` if it never got one. Never rejects. */
  send: (request: TxRequest) => Promise<Hex | null>;
  reset: () => void;
}

type WriteVariables = Parameters<ReturnType<typeof useWriteContract>["writeContractAsync"]>[0];

export function useTx(options: UseTxOptions): UseTxResult {
  const [state, dispatch] = React.useReducer(txReducer, TX_IDLE);
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: REQUIRED_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();

  // The latest options, without making every callback below change identity each render. Declared
  // before the effects that read it so it is up to date by the time they run.
  const optionsRef = React.useRef(options);
  React.useEffect(() => {
    optionsRef.current = options;
  });

  const toastId = React.useRef<string | number | undefined>(undefined);
  const sentFrom = React.useRef<Address | undefined>(undefined);
  const sentHash = React.useRef<Hex | undefined>(undefined);

  // Mirrors `state.phase` so `send` can refuse a second submission synchronously, before the
  // reducer has run. Without it a double-click fires two transactions that then share one machine.
  const phaseRef = React.useRef<TxPhase>("idle");
  React.useEffect(() => {
    phaseRef.current = state.phase;
  }, [state.phase]);

  const hash = txHashOf(state);
  const watching = state.phase === "pending" ? state.hash : undefined;

  const receiptQuery = useWaitForTransactionReceipt({
    hash: watching,
    chainId: REQUIRED_CHAIN_ID,
    confirmations: options.confirmations ?? 1,
  });

  // ---- receipt ---------------------------------------------------------------------------------

  // The watcher is keyed on a hash that goes away the moment the transaction settles, so its data
  // goes with it. A confirmed transaction's receipt is exactly what a caller wants at that point
  // (logs, gas, block), so it is kept here until the machine is reset.
  const [settledReceipt, setSettledReceipt] = React.useState<TransactionReceipt | undefined>(
    undefined,
  );

  const receipt = receiptQuery.data;
  React.useEffect(() => {
    if (!receipt) return;
    setSettledReceipt(receipt);
    if (receipt.status === "success") {
      dispatch({
        type: "confirmed",
        hash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
      });
      optionsRef.current.onConfirmed?.(receipt);
      return;
    }
    const failure = revertedReceiptFailure(optionsRef.current.action);
    dispatch({ type: "failed", hash: receipt.transactionHash, failure });
    optionsRef.current.onFailed?.(failure);
  }, [receipt]);

  const receiptError = receiptQuery.error;
  React.useEffect(() => {
    if (!receiptError) return;
    const failure = decodeTxError(receiptError, { action: optionsRef.current.action });
    dispatch({ type: "failed", failure });
    optionsRef.current.onFailed?.(failure);
  }, [receiptError]);

  // ---- a wallet that leaves mid-flight ----------------------------------------------------------

  React.useEffect(() => {
    // Before a signature there is nothing on chain, so a disconnect ends the attempt. After one,
    // the receipt watcher above uses the app's transport and keeps working — the attempt is not
    // cancelled, it is only unattended, and `walletNote` explains that instead.
    if (isConnected || state.phase !== "awaiting-signature") return;
    const failure = walletDisconnectedFailure(optionsRef.current.action, false);
    dispatch({ type: "failed", failure });
    optionsRef.current.onFailed?.(failure);
  }, [isConnected, state.phase]);

  const walletChanged =
    state.phase === "pending" &&
    (!isConnected || (sentFrom.current !== undefined && address !== sentFrom.current));

  const walletNote = walletChanged
    ? isConnected
      ? "Your wallet switched accounts after this was sent. The transaction belongs to the account that signed it and is still being watched here."
      : "Your wallet disconnected after this was sent. The transaction is already on chain and is still being watched here."
    : null;

  // ---- toasts -----------------------------------------------------------------------------------

  React.useEffect(() => {
    const opts = optionsRef.current;
    if (opts.toasts === false) return;
    const id = toastId.current;
    const explorer = txHashOf(state)
      ? txExplorerLink(txHashOf(state) as Hex, REQUIRED_CHAIN_ID)
      : null;
    const open = explorer?.available
      ? {
          label: "Explorer",
          onClick: () => window.open(explorer.href, "_blank", "noopener,noreferrer"),
        }
      : undefined;

    switch (state.phase) {
      case "idle":
        if (id !== undefined) {
          toast.dismiss(id);
          toastId.current = undefined;
        }
        return;
      case "awaiting-signature":
        toastId.current = toast.loading("Confirm in your wallet", {
          id,
          description: `${opts.action} is waiting for your signature.`,
          duration: Number.POSITIVE_INFINITY,
        });
        return;
      case "pending":
        toastId.current = toast.loading(`${opts.action} pending`, {
          id,
          description: "Broadcast. Waiting for it to be included in a block.",
          duration: Number.POSITIVE_INFINITY,
          action: open,
        });
        return;
      case "confirmed":
        toastId.current = toast.success(opts.successTitle ?? `${opts.action} confirmed`, {
          id,
          description: opts.successMessage,
          duration: 10_000,
          action: open,
        });
        return;
      case "failed":
        toastId.current = toast.error(state.failure.title, {
          id,
          description: state.failure.message,
          duration: 12_000,
          action: open,
        });
        return;
    }
  }, [state]);

  // A "confirm in your wallet" toast has no timeout, so it would outlive a page that navigated away
  // mid-transaction. Dismiss it on unmount; the transaction itself is unaffected either way.
  React.useEffect(
    () => () => {
      if (toastId.current !== undefined) toast.dismiss(toastId.current);
    },
    [],
  );

  // ---- send -------------------------------------------------------------------------------------

  const send = React.useCallback(
    async (request: TxRequest): Promise<Hex | null> => {
      const opts = optionsRef.current;
      const decodeOptions = {
        action: opts.action,
        contract: opts.contract,
        functionName: request.functionName,
        countryName: opts.countryName,
      };

      // Refuse rather than queue: two writes sharing one machine would overwrite each other's state.
      if (isBusyPhase(phaseRef.current)) return null;
      phaseRef.current = "awaiting-signature";

      dispatch({ type: "submit" });
      setSettledReceipt(undefined);
      sentFrom.current = address;
      sentHash.current = undefined;

      try {
        if (opts.simulate !== false && publicClient) {
          await publicClient.simulateContract({
            address: request.address,
            abi: request.abi,
            functionName: request.functionName,
            args: request.args,
            value: request.value,
            account: address,
          } as Parameters<typeof publicClient.simulateContract>[0]);
        }

        const txHash = await writeContractAsync({
          address: request.address,
          abi: request.abi,
          functionName: request.functionName,
          args: request.args,
          value: request.value,
          chainId: REQUIRED_CHAIN_ID,
        } as WriteVariables);

        sentHash.current = txHash;
        dispatch({ type: "signed", hash: txHash });
        return txHash;
      } catch (error) {
        const failure = decodeTxError(error, decodeOptions);
        dispatch({ type: "failed", hash: sentHash.current, failure });
        opts.onFailed?.(failure);
        return null;
      }
    },
    [address, publicClient, writeContractAsync],
  );

  const reset = React.useCallback(() => {
    sentHash.current = undefined;
    sentFrom.current = undefined;
    phaseRef.current = "idle";
    setSettledReceipt(undefined);
    dispatch({ type: "reset" });
  }, []);

  const link = React.useMemo(() => (hash ? txExplorerLink(hash, REQUIRED_CHAIN_ID) : null), [hash]);

  const description = React.useMemo(
    () => describeTxPhase(state, options.action),
    [state, options.action],
  );

  return {
    state,
    phase: state.phase,
    hash,
    isBusy: isBusyPhase(state.phase),
    isConfirmed: state.phase === "confirmed",
    failure: state.phase === "failed" ? state.failure : undefined,
    receipt: settledReceipt,
    link,
    description,
    walletChanged,
    walletNote,
    send,
    reset,
  };
}
