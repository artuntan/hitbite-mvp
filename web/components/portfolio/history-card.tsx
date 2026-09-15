"use client";

/**
 * Transaction history, its filters, and the CSV export.
 *
 * The rows come from `/api/events?account=…`, which matches the address in **any** decoded argument
 * — both legs of a `Transfer`, the holder of a `Subscribed`, the claimant of a `CouponClaimed` — so
 * this is the whole of the wallet's story with the two contracts, not only the transactions it sent.
 *
 * Three things this card is careful about:
 *
 *  - **The filter and the export cannot disagree.** The button exports the filtered rows, all of
 *    them, and says so next to itself; "show more" only changes how many are painted.
 *  - **Amounts are signed from the holder's point of view** and formatted from the integer the
 *    contract emitted. The CSV carries both, so a spreadsheet has something exact to compute with.
 *  - **Coverage is shown, not implied.** The endpoint reports what it managed to read; if a block
 *    range is missing or a timestamp was never fetched, it is stated here rather than left to look
 *    like an address with a short history.
 */

import * as React from "react";
import { Download, Inbox } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingSkeleton } from "@/components/states/loading-skeleton";
import { buildHistoryCsv, downloadCsv, historyCsvFileName } from "@/components/portfolio/csv";
import {
  HISTORY_FILTERS,
  countByFilter,
  filterById,
  filterRows,
  formatTokenDelta,
  formatUsdcDelta,
  type HistoryFilterId,
} from "@/components/portfolio/history";
import type { AccountHistory } from "@/components/portfolio/use-account-history";
import { TOKEN } from "@/lib/copy";
import { formatIsoDate, formatTxHash } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Rows painted before "show more" is needed. A first screen, not a limit on what is held. */
const PAGE_SIZE = 25;

export interface HistoryCardProps {
  history: AccountHistory;
  /** The address the rows were read for. */
  account: string;
  chainId: number;
}

export function HistoryCard({ history, account, chainId }: HistoryCardProps) {
  const [filter, setFilter] = React.useState<HistoryFilterId>("all");
  const [visible, setVisible] = React.useState(PAGE_SIZE);

  // A new address, or a new filter, starts at the first screen again.
  React.useEffect(() => setVisible(PAGE_SIZE), [filter, account]);

  const counts = React.useMemo(() => countByFilter(history.rows), [history.rows]);
  const filtered = React.useMemo(() => filterRows(history.rows, filter), [history.rows, filter]);
  const shown = filtered.slice(0, visible);

  const onExport = React.useCallback(() => {
    const csv = buildHistoryCsv(filtered, { account, chainId });
    downloadCsv(historyCsvFileName(account, filter, formatIsoDate(new Date())), csv);
  }, [filtered, account, chainId, filter]);

  return (
    <Card data-testid="history-card">
      <CardHeader>
        <CardTitle as="h2">Transaction history</CardTitle>
        <CardDescription>
          Every indexed event naming this address, newest first, decoded from the logs of the token
          and the identity registry. A subscription appears twice — once as{" "}
          <span className="num">Subscribed</span> and once as the ERC-20{" "}
          <span className="num">Transfer</span> that minted the tokens — because both are what the
          chain recorded.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {history.phase === "loading" ? (
          <LoadingSkeleton variant="table" rows={5} label="Loading this address's events" />
        ) : history.phase === "unavailable" ? (
          <Alert tone="warning" data-testid="history-unavailable">
            <AlertTitle>No event index on this chain</AlertTitle>
            <AlertDescription>
              <p>{history.message}</p>
              <p className="mt-2">
                This is not the same as an address with no history: nothing could be read, so
                nothing can be said about it. The cost basis above is left blank for the same
                reason.
              </p>
            </AlertDescription>
          </Alert>
        ) : history.phase === "error" ? (
          <ErrorState
            title="The events could not be loaded"
            description={
              <>
                <p>{history.message}</p>
                {history.hint ? <p className="mt-1">{history.hint}</p> : null}
              </>
            }
            onRetry={history.reload}
          />
        ) : history.rows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No events for this address"
            description={
              <p data-testid="history-empty">
                The index covers every block from the deploy block to the chain head and found
                nothing naming this address — no subscription, no transfer, no claim, no registry
                entry. Subscribing or being verified will put the first row here.
              </p>
            }
          />
        ) : (
          <>
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label="Filter events"
            >
              {HISTORY_FILTERS.filter(
                // A chip with nothing behind it is noise — except the active one, which has to stay
                // reachable even if a reload empties it.
                (option) => option.id === "all" || option.id === filter || counts[option.id] > 0,
              ).map((option) => {
                const active = option.id === filter;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={active}
                    data-testid={`history-filter-${option.id}`}
                    onClick={() => setFilter(option.id)}
                    className={cn(
                      "focus-visible:outline-ring rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      "focus-visible:outline-2 focus-visible:outline-offset-2",
                      active
                        ? "border-accent bg-accent text-accent-on"
                        : "border-border bg-surface text-muted hover:bg-surface-sunken",
                    )}
                  >
                    {option.label}
                    <span className="num ml-1.5">{counts[option.id]}</span>
                  </button>
                );
              })}
            </div>

            <Table aria-label="Transaction history">
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead numeric>{TOKEN.symbol}</TableHead>
                  <TableHead numeric>USDC</TableHead>
                  <TableHead>Transaction</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((row) => (
                  <TableRow key={row.key} data-testid="history-row">
                    <TableCell className="whitespace-nowrap">
                      {row.isoTime === null ? (
                        <span className="text-muted">{row.displayTime}</span>
                      ) : (
                        <time dateTime={row.isoTime}>{row.displayTime}</time>
                      )}
                      <span className="text-muted num block text-xs">block {row.blockNumber}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-ink font-medium">{row.label}</span>
                      <span className="text-muted block text-xs">{row.detail}</span>
                    </TableCell>
                    <TableCell numeric>
                      {row.tokensDelta18 === null ? "—" : formatTokenDelta(row.tokensDelta18)}
                    </TableCell>
                    <TableCell numeric>
                      {row.usdcDelta6 === null ? "—" : formatUsdcDelta(row.usdcDelta6)}
                    </TableCell>
                    <TableCell>
                      {row.explorerUrl === null ? (
                        <span className="addr text-muted text-xs">
                          {formatTxHash(row.transactionHash)}
                        </span>
                      ) : (
                        <a
                          href={row.explorerUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="addr text-accent-ink text-xs underline underline-offset-4 hover:no-underline"
                        >
                          {formatTxHash(row.transactionHash)}
                          <span className="sr-only"> (opens the block explorer in a new tab)</span>
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted text-sm" data-testid="history-count">
                Showing {shown.length} of {filtered.length} {filterById(filter).describes}.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {shown.length < filtered.length ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="history-show-more"
                    onClick={() => setVisible((value) => value + PAGE_SIZE)}
                  >
                    Show {Math.min(PAGE_SIZE, filtered.length - shown.length)} more
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="history-export"
                  disabled={filtered.length === 0}
                  onClick={onExport}
                >
                  <Download aria-hidden="true" />
                  Export {filtered.length} row{filtered.length === 1 ? "" : "s"} (CSV)
                </Button>
              </div>
            </div>

            <p className="text-muted text-xs" data-testid="history-export-note">
              The export contains exactly what this filter selects — {filterById(filter).describes},
              all {filtered.length} of them, not only the {shown.length} painted above. Every amount
              appears twice: formatted, and as the exact integer the contract emitted, so a
              spreadsheet has something to compute with that a float cannot spoil.
            </p>
          </>
        )}

        {history.phase === "ready" ? <CoverageNote history={history} /> : null}
      </CardContent>
    </Card>
  );
}

/** What the index actually managed to read. Stated, so a gap never reads as an empty history. */
function CoverageNote({ history }: { history: AccountHistory }) {
  const coverage = history.coverage;
  if (coverage === null) return null;

  const notes: string[] = [];
  if (history.truncated) {
    notes.push(
      `This address has more events than one load reads. The rows above stop at the page cap, so every figure derived from them — the cost basis included — is a floor rather than a total.`,
    );
  }
  if (!coverage.complete) {
    notes.push(
      `The index could not cover every block from ${coverage.from_block} to ${coverage.head_block}: ${coverage.gaps.length} range${coverage.gaps.length === 1 ? "" : "s"} could not be read. Events inside them are missing from this table.`,
    );
  }
  if (coverage.blocks_without_timestamp > 0) {
    notes.push(
      `${coverage.blocks_without_timestamp} block${coverage.blocks_without_timestamp === 1 ? "" : "s"} in the index have no timestamp yet, so rows from them show a block number and no time.`,
    );
  }
  if (coverage.stale) {
    notes.push(
      `This is a cached index that could not be rebuilt${coverage.stale_reason ? `: ${coverage.stale_reason}` : "."} It is ${coverage.cache_age_seconds} seconds old.`,
    );
  }

  return (
    <details className="text-muted text-xs" data-testid="history-coverage">
      <summary className="cursor-pointer underline underline-offset-4">
        What this index covers
        {notes.length > 0 ? ` (${notes.length} caveat${notes.length === 1 ? "" : "s"})` : ""}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <p>
          Blocks <span className="num">{coverage.from_block}</span> to{" "}
          <span className="num">{coverage.to_block}</span> of a chain at{" "}
          <span className="num">{coverage.head_block}</span>, built at {coverage.indexed_at} and{" "}
          {coverage.cache_age_seconds} seconds old. {history.matched} event
          {history.matched === 1 ? "" : "s"} matched this address.
        </p>
        {notes.map((note) => (
          <p key={note} className="text-warning">
            {note}
          </p>
        ))}
        {history.limitations.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5">
            {history.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
