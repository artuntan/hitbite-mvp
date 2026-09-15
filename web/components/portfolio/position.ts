/**
 * The arithmetic and the gates behind the position, the claim and the redemption — no React, no
 * wagmi, no fetch.
 *
 * Everything here is a pure function of (what the chain said, what the person typed), for the same
 * reason `components/subscribe/quote.ts` is: a number this page quotes has to be the number
 * `HBToken` settles at, and a function from integers to integers is the only version of that claim
 * anybody can check.
 *
 * Three rules run through the file.
 *
 *  1. **The contract's arithmetic, truncated the contract's way** (PLAN.md D52). `usdcOut =
 *     tokenAmount × nav / 1e18` on bigints is the same floor the EVM performs, and typed input is
 *     truncated down to 18 decimals rather than rounded up.
 *  2. **Liquidity is checked before a signature, not after a revert** (PLAN.md D6). Coupon money is
 *     ring-fenced: `availableLiquidity() = vault − couponReserve`, and a redemption is refused
 *     against *that*. When the ask is too large the page says so with both numbers, which is the
 *     same pair `InsufficientLiquidity(available, requested)` would have carried — except nobody
 *     had to pay for a failed transaction to read it.
 *  3. **Redeeming and claiming are never gated on eligibility** (PLAN.md D4, COMPLIANCE_RULES 4).
 *     `_update` checks `canHold(to)` on every mint and transfer and `canHold(from)` on transfers,
 *     but not on burns, and `claimCoupon` checks nothing. A de-verified holder can always get out.
 *     Adding a verification gate here would trap money the contract deliberately does not trap.
 */

import {
  MAX_INPUT,
  TOKEN_DECIMALS,
  TOKEN_SCALE,
  formatTokens,
  formatUsdcExact,
  parseAmount,
  previewRedeemUsdc,
} from "@/lib/format";

// --------------------------------------------------------------------------- what the chain said

/** How the batch of contract reads is doing. Same four states as `/subscribe`. */
export type ReadState = "no-deployment" | "loading" | "ready" | "error";

export interface PortfolioChainState {
  readonly reads: ReadState;
  /** Why the reads are unusable, when they are. */
  readonly reason: string | null;
  readonly nav6: bigint | null;
  readonly navUpdatedAt: bigint | null;
  readonly paused: boolean | null;
  /** `balanceOf(account)`, 18 decimals. */
  readonly balance18: bigint | null;
  /** `pendingCoupon(account)` — settled lazily by the contract, never recomputed here. */
  readonly pendingCoupon6: bigint | null;
  /** `availableLiquidity()` — the vault minus the coupon reserve (D6). */
  readonly availableLiquidity6: bigint | null;
  /** `vaultBalance()` — every test USDC the token holds. */
  readonly vaultBalance6: bigint | null;
  /** `couponReserve()` — distributed and not yet claimed. Never available to a redemption. */
  readonly couponReserve6: bigint | null;
  readonly totalSupply18: bigint | null;
  /** `IdentityRegistry.canHold` — shown, never used to gate an exit. */
  readonly canHold: boolean | null;
  readonly identity: { readonly verified: boolean; readonly country: number } | null;
}

export const EMPTY_PORTFOLIO_CHAIN_STATE: PortfolioChainState = {
  reads: "loading",
  reason: null,
  nav6: null,
  navUpdatedAt: null,
  paused: null,
  balance18: null,
  pendingCoupon6: null,
  availableLiquidity6: null,
  vaultBalance6: null,
  couponReserve6: null,
  totalSupply18: null,
  canHold: null,
  identity: null,
};

// --------------------------------------------------------------------------- the amount box

export interface TokenAmountReading {
  readonly text: string;
  readonly empty: boolean;
  /** The 18-decimal integer that would be sent, or `null` when the text is not usable. */
  readonly value18: bigint | null;
  readonly error: string | null;
  /** More than eighteen decimals were typed; the extra was dropped, not rounded (D52). */
  readonly truncated: boolean;
}

const EMPTY_TOKEN_AMOUNT: TokenAmountReading = {
  text: "",
  empty: true,
  value18: null,
  error: null,
  truncated: false,
};

/**
 * Parse the redeem box.
 *
 * Empty is the starting state, not an error. Zero and anything above `MAX_INPUT` (D28) are errors,
 * because `redeem` reverts on both — `ZeroAmount` and `AmountTooLarge` respectively.
 */
export function readTokenAmount(text: string): TokenAmountReading {
  if (text.trim() === "") return { ...EMPTY_TOKEN_AMOUNT, text };

  const parsed = parseAmount(text, TOKEN_DECIMALS);
  if (!parsed.ok) {
    return { text, empty: false, value18: null, error: parsed.error, truncated: false };
  }
  if (parsed.value === 0n) {
    return {
      text,
      empty: false,
      value18: null,
      error: "Enter an amount above zero. `redeem` reverts with `ZeroAmount` at zero.",
      truncated: parsed.truncated,
    };
  }
  if (parsed.value > MAX_INPUT) {
    return {
      text,
      empty: false,
      value18: null,
      error:
        "That is above the contract's input ceiling of 2^128 − 1 token units, which it rejects with `AmountTooLarge`.",
      truncated: parsed.truncated,
    };
  }
  return { text, empty: false, value18: parsed.value, error: null, truncated: parsed.truncated };
}

/** An 18-decimal integer as text for the amount box: exact, ungrouped, every decimal kept. */
export function tokenAmountText(value18: bigint): string {
  return formatTokens(value18, TOKEN_DECIMALS).replace(/,/g, "");
}

// --------------------------------------------------------------------------- the position

/** `balance × nav / 1e18`, the contract's own arithmetic. `null` when either side is unreadable. */
export function valueAtNav(balance18: bigint | null, nav6: bigint | null): bigint | null {
  if (balance18 === null || nav6 === null || nav6 <= 0n) return null;
  return previewRedeemUsdc(balance18, nav6);
}

/**
 * The largest amount that could be redeemed right now: whichever is smaller of the balance and what
 * available liquidity can pay for.
 *
 * `t = floor(available × 1e18 / nav)` is the largest `t` whose payout `floor(t × nav / 1e18)` is
 * still within `available`, which is exactly the comparison `redeem` makes.
 */
export function maxRedeemableTokens18(
  available6: bigint | null,
  nav6: bigint | null,
  balance18: bigint | null,
): bigint | null {
  if (available6 === null || nav6 === null || nav6 <= 0n || balance18 === null) return null;
  const affordable18 = (available6 * TOKEN_SCALE) / nav6;
  return affordable18 < balance18 ? affordable18 : balance18;
}

// --------------------------------------------------------------------------- the redeem quote

export interface RedeemQuote {
  readonly amount18: bigint | null;
  /** What the page shows: the chain's `previewRedeem` when it answered, else the reproduction. */
  readonly usdcOut6: bigint | null;
  readonly source: "chain" | "local" | null;
  /** `previewRedeem(amount)` read from the token. */
  readonly chain6: bigint | null;
  /** `amount × nav / 1e18` computed here from the NAV this page read. */
  readonly local6: bigint | null;
  /** The two disagree — NAV moved between the two reads. The chain is the one that settles. */
  readonly mismatch: boolean;
  readonly nav6: bigint | null;
  readonly available6: bigint | null;
  /** How much more available liquidity the redemption would need. `null` when it needs none. */
  readonly shortfall6: bigint | null;
  readonly exceedsBalance: boolean;
  /** The payout truncates to zero USDC, which `redeem` rejects with `ZeroAmount`. */
  readonly zeroPayout: boolean;
  /** The division left a remainder, so the payout is strictly less than the exact ratio. */
  readonly truncatedPayout: boolean;
}

export function buildRedeemQuote(
  amount: TokenAmountReading,
  chain: PortfolioChainState,
  chainPreview6: bigint | null,
): RedeemQuote {
  const nav6 = chain.nav6;
  const amount18 = amount.value18;

  if (amount18 === null || nav6 === null || nav6 <= 0n) {
    return {
      amount18,
      usdcOut6: null,
      source: null,
      chain6: chainPreview6,
      local6: null,
      mismatch: false,
      nav6,
      available6: chain.availableLiquidity6,
      shortfall6: null,
      exceedsBalance: false,
      zeroPayout: false,
      truncatedPayout: false,
    };
  }

  const local6 = previewRedeemUsdc(amount18, nav6);
  // The chain is the authority where both exist: `previewRedeem` reads the NAV in the block that
  // answered it, and that is the NAV a redemption in the next block settles nearest to.
  const usdcOut6 = chainPreview6 ?? local6;
  const available6 = chain.availableLiquidity6;
  const shortfall6 = available6 !== null && usdcOut6 > available6 ? usdcOut6 - available6 : null;

  return {
    amount18,
    usdcOut6,
    source: chainPreview6 !== null ? "chain" : "local",
    chain6: chainPreview6,
    local6,
    mismatch: chainPreview6 !== null && chainPreview6 !== local6,
    nav6,
    available6,
    shortfall6,
    exceedsBalance: chain.balance18 !== null && amount18 > chain.balance18,
    zeroPayout: usdcOut6 === 0n,
    truncatedPayout: (amount18 * nav6) % TOKEN_SCALE !== 0n,
  };
}

// --------------------------------------------------------------------------- the gates

export type GateStatus = "ok" | "blocked" | "waiting" | "unknown";

/** The control a gate offers as its way forward. The page decides how to render each one. */
export type GateAction = "connect" | "switch" | "amount" | "max-balance" | "max-liquidity" | null;

export interface Gate {
  readonly id: string;
  readonly label: string;
  readonly status: GateStatus;
  /** One or two sentences: the rule, the numbers, and what to do about it. */
  readonly detail: string;
  readonly action: GateAction;
}

export type NetworkPhase = "connecting" | "disconnected" | "wrong-network" | "ready";

export interface RedeemGateInput {
  readonly network: NetworkPhase;
  readonly requiredChainLabel: string;
  readonly currentChainLabel: string | null;
  readonly currentChainId: number | undefined;
  readonly chain: PortfolioChainState;
  readonly amount: TokenAmountReading;
  readonly quote: RedeemQuote;
  /** False when the page is showing an address other than the connected wallet's. */
  readonly ownAddress: boolean;
}

const usdc = (value: bigint) => `${formatUsdcExact(value)} USDC`;
const hb = (value: bigint) => `${formatTokens(value, 6)} hbTRS`;

function walletGate(input: RedeemGateInput): Gate {
  const label = "Wallet connected";
  switch (input.network) {
    case "connecting":
      return {
        id: "wallet",
        label,
        status: "waiting",
        detail: "Checking whether a wallet is already connected to this page.",
        action: null,
      };
    case "disconnected":
      return {
        id: "wallet",
        label,
        status: "blocked",
        detail:
          "A redemption burns tokens from the address that signs it, so there is nothing to sign until a wallet is connected.",
        action: "connect",
      };
    default:
      return input.ownAddress
        ? {
            id: "wallet",
            label,
            status: "ok",
            detail: "A wallet is connected and this page is reading against its address.",
            action: null,
          }
        : {
            id: "wallet",
            label: "Connected wallet holds this position",
            status: "blocked",
            detail:
              "This page is showing an address other than the connected wallet's. A redemption burns tokens from the signer, so it can only ever be sent for the connected address. Connect that wallet, or clear the address in the box above, to act on this position.",
            action: null,
          };
  }
}

function networkGate(input: RedeemGateInput): Gate {
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

function deploymentGate(input: RedeemGateInput): Gate {
  const label = `hbTRS deployed on ${input.requiredChainLabel}`;
  switch (input.chain.reads) {
    case "no-deployment":
      return {
        id: "deployment",
        label,
        status: "unknown",
        detail:
          input.chain.reason ??
          `No deployment is recorded for ${input.requiredChainLabel}, so there is no token to read a balance, a NAV or a coupon from, and nothing to redeem against.`,
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
        detail: `The token and the registry both answered on ${input.requiredChainLabel}.`,
        action: null,
      };
  }
}

function pausedGate(input: RedeemGateInput): Gate {
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
        "The issuer has paused the token. Redemptions, claims, subscriptions, transfers and distributions all stop while it is paused (COMPLIANCE_RULES section 6), so both actions on this page would revert. This is the one thing that can hold up an exit, and it is temporary by design.",
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

function amountGate(input: RedeemGateInput): Gate {
  const label = "An amount to redeem";
  if (input.amount.empty) {
    return {
      id: "amount",
      label,
      status: "waiting",
      detail: "Type how much hbTRS to burn. Nothing is quoted or signed until there is an amount.",
      action: null,
    };
  }
  if (input.amount.error !== null) {
    return {
      id: "amount",
      label,
      status: "blocked",
      detail: input.amount.error,
      action: "amount",
    };
  }
  if (input.quote.zeroPayout) {
    return {
      id: "amount",
      label,
      status: "blocked",
      detail:
        "At the current NAV this amount pays out less than one micro-USDC, which truncates to zero. `redeem` rejects that with `ZeroAmount` rather than burning tokens for nothing. Redeem more.",
      action: "amount",
    };
  }
  return {
    id: "amount",
    label,
    status: "ok",
    detail:
      input.quote.usdcOut6 === null
        ? "An amount is entered."
        : `${hb(input.amount.value18 ?? 0n)} would pay out ${usdc(input.quote.usdcOut6)}.`,
    action: null,
  };
}

function balanceGate(input: RedeemGateInput): Gate {
  const label = "Enough hbTRS to burn";
  const balance = input.chain.balance18;
  if (balance === null) {
    return {
      id: "balance",
      label,
      status: input.chain.reads === "loading" ? "waiting" : "unknown",
      detail:
        "The balance is read from `balanceOf` on the token. It has not answered, so this cannot be checked.",
      action: null,
    };
  }
  if (input.amount.value18 === null) {
    return {
      id: "balance",
      label,
      status: "waiting",
      detail: `This address holds ${hb(balance)}. A redemption burns from that balance.`,
      action: null,
    };
  }
  if (input.amount.value18 > balance) {
    return {
      id: "balance",
      label,
      status: "blocked",
      detail: `This address holds ${hb(balance)} and the box asks to burn ${hb(input.amount.value18)}. The burn inside \`redeem\` would revert with \`ERC20InsufficientBalance\`.`,
      action: "max-balance",
    };
  }
  return {
    id: "balance",
    label,
    status: "ok",
    detail: `${hb(input.amount.value18)} of the ${hb(balance)} this address holds.`,
    action: null,
  };
}

/**
 * The liquidity gate: the one BUILD_PROMPT 7.2 singles out, because getting it wrong means a person
 * pays gas to be told something this page could have told them for free.
 */
function liquidityGate(input: RedeemGateInput): Gate {
  const label = "Enough available liquidity";
  const available = input.chain.availableLiquidity6;
  const reserve = input.chain.couponReserve6;
  const vault = input.chain.vaultBalance6;

  const ringFence =
    vault !== null && reserve !== null
      ? ` The vault holds ${usdc(vault)}, of which ${usdc(reserve)} is coupon money already distributed and not yet claimed. That part is reserved for the holders who earned it and is never used to pay a redemption (PLAN.md D6).`
      : " Coupon money already distributed and not yet claimed is reserved for the holders who earned it and is never used to pay a redemption (PLAN.md D6).";

  if (available === null) {
    return {
      id: "liquidity",
      label,
      status: input.chain.reads === "loading" ? "waiting" : "unknown",
      detail: `Available liquidity is read from \`availableLiquidity()\`. It has not answered, so this cannot be checked before signing.${ringFence}`,
      action: null,
    };
  }
  if (input.quote.usdcOut6 === null) {
    return {
      id: "liquidity",
      label,
      status: "waiting",
      detail: `${usdc(available)} can be paid out right now.${ringFence}`,
      action: null,
    };
  }
  if (input.quote.shortfall6 !== null) {
    return {
      id: "liquidity",
      label,
      status: "blocked",
      detail: `This redemption needs ${usdc(input.quote.usdcOut6)} and the vault can pay out ${usdc(available)} — ${usdc(input.quote.shortfall6)} short. \`redeem\` would revert with \`InsufficientLiquidity(${formatUsdcExact(available)}, ${formatUsdcExact(input.quote.usdcOut6)})\`.${ringFence} Redeem a smaller amount, or come back after the next subscription tops the vault up.`,
      action: "max-liquidity",
    };
  }
  return {
    id: "liquidity",
    label,
    status: "ok",
    detail: `${usdc(input.quote.usdcOut6)} of the ${usdc(available)} available.${ringFence}`,
    action: null,
  };
}

/**
 * Everything `redeem` requires, in the order the contract checks it.
 *
 * There is deliberately **no verification gate**. `_update` skips `canHold(from)` on a burn (D4), so
 * an address removed from the registry can still redeem every token it holds. A gate here would
 * invent a restriction the contract does not have and trap somebody's money in the interface.
 */
export function buildRedeemGates(input: RedeemGateInput): Gate[] {
  return [
    walletGate(input),
    networkGate(input),
    deploymentGate(input),
    pausedGate(input),
    amountGate(input),
    balanceGate(input),
    liquidityGate(input),
  ];
}

export interface RedeemReadiness {
  readonly canRedeem: boolean;
  readonly blockers: readonly Gate[];
}

export function redeemReadiness(gates: readonly Gate[]): RedeemReadiness {
  const blockers = gates.filter((gate) => gate.status !== "ok");
  return { canRedeem: blockers.length === 0, blockers };
}

// --------------------------------------------------------------------------- the claim

export interface ClaimReadiness {
  readonly canClaim: boolean;
  /** Why not, in a sentence. `null` when it can be claimed. */
  readonly reason: string | null;
}

/**
 * Whether `claimCoupon` would go through.
 *
 * `pendingCoupon(address)` is read from the chain and never recomputed here: the contract settles
 * lazily — `accrued + balance × (couponIndex − userIndex) / 1e18` — so a number computed in the
 * browser from a distribution history would disagree with what the claim actually pays.
 *
 * Eligibility is not checked. `claimCoupon` does not check it either (D4).
 */
export function claimReadiness(
  chain: PortfolioChainState,
  network: NetworkPhase,
  ownAddress: boolean,
): ClaimReadiness {
  if (network === "connecting") return { canClaim: false, reason: null };
  if (network === "disconnected") {
    return {
      canClaim: false,
      reason: "Connect the wallet that holds this position to claim what it is owed.",
    };
  }
  if (!ownAddress) {
    return {
      canClaim: false,
      reason:
        "This page is showing an address other than the connected wallet's. `claimCoupon` pays the caller, so it can only be claimed by the wallet that holds the position.",
    };
  }
  if (network === "wrong-network") {
    return { canClaim: false, reason: "Switch networks first — the token lives on one chain." };
  }
  if (chain.reads === "no-deployment" || chain.reads === "error") {
    return { canClaim: false, reason: chain.reason };
  }
  if (chain.paused === true) {
    return {
      canClaim: false,
      reason:
        "The token is paused. `claimCoupon` is covered by the pause, so a claim would revert until the issuer unpauses. The coupon stays accrued in the meantime; a pause cannot take it away.",
    };
  }
  if (chain.pendingCoupon6 === null) {
    return { canClaim: false, reason: null };
  }
  if (chain.pendingCoupon6 === 0n) {
    return {
      canClaim: false,
      reason:
        "Nothing has accrued to this address since it last claimed. Coupons accrue only to balances held at the moment a distribution is made, so an address that subscribed after the last one receives nothing from it. `claimCoupon` reverts with `NothingToClaim`.",
    };
  }
  return { canClaim: true, reason: null };
}
