/**
 * The export is the one artefact from this page that leaves the browser, so what it must not do is
 * lose a number. Every amount is written twice — formatted and as the exact integer the contract
 * emitted — and these tests check the integer column against the same bigint the row carries, not
 * against a re-parse of the formatted one.
 *
 * The quoting rules are tested too: a detail sentence contains commas, an address is text a
 * spreadsheet must not evaluate, and Excel wants CRLF.
 */

import { describe, expect, it } from "vitest";

import { formatPlain } from "@/lib/format";

import { CSV_COLUMNS, buildHistoryCsv, csvCell, historyCsvFileName } from "./csv";
import { HOLDER, OTHER, ZERO, holderHistory, transfer } from "./fixtures";
import { filterRows, toHistoryRows } from "./history";

const CONTEXT = { account: HOLDER, chainId: 84532 } as const;

function parseLines(csv: string): string[] {
  expect(csv.endsWith("\r\n")).toBe(true);
  return csv.trimEnd().split("\r\n");
}

/** Split one CSV record, honouring quotes. Deliberately not the module's own code. */
function splitRecord(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

describe("buildHistoryCsv", () => {
  const rows = toHistoryRows(holderHistory(), HOLDER);
  const csv = buildHistoryCsv(rows, CONTEXT);
  const lines = parseLines(csv);

  it("starts with the header row", () => {
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
  });

  it("writes one record per row, and nothing else", () => {
    expect(lines).toHaveLength(rows.length + 1);
    for (const line of lines) {
      expect(splitRecord(line)).toHaveLength(CSV_COLUMNS.length);
    }
  });

  it("carries every amount twice: readable, and as the exact integer", () => {
    const header = splitRecord(lines[0] as string);
    const index = (column: string) => header.indexOf(column);

    rows.forEach((row, position) => {
      const cells = splitRecord(lines[position + 1] as string);
      if (row.tokensDelta18 !== null) {
        expect(cells[index("tokens_delta_wei")]).toBe(row.tokensDelta18.toString());
        expect(cells[index("tokens_delta")]).toBe(formatPlain(row.tokensDelta18, 18));
      } else {
        expect(cells[index("tokens_delta_wei")]).toBe("");
      }
      if (row.usdcDelta6 !== null) {
        expect(cells[index("usdc_delta_6dec")]).toBe(row.usdcDelta6.toString());
        expect(cells[index("usdc_delta")]).toBe(formatPlain(row.usdcDelta6, 6));
      }
    });
  });

  it("writes ISO 8601 UTC timestamps, and leaves an unindexed one empty", () => {
    const header = splitRecord(lines[0] as string);
    const timeColumn = header.indexOf("block_time_utc");
    const stampColumn = header.indexOf("block_timestamp");

    const dated = splitRecord(lines[1] as string);
    expect(dated[timeColumn]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(dated[stampColumn]).toMatch(/^\d+$/);

    const undated = buildHistoryCsv(
      toHistoryRows([transfer(ZERO, HOLDER, 1n, { block: 3, timestamp: null })], HOLDER),
      CONTEXT,
    );
    const cells = splitRecord(parseLines(undated)[1] as string);
    expect(cells[timeColumn]).toBe("");
    expect(cells[stampColumn]).toBe("");
  });

  it("repeats the account and the chain on every row so exports can be concatenated", () => {
    const header = splitRecord(lines[0] as string);
    for (const line of lines.slice(1)) {
      const cells = splitRecord(line);
      expect(cells[header.indexOf("account")]).toBe(HOLDER);
      expect(cells[header.indexOf("chain_id")]).toBe("84532");
    }
  });

  it("exports exactly what a filter selects", () => {
    const filtered = filterRows(rows, "subscriptions");
    const lines = parseLines(buildHistoryCsv(filtered, CONTEXT));
    expect(lines).toHaveLength(filtered.length + 1);
    for (const line of lines.slice(1)) {
      expect(splitRecord(line)[3]).toBe("Subscribed");
    }
  });

  it("names the counterparty of an ordinary transfer and nobody for a mint", () => {
    const header = splitRecord(lines[0] as string);
    const column = header.indexOf("counterparty");
    const sent = buildHistoryCsv(
      toHistoryRows([transfer(HOLDER, OTHER, 1n, { block: 3 })], HOLDER),
      CONTEXT,
    );
    expect(splitRecord(parseLines(sent)[1] as string)[column]).toBe(OTHER);

    const minted = buildHistoryCsv(
      toHistoryRows([transfer(ZERO, HOLDER, 1n, { block: 3 })], HOLDER),
      CONTEXT,
    );
    expect(splitRecord(parseLines(minted)[1] as string)[column]).toBe("");
  });

  it("survives a round trip through a parser: the detail sentences contain commas", () => {
    const header = splitRecord(lines[0] as string);
    const detailColumn = header.indexOf("detail");
    const withComma = rows.find((row) => row.detail.includes(","));
    expect(withComma, "a fixture detail should contain a comma").toBeDefined();
    const line = lines[rows.indexOf(withComma!) + 1] as string;
    expect(splitRecord(line)[detailColumn]).toBe(withComma!.detail);
  });

  it("is just a header when there is nothing to export", () => {
    expect(buildHistoryCsv([], CONTEXT)).toBe(`${CSV_COLUMNS.join(",")}\r\n`);
  });
});

describe("csvCell", () => {
  it("quotes only what has to be quoted", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\r\nbreak")).toBe('"line\r\nbreak"');
  });

  it("leaves a negative number alone and defuses a formula", () => {
    expect(csvCell("-375.000000")).toBe("-375.000000");
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });
});

describe("historyCsvFileName", () => {
  it("names the address and the filter, so two exports never collide", () => {
    const name = historyCsvFileName(HOLDER, "subscriptions", "2026-09-14");
    expect(name).toMatch(/^hbtrs-portfolio-0x[0-9a-f]{8}-subscriptions-2026-09-14\.csv$/);
    expect(historyCsvFileName(HOLDER, "all", "2026-09-14")).not.toBe(name);
  });

  it("does not pretend something that is not an address is one", () => {
    expect(historyCsvFileName("nonsense", "all", "2026-09-14")).toContain("-address-");
  });
});
