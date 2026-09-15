"use client";

/**
 * Whose portfolio this is.
 *
 * By default it is the connected wallet's. An address can also be typed in, or arrive as
 * `?address=0x…`, and then the page is read-only: balances, coupons, cost basis and history all
 * work for any address, because all of them are public chain state. Only the two writes are
 * restricted, and they are restricted by the contract, not by this control — `redeem` burns from
 * the signer and `claimCoupon` pays the caller, so neither can act on somebody else's position
 * whatever this page shows.
 *
 * It exists because a reviewer with no test wallet should still be able to look at a demo address,
 * and because the empty state is worth being able to see on purpose.
 */

import * as React from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isAddressLike(value: string): boolean {
  return ADDRESS_RE.test(value.trim());
}

export interface AddressPickerProps {
  /** The address being viewed, when it is not simply the connected wallet's. */
  viewing: string | null;
  onView: (address: string) => void;
  onClear: () => void;
  /** The connected wallet, for the "back to mine" wording. */
  connected: string | undefined;
  className?: string;
}

export function AddressPicker({
  viewing,
  onView,
  onClear,
  connected,
  className,
}: AddressPickerProps) {
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const submit = React.useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const value = text.trim();
      if (!isAddressLike(value)) {
        setError("That is not a 20-byte address. Paste a full 0x-prefixed address.");
        return;
      }
      setError(null);
      setText("");
      onView(value);
    },
    [text, onView],
  );

  return (
    <form
      onSubmit={submit}
      className={cn("flex flex-col gap-2", className)}
      data-testid="address-picker"
    >
      <label htmlFor="portfolio-address" className="text-ink text-sm font-medium">
        Look up an address
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="portfolio-address"
          name="address"
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="0x…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "portfolio-address-error" : "portfolio-address-hint"}
          className={cn(
            "addr border-border-strong bg-surface text-ink placeholder:text-muted focus-visible:outline-ring",
            "h-9 min-w-0 flex-1 rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2",
            error && "border-danger",
          )}
        />
        <Button type="submit" variant="secondary" size="sm" data-testid="address-view">
          <Search aria-hidden="true" />
          View
        </Button>
        {viewing !== null ? (
          <Button variant="ghost" size="sm" onClick={onClear} data-testid="address-clear">
            <X aria-hidden="true" />
            {connected ? `Back to ${formatAddress(connected)}` : "Clear"}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p id="portfolio-address-error" className="text-danger text-sm">
          {error}
        </p>
      ) : (
        <p id="portfolio-address-hint" className="text-muted text-xs">
          Balances, coupons and history are public chain state, so any address can be inspected
          here. Claiming and redeeming still need the wallet that holds the position — the contract
          pays the caller and burns from the signer.
        </p>
      )}
    </form>
  );
}
