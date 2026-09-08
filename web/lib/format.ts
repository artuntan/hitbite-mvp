const USDC_DECIMALS = 6n;
const DISPLAY_DECIMALS = 2n;
const ROUNDING_DIVISOR = 10n ** (USDC_DECIMALS - DISPLAY_DECIMALS); // 10_000n
const CENTS_PER_UNIT = 10n ** DISPLAY_DECIMALS; // 100n

/**
 * Format a 6-decimal USDC integer (as stored on-chain) for display with two decimals
 * and thousands separators, e.g. 1_234_560_000n -> "1,234.56".
 *
 * Pure BigInt arithmetic; rounds half away from zero to the nearest cent.
 */
export function formatUsdc(amount6dec: bigint): string {
  const negative = amount6dec < 0n;
  const magnitude = negative ? -amount6dec : amount6dec;
  const cents = (magnitude + ROUNDING_DIVISOR / 2n) / ROUNDING_DIVISOR;
  const whole = cents / CENTS_PER_UNIT;
  const fraction = cents % CENTS_PER_UNIT;

  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = negative && cents > 0n ? "-" : "";
  return `${sign}${grouped}.${fraction.toString().padStart(2, "0")}`;
}
