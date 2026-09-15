/**
 * The arithmetic and the gates behind `/subscribe`, with no React and no wagmi in sight.
 *
 * Everything here is a pure function of (what the chain said, what the person typed). That split is
 * the point: the numbers this page quotes have to equal the numbers `HBToken.subscribe` will
 * settle, and a function that takes integers and returns integers is the only version of that
 * claim anyone can check.
 *
 * Two rules run through the file.
 *
 *  1. **Truncate, never round** (PLAN.md D52). `previewSubscribeTokens` is integer division on
 *     bigints, the same floor the EVM performs, and user input is truncated down to six decimals
 *     with the loss reported rather than hidden. The interface must not promise a token amount the
 *     chain would refuse to mint.
 *  2. **A gate explains itself.** Every reason a subscription could fail is a `Gate` with a
 *     sentence naming the rule, the numbers involved and the way out — not a disabled button. The
 *     rules are the contract's: `BelowMinimum` (D13), `NotEligible` (the registry whitelist),
 *     `Pausable` (D3), the ERC-20 allowance and balance, and the faucet's 24-hour cap (D14).
 */

import { getCountryByNumeric } from "@/lib/countries";
import {
  MAX_INPUT,
  USDC_DECIMALS,
  formatUnixSeconds,
  formatUsdcExact,
  parseAmount,
  previewSubscribeTokens,
} from "@/lib/format";

// --------------------------------------------------------------------------- NAV

/**
 * Where the NAV in the quote came from.
 *
 * `"chain"` is `HBToken.nav()` — the number a subscription actually settles at. `"published"` is
 * the engine's `nav.json`, used only to keep the arithmetic visible when there is no deployment to
 * read from; a quote built on it is indicative and is labelled as such everywhere it appears.
 */
export type NavSource = "chain" | "published";

export interface NavReading {
  readonly source: NavSource;
  /** NAV per token, 6 decimals, exactly as the contract stores it. */
  readonly nav6: bigint;
  /** When this NAV was set (chain) or computed (engine), already formatted. */
  readonly asOf: string;
  /** True only when a subscription would settle at this number. */
  readonly settles: boolean;
}

export function chainNav(nav6: bigint, navUpdatedAt: bigint | null): NavReading {
  return {
    source: "chain",
    nav6,
    asOf: navUpdatedAt && navUpdatedAt > 0n ? formatUnixSeconds(navUpdatedAt) : "time not recorded",
    settles: true,
  };
}

export function publishedNav(nav6: bigint, asOfDate: string): NavReading {
  return { source: "published", nav6, asOf: asOfDate, settles: false };
}

// --------------------------------------------------------------------------- the amount box

export interface AmountReading {
  /** Exactly what is in the input. */
  readonly text: string;
  readonly empty: boolean;
  /** The 6-decimal integer that would be sent, or `null` when the text is not usable. */
  readonly value6: bigint | null;
  /** Why the text is not usable, phrased for the person who typed it. */
  readonly error: string | null;
  /** The text carried more than six decimals and the extra was dropped, not rounded (D52). */
  readonly truncated: boolean;
}

const EMPTY_AMOUNT: AmountReading = {
  text: "",
  empty: true,
  value6: null,
  error: null,
  truncated: false,
};

/**
 * Parse the amount box.
 *
 * Empty is not an error — it is the starting state, and shouting at somebody who has not typed
 * anything yet is noise. Zero and anything above the contract's `MAX_INPUT` ceiling (D28) are
 * errors, because both of them would revert.
 */
export function readAmount(text: string): AmountReading {
  if (text.trim() === "") return { ...EMPTY_AMOUNT, text };

  const parsed = parseAmount(text, USDC_DECIMALS);
  if (!parsed.ok) {
    return { text, empty: false, value6: null, error: parsed.error, truncated: false };
  }
  if (parsed.value === 0n) {
    return {
      text,
      empty: false,
      value6: null,
      error: "Enter an amount above zero. `subscribe` reverts with `ZeroAmount` at zero.",
      truncated: parsed.truncated,
    };
  }
  if (parsed.value > MAX_INPUT) {
    return {
      text,
      empty: false,
      value6: null,
      error:
        "That is above the contract's input ceiling of 2^128 − 1 USDC units, which it rejects with `AmountTooLarge`.",
      truncated: parsed.truncated,
    };
  }
  return { text, empty: false, value6: parsed.value, error: null, truncated: parsed.truncated };
}

/** The amount box pre-filled from a 6-decimal integer, e.g. by "Minimum" or "Max". */
export function amountTextFromUsdc6(value6: bigint): string {
  return formatUsdcExact(value6).replace(/,/g, "");
}

// --------------------------------------------------------------------------- the quote

export interface SubscribeQuote {
  readonly nav: NavReading | null;
  readonly amount6: bigint | null;
  /** `usdcAmount * 1e18 / nav`, floored — `HBToken.previewSubscribe` exactly (BUILD_PROMPT 16.4). */
  readonly tokensOut18: bigint | null;
  /** The input carried more than six decimals. */
  readonly truncatedAmount: boolean;
  /** The division left a remainder, so the mint is strictly less than the exact ratio. */
  readonly truncatedTokens: boolean;
}

export function buildQuote(amount: AmountReading, nav: NavReading | null): SubscribeQuote {
  if (amount.value6 === null || nav === null || nav.nav6 <= 0n) {
    return {
      nav,
      amount6: amount.value6,
      tokensOut18: null,
      truncatedAmount: amount.truncated,
      truncatedTokens: false,
    };
  }
  const tokensOut18 = previewSubscribeTokens(amount.value6, nav.nav6);
  return {
    nav,
    amount6: amount.value6,
    tokensOut18,
    truncatedAmount: amount.truncated,
    truncatedTokens: (amount.value6 * 10n ** 18n) % nav.nav6 !== 0n,
  };
}

// --------------------------------------------------------------------------- what the chain said

/** How the batch of contract reads is doing. */
export type ReadState = "no-deployment" | "loading" | "ready" | "error";

export interface SubscribeChainState {
  readonly reads: ReadState;
  /** Why the reads are unusable, when they are. */
  readonly reason: string | null;
  readonly nav6: bigint | null;
  readonly navUpdatedAt: bigint | null;
  readonly minSubscription6: bigint | null;
  readonly paused: boolean | null;
  /** `IdentityRegistry.identityOf` — the whitelist record, when there is one. */
  readonly identity: { readonly verified: boolean; readonly country: number } | null;
  /** `IdentityRegistry.canHold` — verified **and** not in a blocked country. */
  readonly canHold: boolean | null;
  readonly usdcBalance6: bigint | null;
  readonly allowance6: bigint | null;
  readonly faucetCap6: bigint | null;
  readonly faucetRemaining6: bigint | null;
  /** `windowStart + FAUCET_WINDOW`, unix seconds: when the faucet allowance refreshes. */
  readonly faucetWindowEndsAt: bigint | null;
}

export const EMPTY_CHAIN_STATE: SubscribeChainState = {
  reads: "loading",
  reason: null,
  nav6: null,
  navUpdatedAt: null,
  minSubscription6: null,
  paused: null,
  identity: null,
  canHold: null,
  usdcBalance6: null,
  allowance6: null,
  faucetCap6: null,
  faucetRemaining6: null,
  faucetWindowEndsAt: null,
};

/** The NAV to quote at: the chain's when it can be read, otherwise the published one, labelled. */
export function resolveNav(
  chain: SubscribeChainState,
  published: NavReading | null,
): NavReading | null {
  if (chain.nav6 !== null && chain.nav6 > 0n) return chainNav(chain.nav6, chain.navUpdatedAt);
  return published;
}

// --------------------------------------------------------------------------- the gates

export type GateStatus =
  /** Satisfied. */
  | "ok"
  /** Would make the transaction revert, or there is nothing to send it to. */
  | "blocked"
  /** Cannot be checked yet — nothing has been typed, or an earlier gate has to pass first. */
  | "waiting"
  /** Should be checkable and is not: a read failed, or there is no deployment behind it. */
  | "unknown";

/** The control a gate offers as its way forward. The page decides how to render each one. */
export type GateAction = "connect" | "switch" | "verify" | "faucet" | "approve" | "amount" | null;

export interface Gate {
  readonly id: string;
  readonly label: string;
  readonly status: GateStatus;
  /** One or two sentences: the rule, the numbers, and what to do about it. */
  readonly detail: string;
  readonly action: GateAction;
}

export type NetworkPhase = "connecting" | "disconnected" | "wrong-network" | "ready";

export interface GateInput {
  readonly network: NetworkPhase;
  readonly requiredChainLabel: string;
  readonly currentChainLabel: string | null;
  readonly currentChainId: number | undefined;
  readonly chain: SubscribeChainState;
  readonly amount: AmountReading;
}

const usdc = (value: bigint) => `${formatUsdcExact(value)} USDC`;

function walletGate(input: GateInput): Gate {
  switch (input.network) {
    case "connecting":
      return {
        id: "wallet",
        label: "Wallet connected",
        status: "waiting",
        detail: "Checking whether a wallet is already connected to this page.",
        action: null,
      };
    case "disconnected":
      return {
        id: "wallet",
        label: "Wallet connected",
        status: "blocked",
        detail:
          "Your balance, your allowance and your verification are all read per address, so none of them can be checked — and nothing can be signed — until a wallet is connected.",
        action: "connect",
      };
    default:
      return {
        id: "wallet",
        label: "Wallet connected",
        status: "ok",
        detail: "A wallet is connected and this page is reading against its address.",
        action: null,
      };
  }
}

function networkGate(input: GateInput): Gate {
  const label = `Connected to ${input.requiredChainLabel}`;
  if (input.network === "connecting" || input.network === "disconnected") {
    return {
      id: "network",
      label,
      status: "waiting",
      detail: `The network is checked once a wallet is connected. This app talks to ${input.requiredChainLabel} and to no other chain.`,
      action: null,
    };
  }
  if (input.network === "wrong-network") {
    const on =
      input.currentChainLabel ??
      (input.currentChainId === undefined ? "another network" : `chain ${input.currentChainId}`);
    return {
      id: "network",
      label,
      status: "blocked",
      detail: `Your wallet is on ${on}. hbTRS exists only on ${input.requiredChainLabel}, and a transaction signed on another chain would never reach it.`,
      action: "switch",
    };
  }
  return {
    id: "network",
    label,
    status: "ok",
    detail: `Your wallet is on ${input.requiredChainLabel}.`,
    action: null,
  };
}

function deploymentGate(input: GateInput): Gate {
  const label = `hbTRS deployed on ${input.requiredChainLabel}`;
  switch (input.chain.reads) {
    case "no-deployment":
      return {
        id: "deployment",
        label,
        status: "unknown",
        detail:
          input.chain.reason ??
          `No deployment is recorded for ${input.requiredChainLabel}, so there is no contract to read the NAV, the minimum or the paused flag from, and nothing to subscribe to.`,
        action: null,
      };
    case "error":
      return {
        id: "deployment",
        label,
        status: "unknown",
        detail:
          input.chain.reason ??
          `The contracts could not be read on ${input.requiredChainLabel}. Until they answer, nothing on this page can be quoted against the chain.`,
        action: null,
      };
    case "loading":
      return {
        id: "deployment",
        label,
        status: "waiting",
        detail: "Reading the token and the registry.",
        action: null,
      };
    default:
      return {
        id: "deployment",
        label,
        status: "ok",
        detail: `The token, the registry and the test USDC contract all answered on ${input.requiredChainLabel}.`,
        action: null,
      };
  }
}

function pausedGate(input: GateInput): Gate {
  const label = "Token not paused";
  if (input.chain.paused === null) {
    return {
      id: "paused",
      label,
      status: input.chain.reads === "loading" ? "waiting" : "unknown",
      detail:
        "The pause flag is read from `paused()` on the token. It has not answered, so this cannot be confirmed either way.",
      action: null,
    };
  }
  if (input.chain.paused) {
    return {
      id: "paused",
      label,
      status: "blocked",
      detail:
        "The issuer has paused the token. While it is paused, subscriptions, redemptions, transfers, coupon distributions and claims all stop (COMPLIANCE_RULES section 6), so a subscription would revert. NAV updates and registry changes keep working, and this page will unblock itself when the token is unpaused.",
      action: null,
    };
  }
  return {
    id: "paused",
    label,
    status: "ok",
    detail: "The token is not paused, so value can move.",
    action: null,
  };
}

function verificationGate(input: GateInput): Gate {
  const label = "Wallet verified in the identity registry";
  if (input.network !== "ready") {
    return {
      id: "verified",
      label,
      status: "waiting",
      detail:
        "Verification is recorded per address in the on-chain identity registry, so it is checked once a wallet is connected.",
      action: null,
    };
  }
  if (input.chain.canHold === null) {
    return {
      id: "verified",
      label,
      status: input.chain.reads === "loading" ? "waiting" : "unknown",
      detail:
        "`IdentityRegistry.canHold` is what `subscribe` checks. The registry has not answered, so this cannot be confirmed.",
      action: null,
    };
  }
  if (input.chain.canHold) {
    const country = input.chain.identity?.country;
    const where = country ? ` Recorded country: ${describeCountryCode(country)}.` : "";
    return {
      id: "verified",
      label,
      status: "ok",
      detail: `This address is verified and its country is not blocked, so it can receive hbTRS.${where}`,
      action: null,
    };
  }
  if (input.chain.identity?.verified === true) {
    const country = input.chain.identity.country;
    return {
      id: "verified",
      label,
      status: "blocked",
      detail: `This address is verified, but its recorded country — ${describeCountryCode(country)} — is on the registry's blocklist, so it can no longer receive hbTRS and \`subscribe\` reverts with \`NotEligible\`. A blocklist change takes effect immediately and does not delete the verification record.`,
      action: null,
    };
  }
  return {
    id: "verified",
    label,
    status: "blocked",
    detail:
      "This address is not in the identity registry. hbTRS is whitelisted on-chain: `subscribe` mints to the caller, and the mint reverts with `NotEligible` for an address that cannot hold. Request verification first.",
    action: "verify",
  };
}

function describeCountryCode(numeric: number): string {
  const country = getCountryByNumeric(numeric);
  return country ? `${country.name} (${country.numeric})` : `country ${numeric}`;
}

function minimumGate(input: GateInput): Gate {
  const label = "At or above the minimum subscription";
  const min = input.chain.minSubscription6;
  if (input.amount.value6 === null) {
    return {
      id: "minimum",
      label,
      status: "waiting",
      detail:
        min === null
          ? "The minimum is read from `minSubscription()` on the token, and is checked once you enter an amount."
          : `The token's minimum is ${usdc(min)}. Enter an amount to check it.`,
      action: null,
    };
  }
  if (min === null) {
    return {
      id: "minimum",
      label,
      status: "unknown",
      detail:
        "The minimum is `minSubscription()` on the deployed token — an admin-settable value, not a constant this app may assume. It has not answered, so the amount cannot be checked against it.",
      action: null,
    };
  }
  if (input.amount.value6 < min) {
    return {
      id: "minimum",
      label,
      status: "blocked",
      detail: `The token's minimum is ${usdc(min)} and this is ${usdc(input.amount.value6)}. \`subscribe\` reverts with \`BelowMinimum(${formatUsdcExact(min)}, ${formatUsdcExact(input.amount.value6)})\`.`,
      action: "amount",
    };
  }
  return {
    id: "minimum",
    label,
    status: "ok",
    detail: `${usdc(input.amount.value6)} is at or above the token's ${usdc(min)} minimum.`,
    action: null,
  };
}

function balanceGate(input: GateInput): Gate {
  const label = "Enough test USDC";
  const balance = input.chain.usdcBalance6;
  if (input.network !== "ready" || input.amount.value6 === null) {
    return {
      id: "balance",
      label,
      status: "waiting",
      detail:
        balance === null
          ? "Your test USDC balance is checked against the amount once a wallet is connected and an amount is entered."
          : `Your balance is ${usdc(balance)}. Enter an amount to check it.`,
      action: null,
    };
  }
  if (balance === null) {
    return {
      id: "balance",
      label,
      status: input.chain.reads === "loading" ? "waiting" : "unknown",
      detail:
        "Your test USDC balance could not be read, so it cannot be checked against the amount.",
      action: null,
    };
  }
  if (balance < input.amount.value6) {
    const short = input.amount.value6 - balance;
    return {
      id: "balance",
      label,
      status: "blocked",
      detail: `You hold ${usdc(balance)} and this subscription needs ${usdc(input.amount.value6)} — ${usdc(short)} short. The transfer into the vault would revert with \`ERC20InsufficientBalance\`. Mint more from the faucet below, within its 24-hour cap.`,
      action: "faucet",
    };
  }
  return {
    id: "balance",
    label,
    status: "ok",
    detail: `You hold ${usdc(balance)}, which covers ${usdc(input.amount.value6)}.`,
    action: null,
  };
}

function allowanceGate(input: GateInput): Gate {
  const label = "Allowance covers the subscription";
  const allowance = input.chain.allowance6;
  if (input.network !== "ready" || input.amount.value6 === null) {
    return {
      id: "allowance",
      label,
      status: "waiting",
      detail:
        "The token contract moves your USDC with `transferFrom`, so it needs an ERC-20 allowance. It is checked once a wallet is connected and an amount is entered.",
      action: null,
    };
  }
  if (allowance === null) {
    return {
      id: "allowance",
      label,
      status: input.chain.reads === "loading" ? "waiting" : "unknown",
      detail: "Your allowance for the token contract could not be read.",
      action: null,
    };
  }
  if (allowance < input.amount.value6) {
    return {
      id: "allowance",
      label,
      status: "blocked",
      detail:
        allowance === 0n
          ? `The token contract has no allowance on your USDC, so step 1 below approves exactly ${usdc(input.amount.value6)}. Without it the subscription reverts with \`ERC20InsufficientAllowance\`.`
          : `Your allowance is ${usdc(allowance)} and this needs ${usdc(input.amount.value6)}. Step 1 below raises it to exactly the amount being subscribed.`,
      action: "approve",
    };
  }
  return {
    id: "allowance",
    label,
    status: "ok",
    detail: `Your existing allowance of ${usdc(allowance)} already covers ${usdc(input.amount.value6)}, so there is no second transaction to sign — approving again would cost gas and change nothing.`,
    action: null,
  };
}

/**
 * Every condition `subscribe` imposes, in the order they are checked, each with the rule it comes
 * from. The list is rendered whole, passing and failing alike: a person who cannot subscribe should
 * be able to see which single thing is in the way, not infer it from a greyed-out button.
 */
export function buildGates(input: GateInput): readonly Gate[] {
  return [
    walletGate(input),
    networkGate(input),
    deploymentGate(input),
    pausedGate(input),
    verificationGate(input),
    minimumGate(input),
    balanceGate(input),
    allowanceGate(input),
  ];
}

export interface Readiness {
  /** Everything that is not `ok`, in gate order. */
  readonly blockers: readonly Gate[];
  /** The allowance is short, so the flow is two transactions rather than one. */
  readonly needsApproval: boolean;
  /** The approval can be signed: every gate except the allowance itself is satisfied. */
  readonly canApprove: boolean;
  /** The subscription can be signed. */
  readonly canSubscribe: boolean;
}

export function readiness(gates: readonly Gate[]): Readiness {
  const blockers = gates.filter((gate) => gate.status !== "ok");
  const allowance = gates.find((gate) => gate.id === "allowance");
  const needsApproval = allowance?.status === "blocked";
  const othersOk = blockers.every((gate) => gate.id === "allowance");
  return {
    blockers,
    needsApproval,
    canApprove: needsApproval && othersOk,
    canSubscribe: blockers.length === 0,
  };
}

// --------------------------------------------------------------------------- the faucet (D14)

export interface FaucetReading {
  readonly status: "unknown" | "available" | "exhausted";
  /** What a single faucet call may mint right now. */
  readonly mintable6: bigint | null;
  readonly cap6: bigint | null;
  /** When the 24-hour window refreshes, already formatted; `null` when it is not in the future. */
  readonly resetsAt: string | null;
  readonly detail: string;
}

/**
 * `MockUSDC.faucet` caps a call at `FAUCET_CAP` and an address at `FAUCET_CAP` per fixed 24-hour
 * window anchored at its first use (D14). When the cap is spent, say when it comes back rather than
 * letting the person discover it as a `FaucetDailyCapExceeded` revert.
 *
 * `nowSec` is `null` during a server render, where there is no meaningful clock to compare against.
 */
export function readFaucet(
  chain: SubscribeChainState,
  nowSec: bigint | null,
  quoteSymbol = "mUSDC",
): FaucetReading {
  const { faucetCap6: cap6, faucetRemaining6: remaining6, faucetWindowEndsAt } = chain;
  if (cap6 === null) {
    return {
      status: "unknown",
      mintable6: null,
      cap6,
      resetsAt: null,
      detail:
        "The faucet's cap is read from the test USDC contract. It has not answered yet, so no allowance is quoted here.",
    };
  }
  if (remaining6 === null) {
    // The cap is a contract constant and readable without an address; how much of the current
    // window is left is not. State the rule now rather than making somebody connect to learn it.
    return {
      status: "unknown",
      mintable6: null,
      cap6,
      resetsAt: null,
      detail: `Mints up to ${formatUsdcExact(cap6)} ${quoteSymbol} per address per fixed 24-hour window, which starts at an address's first use. Connect a wallet to see how much of your current window is left.`,
    };
  }

  const windowOpen =
    faucetWindowEndsAt !== null &&
    nowSec !== null &&
    faucetWindowEndsAt > nowSec &&
    remaining6 < cap6;
  const resetsAt =
    windowOpen && faucetWindowEndsAt !== null ? formatUnixSeconds(faucetWindowEndsAt) : null;

  if (remaining6 === 0n) {
    return {
      status: "exhausted",
      mintable6: 0n,
      cap6,
      resetsAt,
      detail: resetsAt
        ? `This address has minted its full ${formatUsdcExact(cap6)} ${quoteSymbol} for the current 24-hour window. The allowance refreshes at ${resetsAt}; until then the faucet reverts with \`FaucetDailyCapExceeded\`.`
        : `This address has minted its full ${formatUsdcExact(cap6)} ${quoteSymbol} for the current 24-hour window, so the faucet would revert with \`FaucetDailyCapExceeded\`.`,
    };
  }

  return {
    status: "available",
    mintable6: remaining6,
    cap6,
    resetsAt,
    detail:
      remaining6 < cap6
        ? `${formatUsdcExact(remaining6)} ${quoteSymbol} of this address's ${formatUsdcExact(cap6)} 24-hour allowance is left${resetsAt ? `; it refreshes at ${resetsAt}` : ""}.`
        : `Mints up to ${formatUsdcExact(cap6)} ${quoteSymbol} per address per 24-hour window. Test money only: it is not USDC and it is not backed by anything.`,
  };
}

// --------------------------------------------------------------------------- the published book

/**
 * The slice of `nav.json` this page needs, in a shape that crosses the server/client boundary.
 *
 * The server component reads the document through `lib/data.ts` and hands these fields down; the
 * client never imports the data layer (it uses `node:fs`) and never re-derives a money value from a
 * float — `navUsdc6` is the engine's own 6-decimal integer (PLAN.md D22).
 */
export interface PublishedFacts {
  /** `nav.usdc_6dec` — NAV per token as an integer. */
  readonly navUsdc6: number;
  /** `as_of`, the valuation date, e.g. "2026-09-14". */
  readonly asOf: string;
  /** `generated_at`, when the engine ran. */
  readonly generatedAt: string;
  /** `fees.management_fee_pct_pa` — accrued daily inside NAV, not charged on a subscription. */
  readonly managementFeePctPa: number;
  /** `fees.fund_expenses_pct_pa` — same accrual. */
  readonly fundExpensesPctPa: number;
}
