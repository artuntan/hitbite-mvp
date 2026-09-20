import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { landingCopy } from "../app/src/lib/site.ts";
const baseUrl = process.env.UI_BASE_URL || "http://localhost:3000";
const live = process.env.LANDING_EXPECT_LIVE !== "false";
const browser = await chromium.launch();
const errors: string[] = [];
const results: string[] = [];
const layouts: object[] = [];
mkdirSync(".context", { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const origins = new Set<string>();
  page.on("request", (request) => origins.add(new URL(request.url()).origin));
  const response = await page.goto(baseUrl);
  assert(response);
  assert(response.ok());
  assert.match(
    response.headers()["strict-transport-security"] || "",
    /max-age=31536000/,
  );
  await expect(page.locator("h1")).toHaveText(landingCopy.headline);
  await expect(page.locator("main > p")).toHaveText(landingCopy.paragraph);
  await expect(page.locator("footer > p")).toHaveText(landingCopy.disclaimer);
  await expect(page).toHaveTitle(
    "HitBite — Türkiye's sovereign bonds, on-chain",
  );
  assert.equal(await page.locator("h1").count(), 1);
  await expect(page.locator('a[href*="github.com"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Read the code" })).toHaveCount(
    0,
  );
  await expect(page.locator('link[rel="icon"]')).toHaveCount(1);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    /\/favicon\.ico/,
  );
  const favicon = await page.request.get(baseUrl + "/favicon.ico");
  assert(favicon.ok());
  assert.deepEqual(
    await favicon.body(),
    readFileSync("app/src/app/favicon.ico"),
  );
  assert.doesNotMatch(
    await page.locator("body").innerText(),
    /\b(invest|investing|returns|APY|yield|guaranteed|coming soon|waitlist|airdrop|points)\b/i,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations().map((animation) => animation.finished),
    ),
  );
  const image = page.getByRole("img", { name: "HitBite", exact: true });
  await image.evaluate((img: HTMLImageElement) => img.decode());
  await expect(image).toHaveAttribute("draggable", "false");
  assert.equal(
    await image.evaluate((el) =>
      el.dispatchEvent(
        new DragEvent("dragstart", { bubbles: true, cancelable: true }),
      ),
    ),
    false,
  );
  if (live) {
    const data = await (
      await page.request.get(baseUrl + "/data/nav.json")
    ).json();
    await expect(page.getByTestId("landing-nav-value")).toHaveText(
      Number(data.nav_per_token).toLocaleString("en-US", {
        minimumFractionDigits: 4,
        maximumFractionDigits: 6,
      }),
    );
    await expect(page.getByTestId("landing-nav").locator("dt")).toHaveText(
      "hbTRSNet asset value",
    );
    await expect(
      page.getByTestId("landing-nav").locator("time"),
    ).toHaveAttribute("datetime", data.timestamp);
    await expect(page.getByTestId("landing-nav")).not.toContainText(
      "Arc Testnet",
    );
    await expect(
      page
        .locator("main")
        .getByRole("link", { name: "Open the testnet", exact: true }),
    ).toHaveAttribute("href", "/app");
  } else {
    await expect(
      page.getByRole("link", { name: "Open the testnet", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByTestId("landing-nav")).toHaveCount(0);
    await expect(page.locator("main a").first()).toHaveText("Request access");
    await expect(page.locator("main a").first()).toHaveAttribute(
      "href",
      "mailto:hello@hitbite.com?subject=HitBite%20access%20request",
    );
  }
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [360, 640],
    [768, 768],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    const bounds = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    assert(
      bounds.scrollWidth <= width!,
      `Horizontal overflow: ${JSON.stringify(bounds)}`,
    );
    assert(
      bounds.scrollHeight <= height!,
      `Vertical overflow: ${JSON.stringify(bounds)}`,
    );
    const headline = await page.locator("h1").evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(el).lineHeight),
    }));
    assert(
      headline.height <= headline.lineHeight * 2 + 1,
      "Headline exceeds two lines",
    );
    layouts.push(bounds);
    await page.screenshot({
      path: `.context/landing-${live ? "live" : "access"}-${width}.png`,
      fullPage: true,
      caret: "initial",
    });
  }
  await page.setViewportSize({ width: 390, height: 540 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollHeight >= innerHeight,
    ),
  );
  await page.locator("footer").scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("link", { name: "hello@hitbite.com", exact: true }),
  ).toBeInViewport();
  results.push(
    "Exact copy, supplied favicon, no GitHub links, responsive single-screen layout; short screens can scroll without clipping",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  await page.keyboard.press("Tab");
  assert.equal(
    await page
      .locator(":focus")
      .evaluate((el) => getComputedStyle(el).outlineStyle),
    "solid",
  );
  results.push(
    "Reduced motion disables all entrance motion; keyboard focus and image drag protection work",
  );
  assert.deepEqual([...origins], [new URL(baseUrl).origin]);
  assert.deepEqual(await page.context().cookies(), []);
  results.push(
    "Landing fetches only same-origin resources and sets no cookies",
  );
  if (live) {
    for (const fixture of ["missing", "stale", "malformed"] as const) {
      await page.route("**/data/nav.json", (route) =>
        route.fulfill({
          status: fixture === "missing" ? 404 : 200,
          contentType: "application/json",
          body: JSON.stringify(
            fixture === "stale"
              ? {
                  nav_per_token: "1.0038",
                  timestamp: new Date(Date.now() - 49 * 3600_000).toISOString(),
                }
              : {},
          ),
        }),
      );
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.getByTestId("landing-nav")).toHaveCount(0);
      await page.unroute("**/data/nav.json");
    }
    let release: (() => void) | undefined;
    await page.route("**/data/nav.json", async (route) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ status: 404, body: "" });
    });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toBeVisible();
    await expect(
      page
        .locator("main")
        .getByRole("link", { name: "Open the testnet", exact: true }),
    ).toBeVisible();
    await expect.poll(() => Boolean(release)).toBe(true);
    const released = page.waitForResponse((response) =>
      response.url().endsWith("/data/nav.json"),
    );
    release!();
    await released;
    await page.unroute("**/data/nav.json");
    results.push(
      "Real NAV renders; missing, stale and malformed NAV stay hidden; first paint is independent of NAV",
    );
    await page
      .locator("main")
      .getByRole("link", { name: "Open the testnet", exact: true })
      .click();
    await expect(page).toHaveURL(baseUrl + "/app");
    await expect(
      page.getByRole("heading", { name: "Connect your wallet." }),
    ).toBeVisible();
    await page.goBack();
    await expect(page.locator("h1")).toHaveText(landingCopy.headline);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollHeight > innerHeight,
      ),
      false,
    );
    results.push(
      "Primary CTA opens the existing app; browser back returns to an intact landing layout",
    );
  } else
    results.push(
      "Launch switch hides both testnet links and NAV and changes primary CTA to email access",
    );
  const robots = await (await page.request.get(baseUrl + "/robots.txt")).text();
  assert.match(robots, /Allow: \/transparency/);
  assert.match(robots, /Disallow: \/admin/);
  const sitemap = await (
    await page.request.get(baseUrl + "/sitemap.xml")
  ).text();
  assert.equal((sitemap.match(/<loc>/g) || []).length, 3);
  for (const agent of ["Twitterbot/1.0", "Slackbot-LinkExpanding 1.0"]) {
    const html = await (
      await page.request.get(baseUrl, { headers: { "User-Agent": agent } })
    ).text();
    assert.match(html, /summary_large_image/);
    assert.match(html, /property="og:image"/);
    assert.match(html, /name="twitter:image"/);
  }
  await page.goto(baseUrl);
  for (const selector of [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
  ]) {
    const url = await page.locator(selector).getAttribute("content");
    assert(url);
    const asset = await page.request.get(
      new URL(new URL(url).pathname, baseUrl).href,
    );
    assert.equal(asset.status(), 200);
    assert.match(asset.headers()["content-type"] || "", /image\/png/);
    const bytes = await asset.body();
    assert.equal(bytes.readUInt32BE(16), 1200);
    assert.equal(bytes.readUInt32BE(20), 630);
    writeFileSync(
      `.context/landing-${selector.includes("twitter") ? "twitter" : "og"}.png`,
      bytes,
    );
  }
  results.push(
    "Indexing, sitemap, HSTS, Twitterbot/Slackbot metadata and both generated 1200×630 share images verified",
  );
  assert.deepEqual(errors, []);
  const evidence = {
    timestamp: new Date().toISOString(),
    baseUrl,
    appLive: live,
    results,
    layouts,
    pageErrors: errors,
    walletTransactions: 0,
  };
  writeFileSync(
    `.context/landing-${live ? "live" : "access"}-evidence.json`,
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
}
