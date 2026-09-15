"use client";

/**
 * One address's event history, loaded once and held for the page.
 *
 * The cost basis, the filter chips, the table and the CSV are all views of the same array. That is
 * deliberate: a fold over a partial history is a wrong number rather than an approximate one, and an
 * export that re-queried would be able to disagree with the table above it. So the whole history is
 * fetched once, and everything else is a pure function of it.
 *
 * A load is cancelled when the address changes or the component unmounts; an aborted fetch leaves
 * the state untouched rather than writing a failure nobody asked about.
 */

import * as React from "react";

import { fetchAccountHistory, type HistoryLoad } from "@/components/portfolio/events-api";
import { toHistoryRows, type HistoryRow } from "@/components/portfolio/history";
import type { ChainEvent, IndexCoverage } from "@/lib/schemas";

export type HistoryPhase = "idle" | "loading" | "ready" | "unavailable" | "error";

export interface AccountHistory {
  readonly phase: HistoryPhase;
  /** Newest first, ready for the table. */
  readonly rows: readonly HistoryRow[];
  /** Oldest first, as fetched — the order the cost-basis fold reads in. */
  readonly events: readonly ChainEvent[];
  readonly coverage: IndexCoverage | null;
  /** The endpoint's own limitations, verbatim. */
  readonly limitations: readonly string[];
  /** The page cap stopped the read before the history ended. */
  readonly truncated: boolean;
  /** How many events matched this address server-side. */
  readonly matched: number;
  /** The reason there is no history: the index is unavailable, or the request failed. */
  readonly message: string | null;
  readonly hint: string | null;
  /** True when every event this address has is in `events`. */
  readonly complete: boolean;
  readonly reload: () => void;
}

const EMPTY: Omit<AccountHistory, "reload"> = {
  phase: "idle",
  rows: [],
  events: [],
  coverage: null,
  limitations: [],
  truncated: false,
  matched: 0,
  message: null,
  hint: null,
  complete: false,
};

export function useAccountHistory(account: string | null): AccountHistory {
  const [load, setLoad] = React.useState<HistoryLoad | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    if (account === null) {
      setLoad(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let live = true;
    setLoading(true);
    setLoad(null);

    fetchAccountHistory(account, controller.signal)
      .then((result) => {
        if (!live) return;
        setLoad(result);
        setLoading(false);
      })
      .catch(() => {
        // The only rejection `fetchAccountHistory` produces is an abort, which is this effect
        // being cleaned up. Everything else comes back as a `status: "error"` value.
      });

    return () => {
      live = false;
      controller.abort();
    };
  }, [account, nonce]);

  const reload = React.useCallback(() => setNonce((value) => value + 1), []);

  const rows = React.useMemo(
    () => (load?.status === "ok" && account !== null ? toHistoryRows(load.events, account) : []),
    [load, account],
  );

  if (account === null) return { ...EMPTY, reload };
  if (loading || load === null) return { ...EMPTY, phase: "loading", reload };

  if (load.status === "unavailable") {
    return {
      ...EMPTY,
      phase: "unavailable",
      limitations: load.limitations,
      message: load.reason,
      reload,
    };
  }
  if (load.status === "error") {
    return { ...EMPTY, phase: "error", message: load.message, hint: load.hint, reload };
  }

  return {
    phase: "ready",
    rows,
    events: load.events,
    coverage: load.coverage,
    limitations: load.limitations,
    truncated: load.truncated,
    matched: load.matched,
    message: null,
    hint: null,
    // Complete when nothing was cut short at either end: the indexer covered the whole range, and
    // the page cap did not bite.
    complete: !load.truncated && load.coverage.complete,
    reload,
  };
}
