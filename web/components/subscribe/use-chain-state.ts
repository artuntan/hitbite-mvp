"use client";

/**
 * Everything `/subscribe` reads from the chain, in one hook.
 *
 * Written as separate `useReadContract` calls rather than one `useReadContracts` batch on purpose:
 * with the generated `as const` ABIs, each call's return type is inferred exactly (`bigint`,
 * `boolean`, the `Identity` tuple), so nothing in this file casts an `unknown` back into a number.
 * A batch would have to be built conditionally — there is no contract address at all when the
 * active chain has no deployment — and a conditional tuple loses that inference, which is the one
 * thing worth paying a few extra RPC calls on a testnet to keep.
 *
 * Three things are read per address (`canHold`, the identity record, the allowance) and are the
 * reason the page can explain a gate instead of waiting for a revert to explain it.
 */

import * as React from "react";
import type { Address } from "viem";
import { useReadContract } from "wagmi";

import {
  EMPTY_CHAIN_STATE,
  type ReadState,
  type SubscribeChainState,
} from "@/components/subscribe/quote";
import { ACTIVE_CHAIN, getContractAddress } from "@/lib/chains";
import { hbTokenAbi, identityRegistryAbi, mockUsdcAbi } from "@/lib/generated/abis";
import { REQUIRED_CHAIN_ID } from "@/lib/wagmi";

const TOKEN_ADDRESS = getContractAddress("HBToken");
const REGISTRY_ADDRESS = getContractAddress("IdentityRegistry");
const USDC_ADDRESS = getContractAddress("MockUSDC");

/**
 * The three addresses, or `null` when the active chain has no recorded deployment. Narrowed once
 * here so every read below can rely on it.
 */
export const DEPLOYED_ADDRESSES: {
  readonly token: Address;
  readonly registry: Address;
  readonly usdc: Address;
} | null =
  TOKEN_ADDRESS !== null && REGISTRY_ADDRESS !== null && USDC_ADDRESS !== null
    ? { token: TOKEN_ADDRESS, registry: REGISTRY_ADDRESS, usdc: USDC_ADDRESS }
    : null;

export const HAS_DEPLOYMENT = DEPLOYED_ADDRESSES !== null;

/** NAV and the pause flag move; everything else on this page waits for a transaction. */
const LIVE = { refetchInterval: 20_000 } as const;
/** `FAUCET_CAP` and `FAUCET_WINDOW` are `constant` in Solidity. Read them once. */
const IMMUTABLE = {
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: Number.POSITIVE_INFINITY,
} as const;

export interface ChainStateResult {
  readonly state: SubscribeChainState;
  /** Re-read everything. Called after a faucet, an approval or a subscription confirms. */
  readonly refresh: () => void;
}

export function useSubscribeChainState(account: Address | undefined): ChainStateResult {
  const enabled = HAS_DEPLOYMENT;
  const accountEnabled = enabled && account !== undefined;
  const token = DEPLOYED_ADDRESSES?.token;
  const registry = DEPLOYED_ADDRESSES?.registry;
  const usdc = DEPLOYED_ADDRESSES?.usdc;

  const nav = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "nav",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...LIVE },
  });
  const navUpdatedAt = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "navUpdatedAt",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...LIVE },
  });
  const minSubscription = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "minSubscription",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled },
  });
  const paused = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "paused",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...LIVE },
  });
  const faucetCap = useReadContract({
    address: usdc,
    abi: mockUsdcAbi,
    functionName: "FAUCET_CAP",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...IMMUTABLE },
  });
  const faucetWindow = useReadContract({
    address: usdc,
    abi: mockUsdcAbi,
    functionName: "FAUCET_WINDOW",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...IMMUTABLE },
  });

  const canHold = useReadContract({
    address: registry,
    abi: identityRegistryAbi,
    functionName: "canHold",
    args: account ? [account] : undefined,
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled: accountEnabled },
  });
  const identity = useReadContract({
    address: registry,
    abi: identityRegistryAbi,
    functionName: "identityOf",
    args: account ? [account] : undefined,
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled: accountEnabled },
  });
  const balance = useReadContract({
    address: usdc,
    abi: mockUsdcAbi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled: accountEnabled },
  });
  const allowance = useReadContract({
    address: usdc,
    abi: mockUsdcAbi,
    functionName: "allowance",
    args: account && token ? [account, token] : undefined,
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled: accountEnabled },
  });
  const faucetRemaining = useReadContract({
    address: usdc,
    abi: mockUsdcAbi,
    functionName: "faucetRemaining",
    args: account ? [account] : undefined,
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled: accountEnabled },
  });
  const windowStart = useReadContract({
    address: usdc,
    abi: mockUsdcAbi,
    functionName: "windowStart",
    args: account ? [account] : undefined,
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled: accountEnabled },
  });

  const marketQueries = [nav, navUpdatedAt, minSubscription, paused, faucetCap, faucetWindow];
  const accountQueries = [canHold, identity, balance, allowance, faucetRemaining, windowStart];
  const all = [...marketQueries, ...accountQueries];

  const marketError = marketQueries.find((query) => query.isError)?.error;
  const marketLoading = marketQueries.some((query) => query.isLoading);

  const reads: ReadState = !HAS_DEPLOYMENT
    ? "no-deployment"
    : marketError
      ? "error"
      : marketLoading
        ? "loading"
        : "ready";

  const reason = !HAS_DEPLOYMENT
    ? `No deployment is recorded for ${ACTIVE_CHAIN.label} in contracts/deployments, so this app has no token, registry or test-USDC address to talk to. There is nothing to read a NAV, a minimum or a paused flag from, and nothing to subscribe to. Deploy the contracts and re-run \`pnpm sync:contracts\` to bring this page to life.`
    : marketError
      ? `The contracts did not answer on ${ACTIVE_CHAIN.label}: ${firstLine(marketError.message)} Nothing below can be checked against the chain until they do.`
      : null;

  const windowEndsAt =
    windowStart.data !== undefined && faucetWindow.data !== undefined && windowStart.data > 0n
      ? windowStart.data + faucetWindow.data
      : null;

  const state: SubscribeChainState = {
    ...EMPTY_CHAIN_STATE,
    reads,
    reason,
    nav6: nav.data ?? null,
    navUpdatedAt: navUpdatedAt.data ?? null,
    minSubscription6: minSubscription.data ?? null,
    paused: paused.data ?? null,
    identity: identity.data
      ? { verified: identity.data.verified, country: identity.data.country }
      : null,
    canHold: canHold.data ?? null,
    usdcBalance6: balance.data ?? null,
    allowance6: allowance.data ?? null,
    faucetCap6: faucetCap.data ?? null,
    faucetRemaining6: faucetRemaining.data ?? null,
    faucetWindowEndsAt: windowEndsAt,
  };

  // `all` is rebuilt every render, so the callback deliberately closes over the refetch functions
  // through a ref rather than listing twelve unstable dependencies.
  const refetchers = React.useRef(all);
  refetchers.current = all;
  const refresh = React.useCallback(() => {
    for (const query of refetchers.current) void query.refetch();
  }, []);

  return { state, refresh };
}

/** One line of an RPC error, trimmed: the rest is a stack of transport detail nobody can act on. */
function firstLine(message: string): string {
  const line = message.split("\n")[0]?.trim() ?? "";
  if (line === "") return "no reason given.";
  return line.endsWith(".") ? line : `${line}.`;
}
