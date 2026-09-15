import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { CSV_COLUMNS, buildHistoryCsv, historyCsvFileName } from "../components/portfolio/csv";
import {
  HOLDER,
  REGISTRY_ADDRESS,
  TOKEN_ADDRESS,
  holderHistory,
} from "../components/portfolio/fixtures";
import { filterRows, toHistoryRows } from "../components/portfolio/history";
import { ACTIVE_CHAIN, ACTIVE_CHAIN_ID, hasDeployment } from "../lib/chains";
import { formatPlain } from "../lib/format";
import { FOOTER_DISCLAIMER, TESTNET_BANNER, TOKEN } from "../lib/copy";
import { eventsResponseSchema, type ChainEvent } from "../lib/schemas";

/**
 * `/portfolio` (BUILD_PROMPT 7.2), without a wallet.
 *
 * No wallet is faked. Injecting an EIP-1193 stub would test the stub, not the page, and every
 * signature path already has unit coverage in `lib/tx.test.ts` and `components/portfolio/*.test.ts`.
 * What is worth asserting from a browser is everything a person sees *before* they connect one:
 *
 *  - the page renders with the mandatory testnet chrome and the no-wallet state has a way forward;
 *  - any address can be looked up read-only, and the two writes are refused with a reason rather
 *    than silently absent;
 *  - an address with no history gets an empty state that says it is empty — or, where there is no
 *    index at all, says *that* instead, because the two are not the same fact;
 *  - the page states the rule that matters most on this screen: a de-verified holder can still get
 *    out (PLAN.md D4), and coupon money is never used to pay a redemption (D6).
 *
 * The CSV is asserted against the module that generates it, over the same fixtures the unit tests
 * use. There is no CSV endpoint to hit: the export is built in the browser from what is already on
 * screen, which is what makes it impossible for it to disagree with the table.
 *
 * Runs against a production build: `playwright.config.ts` starts `pnpm start`, so `pnpm build` must
 * come first.
 */

/** Whether the chain this build points at has a recorded deployment. */
const DEPLOYED = hasDeployment();

/** An address with nothing behind it. Deterministic, and no 64-hex literal in this file. */
const EMPTY_ADDRESS = `0x${"e".repeat(40)}`;

function collectPageProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

test.describe("/portfolio without a wallet", () => {
  test("renders the page, the testnet chrome and the no-wallet state", async ({ page }) => {
    const problems = collectPageProblems(page);

    const response = await page.goto("/portfolio");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Portfolio/);

    // Mandatory on every page (BUILD_PROMPT section 15).
    await expect(page.getByText(TESTNET_BANNER).first()).toBeVisible();
    await expect(page.getByText(FOOTER_DISCLAIMER)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Portfolio", level: 1 })).toHaveCount(1);

    // The no-wallet state: a prompt with a way forward, and a statement of what the page will show
    // rather than a grid of dashes that could be mistaken for a position worth nothing.
    await expect(page.getByText("Connect a wallet", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /connect wallet/i }).first()).toBeVisible();
    await expect(page.getByTestId("no-wallet-explainer")).toBeVisible();
    await expect(page.getByTestId("position-card")).toHaveCount(0);

    expect(problems, `console output on /portfolio:\n${problems.join("\n")}`).toEqual([]);
  });

  test("an address can be looked up, and a bad one is refused in words", async ({ page }) => {
    await page.goto("/portfolio");

    const field = page.getByLabel("Look up an address");
    await field.fill("not-an-address");
    await page.getByTestId("address-view").click();
    await expect(page.getByText(/not a 20-byte address/i)).toBeVisible();
    await expect(page.getByTestId("position-card")).toHaveCount(0);

    await field.fill(EMPTY_ADDRESS);
    await page.getByTestId("address-view").click();

    await expect(page.getByTestId("viewed-address")).toHaveText(EMPTY_ADDRESS);
    // The view is shareable: the address it is showing is in the URL.
    expect(page.url()).toContain(`address=${EMPTY_ADDRESS}`);
    await expect(page.getByTestId("position-card")).toBeVisible();
  });

  test("a looked-up address is read-only, and says why rather than hiding the controls", async ({
    page,
  }) => {
    await page.goto(`/portfolio?address=${EMPTY_ADDRESS}`);

    await expect(page.getByTestId("read-only-banner")).toBeVisible();
    await expect(page.getByTestId("read-only-banner")).toContainText(/burns from the signer/i);

    // Both writes are present and refused, with the contract's reason attached.
    await expect(page.getByTestId("claim-action")).toBeDisabled();
    await expect(page.getByTestId("claim-blocked-reason")).toContainText(
      /wallet that holds this position/i,
    );
    await expect(page.getByTestId("redeem-action")).toBeDisabled();
    await expect(page.getByTestId("redeem-blocker-summary")).toContainText(/waiting on/i);
  });

  test("states the two rules that matter on this screen: D4 and the coupon ring-fence", async ({
    page,
  }) => {
    await page.goto(`/portfolio?address=${EMPTY_ADDRESS}`);

    // D4 / COMPLIANCE_RULES 4: an address that lost its verification can still redeem and claim.
    await expect(page.getByText(/Verification is\s+not\s+checked/).first()).toBeVisible();
    await expect(
      page.getByText(/skips the eligibility (test|check) on a burn/i).first(),
    ).toBeVisible();

    // D6: coupon money is ring-fenced out of redemption liquidity, and all three figures are named.
    await expect(page.getByTestId("redeem-vault")).toBeVisible();
    await expect(page.getByTestId("redeem-reserve")).toBeVisible();
    await expect(page.getByTestId("redeem-available")).toBeVisible();
    await expect(page.getByText(/never draws on it/i)).toBeVisible();
  });

  test("an address with no history gets an empty state, not a blank table", async ({
    page,
    request,
  }) => {
    // What the page will be working from, parsed with the real schema so this test knows which of
    // the two honest outcomes to expect: an index that is empty for this address, or no index.
    const response = await request.get(`/api/events?account=${EMPTY_ADDRESS}&limit=1`);
    expect(response.status()).toBe(200);
    const parsed = eventsResponseSchema.parse(await response.json());

    await page.goto(`/portfolio?address=${EMPTY_ADDRESS}`);
    const card = page.getByTestId("history-card");
    await expect(card).toBeVisible();

    if (parsed.data.status === "ok") {
      expect(parsed.data.page.matched, "the fixture address should have no events").toBe(0);
      await expect(page.getByTestId("history-empty")).toBeVisible();
      await expect(page.getByTestId("history-empty")).toContainText(/no subscription/i);
      // Nothing to filter and nothing to export, so neither control is offered.
      await expect(page.getByTestId("history-export")).toHaveCount(0);
    } else {
      // No deployment, or an RPC that would not answer. That is a different fact from "no events",
      // and the page has to say which one it is.
      await expect(page.getByTestId("history-unavailable")).toBeVisible();
      await expect(page.getByTestId("history-unavailable")).toContainText(
        /not the same as an address with no history/i,
      );
      expect(parsed.data.reason.length).toBeGreaterThan(0);
    }
  });
});

test.describe("/portfolio with no deployment on the active chain", () => {
  test.skip(DEPLOYED, "a deployment is recorded for this chain, so the page reads it");

  test("says so, and quotes no figure it cannot read", async ({ page }) => {
    await page.goto(`/portfolio?address=${EMPTY_ADDRESS}`);

    const alert = page.getByTestId("chain-unavailable");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(ACTIVE_CHAIN.label);
    await expect(alert).toContainText(/no published document/i);

    // Every figure is "Not readable" rather than a zero that would read as a real balance.
    await expect(page.getByTestId("position-balance")).toHaveText("Not readable");
    await expect(page.getByTestId("position-value")).toHaveText("Not readable");
    await expect(page.getByTestId("position-pending-coupon")).toHaveText("Not readable");
    await expect(page.getByTestId("redeem-available")).toHaveText("Not readable");
  });
});

test.describe("the CSV export", () => {
  const rows = toHistoryRows(holderHistory(), HOLDER);
  const context = { account: HOLDER, chainId: 84532 } as const;

  test("produces a header row and one record per row of fixture data", () => {
    const csv = buildHistoryCsv(rows, context);
    const lines = csv.trimEnd().split("\r\n");

    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(rows.length + 1);
    expect(rows.length).toBeGreaterThan(0);

    // Every amount twice: readable, and the exact integer the contract emitted (PLAN.md D22).
    for (const column of [
      "tokens_delta",
      "tokens_delta_wei",
      "usdc_delta",
      "usdc_delta_6dec",
      "block_time_utc",
    ]) {
      expect(CSV_COLUMNS).toContain(column);
    }

    // A subscription record carries the USDC it cost twice: as the exact integer the contract
    // emitted, and as fixed-point text that says the same thing.
    const row = rows.find((entry) => entry.name === "Subscribed");
    expect(row, "the fixture history contains a subscription").toBeDefined();
    const usdcDelta6 = row?.usdcDelta6 as bigint;
    const record = lines.find(
      (line) => line.startsWith(`${row?.blockNumber},`) && line.includes(",Subscribed,"),
    );
    expect(record).toContain(usdcDelta6.toString());
    expect(record).toContain(formatPlain(usdcDelta6, 6));
    // ISO 8601 UTC, ending in Z.
    expect(record).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
  });

  test("exports what is filtered, and names the filter in the file", () => {
    const filtered = filterRows(rows, "subscriptions");
    const csv = buildHistoryCsv(filtered, context);
    const lines = csv.trimEnd().split("\r\n");

    expect(filtered.length).toBeLessThan(rows.length);
    expect(lines).toHaveLength(filtered.length + 1);
    for (const line of lines.slice(1)) expect(line).toContain("Subscribed");

    expect(historyCsvFileName(HOLDER, "subscriptions", "2026-09-14")).toContain("subscriptions");
    expect(historyCsvFileName(HOLDER, "subscriptions", "2026-09-14")).toMatch(/\.csv$/);
  });

  test("the token symbol in the table header is the one the app uses everywhere", () => {
    expect(TOKEN.symbol).toBe("hbTRS");
  });
});

/**
 * A complete `/api/events` response for one address, **validated with the endpoint's own schema
 * before it is served**.
 *
 * This is not a fake wallet and it is not a fake chain: it is the app's own read-only JSON API,
 * answering with the same fixtures the unit tests fold, so the table, the filters and the export
 * can be exercised as a person would use them. Parsing it with `eventsResponseSchema` is what keeps
 * it honest — a payload that has drifted from what the route really serves fails here.
 */
function eventsResponse(events: readonly ChainEvent[]) {
  return eventsResponseSchema.parse({
    ok: true,
    data: {
      status: "ok",
      chain_id: ACTIVE_CHAIN_ID,
      network: ACTIVE_CHAIN.key,
      token_address: TOKEN_ADDRESS,
      registry_address: REGISTRY_ADDRESS,
      deploy_block: 1,
      from_block: 1,
      to_block: 40,
      window_truncated: false,
      results_truncated: false,
      limit: 200,
      count: events.length,
      events,
      filters: { event: [], account: HOLDER, from_block: null, to_block: null },
      page: {
        order: "asc",
        limit: 200,
        max_limit: 200,
        cursor: null,
        next_cursor: null,
        has_more: false,
        returned: events.length,
        matched: events.length,
      },
      coverage: {
        complete: true,
        from_block: 1,
        to_block: 40,
        head_block: 40,
        chunk_size: 10_000,
        log_requests: 1,
        gaps: [],
        duplicates_dropped: 0,
        reorg_conflicts: 0,
        removed_logs_dropped: 0,
        undecodable_logs: 0,
        blocks_timestamped: 7,
        blocks_without_timestamp: 0,
        indexed_at: "2026-09-14T21:30:00Z",
        cache_age_seconds: 0,
        cache_ttl_seconds: 60,
        stale: false,
        stale_reason: null,
      },
      limitations: [],
    },
  });
}

test.describe("/portfolio with a history to show", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/events**", (route) =>
      route.fulfill({ json: eventsResponse(holderHistory()) }),
    );
  });

  test("paints every event, filters them, and folds the cost basis from them", async ({ page }) => {
    await page.goto(`/portfolio?address=${HOLDER}`);

    // Ten events: two subscriptions and their mint legs, two ordinary transfers, a claim, a
    // redemption and its burn leg, and the registry entry.
    await expect(page.getByTestId("history-row")).toHaveCount(10);
    await expect(page.getByTestId("history-count")).toContainText("Showing 10 of 10");

    // The cost basis is folded from those events, not from anything this page was told.
    // 1,400 tokens subscribed for 1,500.000000 USDC, 500 of them since disposed of, so 900 are
    // still priced out of a folded balance of 1,000 — and 1,500 × 900 / 1,400 = 964.285714.
    await expect(page.getByTestId("covered-tokens")).toHaveText("900.000000");
    await expect(page.getByTestId("basis-usdc")).toHaveText("964.285714");
    await expect(page.getByTestId("position-cost-basis")).toHaveText("964.29");
    // And the 100 tokens that arrived by transfer are named rather than quietly priced.
    await expect(page.getByTestId("basis-caveats")).toContainText("arrived by transfer");

    // A filter narrows the table and says what it is showing.
    await page.getByTestId("history-filter-subscriptions").click();
    await expect(page.getByTestId("history-row")).toHaveCount(2);
    await expect(page.getByTestId("history-count")).toContainText("subscriptions only");
  });

  test("exports exactly what is filtered, with a header row and integer amounts", async ({
    page,
  }) => {
    await page.goto(`/portfolio?address=${HOLDER}`);
    await page.getByTestId("history-filter-subscriptions").click();
    await expect(page.getByTestId("history-row")).toHaveCount(2);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("history-export").click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^hbtrs-portfolio-.*-subscriptions-.*\.csv$/);
    const file = await download.path();
    expect(file).not.toBeNull();
    const text = readFileSync(file as string, "utf8");

    // A byte-order mark, so Excel reads the em dashes in the detail column as UTF-8.
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trimEnd().split("\r\n");

    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
    // Two subscriptions, and nothing the filter excluded.
    expect(lines).toHaveLength(3);
    for (const line of lines.slice(1)) expect(line).toContain(",Subscribed,");
    // Both amounts of the 1,000 USDC subscription, formatted and as the exact integer.
    expect(text).toContain("-1000000000");
    expect(text).toContain("-1000.000000");
  });
});
