"use client";

/**
 * The country field, and the blocklist explanation that has to sit beside it.
 *
 * BUILD_PROMPT.md 16.1 and PLAN.md D23: the list is the full ISO 3166-1 set, and blocked codes are
 * **disabled and explained**, never quietly missing. A list that simply omitted them would make the
 * rule invisible — somebody would search for their country, fail to find it, and learn nothing.
 */

import * as React from "react";
import { Ban, RefreshCw } from "lucide-react";

import { BLOCKLIST_INTRO, ON_CHAIN_IS_THE_RULE } from "@/components/verify/copy";
import type { BlocklistState } from "@/components/verify/use-blocklist";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FieldHint, FieldLabel, Select } from "@/components/verify/fields";
import { COUNTRIES_BY_NAME, COUNTRY_LIST_SOURCE, getCountryByNumeric } from "@/lib/countries";

export interface CountrySelectProps {
  id: string;
  value: number | null;
  onValueChange: (value: number | null) => void;
  /** Numeric code to reason. Rendered as a disabled option and as an explanation. */
  blocked: ReadonlyMap<number, string>;
  disabled?: boolean;
  describedBy?: string;
}

export function CountrySelect({
  id,
  value,
  onValueChange,
  blocked,
  disabled,
  describedBy,
}: CountrySelectProps) {
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel htmlFor={id}>Country of residence</FieldLabel>
      <Select
        id={id}
        name="country"
        value={value === null ? "" : String(value)}
        disabled={disabled}
        aria-describedby={describedBy ? `${hintId} ${describedBy}` : hintId}
        onChange={(event) => {
          const next = event.target.value;
          onValueChange(next === "" ? null : Number(next));
        }}
      >
        <option value="">Select a country</option>
        {COUNTRIES_BY_NAME.map((country) => {
          const isBlocked = blocked.has(country.numeric);
          return (
            <option key={country.numeric} value={country.numeric} disabled={isBlocked}>
              {country.name} ({country.numeric}){isBlocked ? " — blocked" : ""}
            </option>
          );
        })}
      </Select>
      <FieldHint id={hintId}>
        All {COUNTRIES_BY_NAME.length} ISO 3166-1 codes, from {COUNTRY_LIST_SOURCE}. The registry
        stores this number, not your address or your name. Blocked codes are listed below and cannot
        be selected.
      </FieldHint>
    </div>
  );
}

/** The one-line source of the list in force, for the panel heading. */
function sourceBadge(state: BlocklistState): { label: string; tone: "success" | "warning" } {
  if (state.source === "chain") return { label: "From the registry", tone: "success" };
  if (state.source === "seed") return { label: "Seed list", tone: "warning" };
  return { label: "Offline copy", tone: "warning" };
}

export function BlocklistNote({ state }: { state: BlocklistState }) {
  const badge = sourceBadge(state);
  const entries = [...state.blocked.entries()].sort((a, b) => a[0] - b[0]);

  return (
    <div
      data-testid="blocklist"
      className="border-border bg-surface-sunken flex flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Ban aria-hidden="true" className="text-danger size-4" />
        <h3 className="text-ink text-sm font-semibold">Blocked countries</h3>
        <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
      </div>

      <p className="text-muted text-sm leading-relaxed">{BLOCKLIST_INTRO}</p>

      {state.isLoading && !state.data ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map(([numeric, reason]) => {
            const country = getCountryByNumeric(numeric);
            return (
              <li key={numeric} className="text-sm">
                <span className="text-ink font-medium">
                  {country?.name ?? `Country ${numeric}`}{" "}
                  <span className="num text-muted">({numeric})</span>
                </span>
                <span className="text-muted"> — {reason}</span>
              </li>
            );
          })}
          {entries.length === 0 ? (
            <li className="text-muted text-sm">
              The registry currently blocks no country. That is what the chain reports; it is not a
              claim that none will be blocked.
            </li>
          ) : null}
        </ul>
      )}

      <p className="text-muted text-xs leading-relaxed">
        {state.source === "chain" && state.data ? (
          <>
            Read from IdentityRegistry at{" "}
            <span className="addr">{state.data.registry_address}</span> on {state.data.network}.
          </>
        ) : null}
        {state.source === "seed" && state.data ? (
          <>
            The deployed registry could not be asked
            {state.data.reason ? <> ({state.data.reason})</> : null}, so these are the codes the
            registry is deployed with. The contract still decides.
          </>
        ) : null}
        {state.source === "fallback" ? (
          <>
            The blocklist endpoint could not be reached
            {state.failure ? <> ({state.failure.message})</> : null}. This is the committed seed
            list from web/lib/countries.json, which may be out of date.
          </>
        ) : null}
      </p>

      <p className="text-muted text-xs leading-relaxed">{ON_CHAIN_IS_THE_RULE}</p>

      {state.source === "fallback" ? (
        <div>
          <Button variant="secondary" size="sm" onClick={state.refresh}>
            <RefreshCw aria-hidden="true" />
            Load the live blocklist
          </Button>
        </div>
      ) : null}
    </div>
  );
}
