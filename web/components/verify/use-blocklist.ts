"use client";

/**
 * The live country blocklist, with a floor under it.
 *
 * `GET /api/verify` folds the registry's `CountryBlockStatusChanged` log into the current list, and
 * that answer outranks the committed one: an admin can block or unblock any code at any time with
 * `setCountryBlocked`, so `countries.json` is a seed, not the law (see the header of
 * `lib/countries.ts`).
 *
 * When the endpoint cannot be reached at all, the seed list is used and the UI says so. That is the
 * safe direction to fail in: refusing a country the contract might have allowed costs somebody a
 * confusing minute, while allowing one the contract blocks would mean a submitted request that the
 * chain refuses. It cannot go wrong the other way round either — `addVerified` reverts
 * `CountryBlocked` regardless of what this list says.
 */

import * as React from "react";

import { fetchBlocklist, type ApiFailure, type BlocklistData } from "@/components/verify/api";
import { SEED_BLOCKED_COUNTRIES } from "@/lib/countries";

export interface BlocklistState {
  /** The endpoint's answer, when there is one. */
  data: BlocklistData | null;
  failure: ApiFailure | null;
  isLoading: boolean;
  /** Numeric code to the reason it is refused. What the select disables and explains. */
  blocked: ReadonlyMap<number, string>;
  /** `chain` and `seed` come from the server; `fallback` means the request itself failed. */
  source: "chain" | "seed" | "fallback";
  refresh: () => void;
}

const SEED_FALLBACK: ReadonlyMap<number, string> = new Map(
  SEED_BLOCKED_COUNTRIES.map((country) => [
    country.numeric,
    country.reason ?? "This country is on the blocklist the registry is deployed with.",
  ]),
);

export function useBlocklist(): BlocklistState {
  const [data, setData] = React.useState<BlocklistData | null>(null);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    void fetchBlocklist(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setIsLoading(false);
      if (result.ok) {
        setData(result.data);
        setFailure(null);
      } else {
        setFailure(result.failure);
      }
    });
    return () => controller.abort();
  }, [attempt]);

  const blocked = React.useMemo<ReadonlyMap<number, string>>(() => {
    if (!data) return SEED_FALLBACK;
    return new Map(
      data.blocked.map((country) => [
        country.numeric,
        country.reason ??
          "The registry admin has blocked this country, so no address registered to it can be verified.",
      ]),
    );
  }, [data]);

  return {
    data,
    failure,
    isLoading,
    blocked,
    source: data ? data.source : "fallback",
    refresh: React.useCallback(() => setAttempt((count) => count + 1), []),
  };
}
