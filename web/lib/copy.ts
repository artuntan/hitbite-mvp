/**
 * The copy blocks from BUILD_PROMPT.md section 15, verbatim, as typed constants.
 *
 * They live here and nowhere else so that the required wording cannot drift page by page. Import
 * them; do not retype them. If a founder changes a sentence, it changes in one file and every page
 * follows.
 *
 * The banner and the footer disclaimer are mandatory on **every** page (BUILD_PROMPT.md sections 2
 * and 15). Section 2 additionally specifies a short form of the notice, kept below as
 * `TESTNET_NOTICE_SHORT` for places with no room for the full sentence (document metadata, the
 * `<title>` description, an OpenGraph summary).
 */

/** BUILD_PROMPT.md 15 — testnet banner. Amber, persistent, on every page. */
export const TESTNET_BANNER =
  "Testnet demonstration on Base Sepolia. Simulated portfolio and attestation. Not an offer of securities." as const;

/** BUILD_PROMPT.md 2 — the short form, for metadata and other tight spaces. */
export const TESTNET_NOTICE_SHORT =
  "Testnet demonstration. Simulated portfolio. Not an offer of securities." as const;

/** BUILD_PROMPT.md 15 — product summary, shown on the Overview page. */
export const PRODUCT_SUMMARY =
  "hbTRS is a whitelisted token representing a simulated, custodied portfolio of Türkiye USD sovereign bonds. Subscriptions and redemptions settle at net asset value in test USDC; coupons are passed through pro-rata. In production the fund is issued and managed by a licensed fund manager; HitBite designs the product, runs the data and transparency layers, and builds distribution." as const;

/** BUILD_PROMPT.md 15 — "How it works", as the single sentence-run the prompt specifies. */
export const HOW_IT_WORKS_TEXT =
  "1. Verify your wallet (professional investors; some countries are excluded). 2. Subscribe in USDC at the current NAV. 3. The portfolio holds Türkiye USD sovereign bonds; NAV updates daily. 4. Coupons are distributed to holders and claimable any time. 5. Redeem at NAV, subject to available liquidity." as const;

/**
 * The same five steps split for an ordered list. Each `text` is the sentence from
 * `HOW_IT_WORKS_TEXT` with only its leading numeral removed — the wording is untouched.
 */
export const HOW_IT_WORKS_STEPS = [
  { step: 1, text: "Verify your wallet (professional investors; some countries are excluded)." },
  { step: 2, text: "Subscribe in USDC at the current NAV." },
  { step: 3, text: "The portfolio holds Türkiye USD sovereign bonds; NAV updates daily." },
  { step: 4, text: "Coupons are distributed to holders and claimable any time." },
  { step: 5, text: "Redeem at NAV, subject to available liquidity." },
] as const;

/** BUILD_PROMPT.md 15 — footer disclaimer. Mandatory on every page. */
export const FOOTER_DISCLAIMER =
  "This is a technical demonstration on a public test network. Portfolio data, prices and attestations are simulated or illustrative and are labelled as such. Nothing here is an offer, solicitation or recommendation to buy any security. HitBite is not a licensed financial institution." as const;

export interface RealVsSimulatedRow {
  /** What the row is about, e.g. "Legal issuer". */
  readonly item: string;
  /** What exists in this testnet MVP. */
  readonly inThisDemo: string;
  /** What a licensed partner runs in production. */
  readonly inProduction: string;
}

/**
 * BUILD_PROMPT.md 15 — "Real vs. simulated". The prompt gives these as `item — demo / production`
 * triples; they are split into fields here so the same source renders as a table in the app and as
 * a markdown table in the README.
 */
export const REAL_VS_SIMULATED: readonly RealVsSimulatedRow[] = [
  { item: "Legal issuer", inThisDemo: "none", inProduction: "licensed ADGM fund manager" },
  { item: "KYC", inThisDemo: "auto-approve on testnet", inProduction: "partner's KYC vendor" },
  {
    item: "Money",
    inThisDemo: "MockUSDC",
    inProduction: "fiat or USDC to the fund's account",
  },
  {
    item: "Custody",
    inThisDemo: "none",
    inProduction: "broker-Euroclear and licensed digital custodian",
  },
  {
    item: "Token contract",
    inThisDemo: "ours",
    inProduction: "vendor's audited implementation of this spec",
  },
  { item: "NAV", inThisDemo: "our engine", inProduction: "fund administrator's NAV" },
  {
    item: "Attestation",
    inThisDemo: "simulated signer",
    inProduction: "independent firm monthly",
  },
  { item: "Dashboard and transparency", inThisDemo: "ours", inProduction: "ours" },
] as const;

/**
 * PLAN.md D9 / engine `ATTESTOR_NOTE`. Byte-identical to the note the engine writes into every
 * attestation payload, so the page and the signed document say the same thing.
 */
export const SIMULATED_ATTESTOR_NOTE =
  "Simulated attestor — an independent firm signs in production." as const;

/**
 * Shown by `/transparency` and returned by `/api/attestation` while `attestation.json` has never
 * been generated (PLAN.md D34). Stating the absence plainly is the honest rendering; inventing a
 * signature from a throwaway key would not be.
 */
export const NO_ATTESTATION_PUBLISHED =
  "No attestation has been published yet. Signing requires the attestor key, which is held by the founders; until `make attest` runs there is nothing to verify, and this page will not pretend otherwise." as const;

/** Product identity, so the token symbol and name are typed in one place. */
export const TOKEN = {
  symbol: "hbTRS",
  name: "HitBite Türkiye Sovereign (Testnet)",
  decimals: 18,
  quoteSymbol: "USDC",
  quoteName: "MockUSDC (Testnet)",
  quoteDecimals: 6,
} as const;
