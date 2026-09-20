import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hBTokenAbi } from "../packages/config/abi.ts";
import { context, readDeployment, json, safeError } from "./runtime.ts";
import { units } from "../app/src/lib/chain.ts";

const baseUrl =
  process.env.UI_BASE_URL ||
  process.env.E2E_BASE_URL ||
  "http://localhost:3000";
const browser = await chromium.launch();
const results: string[] = [];
const errors: string[] = [];
mkdirSync(".context", { recursive: true });
const browserContext = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await browserContext.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (e) => {
  if (e.type() === "error" && /hydrat/i.test(e.text())) errors.push(e.text());
});
try {
  const ctx = await context();
  const deployment = readDeployment(ctx.name);
  const nav = await (await page.request.get(baseUrl + "/data/nav.json")).json();
  const attestation = await (
    await page.request.get(baseUrl + "/data/attestation.json")
  ).json();
  await page.goto(baseUrl + "/transparency");
  await expect(
    page.getByRole("heading", { name: "Transparency", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Transparency — HitBite");
  const onchainNav = await ctx.client.readContract({
    address: deployment.addresses.HBToken,
    abi: hBTokenAbi,
    functionName: "navPerToken",
  });
  await expect(page.getByTestId("transparency-nav")).toContainText(
    units(onchainNav, 6, 6),
    { timeout: 90000 },
  );
  await expect(page.locator(".holdings-table tbody tr")).toHaveCount(
    nav.holdings.length,
  );
  await expect(page.locator(".chart-point")).toHaveCount(nav.history.length);
  if (nav.history.length === 1)
    await expect(page.locator(".chart-line")).toHaveCount(0);
  await expect(page.locator(".record-status")).toHaveText("Not checked");
  await page.evaluate(() => document.fonts.ready);
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width > 800 ? 1100 : 844 });
    assert.equal(
      await page
        .locator("body")
        .evaluate((e) => e.scrollWidth > window.innerWidth),
      false,
      `Document overflow at ${width}`,
    );
    await page.screenshot({
      caret: "initial",
      path: `.context/transparency-${width}.png`,
      fullPage: true,
    });
  }
  results.push(
    "Real NAV and holdings; one-point history has no fabricated trend; 1440/1024/768/390/320px layouts",
  );
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page
    .getByRole("button", { name: "Verify signature", exact: true })
    .click();
  await expect(page.locator(".verification-good")).toContainText(
    "Signature verified",
    { timeout: 15000 },
  );
  await expect(page.locator(".record-status")).toHaveText("Verified");
  await page.locator(".signature-details summary").click();
  const shown = JSON.parse(
    await page.getByLabel("Signed attestation JSON").innerText(),
  );
  assert.deepEqual(shown, attestation);
  for (const [file, expected] of [
    ["nav", nav],
    ["attestation", attestation],
  ] as const) {
    const downloaded = page.waitForEvent("download");
    await page.locator(`a[download][href="/data/${file}.json"]`).click();
    const download = await downloaded;
    const target = `.context/transparency-${file}-download.json`;
    await download.saveAs(target);
    assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), expected);
  }
  await page.getByRole("button", { name: "Copy HBToken address" }).click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    deployment.addresses.HBToken,
  );
  await expect(
    page.getByRole("link", {
      name: `HBToken: ${deployment.addresses.HBToken}. Open in explorer`,
    }),
  ).toHaveAttribute(
    "href",
    new RegExp(`/address/${deployment.addresses.HBToken}$`, "i"),
  );
  results.push(
    "Actual signature verifies; displayed/downloaded signed JSON and NAV match sources; contract copy/explorer links work",
  );
  await page.locator(".valuation-details summary").click();
  await expect(
    page.getByRole("region", { name: "Valuation inputs" }),
  ).toContainText(nav.holdings[0].maturity);
  await page.getByText("Valuation & methodology", { exact: true }).click();
  await expect(
    page.getByText("Simulated yield to maturity", { exact: true }),
  ).toBeVisible();
  await page.getByText("From testnet to production", { exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Production operating model" })
      .locator("tbody tr"),
  ).toHaveCount(8);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page
        .locator("body")
        .evaluate((e) => e.scrollWidth > window.innerWidth),
      false,
      `Expanded detail overflow at ${width}`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator(".signature-details summary").click();
  await page.locator(".valuation-details summary").click();
  await page.getByText("Valuation & methodology", { exact: true }).click();
  await page.getByText("From testnet to production", { exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    caret: "initial",
    path: ".context/transparency-verified.png",
    fullPage: true,
  });
  results.push(
    "Valuation inputs, model fees/yields and all eight production layers remain inspectable without page overflow",
  );

  // Read-only browser fixtures only. Published files and on-chain records are never mutated.
  let fixture = structuredClone(nav);
  await page.route("**/data/nav.json", (route) =>
    route.fulfill({ json: fixture }),
  );
  fixture = { ...nav, nav_units: (BigInt(nav.nav_units) + 1n).toString() };
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.locator(".record-changed")).toContainText(
    "record changed",
    { timeout: 15000 },
  );
  await expect(page.locator(".record-status")).toHaveText("Not checked");
  await expect(
    page.getByText("NAV has changed on-chain.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Verify signature", exact: true })
    .click();
  await expect(page.locator(".record-verification.error")).toContainText(
    "attestation NAV differs",
  );
  results.push(
    "A refreshed mismatching snapshot invalidates the verified state, shows NAV mismatch and fails re-verification",
  );
  fixture = {
    ...nav,
    history: [
      { date: "2026-09-01", nav: "0.98", block: 1 },
      { date: "2026-09-05", nav: "1.02", block: 2 },
      { date: "2026-09-20", nav: "1", block: 3 },
    ],
  };
  await page.reload();
  await expect(page.locator(".chart-point")).toHaveCount(3);
  await page.getByRole("button", { name: "Previous NAV observation" }).click();
  await expect(page.locator(".nav-observation")).toContainText("1.020000");
  await expect(page.locator(".nav-observation")).toContainText("2026-09-05");
  await page
    .getByRole("group", { name: "Published NAV history", exact: true })
    .focus();
  await page.keyboard.press("Home");
  await expect(page.locator(".nav-observation")).toContainText("0.980000");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".nav-observation")).toContainText("1.020000");
  await page.keyboard.press("End");
  await expect(page.locator(".nav-observation")).toContainText("2026-09-20");
  await page.locator(".history-records summary").click();
  await expect(
    page.getByRole("region", { name: "NAV observations" }).locator("tbody tr"),
  ).toHaveCount(3);
  fixture.history = fixture.history.map(
    (h: { date: string; block: number }) => ({ ...h, nav: "1" }),
  );
  await page.reload();
  await expect(page.locator(".chart-point")).toHaveCount(3);
  const heights = await page
    .locator(".chart-point")
    .evaluateAll((points) => points.map((p) => p.getAttribute("cy")));
  assert.equal(new Set(heights).size, 1);
  assert(!String(heights[0]).includes("NaN"));
  fixture.history = [];
  await page.reload();
  await expect(page.getByText("No published observations yet.")).toBeVisible();
  await expect(page.locator(".chart-line")).toHaveCount(0);
  results.push(
    "Synthetic history fixtures: keyboard/buttons select exact observations; flat and empty series render honestly",
  );
  await page.unroute("**/data/nav.json");
  await page.route("**/data/attestation.json", (route) =>
    route.fulfill({
      json: {
        ...attestation,
        payload: { ...attestation.payload, nav_units: "999" },
      },
    }),
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Verify signature", exact: true })
    .click();
  await expect(page.locator(".record-verification.error")).toContainText(
    "displayed payload differs",
  );
  await expect(page.locator(".record-status")).toHaveText("Check failed");
  await page.unroute("**/data/attestation.json");
  let unavailable = true;
  await page.route("**/data/nav.json", (route) =>
    unavailable
      ? route.fulfill({ status: 503, body: "Unavailable" })
      : route.fulfill({ json: nav }),
  );
  await page.reload();
  await expect(page.locator(".data-warning")).toContainText("Published NAV", {
    timeout: 15000,
  });
  await expect(
    page.getByRole("button", { name: "Verify signature", exact: true }),
  ).toBeDisabled();
  unavailable = false;
  await page.getByRole("button", { name: "Retry data" }).click();
  await expect(page.locator(".nav-observation")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator(".data-warning")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Verify signature", exact: true })
    .click();
  await expect(page.locator(".verification-good")).toContainText(
    "Signature verified",
  );
  results.push(
    "Tampered payload is rejected; unavailable NAV disables verification and retry restores valid data",
  );
  await page.unroute("**/data/nav.json");
  await page.getByRole("link", { name: "HitBite app", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Connect your wallet." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Transparency", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Transparency", exact: true }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "Walkthrough" }).check();
  await expect(page.getByText(/No wallet signature is needed/)).toBeVisible();
  await page.getByRole("checkbox", { name: "Walkthrough" }).uncheck();
  results.push(
    "App/Transparency client navigation and optional explanations remain usable",
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    ".context/transparency-evidence.json",
    json({
      timestamp: new Date().toISOString(),
      baseUrl,
      chainId: ctx.chain.id,
      results,
      pageErrors: errors,
      transactions: 0,
      fixtures: "Browser interception only; no published data modified",
      publishedSnapshot: nav.timestamp,
    }),
  );
  console.log(json(results));
} catch (e) {
  await page.screenshot({
    caret: "initial",
    path: ".context/transparency-failure.png",
    fullPage: true,
  });
  console.error(safeError(e));
  process.exitCode = 1;
} finally {
  await browser.close();
}
