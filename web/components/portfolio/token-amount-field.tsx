"use client";

/**
 * The hbTRS amount box.
 *
 * Free text rather than `<input type="number">`, for the reasons `components/subscribe/amount-field`
 * gives: a spinner and locale-dependent decimal parsing are both wrong for money, and
 * `inputMode="decimal"` already gives a phone the right keypad. What is typed is parsed exactly by
 * `readTokenAmount`, so the truncation is visible here rather than discovered in the quote.
 *
 * The two shortcuts are the ones that matter on this page: the whole balance, and the largest
 * amount available liquidity can actually pay for. The second is what turns a refused redemption
 * into one click rather than an arithmetic exercise.
 */

import * as React from "react";

import { Button } from "@/components/ui/button";
import { tokenAmountText, type TokenAmountReading } from "@/components/portfolio/position";
import { TOKEN } from "@/lib/copy";
import { formatTokens, formatUsdcExact } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface TokenAmountFieldProps {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  reading: TokenAmountReading;
  disabled?: boolean;
  /** `balanceOf` for the address being viewed, when it could be read. */
  balance18?: bigint | null;
  /** The most `availableLiquidity()` can pay for right now, in tokens. */
  maxRedeemable18?: bigint | null;
  /** `availableLiquidity()` itself, for the label on that shortcut. */
  available6?: bigint | null;
  inputRef?: React.Ref<HTMLInputElement>;
  className?: string;
}

export function TokenAmountField({
  id = "redeem-amount",
  value,
  onChange,
  reading,
  disabled = false,
  balance18 = null,
  maxRedeemable18 = null,
  available6 = null,
  inputRef,
  className,
}: TokenAmountFieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [reading.error ? errorId : null, hintId].filter(Boolean).join(" ");

  // Offered only when it differs from the balance: otherwise it is the same button twice.
  const showLiquidityShortcut =
    maxRedeemable18 !== null &&
    maxRedeemable18 > 0n &&
    (balance18 === null || maxRedeemable18 < balance18);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-ink text-sm font-medium">
        Amount to redeem
      </label>

      <div
        className={cn(
          "border-border-strong bg-surface focus-within:outline-ring flex items-center gap-2 rounded-md border px-3",
          "focus-within:outline-2 focus-within:outline-offset-2",
          reading.error && "border-danger",
          disabled && "opacity-60",
        )}
      >
        <input
          ref={inputRef}
          id={id}
          name="redeem-amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="0.0000"
          value={value}
          disabled={disabled}
          aria-invalid={reading.error ? true : undefined}
          aria-describedby={describedBy || undefined}
          onChange={(event) => onChange(event.target.value)}
          className="num text-ink placeholder:text-muted h-11 w-full bg-transparent text-lg outline-none disabled:cursor-not-allowed"
        />
        <span className="text-muted shrink-0 text-sm font-medium">{TOKEN.symbol}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {balance18 !== null && balance18 > 0n ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            data-testid="use-balance"
            onClick={() => onChange(tokenAmountText(balance18))}
          >
            Whole balance ({formatTokens(balance18, 4)})
          </Button>
        ) : null}
        {showLiquidityShortcut ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            data-testid="use-max-liquidity"
            onClick={() => onChange(tokenAmountText(maxRedeemable18))}
          >
            Most available ({formatTokens(maxRedeemable18, 4)})
          </Button>
        ) : null}
      </div>

      {reading.error ? (
        <p id={errorId} className="text-danger text-sm">
          {reading.error}
        </p>
      ) : null}

      <p id={hintId} className="text-muted text-xs">
        {TOKEN.symbol} has eighteen decimals. Anything finer is dropped, never rounded up, so the
        payout quoted below is the payout that settles.
        {available6 !== null ? (
          <> Available liquidity right now: {formatUsdcExact(available6)} USDC.</>
        ) : null}
        {reading.truncated && reading.value18 !== null ? (
          <>
            {" "}
            <span className="text-warning">
              Extra decimals were dropped: {formatTokens(reading.value18, 18)} {TOKEN.symbol} will
              be burned.
            </span>
          </>
        ) : null}
      </p>
    </div>
  );
}
