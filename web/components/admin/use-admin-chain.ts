"use client";

/**
 * Everything `/admin` reads from the two contracts, in one hook.
 *
 * Written as separate `useReadContract` calls rather than one batch, for the reason
 * `components/subscribe/use-chain-state.ts` gives: against the generated `as const` ABIs each call's
 * return type is inferred exactly, so nothing here casts an `unknown` into a `bigint`. On a testnet
 * the extra round trips are worth that.
 *
 * ## The role constants are read, not hardcoded
 *
 * `ISSUER_ROLE` and friends are `keccak256` of their own names and could be computed in three lines.
 * They are read from the deployed contracts instead, because a console that decided what you are
 * allowed to do from a constant in this repository would keep saying it with total confidence after
 * the contract changed. Every one is `staleTime: Infinity` — a `constant` in Solidity is read once
 * per page load and never again.
 *
 * ## `null` is not `false`
 *
 * Every field is `T | null`, and `null` means "not read", never "zero" or "no". The role panel
 * depends on that distinction: telling somebody they hold no roles while the answer is still in
 * flight is the one failure mode an operator console cannot afford, because the natural reaction is
 * to go and look for the wrong wallet.
 */

import * as React from "react";
import type { Address } from "viem";
import { useReadContract } from "wagmi";

import { NO_ROLES_READ, type RoleHoldings } from "@/components/admin/roles";
import { ACTIVE_CHAIN, getContractAddress } from "@/lib/chains";
import { hbTokenAbi, identityRegistryAbi, mockUsdcAbi } from "@/lib/generated/abis";
import { REQUIRED_CHAIN_ID } from "@/lib/wagmi";

const TOKEN_ADDRESS = getContractAddress("HBToken");
const REGISTRY_ADDRESS = getContractAddress("IdentityRegistry");
const USDC_ADDRESS = getContractAddress("MockUSDC");

export const ADMIN_ADDRESSES: {
  readonly token: Address;
  readonly registry: Address;
  readonly usdc: Address;
} | null =
  TOKEN_ADDRESS !== null && REGISTRY_ADDRESS !== null && USDC_ADDRESS !== null
    ? { token: TOKEN_ADDRESS, registry: REGISTRY_ADDRESS, usdc: USDC_ADDRESS }
    : null;

export const HAS_DEPLOYMENT = ADMIN_ADDRESSES !== null;

/** A `constant` in Solidity. Read once, kept for the life of the page. */
const IMMUTABLE = {
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: Number.POSITIVE_INFINITY,
} as const;

/** Anything an operator might change from another tab, or that the oracle moves. */
const LIVE = { refetchInterval: 20_000 } as const;

export type AdminReadState = "no-deployment" | "loading" | "error" | "ready";

export interface TokenState {
  readonly nav6: bigint | null;
  readonly reportedAum6: bigint | null;
  readonly navUpdatedAt: bigint | null;
  readonly maxBps: bigint | null;
  readonly anchor6: bigint | null;
  readonly windowStart: bigint | null;
  readonly railWindow: bigint | null;
  readonly supply18: bigint | null;
  readonly paused: boolean | null;
  readonly minSubscription6: bigint | null;
  readonly distributionCount: bigint | null;
  readonly totalDistributed6: bigint | null;
  readonly couponReserve6: bigint | null;
  readonly vaultBalance6: bigint | null;
  readonly availableLiquidity6: bigint | null;
  readonly supplyBackedRatio18: bigint | null;
}

export interface IssuerFunds {
  /** The connected wallet's test-USDC balance. */
  readonly balance6: bigint | null;
  /** What it has approved the token contract to pull, for `distributeCoupon`. */
  readonly allowance6: bigint | null;
}

export interface AdminChainState {
  readonly reads: AdminReadState;
  /** Why nothing below can be trusted, when that is the case. */
  readonly reason: string | null;
  readonly roles: RoleHoldings;
  /** True once every `hasRole` has answered. */
  readonly rolesRead: boolean;
  readonly token: TokenState;
  readonly funds: IssuerFunds;
  readonly addresses: typeof ADMIN_ADDRESSES;
  readonly refresh: () => void;
}

export function useAdminChainState(account: Address | undefined): AdminChainState {
  const enabled = HAS_DEPLOYMENT;
  const forAccount = enabled && account !== undefined;
  const token = ADMIN_ADDRESSES?.token;
  const registry = ADMIN_ADDRESSES?.registry;
  const usdc = ADMIN_ADDRESSES?.usdc;

  // ---- role constants --------------------------------------------------------------------------
  const tokenAdminRole = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "DEFAULT_ADMIN_ROLE",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...IMMUTABLE },
  });
  const issuerRole = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "ISSUER_ROLE",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...IMMUTABLE },
  });
  const oracleRole = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "ORACLE_ROLE",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...IMMUTABLE },
  });
  const registryAdminRole = useReadContract({
    address: registry,
    abi: identityRegistryAbi,
    functionName: "DEFAULT_ADMIN_ROLE",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...IMMUTABLE },
  });
  const registrarRole = useReadContract({
    address: registry,
    abi: identityRegistryAbi,
    functionName: "REGISTRAR_ROLE",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...IMMUTABLE },
  });

  // ---- what this wallet holds ------------------------------------------------------------------
  const hasTokenAdmin = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "hasRole",
    args: account && tokenAdminRole.data ? [tokenAdminRole.data, account] : undefined,
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled: forAccount && tokenAdminRole.data !== undefined },
  });
  const hasIssuer = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "hasRole",
    args: account && issuerRole.data ? [issuerRole.data, account] : undefined,
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled: forAccount && issuerRole.data !== undefined },
  });
  const hasOracle = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "hasRole",
    args: account && oracleRole.data ? [oracleRole.data, account] : undefined,
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled: forAccount && oracleRole.data !== undefined },
  });
  const hasRegistryAdmin = useReadContract({
    address: registry,
    abi: identityRegistryAbi,
    functionName: "hasRole",
    args: account && registryAdminRole.data ? [registryAdminRole.data, account] : undefined,
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled: forAccount && registryAdminRole.data !== undefined },
  });
  const hasRegistrar = useReadContract({
    address: registry,
    abi: identityRegistryAbi,
    functionName: "hasRole",
    args: account && registrarRole.data ? [registrarRole.data, account] : undefined,
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled: forAccount && registrarRole.data !== undefined },
  });

  // ---- token state -----------------------------------------------------------------------------
  const nav = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "nav",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...LIVE },
  });
  const reportedAum = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "reportedAUM",
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
  const maxBps = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "maxNavMoveBps",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...LIVE },
  });
  const anchor = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "railAnchorNav",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...LIVE },
  });
  const windowStart = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "railWindowStart",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...LIVE },
  });
  const railWindow = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "RAIL_WINDOW",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...IMMUTABLE },
  });
  const supply = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "totalSupply",
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
  const minSubscription = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "minSubscription",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled },
  });
  const distributionCount = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "distributionCount",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...LIVE },
  });
  const totalDistributed = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "totalDistributed",
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
  const vaultBalance = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "vaultBalance",
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
  const supplyBackedRatio = useReadContract({
    address: token,
    abi: hbTokenAbi,
    functionName: "supplyBackedRatio",
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled, ...LIVE },
  });

  // ---- the issuer's own test USDC ---------------------------------------------------------------
  const usdcBalance = useReadContract({
    address: usdc,
    abi: mockUsdcAbi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled: forAccount },
  });
  const usdcAllowance = useReadContract({
    address: usdc,
    abi: mockUsdcAbi,
    functionName: "allowance",
    args: account && token ? [account, token] : undefined,
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled: forAccount },
  });

  const marketQueries = [
    tokenAdminRole,
    issuerRole,
    oracleRole,
    registryAdminRole,
    registrarRole,
    nav,
    reportedAum,
    navUpdatedAt,
    maxBps,
    anchor,
    windowStart,
    railWindow,
    supply,
    paused,
    minSubscription,
    distributionCount,
    totalDistributed,
    couponReserve,
    vaultBalance,
    availableLiquidity,
    supplyBackedRatio,
  ];
  const accountQueries = [
    hasTokenAdmin,
    hasIssuer,
    hasOracle,
    hasRegistryAdmin,
    hasRegistrar,
    usdcBalance,
    usdcAllowance,
  ];
  const all = [...marketQueries, ...accountQueries];

  const marketError = marketQueries.find((query) => query.isError)?.error;
  const marketLoading = marketQueries.some((query) => query.isLoading);

  const reads: AdminReadState = !HAS_DEPLOYMENT
    ? "no-deployment"
    : marketError
      ? "error"
      : marketLoading
        ? "loading"
        : "ready";

  const reason = !HAS_DEPLOYMENT
    ? `No deployment is recorded for ${ACTIVE_CHAIN.label} in contracts/deployments, so there is no token and no registry for this console to operate. Deploy the contracts and re-run \`pnpm sync:contracts\`.`
    : marketError
      ? `The contracts did not answer on ${ACTIVE_CHAIN.label}: ${firstLine(marketError.message)} Nothing below can be checked against the chain until they do.`
      : null;

  const roles: RoleHoldings = forAccount
    ? {
        "token-admin": hasTokenAdmin.data ?? null,
        issuer: hasIssuer.data ?? null,
        oracle: hasOracle.data ?? null,
        "registry-admin": hasRegistryAdmin.data ?? null,
        registrar: hasRegistrar.data ?? null,
      }
    : NO_ROLES_READ;

  const refetchers = React.useRef(all);
  refetchers.current = all;
  const refresh = React.useCallback(() => {
    for (const query of refetchers.current) void query.refetch();
  }, []);

  return {
    reads,
    reason,
    roles,
    rolesRead:
      forAccount &&
      [hasTokenAdmin, hasIssuer, hasOracle, hasRegistryAdmin, hasRegistrar].every(
        (query) => query.data !== undefined,
      ),
    token: {
      nav6: nav.data ?? null,
      reportedAum6: reportedAum.data ?? null,
      navUpdatedAt: navUpdatedAt.data ?? null,
      maxBps: maxBps.data ?? null,
      anchor6: anchor.data ?? null,
      windowStart: windowStart.data ?? null,
      railWindow: railWindow.data ?? null,
      supply18: supply.data ?? null,
      paused: paused.data ?? null,
      minSubscription6: minSubscription.data ?? null,
      distributionCount: distributionCount.data ?? null,
      totalDistributed6: totalDistributed.data ?? null,
      couponReserve6: couponReserve.data ?? null,
      vaultBalance6: vaultBalance.data ?? null,
      availableLiquidity6: availableLiquidity.data ?? null,
      supplyBackedRatio18: supplyBackedRatio.data ?? null,
    },
    funds: {
      balance6: usdcBalance.data ?? null,
      allowance6: usdcAllowance.data ?? null,
    },
    addresses: ADMIN_ADDRESSES,
    refresh,
  };
}

/** One line of an RPC error: the rest is transport detail nobody can act on. */
function firstLine(message: string): string {
  const line = message.split("\n")[0]?.trim() ?? "";
  if (line === "") return "no reason given.";
  return line.endsWith(".") ? line : `${line}.`;
}
