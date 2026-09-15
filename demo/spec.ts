/**
 * spec — the numbers BUILD_PROMPT.md section 9 fixes for the demo, as exact base-unit integers.
 *
 * These are constants, not values read back from the chain. That is the point: the runner asserts
 * the documented outcome, so a contract change that quietly moves a number fails the demo instead
 * of being rubber-stamped by an assertion that re-derives its expectation from the same contract
 * it is meant to be checking.
 *
 * Units: USDC and NAV carry 6 decimals, hbTRS carries 18 (`contracts/src/HBToken.sol`).
 */

/** 1 USDC, in base units. */
export const USDC_ONE = 1_000_000n;

/** 1 hbTRS, in base units. */
export const TOKEN_ONE = 10n ** 18n;

/** `HBToken.TOKEN_SCALE` — the 1e18 factor in every NAV conversion. */
export const TOKEN_SCALE = 10n ** 18n;

/** `HBToken.MAX_BPS` — basis-point denominator for the oracle rail. */
export const MAX_BPS = 10_000n;

/** `HBToken.RAIL_WINDOW` — the rail anchor is refreshed once per 24 h window (PLAN.md D27). */
export const RAIL_WINDOW_SECONDS = 86_400n;

/**
 * Opening NAV, 1.000000 USDC per token: the inception NAV in the `HBToken` constructor and the
 * default `SEED_NAV` in `.env.example`. The preflight restores it so every run subscribes at the
 * same price and the step 5 split is the same exact pair of integers on every run.
 */
export const OPENING_NAV = 1_000_000n;

/** Step 4: the NAV the oracle publishes, 1.0043 USDC (+0.43% — inside the 5% rail). */
export const STEP4_NAV = 1_004_300n;

/** Step 3: wallet A subscribes 1,000.000000 USDC. */
export const SUBSCRIPTION_A = 1_000n * USDC_ONE;

/** Step 3: wallet B subscribes 500.000000 USDC. */
export const SUBSCRIPTION_B = 500n * USDC_ONE;

/** Step 5: the issuer distributes a 12.00 USDC coupon. */
export const COUPON_USDC = 12n * USDC_ONE;

/** Step 6: wallet A transfers 100 hbTRS to wallet B. */
export const TRANSFER_TOKENS = 100n * TOKEN_ONE;

/** Step 7: wallet B redeems 200 hbTRS. */
export const REDEEM_TOKENS = 200n * TOKEN_ONE;

/** ISO 3166-1 numeric: United Arab Emirates (wallet A). */
export const COUNTRY_A = 784;

/** ISO 3166-1 numeric: Germany (wallet B). */
export const COUNTRY_B = 276;

/** ISO 3166-1 numeric: United States (wallet C) — on the registry's blocklist. */
export const COUNTRY_C = 840;

/** `IdentityRegistry.INVESTOR_PROFESSIONAL`; retail cannot be verified in phase one (PLAN.md D21). */
export const INVESTOR_PROFESSIONAL = 1;

// ---------------------------------------------------------------------------------------------
// Derived expectations. Each is the exact integer the contract's own arithmetic produces from the
// inputs above, computed here by hand so the assertion is independent of the implementation.
// ---------------------------------------------------------------------------------------------

/** 1,000.000000 USDC / 1.000000 NAV = 1,000 hbTRS: `1_000e6 * 1e18 / 1e6`. */
export const EXPECTED_TOKENS_A = 1_000n * TOKEN_ONE;

/** 500.000000 USDC / 1.000000 NAV = 500 hbTRS. */
export const EXPECTED_TOKENS_B = 500n * TOKEN_ONE;

/** Supply the coupon is divided over: 1,000 + 500 hbTRS. */
export const EXPECTED_SUPPLY_AT_DISTRIBUTION = EXPECTED_TOKENS_A + EXPECTED_TOKENS_B;

/** `couponIndex` increment: `12e6 * 1e18 / 1500e18` = 8,000 = 0.008000 USDC per hbTRS. */
export const EXPECTED_COUPON_PER_TOKEN = 8_000n;

/** Wallet A's share: `1000e18 * 8000 / 1e18` = 8,000,000 = 8.000000 USDC (two thirds of 12.00). */
export const EXPECTED_COUPON_A = 8n * USDC_ONE;

/** Wallet B's share: `500e18 * 8000 / 1e18` = 4,000,000 = 4.000000 USDC (one third of 12.00). */
export const EXPECTED_COUPON_B = 4n * USDC_ONE;

/**
 * NAV after the distribution: 1.004300 - 0.008000 = 0.996300. A fund's NAV drops by the amount it
 * pays out on the ex-distribution date; `distributeCoupon` does the same on chain (PLAN.md D26).
 */
export const EXPECTED_NAV_AFTER_DISTRIBUTION = STEP4_NAV - EXPECTED_COUPON_PER_TOKEN;

/** Step 7 payout: `200e18 * 996_300 / 1e18` = 199,260,000 = 199.260000 USDC. */
export const EXPECTED_REDEEM_USDC = (REDEEM_TOKENS * EXPECTED_NAV_AFTER_DISTRIBUTION) / TOKEN_SCALE;
