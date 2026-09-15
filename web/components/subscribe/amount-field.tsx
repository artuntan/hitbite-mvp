"use client";

/**
 * The USDC amount box.
 *
 * Free text rather than `<input type="number">`: a number input's spinner and locale-dependent
 * decimal handling are both wrong for money, and `inputMode="decimal"` already gives a phone the
 * right keypad. What is typed is parsed exactly by `readAmount`, so the person sees the truncation
 * (D52) rather than discovering it in the quote.
 */

import * as React from "react";

import { Button } from "@/components/ui/button";
import { amountTextFromUsdc6, type AmountReading } from "@/components/subscribe/quote";
import { formatUsdcExact } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface AmountFieldProps {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  reading: AmountReading;
  disabled?: boolean;
  /** `minSubscription()` from the token, when it could be read. */
  minimum6?: bigint | null;
  /** The connected wallet's test USDC balance, when it could be read. */
  balance6?: bigint | null;
  inputRef?: React.Ref<HTMLInputElement>;
  className?: string;
}

export function AmountField({
  id = "subscribe-amount",
  value,
  onChange,
  reading,
  disabled = false,
  minimum6 = null,
  balance6 = null,
  inputRef,
  className,
}: AmountFieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [reading.error ? errorId : null, hintId].filter(Boolean).join(" ");

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-ink text-sm font-medium">
        Amount to subscribe
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
          name="amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="0.000000"
          value={value}
          disabled={disabled}
          aria-invalid={reading.error ? true : undefined}
          aria-describedby={describedBy || undefined}
          onChange={(event) => onChange(event.target.value)}
          className="num text-ink placeholder:text-muted h-11 w-full bg-transparent text-lg outline-none disabled:cursor-not-allowed"
        />
        <span className="text-muted shrink-0 text-sm font-medium">USDC</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {minimum6 !== null ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onChange(amountTextFromUsdc6(minimum6))}
          >
            Minimum ({formatUsdcExact(minimum6)})
          </Button>
        ) : null}
        {balance6 !== null && balance6 > 0n ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onChange(amountTextFromUsdc6(balance6))}
          >
            Balance ({formatUsdcExact(balance6)})
          </Button>
        ) : null}
      </div>

      {reading.error ? (
        <p id={errorId} className="text-danger text-sm">
          {reading.error}
        </p>
      ) : null}

      <p id={hintId} className="text-muted text-xs">
        Test USDC has six decimals. Anything finer than that is dropped, never rounded up, so the
        number quoted below is the number that settles.
        {reading.truncated && reading.value6 !== null ? (
          <>
            {" "}
            <span className="text-warning">
              Extra decimals were dropped: {formatUsdcExact(reading.value6)} USDC will be sent.
            </span>
          </>
        ) : null}
      </p>
    </div>
  );
}
