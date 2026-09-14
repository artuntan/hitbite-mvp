import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { FOOTER_DISCLAIMER, TESTNET_BANNER } from "../lib/copy";
import {
  attestationResponseSchema,
  eventsResponseSchema,
  holdingsResponseSchema,
  navDocumentSchema,
  navResponseSchema,
  statsResponseSchema,
} from "../lib/schemas";

/**
 * Smoke tests (BUILD_PROMPT 7.4): the public pages render, the API routes return JSON that
 * matches the zod schemas, and the transparency NAV check agrees with the committed fixtures.
 *
 * Run against a production build — `playwright.config.ts` starts `pnpm start`, so `pnpm build`
 * must have happened first.
 *
 * These assert on the layout chrome (banner, footer disclaimer) and on the transparency page's
 * own structure. They deliberately do not assert on the Overview page's copy: that page's content
 * is owned elsewhere, and a smoke test that breaks when a paragraph is reworded is noise.
 */

/** The fixture the pages and the API are both supposed to be reading. */
const navFixture = navDocumentSchema.parse(
  JSON.parse(readFileSync(path.join(__dirname, "..", "public", "data", "nav.json"), "utf8")),
);

const PUBLIC_PAGES = [
  { path: "/", name: "Overview" },
  { path: "/transparency", name: "Transparency" },
] as const;

async function getJson(request: APIRequestContext, url: string) {
  const response = await request.get(url);
  expect(response.status(), `${url} should answer 200`).toBe(200);
  expect(
    response.headers()["cache-control"],
    `${url} should carry the public cache policy`,
  ).toContain("s-maxage=60");
  return (await response.json()) as unknown;
}

test.describe("public pages", () => {
  for (const page_ of PUBLIC_PAGES) {
    test(`${page_.name} (${page_.path}) renders with the testnet banner and the disclaimer`, async ({
      page,
    }) => {
      const response = await page.goto(page_.path);
      expect(response?.status()).toBe(200);

      // Every public page names the product. Note that Next's `title.template` (set in
      // app/layout.tsx) applies only to *child* segments, so app/page.tsx has to spell its own
      // title out — `title: "Overview — HitBite hbTRS (testnet)"` — rather than relying on it.
      await expect(page).toHaveTitle(/HitBite/);

      // `.first()`: the banner text is a fixed sentence and a page is free to quote it in its own
      // body copy, so scope to the first occurrence — the one the layout renders above the header.
      await expect(page.getByText(TESTNET_BANNER).first()).toBeVisible();

      // The disclaimer is mandatory on every page and lives in the footer landmark.
      await expect(page.getByRole("contentinfo").getByText(FOOTER_DISCLAIMER)).toBeVisible();

      // Exactly one h1, so the page has a single accessible name.
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    });
  }
});

test.describe("public API", () => {
  test("/api/nav matches navResponseSchema", async ({ request }) => {
    const body = await getJson(request, "/api/nav");
    const parsed = navResponseSchema.parse(body);
    expect(parsed.data.nav.usdc_6dec).toBe(navFixture.nav.usdc_6dec);
    expect(parsed.data.simulated).toBe(true);
  });

  test("/api/holdings matches holdingsResponseSchema", async ({ request }) => {
    const parsed = holdingsResponseSchema.parse(await getJson(request, "/api/holdings"));
    expect(parsed.data.positions.length).toBeGreaterThan(0);
    // Every position keeps its illustrative label: that is a compliance requirement, not a detail.
    for (const position of parsed.data.positions) {
      expect(position.illustrative).toBe(true);
    }
  });

  test("/api/stats matches statsResponseSchema and reports NAV agreement", async ({ request }) => {
    const parsed = statsResponseSchema.parse(await getJson(request, "/api/stats"));
    const agreement = parsed.data.nav_agreement;

    expect(agreement.published_usdc_6dec).toBe(navFixture.nav.usdc_6dec);

    if (agreement.onchain_usdc_6dec === null) {
      // "Could not check" must never be dressed up as a pass or a failure.
      expect(agreement.matches).toBeNull();
      expect(parsed.data.chain.status).toBe("unavailable");
    } else {
      expect(agreement.matches).toBe(
        BigInt(agreement.onchain_usdc_6dec) === BigInt(agreement.published_usdc_6dec),
      );
    }
  });

  test("/api/attestation matches attestationResponseSchema in either state", async ({
    request,
  }) => {
    const parsed = attestationResponseSchema.parse(await getJson(request, "/api/attestation"));
    if (parsed.data.status === "not_published") {
      // Absence is a documented state (PLAN.md D34), answered 200 with a way forward.
      expect(parsed.data.how_to_publish.length).toBeGreaterThan(0);
      expect(parsed.data.expected_path).toContain("attestation.json");
    } else {
      expect(parsed.data.document.signature.message.length).toBeGreaterThan(0);
    }
  });

  test("/api/events matches eventsResponseSchema", async ({ request }) => {
    const parsed = eventsResponseSchema.parse(await getJson(request, "/api/events?limit=5"));
    expect(parsed.data.limitations.length).toBeGreaterThan(0);
    if (parsed.data.status === "ok") {
      expect(parsed.data.events.length).toBeLessThanOrEqual(5);
    }
  });

  test("/api/events rejects a bad limit with the error envelope", async ({ request }) => {
    const response = await request.get("/api/events?limit=0");
    expect(response.status()).toBe(400);
    const body = (await response.json()) as { ok: boolean; error: { code: string; hint: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("bad_request");
  });
});

test.describe("transparency", () => {
  test("the NAV check agrees with the fixtures and never claims a false pass", async ({
    page,
    request,
  }) => {
    const stats = statsResponseSchema.parse(await getJson(request, "/api/stats"));
    const agreement = stats.data.nav_agreement;

    await page.goto("/transparency");

    const navCheck = page.getByTestId("nav-check");
    await expect(navCheck).toBeVisible();

    // The published side is rendered from nav.json, to all six decimals, exactly as published.
    await expect(page.getByTestId("published-nav")).toHaveText(navFixture.nav.per_token_usd);

    // The verdict must be the same one the API reached from the same two numbers.
    const expectedState =
      agreement.matches === null ? "unavailable" : agreement.matches ? "match" : "mismatch";
    await expect(navCheck).toHaveAttribute("data-state", expectedState);

    if (expectedState === "unavailable") {
      // The honest rendering of a missing on-chain side: an em dash and a stated reason, not a pass.
      await expect(page.getByTestId("onchain-nav")).toHaveText("—");
      await expect(navCheck.getByText("The check could not be performed.")).toBeVisible();
    } else {
      expect(agreement.onchain_usdc_6dec).not.toBeNull();
      await expect(navCheck.getByText("Mismatch")).toHaveCount(expectedState === "match" ? 0 : 1);
    }
  });

  test("the holdings table shows every position with its illustrative label", async ({
    page,
    request,
  }) => {
    const holdings = holdingsResponseSchema.parse(await getJson(request, "/api/holdings"));

    await page.goto("/transparency");

    const table = page.getByTestId("holdings-table");
    await expect(table).toBeVisible();
    await expect(table.locator("tbody tr")).toHaveCount(holdings.data.positions.length);

    for (const position of holdings.data.positions) {
      await expect(table.getByText(position.name).first()).toBeVisible();
    }

    // Cash and fees payable are stated, not buried in the NAV total.
    const summary = page.getByTestId("book-summary");
    await expect(summary.getByText("Cash", { exact: true })).toBeVisible();
    await expect(summary.getByText("Fees payable", { exact: true })).toBeVisible();
  });

  test("the attestation section states its true state rather than hiding", async ({
    page,
    request,
  }) => {
    const attestation = attestationResponseSchema.parse(await getJson(request, "/api/attestation"));

    await page.goto("/transparency");

    const section = page.getByTestId("attestation");
    await expect(section).toBeVisible();
    await expect(section).toHaveAttribute(
      "data-state",
      attestation.data.status === "published" ? "published" : "absent",
    );

    // The label travels with the attestation in both states (PLAN.md D9).
    await expect(
      section.getByText("Simulated attestor — an independent firm signs in production."),
    ).toBeVisible();

    if (attestation.data.status === "published") {
      await expect(
        section.getByRole("button", { name: "Verify signature in browser" }),
      ).toBeVisible();
    } else {
      // Nothing to verify: no dead control, but the absence is explained and actionable.
      await expect(section.getByText("No attestation is published.")).toBeVisible();
      // `exact`: the command is also quoted inside the explanatory sentence above it.
      await expect(section.getByText("make attest", { exact: true })).toBeVisible();
      await expect(section.getByRole("button", { name: /verify/i })).toHaveCount(0);
    }
  });

  test("contract addresses come from the recorded deployments", async ({ page }) => {
    await page.goto("/transparency");

    const contracts = page.getByTestId("contracts");
    await expect(contracts).toBeVisible();
    await expect(contracts.getByText("HBToken").first()).toBeVisible();

    // Testnet only, everywhere: no mainnet chain id may reach a public page.
    const body = (await page.textContent("body")) ?? "";
    expect(body).not.toMatch(/\bchain 1\b/);
    expect(body.toLowerCase()).not.toContain("etherscan.io/address");
  });
});
