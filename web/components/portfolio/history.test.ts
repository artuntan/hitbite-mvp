/**
 * The history view model turns a decoded log into a row a person reads and a row a spreadsheet
 * computes with. The tests below pin the two things that would be invisible if they went wrong:
 *
 *  - **the sign convention** — positive when value arrives at the address being viewed, negative
 *    when it leaves — because a column of deltas that mixes the two sums to nonsense; and
 *  - **the double leg of a subscription** — `Subscribed` *and* the ERC-20 `Transfer` that minted
 *    the tokens are both listed, because both are what the chain recorded, and the transfer says
 *    which it is so nobody reads one acquisition as two.
 *
 * Every fixture is parsed with `chainEventSchema` first, so a fixture that has drifted from what
 * `/api/events` actually serves fails here rather than propping up a passing test.
 */

import { describe, expect, it } from "vitest";

import { chainEventSchema } from "@/lib/schemas";

import {
  HOLDER,
  OTHER,
  ZERO,
  couponClaimed,
  holderHistory,
  identityRemoved,
  subscribed,
  transfer,
} from "./fixtures";
import {
  countByFilter,
  filterById,
  filterRows,
  formatTokenDelta,
  formatUsdcDelta,
  toHistoryRow,
  toHistoryRows,
} from "./history";

const NAV = 1_250_000n;

describe("the fixtures", () => {
  it("are real ChainEvents", () => {
    for (const event of holderHistory()) {
      expect(() => chainEventSchema.parse(event)).not.toThrow();
    }
  });
});

describe("toHistoryRow", () => {
  it("reads a subscription as USDC out and tokens in", () => {
    const row = toHistoryRow(
      subscribed(HOLDER, 500_000_000n, 400_000_000_000_000_000_000n, NAV, { block: 20 }),
      HOLDER,
    );
    expect(row.label).toBe("Subscribed");
    expect(row.usdcDelta6).toBe(-500_000_000n);
    expect(row.tokensDelta18).toBe(400_000_000_000_000_000_000n);
    expect(row.nav6).toBe(NAV);
    expect(row.group).toBe("subscriptions");
    expect(row.detail).toContain("1.250000");
  });

  it("reads a redemption as tokens out and USDC in", () => {
    const row = toHistoryRows(holderHistory(), HOLDER).find((entry) => entry.name === "Redeemed");
    expect(row?.tokensDelta18).toBe(-300_000_000_000_000_000_000n);
    expect(row?.usdcDelta6).toBe(375_000_000n);
  });

  it("names the mint leg of a subscription as what it is", () => {
    const row = toHistoryRow(transfer(ZERO, HOLDER, 5n, { block: 3 }), HOLDER);
    expect(row.label).toBe("Minted in");
    expect(row.detail).toContain("transfer leg");
    expect(row.tokensDelta18).toBe(5n);
    // The zero address is a sentinel, never a counterparty.
    expect(row.counterparty).toBeNull();
  });

  it("names the burn leg of a redemption as what it is", () => {
    const row = toHistoryRow(transfer(HOLDER, ZERO, 5n, { block: 3 }), HOLDER);
    expect(row.label).toBe("Burned out");
    expect(row.tokensDelta18).toBe(-5n);
  });

  it("signs an ordinary transfer from the viewed address's point of view", () => {
    const sent = transfer(HOLDER, OTHER, 7n, { block: 3 });
    expect(toHistoryRow(sent, HOLDER).tokensDelta18).toBe(-7n);
    expect(toHistoryRow(sent, HOLDER).counterparty).toBe(OTHER);
    // The same log, viewed from the other side, is the same movement with the other sign.
    expect(toHistoryRow(sent, OTHER).tokensDelta18).toBe(7n);
    expect(toHistoryRow(sent, OTHER).counterparty).toBe(HOLDER);
  });

  it("nets a self-transfer to zero rather than counting it twice", () => {
    const row = toHistoryRow(transfer(HOLDER, HOLDER, 7n, { block: 3 }), HOLDER);
    expect(row.label).toBe("Self-transfer");
    expect(row.tokensDelta18).toBe(0n);
  });

  it("carries a claim as USDC in and no token movement", () => {
    const row = toHistoryRow(couponClaimed(HOLDER, 12_500_000n, { block: 9 }), HOLDER);
    expect(row.usdcDelta6).toBe(12_500_000n);
    expect(row.tokensDelta18).toBeNull();
    expect(row.group).toBe("coupons");
  });

  it("says a de-verified holder can still get out", () => {
    const row = toHistoryRow(identityRemoved(HOLDER, { block: 40 }), HOLDER);
    expect(row.detail).toContain("can still redeem and claim");
  });

  it("leaves an un-timestamped block without an invented time", () => {
    const row = toHistoryRow(transfer(ZERO, HOLDER, 1n, { block: 3, timestamp: null }), HOLDER);
    expect(row.isoTime).toBeNull();
    expect(row.timestamp).toBeNull();
    expect(row.displayTime).toBe("Timestamp not indexed");
  });

  it("keys a row by the identity of a log", () => {
    const row = toHistoryRow(transfer(ZERO, HOLDER, 1n, { block: 3, logIndex: 2 }), HOLDER);
    expect(row.key).toBe(`3:2:${row.transactionHash}`);
  });
});

describe("toHistoryRows", () => {
  const rows = toHistoryRows(holderHistory(), HOLDER);

  it("returns every event, newest first", () => {
    expect(rows).toHaveLength(10);
    const blocks = rows.map((row) => row.blockNumber);
    expect(blocks).toEqual([...blocks].sort((a, b) => b - a));
    // Within a block, the later log index comes first.
    expect(rows[0]?.logIndex).toBe(1);
  });

  it("lists both legs of a subscription", () => {
    const atBlock12 = rows.filter((row) => row.blockNumber === 12);
    expect(atBlock12.map((row) => row.name).sort()).toEqual(["Subscribed", "Transfer"]);
  });
});

describe("the filters", () => {
  const rows = toHistoryRows(holderHistory(), HOLDER);

  it("counts each group", () => {
    const counts = countByFilter(rows);
    expect(counts.all).toBe(10);
    expect(counts.subscriptions).toBe(2);
    expect(counts.redemptions).toBe(1);
    expect(counts.coupons).toBe(1);
    expect(counts.transfers).toBe(5);
    expect(counts.verification).toBe(1);
    expect(counts.issuer).toBe(0);
  });

  it("selects exactly the rows of one group, and everything under `all`", () => {
    expect(filterRows(rows, "all")).toHaveLength(10);
    expect(filterRows(rows, "subscriptions").every((row) => row.name === "Subscribed")).toBe(true);
    expect(filterRows(rows, "subscriptions")).toHaveLength(2);
  });

  it("describes what an export under each chip would contain", () => {
    expect(filterById("all").describes).toContain("every indexed event");
    expect(filterById("redemptions").describes).toContain("redemptions");
  });
});

describe("the signed column formats", () => {
  it("marks a positive amount and never rounds a balance up", () => {
    expect(formatTokenDelta(1_000_000_000_000_000_000n)).toBe("+1.000000");
    expect(formatTokenDelta(-1_999_999_999_999_999_999n)).toBe("-1.999999");
    expect(formatTokenDelta(0n)).toBe("0.000000");
  });

  it("shows every decimal a USDC amount carries", () => {
    expect(formatUsdcDelta(12_500_000n)).toBe("+12.500000");
    expect(formatUsdcDelta(-375_000_000n)).toBe("-375.000000");
  });
});
