import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { erc20Abi } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { mkdirSync, writeFileSync } from "node:fs";
import { walletPage } from "../tests/browser/wallet.ts";
import { json, safeError, transact } from "./runtime.ts";

const baseUrl =
  process.env.UI_BASE_URL ||
  process.env.E2E_BASE_URL ||
  "http://localhost:3000";
const browser = await chromium.launch();
const errors: string[] = [];
const results: string[] = [];
let verificationHash: string | undefined;
let verificationFundingHash: string | undefined;
mkdirSync(".context", { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text()))
      errors.push(message.text());
  });
  await page.goto(baseUrl);
  await expect(
    page.getByRole("heading", { name: "Connect your wallet." }),
  ).toBeVisible();
  await expect(page.getByTestId("app-nav")).not.toContainText("—", {
    timeout: 90000,
  });
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }).getByRole("link"),
  ).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: "Overview", exact: true }),
  ).toHaveCount(0);
  const header = page.locator(".shell-header");
  assert.equal(
    await header.evaluate((e) => getComputedStyle(e).position),
    "fixed",
  );
  assert.equal(
    await header.evaluate((e) => getComputedStyle(e, "::before").opacity),
    "0",
  );
  assert.equal(
    await header.evaluate((e) => getComputedStyle(e).backgroundColor),
    "rgba(0, 0, 0, 0)",
  );
  await page.evaluate(() => document.fonts.ready);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width > 800 ? 1000 : 844 });
    assert.equal(
      await page
        .locator("body")
        .evaluate((e) => e.scrollWidth > window.innerWidth),
      false,
      `Overflow at ${width}px`,
    );
    const nav = await page
      .getByRole("navigation", { name: "Main navigation" })
      .boundingBox();
    assert(nav && nav.x >= 0 && nav.x + nav.width <= width);
    await page
      .getByRole("button", { name: "Your position", exact: true })
      .click();
    await expect(page.locator("#position-summary")).toBeVisible();
    const popup = await page.locator("#position-summary").boundingBox();
    assert(popup && popup.x >= 0 && popup.x + popup.width <= width);
    await page.keyboard.press("Escape");
    await expect(page.locator("#position-summary")).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Your position", exact: true }),
    ).toBeFocused();
    await page.locator("main h2").click();
    await page.screenshot({
      caret: "initial",
      path: `.context/ux-${width}.png`,
      fullPage: true,
    });
  }
  results.push(
    "Direct app entry; only Transparency and position in header; 1440/768/390/320px without overflow",
  );
  results.push(
    "Position popover fits all viewports, dismisses with Escape and returns keyboard focus",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(baseUrl + "/transparency");
  const before = await header.boundingBox();
  await expect
    .poll(() => header.evaluate((e) => getComputedStyle(e, "::before").opacity))
    .toBe("0");
  await page.evaluate(() => window.scrollTo(0, 44));
  await expect
    .poll(() =>
      header.evaluate((e) => Number(getComputedStyle(e, "::before").opacity)),
    )
    .toBeGreaterThan(0.4);
  assert(
    Number(
      await header.evaluate((e) => getComputedStyle(e, "::before").opacity),
    ) < 0.6,
  );
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect
    .poll(() => header.evaluate((e) => getComputedStyle(e, "::before").opacity))
    .toBe("1");
  assert.match(
    await header.evaluate(
      (e) => getComputedStyle(e, "::before").backdropFilter,
    ),
    /blur/,
  );
  const after = await header.boundingBox();
  assert(before && after && Math.abs(after.y - before.y) < 1);
  await page.screenshot({
    caret: "initial",
    path: ".context/ux-glass-scroll.png",
    fullPage: false,
  });
  await page
    .getByRole("button", { name: "Your position", exact: true })
    .click();
  await page.locator("main h1").click();
  await expect(page.locator("#position-summary")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Verify signature", exact: true })
    .click();
  await expect(page.locator(".verification-good")).toContainText(
    "Signature verified",
  );
  results.push(
    "Header is transparent at top, gradually reveals glass on scroll and stays fixed; outside click dismisses position",
  );
  results.push("Transparency attestation still verifies client-side");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect
    .poll(() => header.evaluate((e) => getComputedStyle(e, "::before").opacity))
    .toBe("0");
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    (await header.evaluate((e) =>
      parseFloat(getComputedStyle(e, "::before").transitionDuration),
    )) < 0.01,
    true,
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(baseUrl + "/app");
  await expect(
    page.getByRole("heading", { name: "Connect your wallet." }),
  ).toBeVisible();
  results.push("Existing /app links still open the investor flow");
  await page.close();

  // Unfunded, ephemeral wallet: read-only form checks, no signatures or transactions.
  process.env.LAYOUT_WALLET_PRIVATE_KEY = generatePrivateKey();
  const investor = await walletPage(
    browser,
    "LAYOUT_WALLET_PRIVATE_KEY",
    baseUrl,
  );
  investor.page.on("pageerror", (e) => errors.push(e.message));
  await investor.page.goto(baseUrl);
  await investor.page.evaluate((contract) => {
    localStorage.setItem(
      `hitbite.workspace.5042002.${contract.toLowerCase()}.0x0000000000000000000000000000000000000001`,
      "true",
    );
  }, investor.deployment.addresses.HBToken);
  await investor.page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(
    investor.page.getByRole("heading", { name: "Verify your eligibility." }),
  ).toBeVisible({ timeout: 90000 });
  await expect(
    investor.page.getByRole("heading", { name: "Connect your wallet." }),
  ).toHaveCount(0);
  await expect(
    investor.page.getByRole("navigation", { name: "Investment steps" }),
  ).toHaveCount(0);
  await investor.page.getByLabel("Full name").fill("Layout test");
  await investor.page.getByLabel("Country of residence").selectOption("840");
  await expect(
    investor.page
      .getByRole("alert")
      .filter({ hasText: "Not available to residents" }),
  ).toBeVisible();
  await expect(
    investor.page.getByRole("button", { name: "Sign & start review" }),
  ).toBeDisabled();
  await investor.page.getByLabel("Country of residence").selectOption("826");
  await investor.page
    .getByRole("checkbox", { name: /professional investor/ })
    .check();
  await expect(
    investor.page.getByRole("button", { name: "Sign & start review" }),
  ).toBeEnabled();
  await investor.page.screenshot({
    caret: "initial",
    path: ".context/ux-verify-desktop.png",
    fullPage: true,
  });
  await investor.page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await investor.page
      .locator("body")
      .evaluate((e) => e.scrollWidth > window.innerWidth),
    false,
  );
  await investor.page.screenshot({
    caret: "initial",
    path: ".context/ux-verify-mobile.png",
    fullPage: true,
  });
  assert.equal(investor.transactions.length, 0);
  if (process.env.UI_VERIFY_FRESH === "1") {
    const funding = await transact(
      investor.ctx,
      "ISSUER_PRIVATE_KEY",
      investor.deployment.addresses.USDC,
      erc20Abi,
      "transfer",
      [investor.account.address, 60_000n],
    );
    verificationFundingHash = funding.transactionHash;
    const response = investor.page
      .waitForResponse(
        (r) =>
          r.url().endsWith("/api/verify") &&
          r.request().postDataJSON()?.action === "complete",
        { timeout: 120000 },
      )
      .catch(() => undefined);
    await investor.page
      .getByRole("button", { name: "Sign & start review" })
      .click();
    await expect(
      investor.page.getByText("Pending · 10-second simulated review"),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      investor.page.getByRole("heading", { name: "Subscribe to hbTRS." }),
    ).toBeVisible({ timeout: 120000 });
    const completed = await response;
    assert(completed);
    verificationHash = (await completed.json()).transactionHash;
    assert(verificationHash);
    await expect(
      investor.page.getByRole("heading", { name: "Verify your eligibility." }),
    ).toHaveCount(0);
    await expect(investor.page.locator(".setup-progress")).toContainText(
      "03 / 03",
    );
    results.push(
      "Fresh wallet signed review confirms on-chain and automatically closes verification; another wallet's workspace preference does not skip setup",
    );
  }
  results.push(
    "Fresh-wallet verification form, required consent and US-country restriction remain usable on desktop/mobile",
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    ".context/ux-layout-evidence.json",
    json({
      timestamp: new Date().toISOString(),
      baseUrl,
      results,
      pageErrors: errors,
      walletTransactions: 0,
      verificationHash,
      verificationFundingHash,
    }),
  );
  console.log(json(results));
} catch (e) {
  console.error(safeError(e));
  process.exitCode = 1;
} finally {
  await browser.close();
  delete process.env.LAYOUT_WALLET_PRIVATE_KEY;
}
