/**
 * Zod schemas for every document the NAV engine publishes, and for every response this app's
 * public API returns.
 *
 * These mirror `engine/nav_engine/schemas.py` field for field. The engine's output models are
 * `extra="forbid"`, so the document schemas here are **strict** for the same reason: an engine
 * that starts emitting a field the web app has never heard of is a contract change, and a
 * contract change should fail a build rather than reach a page silently.
 *
 * Money is validated as a fixed-scale *string* (`"1016860.71"`) and, where the engine publishes
 * one, as a 6-decimal *integer* beside it (PLAN.md D22). Neither is ever turned into a
 * JavaScript number: `lib/format.ts` parses the string exactly into a BigInt. The regexes below
 * pin the number of decimals because that is what makes the exact parse safe.
 */

import { z } from "zod";

// --------------------------------------------------------------------------- scalars

function fixedString(decimals: number, label: string) {
  return z
    .string()
    .regex(
      new RegExp(`^-?\\d+\\.\\d{${decimals}}$`),
      `expected ${label}: a decimal string with exactly ${decimals} fractional digits`,
    );
}

/** USD amount, 2 decimals — engine `Usd2`. */
export const usd2 = fixedString(2, "a USD amount");
/** Per-unit / per-token amount, 6 decimals — engine `Unit6`. Same scale as on-chain USDC. */
export const unit6 = fixedString(6, "a per-unit amount");
/** Clean price and coupon, 4 decimals — engine `Fixed4`. */
export const fixed4 = fixedString(4, "a 4-decimal figure");
/** Dirty price, 8 decimals — engine `Fixed8`. */
export const fixed8 = fixedString(8, "an 8-decimal figure");
/** Reference units and scaling factor, 10 decimals — engine `Fixed10`. */
export const fixed10 = fixedString(10, "a 10-decimal figure");
/** Token amount, 18 decimals — engine `Tokens18`. */
export const tokens18 = fixedString(18, "a token amount");

/** An unsigned integer carried as a string because it does not fit a JSON number (wei, 1e18). */
export const integerString = z
  .string()
  .regex(/^\d+$/, "expected a non-negative integer written as a string");

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date, YYYY-MM-DD");

/** The engine's `format_generated_at`: second precision, UTC, always `Z`. */
export const isoTimestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "expected an ISO UTC timestamp ending in Z");

export const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 20-byte hex address");

export const txHash = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "expected a 32-byte hex transaction hash");

/** Any 32-byte hash — a block hash, where `txHash` would read as the wrong thing. */
export const hash32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 32-byte hex hash");

/** Yields, durations and convexities: analytics, not money, and floats by design (`Float6`). */
export const analytic = z.number().finite();

const intField = z.number().int();
const nonNegativeInt = z.number().int().nonnegative();

export const supplySource = z.enum(["rpc", "cache", "none"]);
export type SupplySource = z.infer<typeof supplySource>;

// --------------------------------------------------------------------------- nav.json

export const chainInfoSchema = z.strictObject({
  chain_id: intField.nullable(),
  token_address: evmAddress.nullable(),
  total_supply_tokens: tokens18.nullable(),
  total_supply_wei: integerString.nullable(),
  onchain_nav_usdc_6dec: nonNegativeInt.nullable(),
  supply_source: supplySource,
  warning: z.string().nullable(),
});
export type ChainInfo = z.infer<typeof chainInfoSchema>;

export const navBlockSchema = z.strictObject({
  per_token_usd: unit6,
  usdc_6dec: nonNegativeInt,
  total_usd: usd2,
  reference_units: fixed10,
  reported_aum_usd: usd2.nullable(),
  reported_aum_usdc_6dec: nonNegativeInt.nullable(),
});
export type NavBlock = z.infer<typeof navBlockSchema>;

export const portfolioBlockSchema = z.strictObject({
  sum_market_value_usd: usd2,
  cash_usd: usd2,
  fees_payable_usd: usd2,
  weighted_ytm_pct: analytic,
  modified_duration: analytic,
  convexity: analytic,
  positions_count: nonNegativeInt,
});
export type PortfolioBlock = z.infer<typeof portfolioBlockSchema>;

export const distributionYieldBlockSchema = z.strictObject({
  trailing_per_unit_usd: unit6,
  window_days: nonNegativeInt,
  months_available: nonNegativeInt,
  average_nav_per_unit: unit6,
  raw_pct: analytic,
  annualized_pct: analytic.nullable(),
  note: z.string(),
});
export type DistributionYieldBlock = z.infer<typeof distributionYieldBlockSchema>;

export const feesBlockSchema = z.strictObject({
  management_fee_pct_pa: analytic,
  fund_expenses_pct_pa: analytic,
});

export const tBillReferenceSchema = z.strictObject({
  label: z.string(),
  yield_pct: analytic,
  source_note: z.string(),
  illustrative: z.literal(true),
});

export const comparisonBlockSchema = z.strictObject({
  tokenized_tbill_reference: tBillReferenceSchema,
});

export const navDocumentSchema = z.strictObject({
  generated_at: isoTimestamp,
  as_of: isoDate,
  simulated: z.literal(true),
  source_note: z.string(),
  chain: chainInfoSchema,
  nav: navBlockSchema,
  portfolio: portfolioBlockSchema,
  distribution_yield: distributionYieldBlockSchema,
  fees: feesBlockSchema,
  comparison: comparisonBlockSchema,
});
export type NavDocument = z.infer<typeof navDocumentSchema>;

// --------------------------------------------------------------------------- holdings.json

export const holdingPositionSchema = z.strictObject({
  name: z.string(),
  isin: z.string(),
  illustrative: z.literal(true),
  coupon_pct: analytic,
  maturity: isoDate,
  face_usd: usd2,
  scaled_face_usd: usd2.nullable(),
  clean_price: fixed4,
  accrued_usd: usd2,
  dirty_price: fixed8,
  market_value_usd: usd2,
  weight_pct: analytic,
  ytm_pct: analytic,
  modified_duration: analytic,
  convexity: analytic,
  prev_coupon_date: isoDate,
  next_coupon_date: isoDate,
  day_count: z.string(),
  frequency: nonNegativeInt,
});
export type HoldingPosition = z.infer<typeof holdingPositionSchema>;

export const holdingsDocumentSchema = z.strictObject({
  generated_at: isoTimestamp,
  as_of: isoDate,
  simulated: z.literal(true),
  source_note: z.string(),
  scaled_by: fixed10.nullable(),
  positions: z.array(holdingPositionSchema),
  cash_usd: usd2,
  fees_payable_usd: usd2,
  nav_total_usd: usd2,
});
export type HoldingsDocument = z.infer<typeof holdingsDocumentSchema>;

// --------------------------------------------------------------------------- nav_history.json

export const navHistoryEntrySchema = z.strictObject({
  date: isoDate,
  nav_per_token_usd: unit6,
  usdc_6dec: nonNegativeInt,
  nav_total_usd: usd2,
  weighted_ytm_pct: analytic,
  modified_duration: analytic,
  distributions_per_unit_cum: unit6,
});
export type NavHistoryEntry = z.infer<typeof navHistoryEntrySchema>;

export const navHistoryDocumentSchema = z.strictObject({
  generated_at: isoTimestamp,
  simulated: z.literal(true),
  source_note: z.string(),
  entries: z.array(navHistoryEntrySchema),
});
export type NavHistoryDocument = z.infer<typeof navHistoryDocumentSchema>;

// --------------------------------------------------------------------------- scenarios.json

export const scenarioBaseSchema = z.strictObject({
  nav_total_usd: usd2,
  nav_per_token_usd: unit6,
});

export const parallelScenarioSchema = z.strictObject({
  shift_bp: intField,
  nav_total_usd: usd2,
  nav_per_token_usd: unit6,
  delta_usd: usd2,
  delta_pct: analytic,
});
export type ParallelScenario = z.infer<typeof parallelScenarioSchema>;

export const cdsScenarioSchema = z.strictObject({
  shock_bp: analytic,
  beta: analytic,
  shift_bp: analytic,
  nav_total_usd: usd2,
  nav_per_token_usd: unit6,
  delta_usd: usd2,
  delta_pct: analytic,
});
export type CdsScenario = z.infer<typeof cdsScenarioSchema>;

export const scenariosDocumentSchema = z.strictObject({
  generated_at: isoTimestamp,
  as_of: isoDate,
  simulated: z.literal(true),
  source_note: z.string(),
  assumptions: z.string(),
  base: scenarioBaseSchema,
  parallel: z.array(parallelScenarioSchema),
  cds: z.array(cdsScenarioSchema),
});
export type ScenariosDocument = z.infer<typeof scenariosDocumentSchema>;

// --------------------------------------------------------------------------- attestation.json

export const attestationHoldingSchema = z.strictObject({
  name: z.string(),
  isin: z.string(),
  illustrative: z.literal(true),
  coupon_pct: fixed4,
  maturity: isoDate,
  face_usd: usd2,
  scaled_face_usd: usd2.nullable(),
  clean_price: fixed4,
  accrued_usd: usd2,
  dirty_price: fixed8,
  market_value_usd: usd2,
});

export const attestationChainSchema = z.strictObject({
  chain_id: intField.nullable(),
  token_address: evmAddress.nullable(),
  total_supply_wei: integerString.nullable(),
  total_supply_tokens: tokens18.nullable(),
  onchain_nav_usdc_6dec: nonNegativeInt.nullable(),
  supply_source: supplySource,
});

export const attestationNavSchema = z.strictObject({
  per_token_usd: unit6,
  usdc_6dec: nonNegativeInt,
  total_usd: usd2,
  reference_units: fixed10,
  reported_aum_usd: usd2.nullable(),
  reported_aum_usdc_6dec: nonNegativeInt.nullable(),
});

export const supplyBackedRatioSchema = z.strictObject({
  ratio: unit6,
  ratio_1e18: integerString,
  assets_usdc_6dec: nonNegativeInt.nullable(),
  liabilities_usdc_6dec: nonNegativeInt.nullable(),
  basis: z.string(),
});

export const attestationPayloadSchema = z.strictObject({
  version: z.literal("hitbite.attestation.v1"),
  generated_at: isoTimestamp,
  timestamp: nonNegativeInt,
  as_of: isoDate,
  simulated: z.literal(true),
  attestor_note: z.string(),
  source_note: z.string(),
  chain: attestationChainSchema,
  nav: attestationNavSchema,
  cash_usd: usd2,
  fees_payable_usd: usd2,
  sum_market_value_usd: usd2,
  positions_count: nonNegativeInt,
  holdings: z.array(attestationHoldingSchema),
  supply_backed_ratio: supplyBackedRatioSchema,
});
export type AttestationPayload = z.infer<typeof attestationPayloadSchema>;

export const attestationSignatureSchema = z.strictObject({
  scheme: z.literal("EIP-191 personal_sign (secp256k1)"),
  /** The exact canonical JSON that was signed. Verify against this, not a re-serialisation (D33). */
  message: z.string(),
  message_sha256: z.string().regex(/^0x[0-9a-f]{64}$/, "expected a 0x-prefixed sha256 digest"),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "expected a 65-byte secp256k1 signature"),
  attestor_address: evmAddress,
  attestor_public_key: z
    .string()
    .regex(/^0x04[0-9a-fA-F]{128}$/, "expected a SEC1 uncompressed public key"),
  attestor_note: z.string(),
  verify_with: z.string(),
});

export const attestationDocumentSchema = z.strictObject({
  generated_at: isoTimestamp,
  simulated: z.literal(true),
  source_note: z.string(),
  attestation: attestationPayloadSchema,
  signature: attestationSignatureSchema,
});
export type AttestationDocument = z.infer<typeof attestationDocumentSchema>;

// --------------------------------------------------------------------------- API envelope

/**
 * Stable error codes. Adding one is a breaking change for a partner switching on it, so they are
 * enumerated rather than free-form strings.
 */
export const apiErrorCode = z.enum([
  "bad_request",
  "invalid_document",
  "not_found",
  "chain_unavailable",
  "internal_error",
]);
export type ApiErrorCode = z.infer<typeof apiErrorCode>;

export const apiErrorSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({
    code: apiErrorCode,
    message: z.string(),
    /** What the caller (or the operator) can do about it. Always present. */
    hint: z.string(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** `{ ok: true, data: T }` — every successful response in this API. */
export function apiSuccessSchema<T extends z.ZodType>(data: T) {
  return z.strictObject({ ok: z.literal(true), data });
}

// --------------------------------------------------------------------------- /api/attestation

/**
 * The attestation endpoint has two legitimate states and this union is how a caller is forced to
 * handle both. `attestation.json` is not committed (PLAN.md D34) — it does not exist until a
 * founder runs `make attest` with the real attestor key — so "not published" is the normal answer
 * today, not an error, and it is returned with HTTP 200.
 */
export const attestationStatusSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("published"),
    document: attestationDocumentSchema,
  }),
  z.strictObject({
    status: z.literal("not_published"),
    /** Why there is nothing to show, in a sentence fit to render. */
    reason: z.string(),
    /** The command that produces it. */
    how_to_publish: z.string(),
    /** Where it will appear, repo-relative. */
    expected_path: z.string(),
    /** `SIMULATED_ATTESTOR_NOTE` — true of the published case too, so it is never dropped. */
    attestor_note: z.string(),
  }),
]);
export type AttestationStatus = z.infer<typeof attestationStatusSchema>;

export const attestationResponseSchema = apiSuccessSchema(attestationStatusSchema);

// --------------------------------------------------------------------------- /api/nav, /api/holdings

export const navResponseSchema = apiSuccessSchema(navDocumentSchema);
export const holdingsResponseSchema = apiSuccessSchema(holdingsDocumentSchema);

// --------------------------------------------------------------------------- the event index

/**
 * Every contract event the indexer decodes (PLAN.md D10).
 *
 * This is both contracts' product event surface, taken from `contracts/src/interfaces/`. The ones
 * left out carry no product meaning and would bury the ones that do: ERC-20 `Approval`, the
 * AccessControl role events, `MaxNavMoveBpsUpdated`, `MinSubscriptionUpdated` and MockUSDC's
 * `Faucet`. Adding a name here is additive for a caller switching on it; removing one is not.
 */
export const EVENT_NAMES = [
  "NAVUpdated",
  "NAVForced",
  "Subscribed",
  "Redeemed",
  "CouponDistributed",
  "CouponClaimed",
  "OperationalMint",
  "OperationalBurn",
  "Transfer",
  "Paused",
  "Unpaused",
  "IdentityVerified",
  "IdentityRemoved",
  "CountryBlockStatusChanged",
] as const;

export const eventNameSchema = z.enum(EVENT_NAMES);
export type EventName = (typeof EVENT_NAMES)[number];

/** Which contract emitted the event: `token` is `HBToken`, `registry` is `IdentityRegistry`. */
export const eventSourceSchema = z.enum(["token", "registry"]);
export type EventSource = z.infer<typeof eventSourceSchema>;

/** A lower-cased address, as the `accounts` array and the account filter both use. */
export const lowerCaseAddress = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/, "expected a lower-cased 20-byte hex address");

export const chainEventSchema = z.strictObject({
  name: eventNameSchema,
  source: eventSourceSchema,
  /** The emitting contract. Not an account: it never matches the `account` filter. */
  address: evmAddress,
  block_number: nonNegativeInt,
  /** The block's hash. Identity of a log is `(block_number, log_index, transaction_hash)`. */
  block_hash: hash32,
  /** Unix seconds, or `null` when the block's timestamp has not been fetched yet. */
  block_timestamp: nonNegativeInt.nullable(),
  /** The same instant as `block_timestamp`, ISO UTC, for a reader rather than a parser. */
  block_time: isoTimestamp.nullable(),
  transaction_hash: txHash,
  transaction_index: nonNegativeInt,
  log_index: nonNegativeInt,
  /**
   * Decoded arguments in ABI order, every value stringified: addresses checksummed, integers as
   * decimal strings of the exact integer the contract emitted (PLAN.md D22), booleans as
   * `"true"`/`"false"`. JSON has no BigInt and a JSON number would lose the low digits of an
   * 18-decimal amount.
   */
  args: z.record(z.string(), z.string()),
  /** Every address appearing anywhere in `args`, lower-cased. The account filter matches this. */
  accounts: z.array(lowerCaseAddress),
});
export type ChainEvent = z.infer<typeof chainEventSchema>;

/** A half-open block range the indexer could not read, and why. */
export const blockGapSchema = z.strictObject({
  from_block: nonNegativeInt,
  to_block: nonNegativeInt,
  reason: z.string(),
});
export type BlockGap = z.infer<typeof blockGapSchema>;

/**
 * What the index actually managed to read, said plainly.
 *
 * `complete: false` with a non-empty `gaps` is the honest answer when a public RPC truncated or
 * refused part of the range. A short list that looks complete is the failure mode this block
 * exists to prevent.
 */
export const indexCoverageSchema = z.strictObject({
  complete: z.boolean(),
  from_block: nonNegativeInt,
  to_block: nonNegativeInt,
  head_block: nonNegativeInt,
  chunk_size: nonNegativeInt,
  /** `eth_getLogs` calls made, including retries and splits. */
  log_requests: nonNegativeInt,
  gaps: z.array(blockGapSchema),
  /** Exact `(block, log index, transaction hash)` repeats dropped. Harmless. */
  duplicates_dropped: nonNegativeInt,
  /** Slots that held two different transactions while the index was built. That is a reorg. */
  reorg_conflicts: nonNegativeInt,
  /** Logs the node itself marked `removed`. */
  removed_logs_dropped: nonNegativeInt,
  /** Logs matching an indexed event that would not decode against its ABI. Should be zero. */
  undecodable_logs: nonNegativeInt,
  blocks_timestamped: nonNegativeInt,
  blocks_without_timestamp: nonNegativeInt,
  /** When this index was built, and how old the copy that answered this request is. */
  indexed_at: isoTimestamp,
  cache_age_seconds: nonNegativeInt,
  cache_ttl_seconds: nonNegativeInt,
  /** `true` when a rebuild failed and the previous index was served rather than nothing. */
  stale: z.boolean(),
  stale_reason: z.string().nullable(),
});
export type IndexCoverage = z.infer<typeof indexCoverageSchema>;

export const eventOrderSchema = z.enum(["asc", "desc"]);

/** The filters this request actually applied, echoed so a caller can see what it asked for. */
export const eventFiltersSchema = z.strictObject({
  /** Empty means every indexed event. */
  event: z.array(eventNameSchema),
  account: evmAddress.nullable(),
  from_block: nonNegativeInt.nullable(),
  to_block: nonNegativeInt.nullable(),
});

export const eventPageSchema = z.strictObject({
  order: eventOrderSchema,
  limit: nonNegativeInt,
  max_limit: nonNegativeInt,
  /** The cursor this request was given, and the one to pass for the next page. */
  cursor: z.string().nullable(),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
  returned: nonNegativeInt,
  /** How many events matched the filter in total, before the cursor and the limit. */
  matched: nonNegativeInt,
});

export const eventsResponseSchema = apiSuccessSchema(
  z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("ok"),
      chain_id: intField,
      network: z.string(),
      token_address: evmAddress,
      registry_address: evmAddress,
      deploy_block: nonNegativeInt,
      from_block: nonNegativeInt,
      to_block: nonNegativeInt,
      /** True when the index could not cover everything from `deploy_block`; see `coverage.gaps`. */
      window_truncated: z.boolean(),
      /** True when more events matched than this page returned; see `page.next_cursor`. */
      results_truncated: z.boolean(),
      limit: nonNegativeInt,
      count: nonNegativeInt,
      events: z.array(chainEventSchema),
      filters: eventFiltersSchema,
      page: eventPageSchema,
      coverage: indexCoverageSchema,
      /** What this endpoint still does not do. Rendered as-is; see PLAN.md D10. */
      limitations: z.array(z.string()),
    }),
    z.strictObject({
      status: z.literal("unavailable"),
      chain_id: intField,
      network: z.string(),
      reason: z.string(),
      limitations: z.array(z.string()),
    }),
  ]),
);
export type EventsResponse = z.infer<typeof eventsResponseSchema>;

// --------------------------------------------------------------------------- derived activity

/**
 * The holder count, with the one thing a reader has to know about it stated in the payload.
 *
 * `excludes_zero_address` is a literal `true` rather than a comment: the ERC-20 mint and burn
 * sentinel is not an account, and a count that included it would be wrong by one from the first
 * subscription onwards.
 */
export const holdersSchema = z.strictObject({
  count: nonNegativeInt,
  excludes_zero_address: z.literal(true),
  source: z.literal("Transfer logs"),
  basis: z.string(),
  /** Addresses that ever held a positive balance, whether or not they still do. */
  ever_held: nonNegativeInt,
  /** `false` when the index has gaps, so the count is a floor rather than an answer. */
  complete: z.boolean(),
});
export type Holders = z.infer<typeof holdersSchema>;

export const flowTotalsSchema = z.strictObject({
  count: nonNegativeInt,
  accounts: nonNegativeInt,
  usdc_6dec: integerString,
  tokens_wei: integerString,
});

export const distributionTotalsSchema = z.strictObject({
  count: nonNegativeInt,
  /** `CouponDistributed.usdcAmount`: what the issuer paid into the vault. */
  usdc_amount_6dec: integerString,
  /** `CouponDistributed.usdcAllocated`: the part the cumulative index attributed to holders. */
  usdc_allocated_6dec: integerString,
  /** `usdc_amount - usdc_allocated`: the PLAN.md D29 truncation remainder. Vault liquidity. */
  truncation_remainder_6dec: integerString,
  latest_distribution_id: integerString.nullable(),
  latest_at: isoTimestamp.nullable(),
  note: z.string(),
});

export const dailyActivitySchema = z.strictObject({
  date: isoDate,
  subscriptions_count: nonNegativeInt,
  subscriptions_usdc_in_6dec: integerString,
  subscriptions_tokens_out_wei: integerString,
  redemptions_count: nonNegativeInt,
  redemptions_tokens_in_wei: integerString,
  redemptions_usdc_out_6dec: integerString,
  distributions_count: nonNegativeInt,
  distributions_usdc_amount_6dec: integerString,
  distributions_usdc_allocated_6dec: integerString,
  claims_count: nonNegativeInt,
  claims_usdc_6dec: integerString,
  /** The last `NAVUpdated.newNav` of that UTC day, or `null` if NAV did not change. */
  nav_close_usdc_6dec: integerString.nullable(),
});
export type DailyActivity = z.infer<typeof dailyActivitySchema>;

export const onchainNavPointSchema = z.strictObject({
  block_number: nonNegativeInt,
  timestamp: nonNegativeInt.nullable(),
  time: isoTimestamp.nullable(),
  date: isoDate.nullable(),
  previous_nav_usdc_6dec: integerString,
  nav_usdc_6dec: integerString,
  reported_aum_usdc_6dec: integerString,
  /** `true` when `NAVForced` was emitted in the same transaction: an admin bypassed the rail. */
  forced: z.boolean(),
  transaction_hash: txHash,
});

export const verificationTotalsSchema = z.strictObject({
  verified_events: nonNegativeInt,
  removed_events: nonNegativeInt,
  /** Accounts verified and not since removed. Re-verification overwrites; it does not add. */
  currently_verified: nonNegativeInt,
});

/**
 * Everything BUILD_PROMPT 7.2 asks `/stats` for that can only come from events: holders,
 * distributions to date, and subscriptions and redemptions over time.
 *
 * A discriminated union for the same reason the chain block is one — when the indexer cannot read
 * the chain, the honest answer is `unavailable` with a reason, not a page full of zeros.
 */
export const eventActivitySchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ok"),
    chain_id: intField,
    network: z.string(),
    token_address: evmAddress,
    registry_address: evmAddress,
    deploy_block: nonNegativeInt,
    from_block: nonNegativeInt,
    to_block: nonNegativeInt,
    event_count: nonNegativeInt,
    event_counts: z.record(eventNameSchema, nonNegativeInt),
    holders: holdersSchema,
    supply_from_events: z.strictObject({
      wei: integerString,
      minted_wei: integerString,
      burned_wei: integerString,
      /** Whether it equals the contract's `totalSupply()`; `null` when the chain read failed. */
      matches_chain: z.boolean().nullable(),
      note: z.string(),
    }),
    subscriptions: flowTotalsSchema,
    redemptions: flowTotalsSchema,
    distributions: distributionTotalsSchema,
    claims: flowTotalsSchema,
    verifications: verificationTotalsSchema,
    pauses: z.strictObject({ paused: nonNegativeInt, unpaused: nonNegativeInt }),
    /** One row per UTC day from the first activity to the last, zero rows included. */
    daily: z.array(dailyActivitySchema),
    /** Events with no resolved block timestamp, and therefore in no daily bucket. */
    undated_events: nonNegativeInt,
    nav_history_onchain: z.array(onchainNavPointSchema),
    nav_history_truncated: z.boolean(),
    coverage: indexCoverageSchema,
    limitations: z.array(z.string()),
  }),
  z.strictObject({
    status: z.literal("unavailable"),
    chain_id: intField,
    network: z.string(),
    reason: z.string(),
    limitations: z.array(z.string()),
  }),
]);
export type EventActivity = z.infer<typeof eventActivitySchema>;

// --------------------------------------------------------------------------- /api/stats

/**
 * On-chain figures, when a deployment exists on the configured chain and the RPC answers.
 * Every amount is a decimal string of the integer the contract holds — JSON has no BigInt, and
 * a JSON number would quietly lose the low digits of an 18-decimal supply.
 */
export const chainStatsSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ok"),
    chain_id: intField,
    network: z.string(),
    token_address: evmAddress,
    registry_address: evmAddress,
    usdc_address: evmAddress,
    deploy_block: nonNegativeInt,
    paused: z.boolean(),
    total_supply_wei: integerString,
    total_supply_tokens: tokens18,
    nav_usdc_6dec: integerString,
    nav_per_token_usd: unit6,
    nav_updated_at: nonNegativeInt,
    reported_aum_usdc_6dec: integerString,
    vault_balance_usdc_6dec: integerString,
    available_liquidity_usdc_6dec: integerString,
    coupon_reserve_usdc_6dec: integerString,
    total_distributed_usdc_6dec: integerString,
    total_claimed_usdc_6dec: integerString,
    distribution_count: nonNegativeInt,
    supply_backed_ratio_1e18: integerString,
    min_subscription_usdc_6dec: integerString,
    max_nav_move_bps: nonNegativeInt,
    /**
     * Holders with a non-zero balance, folded from `Transfer` logs by the event indexer, or
     * `null` when the index could not be built (the reason is then in `activity.reason`). The
     * zero address is never counted — see `activity.holders` for that statement in the payload.
     */
    holders: nonNegativeInt.nullable(),
  }),
  z.strictObject({
    status: z.literal("unavailable"),
    chain_id: intField,
    network: z.string(),
    reason: z.string(),
  }),
]);
export type ChainStats = z.infer<typeof chainStatsSchema>;

/**
 * Does the NAV the engine published equal the NAV the contract holds?
 *
 * `matches` is `null`, not `false`, when there is nothing to compare against — no deployment, or
 * an RPC that did not answer. "We could not check" and "the check failed" are different facts and
 * the transparency page has to be able to tell them apart.
 */
export const navAgreementSchema = z.strictObject({
  published_usdc_6dec: nonNegativeInt,
  onchain_usdc_6dec: integerString.nullable(),
  matches: z.boolean().nullable(),
  note: z.string(),
});

export const statsResponseSchema = apiSuccessSchema(
  z.strictObject({
    generated_at: isoTimestamp,
    as_of: isoDate,
    simulated: z.literal(true),
    source_note: z.string(),
    nav: navBlockSchema,
    portfolio: portfolioBlockSchema,
    distribution_yield: distributionYieldBlockSchema,
    fees: feesBlockSchema,
    history: z.strictObject({
      entries: z.array(navHistoryEntrySchema),
      first_date: isoDate.nullable(),
      last_date: isoDate.nullable(),
      count: nonNegativeInt,
    }),
    chain: chainStatsSchema,
    activity: eventActivitySchema,
    nav_agreement: navAgreementSchema,
    notes: z.array(z.string()),
  }),
);
export type StatsResponse = z.infer<typeof statsResponseSchema>;
