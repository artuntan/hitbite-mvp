import { chromium, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { walletPage } from "../tests/browser/wallet.ts";
import { context, json, safeError } from "./runtime.ts";

const baseUrl =
  process.env.UI_BASE_URL ||
  process.env.E2E_BASE_URL ||
  "http://localhost:3000";
const browser = await chromium.launch();
const errors: string[] = [];
const results: { step: string; passed: boolean }[] = [];
mkdirSync(".context", { recursive: true });
try {
  await context();
  const investor = await walletPage(browser, "UI_WALLET_PRIVATE_KEY", baseUrl);
  const page = investor.page;
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(baseUrl + "/app");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: /02 Verify/ }).click();
  await expect(
    page.getByRole("heading", { name: "Verify your eligibility." }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: /01 Connect/ }).click();
  await page.screenshot({
    path: ".context/step-1-connect.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Continue to verify →" }).click();
  const already = await page
    .getByRole("heading", { name: "Your wallet is verified." })
    .isVisible();
  if (!already) {
    await page.getByLabel("Full name").fill("Test UI Applicant");
    await page.getByLabel("Country of residence").selectOption("840");
    await expect(
      page.getByRole("alert").filter({ hasText: "Not available to residents" }),
    ).toContainText("Not available to residents");
    await page.getByLabel("Country of residence").selectOption("826");
    await page.getByRole("checkbox", { name: /professional investor/ }).check();
    await page.getByRole("button", { name: "Sign & start review" }).click();
    await expect(
      page.getByText("Pending · 10-second simulated review"),
    ).toBeVisible({ timeout: 10000 });
    await page.screenshot({
      path: ".context/step-2-review.png",
      fullPage: true,
    });
    await expect(
      page.getByRole("heading", { name: "Your wallet is verified." }),
    ).toBeVisible({ timeout: 60000 });
  }
  results.push({
    step: already
      ? "Connect and existing verified registry status"
      : "Connect and simulated review via UI",
    passed: true,
  });
  await page.screenshot({
    path: ".context/step-2-verified.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Continue to subscribe →" }).click();
  await page.getByLabel("USDC amount").fill("0.2");
  const approve = page.getByRole("button", {
    name: "Approve USDC",
    exact: true,
  });
  if (await approve.isEnabled()) {
    await approve.click();
    await expect(page.getByTestId("receipt")).toHaveCount(1, {
      timeout: 30000,
    });
  }
  await expect(
    page.getByRole("button", { name: "Subscribe", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(
    page.getByText("Subscribed", { exact: false }).first(),
  ).toBeVisible({ timeout: 30000 });
  await page.screenshot({
    path: ".context/step-3-subscribe.png",
    fullPage: true,
  });
  results.push({ step: "Approve and subscribe via UI", passed: true });
  await page.getByRole("button", { name: "View your position →" }).click();
  const issuer = await walletPage(browser, "ISSUER_PRIVATE_KEY", baseUrl);
  await issuer.page.goto(baseUrl + "/admin");
  await issuer.page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(
    issuer.page.getByRole("heading", { name: "Fund a coupon" }),
  ).toBeVisible({ timeout: 30000 });
  await issuer.page.getByLabel("Coupon amount").fill("0.04");
  await issuer.page
    .getByRole("button", { name: "Approve coupon funding", exact: true })
    .click();
  await expect(
    issuer.page.getByRole("button", { name: "Distribute coupon", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await issuer.page
    .getByRole("button", { name: "Distribute coupon", exact: true })
    .click();
  await expect(issuer.page.getByText(/CouponDistributed/).first()).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByRole("button", { name: "Claim coupons", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await page
    .getByRole("button", { name: "Claim coupons", exact: true })
    .click();
  await expect(page.getByText(/CouponClaimed/).first()).toBeVisible({
    timeout: 30000,
  });
  await page.screenshot({ path: ".context/step-4-hold.png", fullPage: true });
  results.push({
    step: "Admin coupon distribution and investor claim via UI",
    passed: true,
  });
  await page.getByRole("button", { name: "Continue to redeem →" }).click();
  await page.getByRole("button", { name: "Use full token balance" }).click();
  await page
    .getByRole("button", { name: "Redeem tokens", exact: true })
    .click();
  await expect(page.getByText(/Redeemed/).first()).toBeVisible({
    timeout: 30000,
  });
  await page.screenshot({ path: ".context/step-5-redeem.png", fullPage: true });
  results.push({ step: "Full redemption via UI", passed: true });
  await issuer.page.getByLabel("Vault funding amount").fill("0.1");
  await issuer.page
    .getByRole("button", { name: "Transfer USDC to vault", exact: true })
    .click();
  await expect(issuer.page.getByText(/Transfer/).last()).toBeVisible({
    timeout: 30000,
  });
  await issuer.page.screenshot({
    path: ".context/admin-issuer.png",
    fullPage: true,
  });
  await page.goto(baseUrl + "/transparency");
  await page.getByRole("button", { name: "Verify signature" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Signature verified" }),
  ).toContainText("Signature verified", {
    timeout: 15000,
  });
  await page.screenshot({
    path: ".context/transparency-verified.png",
    fullPage: true,
  });
  results.push({ step: "Client-side signature verification", passed: true });
  await page.getByRole("checkbox", { name: "Walkthrough" }).check();
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "Walkthrough" }),
  ).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseUrl + "/app");
  await page.getByRole("button", { name: /02 Verify/ }).click();
  await expect(
    page.getByRole("heading", { name: "Your wallet is verified." }),
  ).toBeVisible({ timeout: 30000 });
  await page.screenshot({
    path: ".context/flow-mobile-verified.png",
    fullPage: true,
  });
  if (
    await page
      .locator("body")
      .evaluate((e) => e.scrollWidth > window.innerWidth)
  )
    throw new Error("Mobile document overflow.");
  if (errors.length)
    throw new Error("Browser runtime errors: " + errors.length);
  results.push({
    step: "Mobile layout and persisted walkthrough",
    passed: true,
  });
  writeFileSync(
    ".context/ui-evidence.json",
    json({
      timestamp: new Date().toISOString(),
      baseUrl,
      chainId: investor.ctx.chain.id,
      wallet: investor.account.address,
      verificationWasFresh: !already,
      kind: "Automated injected-wallet browser test; not founder acceptance",
      results,
      pageErrors: errors,
    }),
  );
  console.log(json(results));
} catch (e) {
  for (const c of browser.contexts())
    for (const p of c.pages()) {
      await p.screenshot({ path: ".context/ui-failure.png", fullPage: true });
      console.log((await p.locator("body").innerText()).slice(0, 6500));
    }
  console.error(safeError(e));
  process.exitCode = 1;
} finally {
  await browser.close();
}
