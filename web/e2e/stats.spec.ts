import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { FOOTER_DISCLAIMER, TESTNET_BANNER } from "../lib/copy";
import { formatFixed, formatTokens, formatUsdc, formatUsdcExact } from "../lib/format";
import { statsResponseSchema, type StatsResponse } from "../lib/schemas";

/**
 * `/stats` (BUILD_PROMPT 7.2).
 *
 * Runs against a production build — `playwright.config.ts` starts `pnpm start`,
 * so `pnpm build` must have happened first.
 *
 * The page and `/api/stats` read the same event index in the same process, so
 * these tests take the endpoint as the oracle and assert the page agrees with
 * it, figure by figure, formatted from the same integers (PLAN.md D22). That is
 * the check that catches a number drifting between the JSON a partner reads and
 * the page a reviewer reads.
 *
 * Both states are asserted, and which one runs depends on the environment rather
 * than on a fixture: with no deployment on the configured chain the page must
 * render an explanation and **no figures at all**, and with an index it must
 * render the figures the endpoint reports. A test that only ever exercised one
 * of those would let the other rot.
 */

type StatsData = StatsResponse["data"];
type Activity = StatsData["activity"];

async function readStats(request: APIRequestContext): Promise<StatsData> {
  const response = await request.get("/api/stats");
  expect(response.status(), "/api/stats should answer 200").toBe(200);
  return statsResponseSchema.parse(await response.json()).data;
}

/**
 * The page renders figures only when the scan actually covered blocks. An index
 * whose `to_block` is below its `from_block` is a node behind the deploy block:
 * nothing was read, so every count would be a zero nobody measured.
 */
function isMeasurable(activity: Activity): boolean {
  return activity.status === "ok" && activity.coverage.to_block >= activity.coverage.from_block;
}

function count(value: number): string {
  return formatFixed(BigInt(value), 0);
}

function collectPageProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

test.describe("Stats page", () => {
  test("renders the shell, the heading and the definitions in either state", async ({ page }) => {
    const response = await page.goto("/stats");
    expect(response?.status()).toBe(200);

    await expect(page).toHaveTitle(/HitBite/);
    await expect(page.getByText(TESTNET_BANNER).first()).toBeVisible();
    await expect(page.getByRole("contentinfo").getByText(FOOTER_DISCLAIMER)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1, name: "Stats" })).toBeVisible();

    // The definitions are what make the empty state legible, so they are not
    // conditional on there being anything to count.
    const definitions = page.getByTestId("stats-definitions");
    await expect(definitions).toBeVisible();
    await expect(definitions.getByText("Holders", { exact: true })).toBeVisible();
    await expect(definitions.getByText("Distributions to date", { exact: true })).toBeVisible();
  });

  test("says the holder count excludes the zero address", async ({ page, request }) => {
    const data = await readStats(request);
    await page.goto("/stats");

    // In both states, and in the payload too: a count that included the ERC-20
    // mint and burn sentinel would be wrong by one from the first subscription.
    if (data.activity.status === "ok") {
      expect(data.activity.holders.excludes_zero_address).toBe(true);
    }
    await expect(page.getByText("The zero address is never counted").first()).toBeVisible();
  });

  test("renders an explanation and no figures when there is nothing to count", async ({
    page,
    request,
  }) => {
    const data = await readStats(request);
    test.skip(
      isMeasurable(data.activity),
      "an index exists on the configured chain, so the page has figures to show",
    );

    await page.goto("/stats");

    await expect(page.getByTestId("stats-activity")).toHaveAttribute("data-state", "unavailable");

    const empty = page.getByTestId("stats-empty");
    await expect(empty).toBeVisible();
    await expect(empty.getByText("No events have been indexed")).toBeVisible();

    // The reason is the indexer's own, quoted rather than paraphrased — the same
    // sentence the endpoint carries.
    if (data.activity.status === "unavailable") {
      await expect(page.getByTestId("stats-empty-reason")).toHaveText(data.activity.reason);
    }

    // What would fill it, as the commands that do it.
    await expect(empty.getByText("make deploy CHAIN=…", { exact: true })).toBeVisible();
    await expect(empty.getByText("pnpm sync:contracts", { exact: true })).toBeVisible();

    // No figures, no cards of zeros: absence is rendered as absence.
    await expect(page.getByTestId("stats-figures")).toHaveCount(0);
    await expect(page.getByTestId("stats-supply")).toHaveCount(0);
    await expect(page.getByTestId("stats-distributions")).toHaveCount(0);
    await expect(page.getByTestId("stats-flows")).toHaveCount(0);
    await expect(page.getByTestId("stats-nav")).toHaveCount(0);
  });

  test("shows the figures /api/stats reports, formatted from the same integers", async ({
    page,
    request,
  }) => {
    const data = await readStats(request);
    const activity = data.activity;
    test.skip(
      !isMeasurable(activity),
      "no deployment or no index on the configured chain, so there is nothing to compare",
    );
    if (activity.status !== "ok") return;

    await page.goto("/stats");
    await expect(page.getByTestId("stats-activity")).toHaveAttribute("data-state", "ok");

    // Holders: the count, written as a floor when the scan has a gap.
    const holders = activity.holders.complete
      ? count(activity.holders.count)
      : `≥ ${count(activity.holders.count)}`;
    await expect(page.getByTestId("figure-holders")).toContainText(holders);
    await expect(page.getByTestId("holders-count")).toHaveText(holders);

    // Supply: the contract's own totalSupply() when it could be read, and the
    // fold from Transfer logs when it could not — never a mixture of the two.
    const supplyWei =
      data.chain.status === "ok"
        ? BigInt(data.chain.total_supply_wei)
        : BigInt(activity.supply_from_events.wei);
    await expect(page.getByTestId("figure-supply")).toContainText(formatTokens(supplyWei, 4));
    await expect(page.getByTestId("supply-from-events")).toHaveText(
      formatTokens(BigInt(activity.supply_from_events.wei), 6),
    );
    await expect(page.getByTestId("stats-supply")).toHaveAttribute(
      "data-state",
      activity.supply_from_events.matches_chain === null
        ? "unchecked"
        : activity.supply_from_events.matches_chain
          ? "match"
          : "mismatch",
    );

    // Flows, as 6-decimal integers summed by the indexer.
    await expect(page.getByTestId("figure-subscriptions")).toContainText(
      formatUsdc(BigInt(activity.subscriptions.usdc_6dec)),
    );
    await expect(page.getByTestId("figure-redemptions")).toContainText(
      formatUsdc(BigInt(activity.redemptions.usdc_6dec)),
    );

    // Distributions: the page states which of the two meanings it shows, and
    // both numbers plus the D29 remainder are on the card, to six decimals.
    const distributions = activity.distributions;
    await expect(page.getByTestId("figure-distributions")).toContainText(
      formatUsdc(BigInt(distributions.usdc_amount_6dec)),
    );
    await expect(page.getByTestId("distributions-paid-in")).toHaveText(
      formatUsdcExact(BigInt(distributions.usdc_amount_6dec)),
    );
    await expect(page.getByTestId("distributions-allocated")).toHaveText(
      formatUsdcExact(BigInt(distributions.usdc_allocated_6dec)),
    );
    await expect(page.getByTestId("distributions-remainder")).toHaveText(
      formatUsdcExact(BigInt(distributions.truncation_remainder_6dec)),
    );
    await expect(
      page.getByText("“Distributions to date” on this page means the USDC paid into the vault."),
    ).toBeVisible();

    // What the scan read, so a partial history can never look complete.
    await expect(page.getByTestId("coverage-events")).toHaveText(count(activity.event_count));
    await expect(page.getByTestId("stats-index")).toHaveAttribute(
      "data-state",
      activity.coverage.complete ? "complete" : "incomplete",
    );
  });

  test("surfaces a truncated window rather than presenting it as a whole history", async ({
    page,
    request,
  }) => {
    const data = await readStats(request);
    const activity = data.activity;
    test.skip(
      !isMeasurable(activity) || (activity.status === "ok" && activity.coverage.complete),
      "the scan covered the whole range, so there is no truncation to surface",
    );

    await page.goto("/stats");
    await expect(page.getByTestId("stats-truncated")).toBeVisible();
    await expect(page.getByTestId("stats-truncated")).toContainText("floors, not answers");
  });

  test("puts every chart's figures in a table as well as in the chart", async ({
    page,
    request,
  }) => {
    const data = await readStats(request);
    const activity = data.activity;
    test.skip(!isMeasurable(activity), "no index, so no charts");
    if (activity.status !== "ok") return;

    await page.goto("/stats");

    const hasFlows = activity.subscriptions.count + activity.redemptions.count > 0;
    const flowsTable = page.getByRole("table", { name: "Daily subscriptions and redemptions" });
    if (hasFlows) {
      // Rendered with the chart, not behind a disclosure: it is the accessible
      // channel for a two-colour encoding.
      await expect(flowsTable).toBeVisible();
      await expect(
        page.getByRole("img", { name: /daily subscriptions and redemptions/i }),
      ).toBeVisible();
    } else {
      await expect(flowsTable).toHaveCount(0);
      await expect(page.getByTestId("stats-flows")).toContainText(
        "No subscriptions or redemptions",
      );
    }

    const navTable = page.getByRole("table", { name: "On-chain NAV changes" });
    if (activity.nav_history_onchain.length > 0) {
      // Behind a native disclosure, so it is reachable with no JavaScript at all.
      await expect(navTable).toBeHidden();
      await page
        .locator("details")
        .filter({ has: page.locator('table[aria-label="On-chain NAV changes"]') })
        .locator("summary")
        .click();
      await expect(navTable).toBeVisible();
      await expect(navTable.locator("tbody tr")).toHaveCount(activity.nav_history_onchain.length);
    } else {
      await expect(navTable).toHaveCount(0);
      await expect(page.getByTestId("stats-nav")).toContainText("NAV has never been changed");
    }
  });

  test("has no dead internal links and names no mainnet", async ({ page, request }) => {
    await page.goto("/stats");

    const hrefs = await page
      .locator("a[href]")
      .evaluateAll((anchors) =>
        anchors
          .map((anchor) => anchor.getAttribute("href") ?? "")
          .filter((href) => href.startsWith("/")),
      );

    expect(hrefs.length, "the page should link to its own JSON").toBeGreaterThan(0);
    for (const href of [...new Set(hrefs)]) {
      const response = await request.get(href);
      expect(response.status(), `${href} should not be a dead link`).toBe(200);
    }

    // Testnet only, everywhere (BUILD_PROMPT section 2).
    const body = (await page.textContent("body")) ?? "";
    expect(body).not.toMatch(/\bchain 1\b/);
    expect(body.toLowerCase()).not.toContain("etherscan.io/address");
  });

  for (const theme of ["light", "dark"] as const) {
    test(`renders in the ${theme} theme with no console errors`, async ({ page }) => {
      const problems = collectPageProblems(page);

      await page.addInitScript((value) => {
        window.localStorage.setItem("theme", value);
      }, theme);

      await page.goto("/stats");
      const html = page.locator("html");
      if (theme === "dark") {
        await expect(html).toHaveClass(/\bdark\b/);
      } else {
        await expect(html).not.toHaveClass(/\bdark\b/);
      }

      await expect(page.getByRole("heading", { level: 1, name: "Stats" })).toBeVisible();
      expect(problems, `console output in ${theme} theme`).toEqual([]);
    });
  }
});
