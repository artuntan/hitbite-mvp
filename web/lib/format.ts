/**
 * Number, money, date and address formatting.
 *
 * One rule runs through this file: **integers in, strings out**. USDC is a 6-decimal integer, the
 * token is an 18-decimal integer, and NAV is a 6-decimal integer per 1e18 tokens — exactly as the
 * contract stores them and exactly as the engine publishes them next to its display strings
 * (PLAN.md D22). Nothing here re-derives a money value from a JavaScript number, because
 * `0.1 + 0.2` is the reason funds publish integers.
 *
 * Engine documents also carry fixed-scale display strings (`"1016860.71"`, `"1.003061"`). Those
 * are parsed **exactly** with `parseFixed`, never with `Number()`.
 *
 * Dates are formatted from UTC components by hand rather than through `Intl`/`toLocaleDateString`,
 * so a server render and a client render produce identical bytes and React never reports a
 * hydration mismatch.
 */

// --------------------------------------------------------------------------- scales

export const USDC_DECIMALS = 6;
export const TOKEN_DECIMALS = 18;

/** 1e6 — the scale of a USDC amount and of `nav`. */
export const USDC_SCALE = 1_000_000n;
/** 1e18 — the scale of an hbTRS amount and of `couponIndex`. */
export const TOKEN_SCALE = 1_000_000_000_000_000_000n;

/**
 * `HBToken.MAX_INPUT` — `type(uint128).max`. Every amount, NAV and reported-AUM input is bounded
 * by it so no intermediate product can overflow (PLAN.md D28). The UI should reject above this
 * before asking a wallet to sign something the contract will revert.
 */
export const MAX_INPUT = (1n << 128n) - 1n;

export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatError";
  }
}

// --------------------------------------------------------------------------- exact parsing

const FIXED_RE = /^(-)?(\d+)(?:\.(\d*))?$/;

/**
 * Parse a fixed-point decimal string into a scaled BigInt, exactly.
 *
 * `parseFixed("1016860.71", 6) === 1016860710000n`. Throws when the string is not a plain decimal
 * or carries more fractional digits than `decimals` can hold — silently dropping precision is how
 * a displayed number stops matching the chain.
 */
export function parseFixed(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new FormatError(`parseFixed: decimals must be an integer in 0..36, got ${decimals}`);
  }
  const match = FIXED_RE.exec(value.trim());
  if (!match) {
    throw new FormatError(`parseFixed: ${JSON.stringify(value)} is not a decimal number`);
  }
  const [, sign, whole = "0", fraction = ""] = match;
  if (fraction.length > decimals) {
    throw new FormatError(
      `parseFixed: ${JSON.stringify(value)} has ${fraction.length} fractional digits, ` +
        `more than the ${decimals} this scale can represent`,
    );
  }
  const scaled = BigInt(whole + fraction.padEnd(decimals, "0"));
  return sign === "-" ? -scaled : scaled;
}

/** `parseFixed` that returns `null` instead of throwing. */
export function tryParseFixed(value: string, decimals: number): bigint | null {
  try {
    return parseFixed(value, decimals);
  } catch {
    return null;
  }
}

/** An engine USD display string (`"12500.00"`) as a 6-decimal integer. */
export function toUsdc6(displayValue: string): bigint {
  return parseFixed(displayValue, USDC_DECIMALS);
}

/** An engine token display string (18 dp) as an 18-decimal integer. */
export function toTokens18(displayValue: string): bigint {
  return parseFixed(displayValue, TOKEN_DECIMALS);
}

export type ParsedAmount =
  | { readonly ok: true; readonly value: bigint; readonly truncated: boolean }
  | { readonly ok: false; readonly error: string };

/**
 * Parse free-text user input (a subscribe or redeem box) into a scaled integer.
 *
 * Tolerant where tolerance is harmless — surrounding whitespace, thousands separators, a bare
 * leading or trailing `.` — and explicit where it is not: extra precision is **truncated**, never
 * rounded up, and the caller is told so it can show what will actually be sent.
 */
export function parseAmount(input: string, decimals: number): ParsedAmount {
  const cleaned = input.trim().replace(/,/g, "").replace(/\s/g, "");
  if (cleaned === "") return { ok: false, error: "Enter an amount." };
  const normalised = cleaned.startsWith(".")
    ? `0${cleaned}`
    : cleaned.endsWith(".")
      ? cleaned.slice(0, -1)
      : cleaned;
  const match = FIXED_RE.exec(normalised);
  if (!match) return { ok: false, error: "Enter a number, for example 1000 or 1000.50." };
  const [, sign, whole = "0", fraction = ""] = match;
  if (sign === "-") return { ok: false, error: "Enter a positive amount." };
  const truncated = fraction.length > decimals;
  const kept = fraction.slice(0, decimals).padEnd(decimals, "0");
  return { ok: true, value: BigInt(whole + kept), truncated };
}

/** True when a scaled amount fits the contract's `MAX_INPUT` bound and is positive. */
export function isWithinContractBounds(value: bigint): boolean {
  return value > 0n && value <= MAX_INPUT;
}

// --------------------------------------------------------------------------- core formatter

export type Rounding = "half-up" | "trunc";

export interface FormatFixedOptions {
  /** Digits after the point in the output. Defaults to the value's own scale. */
  displayDecimals?: number;
  /** `"half-up"` rounds half away from zero (default); `"trunc"` drops the remainder. */
  rounding?: Rounding;
  /** Thousands separators. Default `true`. */
  group?: boolean;
  /** `"always"` prefixes a `+` on positive, non-zero values. Default `"auto"`. */
  signDisplay?: "auto" | "always";
}

function group3(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format a scaled integer. The single primitive every other money formatter here is built on.
 *
 * Display rounding never changes the underlying integer: `formatFixed` is for showing a number,
 * `parseFixed` is for carrying it. When a displayed value must be exactly what settles on-chain,
 * show every decimal the scale has (`formatUsdcExact`) rather than a rounded one.
 */
export function formatFixed(
  value: bigint,
  decimals: number,
  options: FormatFixedOptions = {},
): string {
  const {
    displayDecimals = decimals,
    rounding = "half-up",
    group = true,
    signDisplay = "auto",
  } = options;

  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new FormatError(`formatFixed: decimals must be a non-negative integer, got ${decimals}`);
  }
  if (!Number.isInteger(displayDecimals) || displayDecimals < 0) {
    throw new FormatError(
      `formatFixed: displayDecimals must be a non-negative integer, got ${displayDecimals}`,
    );
  }

  const negative = value < 0n;
  const magnitude = negative ? -value : value;

  let scaled: bigint;
  if (displayDecimals >= decimals) {
    scaled = magnitude * 10n ** BigInt(displayDecimals - decimals);
  } else {
    const divisor = 10n ** BigInt(decimals - displayDecimals);
    scaled = rounding === "trunc" ? magnitude / divisor : (magnitude + divisor / 2n) / divisor;
  }

  const unit = 10n ** BigInt(displayDecimals);
  const whole = scaled / unit;
  const fraction = scaled % unit;

  const wholeText = group ? group3(whole.toString()) : whole.toString();
  const fractionText =
    displayDecimals > 0 ? `.${fraction.toString().padStart(displayDecimals, "0")}` : "";

  // A value that rounds to zero is shown as zero, never as "-0.00".
  const sign = scaled === 0n ? "" : negative ? "-" : signDisplay === "always" ? "+" : "";
  return `${sign}${wholeText}${fractionText}`;
}

/**
 * Ungrouped fixed-point text, for machine-readable output (JSON responses, CSV cells, `value`
 * attributes). Same arithmetic as `formatFixed`, without the thousands separators that would make
 * the string unparseable by anything but a human.
 */
export function formatPlain(value: bigint, decimals: number, displayDecimals = decimals): string {
  return formatFixed(value, decimals, { displayDecimals, group: false });
}

// --------------------------------------------------------------------------- USDC

/**
 * Format a 6-decimal USDC integer (as stored on-chain) for display with two decimals
 * and thousands separators, e.g. 1_234_560_000n -> "1,234.56".
 *
 * Pure BigInt arithmetic; rounds half away from zero to the nearest cent.
 */
export function formatUsdc(amount6dec: bigint): string {
  return formatFixed(amount6dec, USDC_DECIMALS, { displayDecimals: 2 });
}

/**
 * All six decimals of a USDC integer, e.g. `1_003_061n -> "1.003061"`. Use this wherever the
 * number shown has to be the number the contract holds — NAV, previews, transparency checks.
 */
export function formatUsdcExact(amount6dec: bigint): string {
  return formatFixed(amount6dec, USDC_DECIMALS, { displayDecimals: USDC_DECIMALS });
}

/** `formatUsdc` with a currency suffix, e.g. `"1,234.56 USDC"`. */
export function formatUsdcWithSymbol(amount6dec: bigint, symbol = "USDC"): string {
  return `${formatUsdc(amount6dec)} ${symbol}`;
}

/** A USD display string straight from an engine document, re-formatted with separators. */
export function formatUsdString(displayValue: string, displayDecimals = 2): string {
  return formatFixed(toUsdc6(displayValue), USDC_DECIMALS, { displayDecimals });
}

/** A signed USD delta from an engine display string, e.g. `"-22658.30" -> "-22,658.30"`. */
export function formatUsdDelta(displayValue: string, displayDecimals = 2): string {
  return formatFixed(toUsdc6(displayValue), USDC_DECIMALS, {
    displayDecimals,
    signDisplay: "always",
  });
}

// --------------------------------------------------------------------------- tokens

/**
 * Format an 18-decimal token amount. Truncates by default: a balance must never round up past
 * what the holder can actually move.
 */
export function formatTokens(amount18dec: bigint, displayDecimals = 4): string {
  return formatFixed(amount18dec, TOKEN_DECIMALS, { displayDecimals, rounding: "trunc" });
}

/** All eighteen decimals, for a details row or a copy-to-clipboard value. */
export function formatTokensExact(amount18dec: bigint): string {
  return formatFixed(amount18dec, TOKEN_DECIMALS, { displayDecimals: TOKEN_DECIMALS });
}

export function formatTokensWithSymbol(
  amount18dec: bigint,
  symbol = "hbTRS",
  displayDecimals = 4,
): string {
  return `${formatTokens(amount18dec, displayDecimals)} ${symbol}`;
}

/** A 1e18-scaled ratio such as `HBToken.supplyBackedRatio()`, e.g. `"1.0000"`. */
export function formatRatio1e18(ratio: bigint, displayDecimals = 4): string {
  return formatFixed(ratio, 18, { displayDecimals });
}

// --------------------------------------------------------------------------- contract arithmetic

/**
 * `HBToken.previewSubscribe` in TypeScript: `tokens = usdcAmount * 1e18 / nav`, truncated.
 *
 * BigInt division truncates toward zero and both inputs are non-negative, so this is the same
 * floor the EVM performs. Quote from this, not from a float — the interface must not promise a
 * token amount the chain will not mint.
 */
export function previewSubscribeTokens(usdcAmount6: bigint, nav6: bigint): bigint {
  if (usdcAmount6 < 0n)
    throw new FormatError("previewSubscribeTokens: amount must not be negative");
  if (nav6 <= 0n) throw new FormatError("previewSubscribeTokens: nav must be positive");
  return (usdcAmount6 * TOKEN_SCALE) / nav6;
}

/** `HBToken.previewRedeem`: `usdcOut = tokenAmount * nav / 1e18`, truncated the same way. */
export function previewRedeemUsdc(tokenAmount18: bigint, nav6: bigint): bigint {
  if (tokenAmount18 < 0n) throw new FormatError("previewRedeemUsdc: amount must not be negative");
  if (nav6 <= 0n) throw new FormatError("previewRedeemUsdc: nav must be positive");
  return (tokenAmount18 * nav6) / TOKEN_SCALE;
}

// --------------------------------------------------------------------------- percentages and bps

function formatFiniteNumber(
  value: number,
  displayDecimals: number,
  signDisplay: "auto" | "always",
) {
  if (!Number.isFinite(value)) throw new FormatError(`not a finite number: ${value}`);
  const fixed = value.toFixed(displayDecimals);
  const negative = fixed.startsWith("-");
  const body = negative ? fixed.slice(1) : fixed;
  const [wholePart = "0", fractionPart] = body.split(".");
  const isZero = /^0(\.0*)?$/.test(body);
  const sign = isZero ? "" : negative ? "-" : signDisplay === "always" ? "+" : "";
  return `${sign}${group3(wholePart)}${fractionPart ? `.${fractionPart}` : ""}`;
}

/**
 * Format a percentage. Yields, durations and convexities are the only figures in this codebase
 * that legitimately arrive as floats — they are risk analytics, not money (engine `Float6`).
 * A fixed-scale string is accepted too and is parsed exactly.
 */
export function formatPercent(
  value: number | string,
  displayDecimals = 2,
  options: { signDisplay?: "auto" | "always"; suffix?: string } = {},
): string {
  const { signDisplay = "auto", suffix = "%" } = options;
  if (typeof value === "string") {
    const scaled = parseFixed(value, 8);
    return `${formatFixed(scaled, 8, { displayDecimals, signDisplay })}${suffix}`;
  }
  return `${formatFiniteNumber(value, displayDecimals, signDisplay)}${suffix}`;
}

/** A percentage with an explicit sign, for scenario deltas. */
export function formatPercentDelta(value: number | string, displayDecimals = 2): string {
  return formatPercent(value, displayDecimals, { signDisplay: "always" });
}

/** A plain analytic number (modified duration, convexity) with no unit. */
export function formatNumber(value: number | string, displayDecimals = 2): string {
  if (typeof value === "string") {
    return formatFixed(parseFixed(value, 8), 8, { displayDecimals });
  }
  return formatFiniteNumber(value, displayDecimals, "auto");
}

/** `500 -> "500 bp"`. Basis points are integers; they are never shown with a fraction. */
export function formatBasisPoints(bps: number | bigint): string {
  const asBigInt = typeof bps === "bigint" ? bps : BigInt(Math.trunc(bps));
  return `${formatFixed(asBigInt, 0)} bp`;
}

/** `500 -> "5.00%"`. One basis point is one hundredth of a percent. */
export function formatBasisPointsAsPercent(bps: number | bigint, displayDecimals = 2): string {
  const asBigInt = typeof bps === "bigint" ? bps : BigInt(Math.trunc(bps));
  return `${formatFixed(asBigInt, 2, { displayDecimals })}%`;
}

// --------------------------------------------------------------------------- dates

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function toUtcDate(value: string | Date): Date {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    throw new FormatError(`not a valid date: ${JSON.stringify(value)}`);
  }
  return date;
}

function monthName(index: number): string {
  const name = MONTHS[index];
  if (name === undefined) throw new FormatError(`month index out of range: ${index}`);
  return name;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

/** `"2026-09-14" -> "14 Sep 2026"`. UTC, locale-independent, identical on server and client. */
export function formatDate(value: string | Date): string {
  const date = toUtcDate(value);
  return `${date.getUTCDate()} ${monthName(date.getUTCMonth())} ${date.getUTCFullYear()}`;
}

/** `"2026-09-14T06:00:00Z" -> "14 Sep 2026, 06:00 UTC"`. */
export function formatDateTimeUtc(value: string | Date): string {
  const date = toUtcDate(value);
  return `${formatDate(date)}, ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())} UTC`;
}

/** `"2026-09-14T06:00:00Z" -> "2026-09-14"`. For `<time dateTime>` and CSV columns. */
export function formatIsoDate(value: string | Date): string {
  const date = toUtcDate(value);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** `1789420690 -> "14 Sep 2026, 21:18 UTC"`. Unix seconds, as recorded by the deploy script. */
export function formatUnixSeconds(seconds: number | bigint): string {
  const asNumber = typeof seconds === "bigint" ? Number(seconds) : seconds;
  return formatDateTimeUtc(new Date(asNumber * 1000));
}

// --------------------------------------------------------------------------- addresses and hashes

const HEX_RE = /^0x[0-9a-fA-F]+$/;

/**
 * `"0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" -> "0x9fE4…a6e0"`.
 *
 * Returns the input unchanged when it does not look like hex: a formatter used inside a render
 * must not be able to blank a page, and an unexpected value is more useful shown than hidden.
 */
export function formatAddress(address: string, chars = 4): string {
  if (!HEX_RE.test(address) || address.length <= 2 + chars * 2) return address;
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

/** Same shortening, wider by default, for 32-byte transaction hashes. */
export function formatTxHash(hash: string, chars = 6): string {
  return formatAddress(hash, chars);
}
