/**
 * The CSV export (BUILD_PROMPT 7.2).
 *
 * What is on screen is what comes out: the page hands this module the rows the active filter is
 * showing, in the order it is showing them, and the file name records which filter that was. An
 * export that quietly contained more (or less) than the table above it would be a small lie in a
 * file somebody is about to paste into a model.
 *
 * Four decisions, all of them about not mangling a number:
 *
 *  1. **Every amount appears twice.** `tokens_delta` and `tokens_delta_wei`, `usdc_delta` and
 *     `usdc_delta_6dec`. The first is readable, the second is the exact integer the contract
 *     emitted — the one to compute with, because a spreadsheet parsing `1000.000000000000000000`
 *     into a float has already lost it (PLAN.md D22).
 *  2. **Fixed-point text is exact and ungrouped.** Every decimal the scale carries, no thousands
 *     separators and no rounding: `formatPlain` shows the whole integer, so the readable column and
 *     the integer column can never disagree.
 *  3. **Timestamps are ISO 8601 UTC**, exactly the `block_time` the API returned, plus the raw unix
 *     seconds. A block whose timestamp the indexer has not fetched leaves both cells empty rather
 *     than carrying an invented time.
 *  4. **Nothing is left for a spreadsheet to execute.** RFC 4180 quoting, and any cell that starts
 *     with a formula character is prefixed with an apostrophe. Numbers, which may legitimately lead
 *     with `-`, are left alone.
 */

import { formatPlain } from "@/lib/format";
import type { HistoryRow } from "@/components/portfolio/history";

/** The header row, in output order. Exported so a test can assert the contract, not a snapshot. */
export const CSV_COLUMNS = [
  "block_number",
  "block_time_utc",
  "block_timestamp",
  "event",
  "event_label",
  "detail",
  "tokens_delta",
  "tokens_delta_wei",
  "usdc_delta",
  "usdc_delta_6dec",
  "nav_usdc",
  "nav_usdc_6dec",
  "counterparty",
  "transaction_hash",
  "log_index",
  "contract",
  "account",
  "chain_id",
  "explorer_url",
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

export interface CsvContext {
  /** The address the rows were read for. Repeated on every row so exports can be concatenated. */
  readonly account: string;
  readonly chainId: number;
}

/** RFC 4180 record separator. Excel is the reason it is CRLF and not LF. */
const EOL = "\r\n";

const FORMULA_START = /^[=+@\t\r]/;
const NUMERIC_START = /^-?\d/;

/** One cell: quoted where it has to be, defused where a spreadsheet would otherwise evaluate it. */
export function csvCell(value: string): string {
  const defused = FORMULA_START.test(value) && !NUMERIC_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(defused) ? `"${defused.replace(/"/g, '""')}"` : defused;
}

function row(values: readonly string[]): string {
  return values.map(csvCell).join(",");
}

/** A signed decimal amount with every digit the scale carries, ungrouped. Empty when absent. */
function fixed(value: bigint | null, decimals: number): string {
  return value === null ? "" : formatPlain(value, decimals);
}

function integer(value: bigint | null): string {
  return value === null ? "" : value.toString();
}

/**
 * The rows the filter is showing, as CSV text.
 *
 * Returned without a byte-order mark: callers writing a file for Excel prepend U+FEFF at the
 * Blob, which keeps this function's output exactly the text a test can assert on.
 */
export function buildHistoryCsv(rows: readonly HistoryRow[], context: CsvContext): string {
  const lines: string[] = [row([...CSV_COLUMNS])];
  for (const entry of rows) {
    lines.push(
      row([
        String(entry.blockNumber),
        entry.isoTime ?? "",
        entry.timestamp === null ? "" : String(entry.timestamp),
        entry.name,
        entry.label,
        entry.detail,
        fixed(entry.tokensDelta18, 18),
        integer(entry.tokensDelta18),
        fixed(entry.usdcDelta6, 6),
        integer(entry.usdcDelta6),
        fixed(entry.nav6, 6),
        integer(entry.nav6),
        entry.counterparty ?? "",
        entry.transactionHash,
        String(entry.logIndex),
        entry.contract,
        context.account,
        String(context.chainId),
        entry.explorerUrl ?? "",
      ]),
    );
  }
  return `${lines.join(EOL)}${EOL}`;
}

/**
 * `hbtrs-portfolio-0x1234abcd-subscriptions-2026-09-14.csv`.
 *
 * The filter is in the name because the file contains exactly what was filtered: two exports taken
 * a minute apart under different chips must not land in a downloads folder as the same file.
 */
export function historyCsvFileName(account: string, filterId: string, isoDate: string): string {
  const short = /^0x[0-9a-fA-F]{40}$/.test(account)
    ? `${account.slice(0, 6)}${account.slice(-4)}`.toLowerCase()
    : "address";
  return `hbtrs-portfolio-${short}-${filterId}-${isoDate}.csv`;
}

/**
 * Hand the file to the browser.
 *
 * An object URL and a synthetic click: no server round trip, so the export works against whatever
 * is already loaded and cannot disagree with it. The URL is revoked immediately after — it is a
 * handle on a blob the download has already taken a reference to.
 */
export function downloadCsv(fileName: string, csv: string): void {
  // A byte-order mark so Excel reads it as UTF-8: the em dashes and the accented names in the
  // detail column are otherwise mojibake on a Windows default.
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
