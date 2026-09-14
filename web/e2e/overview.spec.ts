import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  HOW_IT_WORKS_STEPS,
  PRODUCT_SUMMARY,
  TESTNET_BANNER,
  FOOTER_DISCLAIMER,
} from "../lib/copy";
import { formatPercent, formatUsdcExact } from "../lib/format";
import { navDocumentSchema } from "../lib/schemas";

/**
 * Overview page (BUILD_PROMPT 7.2).
 *
 * Runs against a production build — `playwright.config.ts` starts `pnpm start`,
 * so `pnpm build` must have happened first.
 *
 * What is asserted, and why:
 *  - the sections the brief names are all present;
 *  - the figures on the page equal the committed fixture, formatted from its
 *    6-decimal integers (PLAN.md D22) — this is the check that catches a number
 *    drifting between the engine and the UI;
 *  - the illustrative label on the T-bill comparison is *visible*, not hidden in
 *    a tooltip;
 *  - every internal link resolves, because "no dead links" is an explicit review
 *    item (BUILD_PROMPT 16.5) and the CTA deliberately points at unbuilt routes
 *    with disabled controls rather than links;
 *  - both themes render every chart with no console errors.
 */

const nav = navDocumentSchema.parse(
  JSON.parse(readFileSync(path.join(__dirname, "..", "public", "data", "nav.json"), "utf8")),
);

/** Charts are client components; wait for Recharts to paint before asserting on them. */
const CHART_SURFACE = ".recharts-surface";

function collectPageProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

test.describe("Overview page", () => {
  test("renders the shell, the product summary and every required section", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    // The root page inherits `title.default` from the layout: Next's title
    // template only applies to child segments, and this page is the root one.
    await expect(page).toHaveTitle(/HitBite hbTRS/);

    // Mandatory on every page (BUILD_PROMPT section 15).
    await expect(page.getByText(TESTNET_BANNER)).toBeVisible();
    await expect(page.getByText(FOOTER_DISCLAIMER)).toBeVisible();

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(PRODUCT_SUMMARY)).toBeVisible();

    for (const heading of [
      "Portfolio",
      "NAV history",
      "How it works",
      "Comparison",
      "About this data",
      "Verification and subscription",
    ]) {
      await expect(
        page.getByRole("heading", { name: heading, exact: true, level: 2 }),
        `section "${heading}" should be on the page`,
      ).toBeVisible();
    }

    // "How it works" in five steps, verbatim.
    for (const step of HOW_IT_WORKS_STEPS) {
      await expect(page.getByText(step.text, { exact: true })).toBeVisible();
    }
  });

  test("shows the headline metrics with units, and says so when one has no data", async ({
    page,
  }) => {
    await page.goto("/");

    const navPerToken = formatUsdcExact(BigInt(nav.nav.usdc_6dec));
    await expect(page.getByText(navPerToken, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("USDC per hbTRS · as of", { exact: false })).toBeVisible();

    await expect(
      page.getByText(formatPercent(nav.portfolio.weighted_ytm_pct), { exact: true }).first(),
    ).toBeVisible();

    // The fixture has no annualised distribution yield yet; the page must say so
    // rather than print a zero.
    expect(nav.distribution_yield.annualized_pct).toBeNull();
    await expect(page.getByText("Not yet available")).toBeVisible();
    await expect(page.getByText(nav.distribution_yield.note)).toBeVisible();
  });

  test("labels the tokenized T-bill reference as an illustrative placeholder, visibly", async ({
    page,
  }) => {
    await page.goto("/");

    const comparison = page.getByRole("table", {
      name: "hbTRS compared with a tokenized US T-bill reference",
    });
    await expect(comparison).toBeVisible();

    // Visible on the card itself — not in a tooltip, not behind a disclosure.
    await expect(page.getByText("Illustrative placeholder — not a quoted yield")).toBeVisible();
    await expect(
      page.getByText(nav.comparison.tokenized_tbill_reference.source_note),
    ).toBeVisible();
    await expect(
      comparison.getByText(formatPercent(nav.comparison.tokenized_tbill_reference.yield_pct)),
    ).toBeVisible();
  });

  test("puts every chart's figures in a table as well as in the chart", async ({ page }) => {
    await page.goto("/");

    // The composition and ladder tables are always visible: the first is also the
    // donut's legend, and the second fills the card the chart leaves short.
    for (const label of [
      "Portfolio composition by holding",
      "Bond market value by maturity year",
    ]) {
      await expect(page.getByRole("table", { name: label })).toBeVisible();
    }

    // The history table sits behind a native disclosure, so it is reachable with
    // no JavaScript at all. `getByRole` ignores hidden nodes, which is why the
    // closed state resolves to nothing.
    const label = "Net asset value per token by date";
    const table = page.getByRole("table", { name: label });
    await expect(table).toBeHidden();
    await page
      .locator("details")
      .filter({ has: page.locator(`table[aria-label="${label}"]`) })
      .locator("summary")
      .click();
    await expect(table).toBeVisible();
  });

  test("has no dead internal links", async ({ page, request }) => {
    await page.goto("/");

    const hrefs = await page
      .locator("a[href]")
      .evaluateAll((anchors) =>
        anchors
          .map((anchor) => anchor.getAttribute("href") ?? "")
          .filter((href) => href.startsWith("/")),
      );

    expect(hrefs.length, "the page should link somewhere").toBeGreaterThan(0);

    for (const href of [...new Set(hrefs)]) {
      const response = await request.get(href);
      expect(response.status(), `${href} should not be a dead link`).toBe(200);
    }
  });

  for (const theme of ["light", "dark"] as const) {
    test(`renders every chart in the ${theme} theme with no console errors`, async ({ page }) => {
      const problems = collectPageProblems(page);

      // next-themes reads its stored choice from `localStorage.theme` in a
      // blocking script, so the first paint is already in the right theme.
      await page.addInitScript((value) => {
        window.localStorage.setItem("theme", value);
      }, theme);

      await page.goto("/");
      const html = page.locator("html");
      if (theme === "dark") {
        await expect(html).toHaveClass(/\bdark\b/);
      } else {
        await expect(html).not.toHaveClass(/\bdark\b/);
      }

      // Donut, maturity ladder, NAV history.
      await expect(page.locator(CHART_SURFACE)).toHaveCount(3);
      for (let index = 0; index < 3; index += 1) {
        await expect(page.locator(CHART_SURFACE).nth(index)).toBeVisible();
      }

      // Every chart is named for assistive tech.
      for (const label of [
        "Portfolio composition by holding",
        "Bond market value by maturity year",
        "Net asset value per token over time",
      ]) {
        await expect(page.getByRole("img", { name: label })).toBeVisible();
      }

      expect(problems, `console output in ${theme} theme`).toEqual([]);
    });
  }
});
