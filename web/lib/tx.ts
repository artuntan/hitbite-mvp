/**
 * Transaction plumbing shared by every write the app makes.
 *
 * Three things live here, all of them pure:
 *
 *   1. **A five-state status machine** — `idle → awaiting-signature → pending → confirmed`, with
 *      `failed` reachable from anywhere in between. `txReducer` is a total function over
 *      `(TxState, TxEvent)`, so every screen that shows progress agrees on what the states are and
 *      which transitions exist. Illegal events are ignored rather than throwing: a stale promise
 *      resolving after a reset must not be able to crash a page.
 *   2. **Explorer links** — a discriminated union rather than `string | null`, because Anvil has no
 *      explorer and "there is no explorer, here is the full hash" is a thing the interface has to
 *      say out loud instead of rendering a dead button (see `ExplorerLink`).
 *   3. **Revert decoding** — the reason this module exists. The contracts revert with custom errors
 *      carrying arguments; `decodeTxError` turns those back into a sentence someone can act on,
 *      using the generated ABIs. A raw revert string reaching a user is a bug.
 *
 * **No React, no wagmi, no RainbowKit.** This module is imported by the client components in
 * `components/wallet/`, but it is safe anywhere — nothing here drags the wallet bundle onto a page.
 * It is also, deliberately, not a barrel: it re-exports nothing from `components/wallet/`, so a
 * server component that imports a formatter from here cannot transitively pull in RainbowKit.
 */

import { decodeErrorResult, keccak256, numberToHex, toBytes, type Abi, type Hex } from "viem";

import {
  ACTIVE_CHAIN_ID,
  getChainConfig,
  getExplorerUrl,
  getPublicRpcUrl,
  type SupportedChainId,
} from "./chains";
import { hbTokenAbi, identityRegistryAbi, mockUsdcAbi, type ContractName } from "./generated/abis";
import {
  formatAddress,
  formatBasisPointsAsPercent,
  formatTokens,
  formatTxHash,
  formatUsdcExact,
} from "./format";

// =========================================================================== the status machine

/**
 * Every state a write can be in. There are five and there will only ever be five: a screen that
 * needs a sixth (for example "approved, ready to subscribe") composes two machines instead of
 * widening this one — see `TxStepList` in `components/wallet/tx-status.tsx`.
 */
export type TxPhase = "idle" | "awaiting-signature" | "pending" | "confirmed" | "failed";

export type TxState =
  | { readonly phase: "idle" }
  | { readonly phase: "awaiting-signature" }
  | { readonly phase: "pending"; readonly hash: Hex }
  | { readonly phase: "confirmed"; readonly hash: Hex; readonly blockNumber?: bigint }
  /**
   * `hash` is present when the wallet had already broadcast before the failure. It is what stops a
   * disconnect mid-transaction from dead-ending: the transaction is on chain whether or not the
   * wallet is still attached, so the UI keeps an explorer link to hand.
   */
  | { readonly phase: "failed"; readonly hash?: Hex; readonly failure: TxFailure };

export type TxEvent =
  /** Back to square one. Always legal. */
  | { readonly type: "reset" }
  /** The wallet has been asked to sign. */
  | { readonly type: "submit" }
  /** A hash exists; the transaction is in the mempool. */
  | { readonly type: "signed"; readonly hash: Hex }
  | { readonly type: "confirmed"; readonly hash: Hex; readonly blockNumber?: bigint }
  | { readonly type: "failed"; readonly failure: TxFailure; readonly hash?: Hex };

export const TX_IDLE: TxState = { phase: "idle" };

/**
 * The transition table. Total, pure, and deliberately forgiving of events that arrive in the wrong
 * order — an in-flight request whose component has already been reset will still resolve, and
 * dropping that event is correct where throwing is not.
 *
 * Legal transitions:
 *
 * | from                | reset | submit              | signed  | confirmed | failed |
 * |---------------------|-------|---------------------|---------|-----------|--------|
 * | `idle`              | idle  | awaiting-signature  | —       | —         | failed |
 * | `awaiting-signature`| idle  | —                   | pending | —         | failed |
 * | `pending`           | idle  | —                   | pending | confirmed | failed |
 * | `confirmed`         | idle  | awaiting-signature  | —       | —         | —      |
 * | `failed`            | idle  | awaiting-signature  | —       | —         | failed |
 *
 * Two entries are worth the words. `signed` from `pending` is legal so a wallet that replaces a
 * transaction (speed-up, cancel) can hand over the new hash without a reset. `failed` from
 * `confirmed` is ignored, because a confirmed transaction is final and a late error — a receipt
 * poll losing a race, say — must never be able to recolour a success.
 */
export function txReducer(state: TxState, event: TxEvent): TxState {
  switch (event.type) {
    case "reset":
      return state.phase === "idle" ? state : TX_IDLE;

    case "submit":
      if (state.phase === "awaiting-signature" || state.phase === "pending") return state;
      return { phase: "awaiting-signature" };

    case "signed":
      if (state.phase !== "awaiting-signature" && state.phase !== "pending") return state;
      if (state.phase === "pending" && state.hash === event.hash) return state;
      return { phase: "pending", hash: event.hash };

    case "confirmed":
      // Only from `pending`: a confirmation means a receipt arrived, and a receipt cannot arrive
      // for a transaction this machine never saw broadcast.
      if (state.phase !== "pending") return state;
      return { phase: "confirmed", hash: event.hash, blockNumber: event.blockNumber };

    case "failed": {
      if (state.phase === "confirmed") return state;
      const hash = event.hash ?? (state.phase === "pending" ? state.hash : undefined);
      return hash
        ? { phase: "failed", hash, failure: event.failure }
        : { phase: "failed", failure: event.failure };
    }

    default:
      return state;
  }
}

/** The wallet or the chain owes us something. Controls must be disabled while this is true. */
export function isBusyPhase(phase: TxPhase): boolean {
  return phase === "awaiting-signature" || phase === "pending";
}

/** Nothing further will happen on its own. */
export function isTerminalPhase(phase: TxPhase): boolean {
  return phase === "confirmed" || phase === "failed";
}

/** The hash of the current attempt, if one has been broadcast. */
export function txHashOf(state: TxState): Hex | undefined {
  return state.phase === "pending" || state.phase === "confirmed" || state.phase === "failed"
    ? state.hash
    : undefined;
}

export type TxTone = "neutral" | "accent" | "success" | "danger";

export interface TxPhaseDescription {
  /** Short badge text, e.g. "Waiting for signature". */
  readonly label: string;
  /** Sentence for the status region. Announced to screen readers when the phase changes. */
  readonly message: string;
  /** Maps onto `StatusBadge`/`Alert` tones. Colour is never the only signal — `label` carries it. */
  readonly tone: TxTone;
}

/**
 * Human wording for a state. `action` is the verb the page is performing ("Subscribe", "Approve
 * USDC"); it is woven into the sentence so a screen with two machines running does not announce
 * two identical strings.
 */
export function describeTxPhase(state: TxState, action = "Transaction"): TxPhaseDescription {
  switch (state.phase) {
    case "idle":
      return {
        label: "Not started",
        message: `${action} has not been submitted.`,
        tone: "neutral",
      };
    case "awaiting-signature":
      return {
        label: "Waiting for signature",
        message: `${action}: confirm the request in your wallet.`,
        tone: "accent",
      };
    case "pending":
      return {
        label: "Pending",
        message: `${action} was broadcast as ${formatTxHash(state.hash)} and is waiting to be included in a block.`,
        tone: "accent",
      };
    case "confirmed":
      return {
        label: "Confirmed",
        message: `${action} confirmed in transaction ${formatTxHash(state.hash)}.`,
        tone: "success",
      };
    case "failed":
      return {
        label: "Failed",
        message: `${action} failed. ${state.failure.message}`,
        tone: "danger",
      };
  }
}

// =========================================================================== explorer links

/**
 * Why this is a union and not `string | null`: Anvil has no block explorer, and the difference
 * between "no link yet" and "this network has no explorer at all" is the difference between a
 * spinner and a sentence. A `null` collapses the two and invites a dead anchor.
 */
export type ExplorerLink =
  | {
      readonly available: true;
      readonly href: string;
      readonly label: string;
      readonly host: string;
    }
  | { readonly available: false; readonly reason: string };

function explorerHost(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
}

function buildExplorerLink(
  path: "tx" | "address",
  value: string,
  chainId: SupportedChainId,
  label: string,
): ExplorerLink {
  const base = getExplorerUrl(chainId);
  if (!base) {
    const { label: chainLabel } = getChainConfig(chainId);
    return {
      available: false,
      reason: `${chainLabel} has no block explorer, so there is nothing to link to. The full ${path === "tx" ? "transaction hash" : "address"} is shown here instead.`,
    };
  }
  return { available: true, href: `${base}/${path}/${value}`, label, host: explorerHost(base) };
}

/** Explorer link for a transaction hash. Base Sepolia has one; Anvil does not. */
export function txExplorerLink(
  hash: string,
  chainId: SupportedChainId = ACTIVE_CHAIN_ID,
): ExplorerLink {
  return buildExplorerLink("tx", hash, chainId, `View ${formatTxHash(hash)} on the explorer`);
}

/** Explorer link for an address. Same two outcomes as `txExplorerLink`. */
export function addressExplorerLink(
  address: string,
  chainId: SupportedChainId = ACTIVE_CHAIN_ID,
): ExplorerLink {
  return buildExplorerLink(
    "address",
    address,
    chainId,
    `View ${formatAddress(address)} on the explorer`,
  );
}

// =========================================================================== network facts

/**
 * Everything a person needs to add or select the network by hand, for the case where the wallet
 * will not do it on request. Shown by `WrongNetworkAlert` when a programmatic switch fails, which
 * is the difference between a dead end and a workaround.
 */
export interface WalletNetworkFacts {
  readonly chainId: SupportedChainId;
  /** `wallet_addEthereumChain` wants the id as hex. */
  readonly chainIdHex: Hex;
  readonly label: string;
  readonly rpcUrl: string;
  readonly currencySymbol: string;
  readonly explorerUrl: string | null;
}

export function walletNetworkFacts(
  chainId: SupportedChainId = ACTIVE_CHAIN_ID,
): WalletNetworkFacts {
  const config = getChainConfig(chainId);
  return {
    chainId,
    chainIdHex: numberToHex(chainId),
    label: config.label,
    rpcUrl: getPublicRpcUrl(chainId),
    currencySymbol: config.viemChain.nativeCurrency.symbol,
    explorerUrl: getExplorerUrl(chainId),
  };
}

// =========================================================================== failures

/**
 * Why a failure went wrong, at the granularity the interface actually behaves differently at.
 *
 * - `rejected` — the person said no in the wallet. Nothing was sent. Offer the same action again.
 * - `wallet-busy` — a request is already open in the wallet (EIP-1193 `-32002`).
 * - `disconnected` — the wallet went away. Whether anything reached the chain depends on `hash`.
 * - `wrong-network` — the wallet is on a network this app does not talk to.
 * - `unsupported-chain` — the wallet does not know the network and would not add it (`4902`).
 * - `insufficient-gas` — no testnet ETH to pay for gas. Not the same as a revert, and the fix is
 *   a faucet rather than a smaller amount.
 * - `reverted` — the contract refused. This is the case the decoder exists for.
 * - `timeout` — broadcast, but no receipt arrived in the window we waited. Still possibly mining.
 * - `network` — the RPC or the transport failed.
 * - `unknown` — everything else, reported honestly rather than guessed at.
 */
export type TxFailureKind =
  | "rejected"
  | "wallet-busy"
  | "disconnected"
  | "wrong-network"
  | "unsupported-chain"
  | "insufficient-gas"
  | "reverted"
  | "timeout"
  | "network"
  | "unknown";

/** One decoded argument, ready to render in a definition list. */
export interface TxFailureDetail {
  readonly label: string;
  readonly value: string;
  /** Render with `.num` (figures) or `.addr` (addresses and hashes). */
  readonly mono?: "num" | "addr";
}

export interface TxFailure {
  readonly kind: TxFailureKind;
  /** Headline. Sentence case, no trailing full stop — it sits in a heading slot. */
  readonly title: string;
  /**
   * One or two sentences naming the cause and the way out. This is the string the user reads;
   * it is never a raw revert message and never contains a selector.
   */
  readonly message: string;
  /** The custom error's name when the revert matched an ABI entry, e.g. `"BelowMinimum"`. */
  readonly errorName?: string;
  /** Decoded arguments, already formatted. */
  readonly details?: readonly TxFailureDetail[];
  /** True when submitting the same request again could plausibly succeed without changing it. */
  readonly retryable: boolean;
  /**
   * The underlying message, for a collapsed "technical detail" block and for bug reports. Never
   * the primary text — if this is all the UI shows, this module has failed at its job.
   */
  readonly raw?: string;
}

/** Which token an ERC-20 error is about, and therefore how to scale its amounts. */
export type TokenHint = "usdc" | "hbtrs";

export interface DecodeTxErrorOptions {
  /** The verb the page is performing, e.g. `"Subscribe"`. Used only in generic titles. */
  readonly action?: string;
  /** The contract the write was addressed to. Narrows the units of shared ERC-20 errors. */
  readonly contract?: ContractName;
  /**
   * The function that was called. With `contract`, this is what lets a shared OpenZeppelin error
   * be reported in the right units: `HBToken.subscribe` fails on **USDC** allowance (6 decimals)
   * while `HBToken.redeem` fails on an **hbTRS** balance (18). Guessing here would print an
   * amount that is wrong by twelve orders of magnitude, so when neither hint is available the
   * amount is reported in base units and labelled as such.
   */
  readonly functionName?: string;
  /** Overrides the inference above when a call site knows better. */
  readonly token?: TokenHint;
  /** Resolves an ISO 3166-1 numeric code to a name; falls back to the codes BUILD_PROMPT 16.1 names. */
  readonly countryName?: (code: number) => string | null;
}

/**
 * Every custom error the three contracts can revert with, in one array for `decodeErrorResult`.
 *
 * Built from the generated ABIs rather than hand-copied, so a new error in Solidity reaches this
 * decoder as soon as `pnpm sync:contracts` runs. Duplicates (the OpenZeppelin errors appear in more
 * than one ABI) are dropped by signature; they decode identically either way, but a shorter array
 * is a faster lookup on every failure.
 */
export const CONTRACT_ERROR_ABI: Abi = (() => {
  const seen = new Set<string>();
  const errors: Abi[number][] = [];
  for (const item of [...hbTokenAbi, ...identityRegistryAbi, ...mockUsdcAbi]) {
    if (item.type !== "error") continue;
    const signature = `${item.name}(${item.inputs.map((input) => input.type).join(",")})`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    errors.push(item);
  }
  return errors;
})();

// --------------------------------------------------------------------------- argument coercion

function asBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  return null;
}

function asAddress(value: unknown): string | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) ? value : null;
}

function asHex(value: unknown): Hex | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value) ? (value as Hex) : null;
}

/** `0x9fE4…a6e0`, or the literal text when the argument was not an address after all. */
function shortAddress(value: unknown): string {
  return asAddress(value) ? formatAddress(String(value)) : String(value);
}

// --------------------------------------------------------------------------- units

interface TokenUnits {
  readonly symbol: string;
  readonly format: (value: bigint) => string;
}

const UNITS: Readonly<Record<TokenHint, TokenUnits>> = {
  /**
   * Six decimals, every one of them shown. `BelowMinimum(100.000000, 99.999999)` has to read as a
   * refusal a person can believe; rounded to cents both numbers would print "100.00" (PLAN.md D52).
   */
  usdc: { symbol: "USDC", format: (value) => formatUsdcExact(value) },
  hbtrs: { symbol: "hbTRS", format: (value) => formatTokens(value, 6) },
};

/** USDC amounts in HBToken's own errors are never ambiguous: the vault only holds USDC. */
const usdc = (value: bigint) => `${UNITS.usdc.format(value)} USDC`;

/**
 * Which token the shared OpenZeppelin ERC-20 errors are about, per call. MockUSDC only ever moves
 * mUSDC. HBToken moves both, so the function name decides.
 */
const HB_TOKEN_ERC20_TOKEN: Readonly<Record<string, TokenHint>> = {
  subscribe: "usdc", // pulls USDC in through transferFrom
  distributeCoupon: "usdc",
  claimCoupon: "usdc",
  redeem: "hbtrs", // burns hbTRS
  burn: "hbtrs",
  mint: "hbtrs",
  transfer: "hbtrs",
  transferFrom: "hbtrs",
  approve: "hbtrs",
};

function resolveToken(options: DecodeTxErrorOptions): TokenUnits | null {
  if (options.token) return UNITS[options.token];
  if (options.contract === "MockUSDC") return { symbol: "mUSDC", format: UNITS.usdc.format };
  if (options.contract === "HBToken" && options.functionName) {
    const hint = HB_TOKEN_ERC20_TOKEN[options.functionName];
    if (hint) return hint === "usdc" ? UNITS.usdc : UNITS.hbtrs;
  }
  return null;
}

/**
 * Format an ERC-20 amount when the token is known, and refuse to invent a scale when it is not:
 * an unscaled integer labelled "base units" is honest, `1234000000` labelled "USDC" is not.
 */
function erc20Amount(value: bigint, units: TokenUnits | null): string {
  return units ? `${units.format(value)} ${units.symbol}` : `${value.toString()} base units`;
}

// --------------------------------------------------------------------------- role and country names

/**
 * `AccessControlUnauthorizedAccount` carries a role hash. Hashing the four role names the contracts
 * declare turns `0x9f2d…` back into "the issuer role", which is the whole difference between a
 * useful message and a hex dump. Computed rather than pasted so it cannot drift from Solidity's
 * `keccak256("ISSUER_ROLE")`.
 */
const ROLE_NAMES: ReadonlyMap<string, string> = new Map(
  [
    ["DEFAULT_ADMIN_ROLE", "admin role"],
    ["ISSUER_ROLE", "issuer role"],
    ["ORACLE_ROLE", "oracle role"],
    ["REGISTRAR_ROLE", "registrar role"],
  ].map(([constant, label]) => [
    constant === "DEFAULT_ADMIN_ROLE"
      ? `0x${"0".repeat(64)}`
      : keccak256(toBytes(constant as string)),
    label as string,
  ]),
);

function roleName(value: unknown): string {
  const hex = asHex(value);
  if (!hex) return "a role";
  return ROLE_NAMES.get(hex.toLowerCase()) ?? `role ${formatAddress(hex, 6)}`;
}

/**
 * The ISO 3166-1 numeric codes BUILD_PROMPT 16.1 names, and nothing else. The registry's blocklist
 * is admin-editable and may contain codes this map has never heard of, so an unknown code is
 * printed as a code — inventing a country name would be worse than printing a number.
 *
 * Pass `countryName` to `decodeTxError` to resolve the full ISO list where a page already has it.
 */
const KNOWN_COUNTRIES: Readonly<Record<number, string>> = {
  276: "Germany",
  634: "Qatar",
  682: "Saudi Arabia",
  702: "Singapore",
  756: "Switzerland",
  784: "United Arab Emirates",
  792: "Türkiye",
  826: "United Kingdom",
  840: "United States",
};

function countryLabel(code: number, resolve?: (code: number) => string | null): string {
  const name = resolve?.(code) ?? KNOWN_COUNTRIES[code] ?? null;
  return name ? `${name} (code ${code})` : `country code ${code}`;
}

// --------------------------------------------------------------------------- revert copy

interface RevertCopy {
  readonly title: string;
  readonly message: string;
  readonly details?: readonly TxFailureDetail[];
  /** Default `false`: most reverts are a refusal, and repeating the same call repeats the refusal. */
  readonly retryable?: boolean;
}

/** Solidity's `Panic(uint256)` codes. Only the ones a caller could plausibly trigger are named. */
const PANIC_REASONS: Readonly<Record<string, string>> = {
  "0x01": "an assertion in the contract failed",
  "0x11": "an arithmetic operation overflowed",
  "0x12": "a division by zero",
  "0x21": "a value outside an enum's range",
  "0x31": "a pop from an empty array",
  "0x32": "an array index out of bounds",
  "0x41": "an allocation too large for memory",
  "0x51": "a call to an uninitialised internal function",
};

/**
 * The table this module exists for: one custom error in, one sentence out.
 *
 * The rules being explained are the ones in COMPLIANCE_RULES.md, and the wording here must not
 * out-run them — the contract is the authority, this is the translation. Every message names the
 * cause and, where one exists, the way forward. None of them quotes a selector.
 */
function revertCopy(
  errorName: string,
  args: readonly unknown[] | undefined,
  options: DecodeTxErrorOptions,
): RevertCopy | null {
  const token = resolveToken(options);
  const a0 = args?.[0];
  const a1 = args?.[1];
  const a2 = args?.[2];

  switch (errorName) {
    // ---- eligibility and the registry -------------------------------------------------------
    case "NotEligible": {
      const account = shortAddress(a0);
      return {
        title: "That address cannot hold hbTRS",
        message: `${account} is not on the whitelist, or the country on its verification record is blocked. Only verified addresses in permitted countries can receive hbTRS; the contract checks this on every mint and every transfer. Complete verification for that address first.`,
        details: [{ label: "Address", value: String(a0), mono: "addr" }],
      };
    }
    case "NotVerified":
      return {
        title: "No verification record",
        message: `${shortAddress(a0)} has no record in the identity registry, so there is nothing to remove.`,
        details: [{ label: "Address", value: String(a0), mono: "addr" }],
      };
    case "CountryBlocked": {
      const code = asNumber(a0);
      return {
        title: "That country is blocked",
        message:
          code === null
            ? "The country on this verification is on the registry's blocklist, so the address cannot be verified."
            : `${countryLabel(code, options.countryName)} is on the registry's blocklist, so this address cannot be verified. The blocklist is set on-chain and only an admin can change it.`,
        details:
          code === null ? undefined : [{ label: "Country code", value: String(code), mono: "num" }],
      };
    }
    case "InvalidCountry": {
      const code = asNumber(a0);
      return {
        title: "That country code is not valid",
        message: `Country codes are ISO 3166-1 numeric and must be between 1 and 999. ${code === null ? "The value supplied" : `${code}`} is outside that range; zero is rejected everywhere, because an address with an unset country would otherwise slip past the blocklist.`,
      };
    }
    case "RetailNotAllowed":
      return {
        title: "Retail investors cannot be verified",
        message:
          "Only professional investors (investor type 1) can be verified in phase one. The retail type exists in storage for a later phase, and no path can write it today.",
      };
    case "InvalidInvestorType": {
      const type = asNumber(a0);
      return {
        title: "That investor type is not recognised",
        message: `Investor type ${type ?? "supplied"} is not a value the registry accepts. Type 1 is professional and is the only type that can be verified today.`,
      };
    }
    case "NotRegistrar":
      return {
        title: "Only the registrar can do that",
        message:
          "Verifying and de-verifying addresses needs the registrar role. The key that signed this transaction does not hold it.",
      };

    // ---- subscribe, redeem, coupons ---------------------------------------------------------
    case "BelowMinimum": {
      const minimum = asBigInt(a0);
      const given = asBigInt(a1);
      return {
        title: "Below the minimum subscription",
        message:
          minimum === null || given === null
            ? "The amount is below the minimum subscription the contract enforces. Increase it and try again."
            : `The minimum subscription is ${usdc(minimum)} and this one is ${usdc(given)}. Increase the amount to at least ${usdc(minimum)}.`,
        details:
          minimum === null || given === null
            ? undefined
            : [
                { label: "Minimum", value: usdc(minimum), mono: "num" },
                { label: "You asked for", value: usdc(given), mono: "num" },
              ],
      };
    }
    case "InsufficientLiquidity": {
      const available = asBigInt(a0);
      const requested = asBigInt(a1);
      return {
        title: "Not enough liquidity to redeem that",
        message:
          available === null || requested === null
            ? "The vault does not hold enough available USDC to pay for this redemption. Redeem a smaller amount, or try again later."
            : `The vault can pay out ${usdc(available)} right now and this redemption needs ${usdc(requested)}. Unclaimed coupons are reserved for the holders who earned them and are never used for redemptions, so redeem a smaller amount or try again after the next subscription.`,
        details:
          available === null || requested === null
            ? undefined
            : [
                { label: "Available", value: usdc(available), mono: "num" },
                { label: "Requested", value: usdc(requested), mono: "num" },
              ],
        retryable: true,
      };
    }
    case "ZeroTokens":
      return {
        title: "That amount rounds down to zero tokens",
        message:
          "At the current NAV this subscription would mint no tokens at all, so the contract rejects it rather than taking the USDC. Increase the amount.",
      };
    case "NothingToClaim":
      return {
        title: "No coupon to claim",
        message:
          "No coupon has accrued to this address since it last claimed. Coupons accrue only to balances held at the moment a distribution is made.",
      };
    case "NoSupply":
      return {
        title: "No tokens are outstanding",
        message:
          "A coupon cannot be distributed while the supply is zero: there is nobody to distribute it to.",
      };
    case "DistributionTooSmall": {
      const amount = asBigInt(a0);
      const minimum = asBigInt(a1);
      return {
        title: "That distribution is too small",
        message:
          amount === null || minimum === null
            ? "The distribution is too small to raise the per-token coupon index by even one unit, so the whole amount would be locked in the contract."
            : `${usdc(amount)} is too small to raise the per-token coupon index by even one unit at the current supply; the smallest distribution that works is ${usdc(minimum)}. A smaller one would lock the money in the contract, so it is rejected instead of absorbed.`,
      };
    }
    case "DistributionExceedsNav": {
      const perToken = asBigInt(a0);
      const nav = asBigInt(a1);
      return {
        title: "That coupon is larger than NAV",
        message:
          perToken === null || nav === null
            ? "The per-token coupon must be strictly below the current NAV, because NAV drops by that amount when the coupon is distributed."
            : `The per-token coupon works out at ${usdc(perToken)} against a NAV of ${usdc(nav)}. NAV drops by the per-token amount at the moment of distribution, so it must be strictly below NAV or the price would fall to zero.`,
      };
    }

    // ---- NAV and admin rails -----------------------------------------------------------------
    case "NavMoveExceedsRail": {
      const anchor = asBigInt(a0);
      const next = asBigInt(a1);
      const maxBps = asBigInt(a2);
      return {
        title: "NAV move exceeds the rail",
        message:
          anchor === null || next === null || maxBps === null
            ? "The new NAV moves further than the oracle rail allows in one 24-hour window."
            : `${usdc(next)} is more than ${formatBasisPointsAsPercent(maxBps)} away from ${usdc(anchor)}, the NAV at the start of the current 24-hour window. The rail is anchored to the window, not to the last update, so a compromised oracle key cannot walk the price. Only an admin can force a move past it, and a forced move emits its own event.`,
        details:
          anchor === null || next === null || maxBps === null
            ? undefined
            : [
                { label: "Window anchor", value: usdc(anchor), mono: "num" },
                { label: "Proposed NAV", value: usdc(next), mono: "num" },
                { label: "Rail", value: formatBasisPointsAsPercent(maxBps), mono: "num" },
              ],
      };
    }
    case "InvalidNav":
      return {
        title: "That NAV is not valid",
        message:
          "NAV must be greater than zero and no larger than the contract's input ceiling. Zero would make every token worthless in one call, so it is rejected outright.",
      };
    case "InvalidBps": {
      const bps = asBigInt(a0);
      return {
        title: "That is not a valid basis-point value",
        message: `${bps === null ? "The value supplied" : bps.toString()} is above 10,000 basis points, which is 100%. Pick a value between 0 and 10,000.`,
      };
    }
    case "AmountTooLarge":
      return {
        title: "That amount is too large",
        message:
          "Every amount, NAV and reported AUM is capped at 2^128 − 1 so that the contract's arithmetic provably fits in 256 bits. The cap is orders of magnitude above any real amount; this value is above it.",
      };

    // ---- pause, roles, guards ----------------------------------------------------------------
    case "EnforcedPause":
      return {
        title: "The token is paused",
        message:
          "While the token is paused everything that moves value stops: transfers, subscribe, redeem, coupon distribution and claims. NAV updates and registry changes keep working. An issuer has to unpause before this will go through.",
        retryable: true,
      };
    case "ExpectedPause":
      return {
        title: "The token is not paused",
        message: "It cannot be unpaused, because it is not paused.",
      };
    case "AccessControlUnauthorizedAccount": {
      return {
        title: "This key does not hold the required role",
        message: `${shortAddress(a0)} does not hold the ${roleName(a1)}, which this action requires. Roles are separate on purpose — the admin, issuer, oracle and registrar keys are distinct from the first deployment.`,
        details: [
          { label: "Account", value: String(a0), mono: "addr" },
          { label: "Required role", value: roleName(a1) },
        ],
      };
    }
    case "AccessControlBadConfirmation":
      return {
        title: "A role can only be renounced by its own holder",
        message:
          "`renounceRole` has to be called by the account losing the role, and the address passed did not match the caller.",
      };
    case "ReentrancyGuardReentrantCall":
      return {
        title: "Re-entrant call rejected",
        message:
          "The contract refuses to be re-entered while one of its value-moving functions is still running. This normally means the call came from a contract that calls back in.",
      };

    // ---- token plumbing ----------------------------------------------------------------------
    case "ERC20InsufficientBalance": {
      const balance = asBigInt(a1);
      const needed = asBigInt(a2);
      return {
        title: "Not enough balance",
        message:
          balance === null || needed === null
            ? `${shortAddress(a0)} does not hold enough of the token this transaction moves.`
            : `${shortAddress(a0)} holds ${erc20Amount(balance, token)} and this transaction needs ${erc20Amount(needed, token)}.`,
        details:
          balance === null || needed === null
            ? undefined
            : [
                { label: "Balance", value: erc20Amount(balance, token), mono: "num" },
                { label: "Needed", value: erc20Amount(needed, token), mono: "num" },
              ],
      };
    }
    case "ERC20InsufficientAllowance": {
      const allowance = asBigInt(a1);
      const needed = asBigInt(a2);
      return {
        title: "Approve more first",
        message:
          allowance === null || needed === null
            ? `${shortAddress(a0)} is not approved to move enough of the token this transaction needs. Approve it and try again.`
            : `${shortAddress(a0)} is approved to move ${erc20Amount(allowance, token)} and this transaction needs ${erc20Amount(needed, token)}. Approve at least ${erc20Amount(needed, token)}, then submit again.`,
        details:
          allowance === null || needed === null
            ? undefined
            : [
                { label: "Spender", value: String(a0), mono: "addr" },
                { label: "Approved", value: erc20Amount(allowance, token), mono: "num" },
                { label: "Needed", value: erc20Amount(needed, token), mono: "num" },
              ],
      };
    }
    case "ERC20InvalidReceiver":
      return {
        title: "That recipient is not valid",
        message: `${shortAddress(a0)} cannot receive this token. The zero address is never a valid recipient.`,
      };
    case "ERC20InvalidSender":
      return {
        title: "That sender is not valid",
        message: `${shortAddress(a0)} cannot send this token. The zero address is never a valid sender.`,
      };
    case "ERC20InvalidSpender":
      return {
        title: "That spender is not valid",
        message: `${shortAddress(a0)} cannot be approved as a spender.`,
      };
    case "ERC20InvalidApprover":
      return {
        title: "That approver is not valid",
        message: `${shortAddress(a0)} cannot grant an approval.`,
      };
    case "SafeERC20FailedOperation":
      return {
        title: "The USDC transfer failed",
        message: `The token at ${shortAddress(a0)} rejected the transfer, so the whole transaction was rolled back. Nothing moved.`,
      };

    // ---- faucet -------------------------------------------------------------------------------
    case "FaucetAmountTooLarge": {
      const amount = asBigInt(a0);
      const cap = asBigInt(a1);
      return {
        title: "The faucet will not mint that much at once",
        message:
          amount === null || cap === null
            ? "The faucet has a per-call cap and this request is above it. Ask for less."
            : `The faucet mints at most ${UNITS.usdc.format(cap)} mUSDC per call and this asked for ${UNITS.usdc.format(amount)}. Ask for the cap or less.`,
      };
    }
    case "FaucetDailyCapExceeded": {
      const remaining = asBigInt(a0);
      return {
        title: "The faucet is used up for this address",
        message:
          remaining === null
            ? "This address has reached its faucet limit for the current 24-hour window."
            : `This address has ${UNITS.usdc.format(remaining)} mUSDC left in its current 24-hour faucet window. Ask for that or less, or wait for the window to reset.`,
        retryable: true,
      };
    }

    // ---- shared guards -------------------------------------------------------------------------
    case "ZeroAmount":
      return {
        title: "The amount must be above zero",
        message: "Enter an amount greater than zero.",
      };
    case "ZeroAddress":
      return {
        title: "The zero address is not accepted",
        message: "This argument cannot be the zero address.",
      };
    case "SafeCastOverflowedUintDowncast":
      return {
        title: "A value did not fit",
        message: "A value was too large for the width the contract stores it in.",
      };

    // ---- the two built-in Solidity errors --------------------------------------------------------
    case "Error": {
      const reason = typeof a0 === "string" ? a0.trim() : "";
      return {
        title: "The contract refused this transaction",
        message: reason
          ? `The contract gave this reason: "${reason}".`
          : "The contract reverted without giving a reason.",
      };
    }
    case "Panic": {
      const code = asBigInt(a0);
      const key = code === null ? null : (`0x${code.toString(16).padStart(2, "0")}` as string);
      const reason = key ? PANIC_REASONS[key] : undefined;
      return {
        title: "The contract hit an internal error",
        message: reason
          ? `The transaction failed inside the contract on ${reason}. This is a bug rather than a rule, and it is worth reporting.`
          : "The transaction failed on an internal error inside the contract. This is a bug rather than a rule, and it is worth reporting.",
      };
    }

    default:
      return null;
  }
}

// --------------------------------------------------------------------------- decoding

/**
 * Decode raw revert data (`0x` + 4-byte selector + ABI-encoded arguments) into a failure.
 *
 * Returns `null` when the data is empty or the selector belongs to no error in the three ABIs —
 * the caller then reports the failure honestly as undecoded rather than inventing a cause.
 */
export function decodeRevertData(data: Hex, options: DecodeTxErrorOptions = {}): TxFailure | null {
  let decoded;
  try {
    decoded = decodeErrorResult({ abi: CONTRACT_ERROR_ABI, data });
  } catch {
    return null;
  }
  return failureFromDecoded(decoded.errorName, decoded.args, options);
}

function failureFromDecoded(
  errorName: string,
  args: readonly unknown[] | undefined,
  options: DecodeTxErrorOptions,
): TxFailure {
  const copy = revertCopy(errorName, args, options);
  if (copy) {
    return {
      kind: "reverted",
      title: copy.title,
      message: copy.message,
      errorName,
      details: copy.details,
      retryable: copy.retryable ?? false,
    };
  }
  // A custom error the contracts gained after this table was written. Name it rather than hide it:
  // the name is at least a term a reader can search the compliance rules for.
  return {
    kind: "reverted",
    title: "The contract refused this transaction",
    message: `The contract rejected it with ${errorName}. That rule is described in the compliance rules; nothing was changed on chain.`,
    errorName,
    retryable: false,
  };
}

// --------------------------------------------------------------------------- error-chain walking

/**
 * A viem/wagmi error as seen from the outside.
 *
 * Duck-typed on purpose. `instanceof` would be the obvious way to recognise viem's error classes,
 * and it is the wrong one here: the dependency tree contains more than one copy of viem, so an
 * error thrown through a connector can be an instance of a *different* `BaseError` constructor than
 * the one this module imported, and every check would silently return false. Reading `name`,
 * `code` and `data` works whichever copy produced the error, and it also means the unit tests can
 * build realistic errors out of plain objects.
 */
interface ErrorLike {
  name?: unknown;
  message?: unknown;
  shortMessage?: unknown;
  details?: unknown;
  code?: unknown;
  data?: unknown;
  raw?: unknown;
  reason?: unknown;
  cause?: unknown;
}

const MAX_CAUSE_DEPTH = 16;

function errorChain(error: unknown): ErrorLike[] {
  const chain: ErrorLike[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== null && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    chain.push(current as ErrorLike);
    if (chain.length >= MAX_CAUSE_DEPTH) break;
    current = (current as ErrorLike).cause;
  }
  return chain;
}

const HEX_DATA = /^0x[0-9a-fA-F]*$/;

/** Pull the revert payload out of a link in the chain, wherever that viem version put it. */
function revertPayload(
  link: ErrorLike,
): Hex | { errorName: string; args?: readonly unknown[] } | null {
  // `ContractFunctionRevertedError.raw`, and the plain `{ data: "0x…" }` a provider returns.
  for (const candidate of [link.raw, link.data]) {
    if (typeof candidate === "string" && HEX_DATA.test(candidate) && candidate.length >= 10) {
      return candidate as Hex;
    }
    if (candidate && typeof candidate === "object") {
      // `RawContractError.data` may itself be `{ data: "0x…" }`.
      const inner = (candidate as { data?: unknown }).data;
      if (typeof inner === "string" && HEX_DATA.test(inner) && inner.length >= 10)
        return inner as Hex;
      // `ContractFunctionRevertedError.data` is already decoded by viem when the call's own ABI
      // happened to contain the error. Reuse it rather than re-decoding.
      const errorName = (candidate as { errorName?: unknown }).errorName;
      if (typeof errorName === "string") {
        const args = (candidate as { args?: unknown }).args;
        return { errorName, args: Array.isArray(args) ? (args as readonly unknown[]) : undefined };
      }
    }
  }
  return null;
}

function chainHasName(chain: ErrorLike[], names: readonly string[]): boolean {
  return chain.some((link) => typeof link.name === "string" && names.includes(link.name));
}

function chainHasCode(chain: ErrorLike[], codes: readonly number[]): boolean {
  return chain.some((link) => typeof link.code === "number" && codes.includes(link.code));
}

function chainText(chain: ErrorLike[]): string {
  return chain
    .flatMap((link) => [link.shortMessage, link.details, link.message])
    .filter((value): value is string => typeof value === "string")
    .join(" — ");
}

/** The most specific message viem produced, for the collapsed technical block. */
function rawMessage(chain: ErrorLike[]): string | undefined {
  for (const link of chain) {
    if (typeof link.shortMessage === "string" && link.shortMessage.trim()) return link.shortMessage;
  }
  for (const link of chain) {
    if (typeof link.message === "string" && link.message.trim()) return link.message.split("\n")[0];
  }
  return undefined;
}

const REJECTION_NAMES = ["UserRejectedRequestError"];
const REJECTION_TEXT =
  /user rejected|user denied|denied transaction|rejected the request|request rejected/i;
const DISCONNECT_NAMES = [
  "ConnectorNotConnectedError",
  "ConnectorAccountNotFoundError",
  "ConnectorUnavailableReconnectingError",
  "ProviderNotFoundError",
  "ProviderDisconnectedError",
  "ChainDisconnectedError",
];
const DISCONNECT_TEXT =
  /connector not connected|provider not found|wallet is disconnected|no ethereum provider/i;
const CHAIN_MISMATCH_NAMES = ["ChainMismatchError", "ConnectorChainMismatchError"];
const UNSUPPORTED_CHAIN_NAMES = ["ChainNotConfiguredError", "SwitchChainNotSupportedError"];
const TIMEOUT_NAMES = [
  "WaitForTransactionReceiptTimeoutError",
  "TransactionNotFoundError",
  "TransactionReceiptNotFoundError",
  "TimeoutError",
];
const NETWORK_NAMES = [
  "HttpRequestError",
  "RpcRequestError",
  "InternalRpcError",
  "WebSocketRequestError",
  "SocketClosedError",
  "LimitExceededRpcError",
];

/**
 * Turn anything thrown by wagmi, viem or an EIP-1193 provider into something worth showing.
 *
 * The order of the checks is the point. A rejection wrapped around a revert is still a rejection; a
 * revert wrapped in a gas-estimation failure is still a revert. Each branch is decided on a
 * property the error definitely carries — a name, an EIP-1193 code, a hex payload — not on a
 * substring of its message, except where nothing else is available and the substring is the
 * wallet's own wording.
 */
export function decodeTxError(error: unknown, options: DecodeTxErrorOptions = {}): TxFailure {
  const action = options.action ?? "This transaction";
  const chain = errorChain(error);
  const raw = rawMessage(chain) ?? (typeof error === "string" ? error : undefined);
  const text = chainText(chain);

  if (chain.length === 0) {
    return {
      kind: "unknown",
      title: `${action} failed`,
      message:
        "The wallet returned no information about what went wrong. Nothing is known to have reached the chain; check your wallet before trying again.",
      retryable: true,
      raw,
    };
  }

  // 1 — the person said no. EIP-1193 4001, or viem's wrapper around it.
  if (
    chainHasCode(chain, [4001]) ||
    chainHasName(chain, REJECTION_NAMES) ||
    REJECTION_TEXT.test(text)
  ) {
    return {
      kind: "rejected",
      title: "You declined the request",
      message: `${action} was cancelled in your wallet, so nothing was sent and nothing was spent. You can start it again whenever you like.`,
      retryable: true,
      raw,
    };
  }

  // 2 — a request is already open in the wallet. Re-submitting just queues another one.
  if (chainHasCode(chain, [-32002])) {
    return {
      kind: "wallet-busy",
      title: "Your wallet already has a request open",
      message:
        "Open your wallet and finish or dismiss the request that is already waiting there, then try again. Submitting again now would only add to the queue.",
      retryable: true,
      raw,
    };
  }

  // 3 — the wallet does not know this network (4902) and would not add it.
  if (chainHasCode(chain, [4902]) || chainHasName(chain, UNSUPPORTED_CHAIN_NAMES)) {
    const facts = walletNetworkFacts();
    return {
      kind: "unsupported-chain",
      title: `Your wallet does not know ${facts.label}`,
      message: `Your wallet has no entry for ${facts.label} and did not add it when asked. Add it by hand — chain id ${facts.chainId} (${facts.chainIdHex}), RPC ${facts.rpcUrl}, currency ${facts.currencySymbol} — then try again.`,
      retryable: false,
      raw,
    };
  }

  // 4 — the wallet is attached to the wrong network.
  if (chainHasName(chain, CHAIN_MISMATCH_NAMES)) {
    const facts = walletNetworkFacts();
    return {
      kind: "wrong-network",
      title: "Your wallet is on the wrong network",
      message: `This app only talks to ${facts.label} (chain id ${facts.chainId}). Switch networks in your wallet, then try again.`,
      retryable: true,
      raw,
    };
  }

  // 5 — the wallet went away. Whether anything was sent is the caller's to say; it holds the hash.
  if (
    chainHasCode(chain, [4900, 4901]) ||
    chainHasName(chain, DISCONNECT_NAMES) ||
    DISCONNECT_TEXT.test(text)
  ) {
    return {
      kind: "disconnected",
      title: "Your wallet is not connected",
      message:
        "The wallet disconnected before this could be signed, so nothing was sent. Reconnect and start again — anything already on chain is unaffected.",
      retryable: true,
      raw,
    };
  }

  // 6 — a contract refused. This is the branch the whole module is built around.
  for (const link of chain) {
    const payload = revertPayload(link);
    if (!payload) continue;
    if (typeof payload === "string") {
      const failure = decodeRevertData(payload, options);
      if (failure) return { ...failure, raw };
      continue;
    }
    return { ...failureFromDecoded(payload.errorName, payload.args, options), raw };
  }

  // A string revert viem already unpacked into `reason`, with no data left to decode.
  for (const link of chain) {
    if (typeof link.reason === "string" && link.reason.trim()) {
      return { ...failureFromDecoded("Error", [link.reason], options), raw };
    }
  }

  // 7 — no gas money. A revert and an empty tank look similar from the outside and are not.
  if (/insufficient funds/i.test(text)) {
    const facts = walletNetworkFacts();
    return {
      kind: "insufficient-gas",
      title: `Not enough ${facts.currencySymbol} for gas`,
      message: `This account cannot pay the gas for ${facts.label}. Top it up from a ${facts.label} faucet — the amounts involved are test funds with no value — and try again.`,
      retryable: true,
      raw,
    };
  }

  // 8 — broadcast, but no receipt in the window we waited. It may still confirm.
  if (chainHasName(chain, TIMEOUT_NAMES)) {
    return {
      kind: "timeout",
      title: "No confirmation yet",
      message:
        "The transaction was sent but no receipt arrived while this page was watching. It may still confirm — follow the hash on the explorer before sending it again, so you do not send it twice.",
      retryable: false,
      raw,
    };
  }

  // 9 — the transport.
  if (chainHasName(chain, NETWORK_NAMES) || chainHasCode(chain, [-32603])) {
    return {
      kind: "network",
      title: "The network did not answer",
      message: `${action} could not be completed because the RPC endpoint failed to respond. This is a testnet, so a retry usually clears it.`,
      retryable: true,
      raw,
    };
  }

  // 10 — honest about not knowing.
  const reverted = chainHasName(chain, [
    "ContractFunctionRevertedError",
    "ContractFunctionExecutionError",
  ]);
  return {
    kind: reverted ? "reverted" : "unknown",
    title: reverted ? "The contract refused this transaction" : `${action} failed`,
    message: reverted
      ? "The contract reverted without data this app can decode, so the exact rule is not known here. Nothing was changed on chain. The technical detail below is what the node returned."
      : "Something went wrong that this app does not recognise. The technical detail below is exactly what the wallet returned; nothing has been hidden or reworded.",
    retryable: !reverted,
    raw,
  };
}

/**
 * The wallet went away while a write was in flight.
 *
 * `broadcast` is what stops this dead-ending. Before a signature there is nothing on chain and
 * reconnecting is the whole fix; after one, the transaction is the chain's business and will
 * confirm or not regardless of whether a wallet is still attached, so the message says so and the
 * caller keeps the hash (and therefore the explorer link) beside it.
 */
export function walletDisconnectedFailure(
  action = "This transaction",
  broadcast = false,
): TxFailure {
  return broadcast
    ? {
        kind: "disconnected",
        title: "Your wallet disconnected",
        message: `${action} had already been broadcast, so it is on chain and will confirm or fail on its own — this page is still watching it. Reconnect when you want to send anything else.`,
        retryable: false,
      }
    : {
        kind: "disconnected",
        title: "Your wallet disconnected",
        message: `${action} was never signed, so nothing was sent and nothing was spent. Reconnect your wallet and start again.`,
        retryable: true,
      };
}

/**
 * A receipt that came back `reverted` — mined, gas spent, state unchanged.
 *
 * There is no reason in a receipt. The reason lives in the simulation that should have caught this
 * before signing, so `useTx` simulates first and this message stays deliberately plain rather than
 * guessing at a cause it cannot see.
 */
export function revertedReceiptFailure(action = "This transaction"): TxFailure {
  return {
    kind: "reverted",
    title: "Mined, but the contract reverted",
    message: `${action} reached the chain and was rejected by the contract while executing. Gas was spent; nothing else changed. A receipt carries no reason, so check the transaction on the explorer for the details.`,
    retryable: false,
  };
}
