"use client";

/**
 * Everything `/portfolio` reads from the chain, in one hook.
 *
 * Separate `useReadContract` calls rather than one `useReadContracts` batch, for the reason
 * `components/subscribe/use-chain-state.ts` gives: with the generated `as const` ABIs each call's
 * return type is inferred exactly (`bigint`, `boolean`, the `Identity` tuple), so nothing here
 * casts an `unknown` back into a number. A batch would have to be assembled conditionally — there
 * is no contract address at all when the active chain has no deployment — and a conditional tuple
 * loses that inference.
 *
 * Two of these reads are load-bearing and are deliberately reads rather than computations:
 *
 *  - **`pendingCoupon(address)`.** The contract settles lazily: what is owed is
 *    `accrued + balance × (couponIndex − userIndex) / 1e18`, and only the contract knows
 *    `userIndex`. A browser-side reconstruction from the distribution history would disagree with
 *    what `claimCoupon` actually pays, so the page asks the contract and shows its answer.
 *  - **`availableLiquidity()`.** The vault minus the coupon reserve (PLAN.md D6). `vaultBalance()`
 *    and `couponReserve()` are read alongside it so the page can *show* the ring-fence rather than
 *    assert it: a person refused a redemption can see exactly which dollars are not theirs to take.
 */

import * as React from "react";
import type { Address } from "viem";
import { useReadContract } from "wagmi";

import {
  EMPTY_PORTFOLIO_CHAIN_STATE,
  type PortfolioChainState,
  type ReadState,
} from "@/components/portfolio/position";
import { ACTIVE_CHAIN, getContractAddress } from "@/lib/chains";
import { hbTokenAbi, identityRegistryAbi } from "@/lib/generated/abis";
import { REQUIRED_CHAIN_ID } from "@/lib/wagmi";

const TOKEN_ADDRESS = getContractAddress("HBToken");
const REGISTRY_ADDRESS = getContractAddress("IdentityRegistry");

/** The two addresses, or `null` when the active chain has no recorded deployment. */
export const DEPLOYED_ADDRESSES: {
  readonly token: Address;
  readonly registry: Address;
} | null =
  TOKEN_ADDRESS !== null && REGISTRY_ADDRESS !== null
    ? { token: TOKEN_ADDRESS, registry: REGISTRY_ADDRESS }
    : null;

export const HAS_DEPLOYMENT = DEPLOYED_ADDRESSES !== null;

/** NAV, the pause flag and the vault all move without this page doing anything. */
const LIVE = { refetchInterval: 20_000 } as const;

export interface PortfolioChainResult {
  readonly state: PortfolioChainState;
  /** Re-read everything. Called after a claim or a redemption confirms. */
  readonly refresh: () => void;
}

export function usePortfolioChainState(account: Address | undefined): PortfolioChainResult {
  const enabled = HAS_DEPLOYMENT;
  const accountEnabled = enabled && account !== undefined;
  const token = DEPLOYED_ADDRESSES?.token;
  const registry = DEPLOYED_ADDRESSES?.registry;

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
  const paused = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "paused",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...LIVE },
  });
  const availableLiquidity = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "availableLiquidity",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...LIVE },
  });
  const vaultBalance = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "vaultBalance",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...LIVE },
  });
  const couponReserve = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "couponReserve",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...LIVE },
  });
  const totalSupply = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "totalSupply",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...LIVE },
  });

  const balance = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled: accountEnabled, ...LIVE },
  });
  const pendingCoupon = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "pendingCoupon",
    args: account ? [account] : undefined,
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled: accountEnabled, ...LIVE },
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

  const marketQueries = [
    nav,
    navUpdatedAt,
    paused,
    availableLiquidity,
    vaultBalance,
    couponReserve,
    totalSupply,
  ];
  const accountQueries = [balance, pendingCoupon, canHold, identity];
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
    ? `No deployment is recorded for ${ACTIVE_CHAIN.label} in contracts/deployments, so this app has no token or registry address to talk to. There is no balance to read, no coupon to claim and nothing to redeem against. Deploy the contracts and re-run \`pnpm sync:contracts\` to bring this page to life.`
    : marketError
      ? `The contracts did not answer on ${ACTIVE_CHAIN.label}: ${firstLine(marketError.message)} Nothing below can be checked against the chain until they do.`
      : null;

  const state: PortfolioChainState = {
    ...EMPTY_PORTFOLIO_CHAIN_STATE,
    reads,
    reason,
    nav6: nav.data ?? null,
    navUpdatedAt: navUpdatedAt.data ?? null,
    paused: paused.data ?? null,
    balance18: balance.data ?? null,
    pendingCoupon6: pendingCoupon.data ?? null,
    availableLiquidity6: availableLiquidity.data ?? null,
    vaultBalance6: vaultBalance.data ?? null,
    couponReserve6: couponReserve.data ?? null,
    totalSupply18: totalSupply.data ?? null,
    canHold: canHold.data ?? null,
    identity: identity.data
      ? { verified: identity.data.verified, country: identity.data.country }
      : null,
  };

  // `all` is rebuilt every render, so the callback closes over the refetch functions through a ref
  // rather than listing eleven unstable dependencies.
  const refetchers = React.useRef(all);
  refetchers.current = all;
  const refresh = React.useCallback(() => {
    for (const query of refetchers.current) void query.refetch();
  }, []);

  return { state, refresh };
}

/**
 * `previewRedeem(amount)` from the token itself.
 *
 * BUILD_PROMPT 7.2 asks for the preview, and this is it: the contract's own view function, on the
 * amount in the box. `position.ts` reproduces the same arithmetic locally, and the page shows the
 * chain's answer where it has one — the two agreeing is the check that the reproduction is right,
 * and the one case where they differ (the NAV moved between the two reads) is worth saying out
 * loud rather than resolving silently.
 *
 * `amount18` is expected to be debounced by the caller: this is an `eth_call` per distinct value.
 */
export function usePreviewRedeem(amount18: bigint | null): bigint | null {
  const query = useReadContract({
    address: DEPLOYED_ADDRESSES?.token,
    abi: hbTokenAbi,
    functionName: "previewRedeem",
    args: amount18 === null ? undefined : [amount18],
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled: HAS_DEPLOYMENT && amount18 !== null },
  });
  return query.data ?? null;
}

/** One line of an RPC error, trimmed: the rest is a stack of transport detail nobody can act on. */
function firstLine(message: string): string {
  const line = message.split("\n")[0]?.trim() ?? "";
  if (line === "") return "no reason given.";
  return line.endsWith(".") ? line : `${line}.`;
}
