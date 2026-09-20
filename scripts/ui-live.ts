import assert from "node:assert/strict";
import { parseEventLogs } from "viem";
import { chromium, expect, type Route } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { walletPage } from "../tests/browser/wallet.ts";
import { hBTokenAbi } from "../packages/config/abi.ts";
import { units } from "../app/src/lib/chain.ts";
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
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text()))
      errors.push(message.text());
  });
  await page.goto(baseUrl + "/");
  await page
    .locator("main")
    .getByRole("link", { name: "Open the testnet", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect your wallet." }),
  ).toBeVisible();
  await page.screenshot({
    caret: "initial",
    path: ".context/step-1-connect.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();

  await expect(
    page.getByRole("heading", {
      name: /Verify your eligibility\.|Subscribe to hbTRS\./,
    }),
  ).toBeVisible({ timeout: 120000 });
  const already = await page
    .getByRole("heading", { name: "Subscribe to hbTRS." })
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
      caret: "initial",
      path: ".context/step-2-review.png",
      fullPage: true,
    });
    await expect(
      page.getByRole("heading", { name: "Subscribe to hbTRS." }),
    ).toBeVisible({ timeout: 60000 });
  }
  results.push({
    step: already
      ? "Connect and existing verified registry status"
      : "Connect and simulated review via UI",
    passed: true,
  });
  await page.screenshot({
    caret: "initial",
    path: ".context/step-2-verified.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("heading", { name: "Connect your wallet." }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Verify your eligibility." }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Investment steps" }),
  ).toHaveCount(0);
  await page.getByLabel("USDC amount").fill("0.2");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const steps = page.getByRole("list", { name: "Subscription transactions" });
    await expect(steps.getByRole("listitem")).toHaveCount(2);
    for (const indicator of await steps.locator(".step-indicator").all()) {
      const bounds = await indicator.boundingBox();
      assert(
        bounds &&
          bounds.width >= 22 &&
          Math.abs(bounds.width - bounds.height) < 0.5,
      );
      assert.equal(
        await indicator.evaluate(
          (e) =>
            e.scrollWidth > e.clientWidth || e.scrollHeight > e.clientHeight,
        ),
        false,
      );
    }
    assert.equal(
      await page.locator("body").evaluate((e) => e.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({
      caret: "initial",
      path: `.context/subscription-steps-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  const approve = page.getByRole("button", {
    name: "Approve USDC",
    exact: true,
  });
  if (await approve.isVisible()) {
    await approve.click();
    await expect(page.getByLabel("USDC amount")).toBeDisabled();
    await expect(page.locator(".approval-progress .done")).toContainText(
      "Approve USDC",
      { timeout: 120000 },
    );
  }
  await expect(
    page.getByRole("button", { name: "Subscribe", exact: true }),
  ).toBeEnabled({ timeout: 120000 });
  await expect(
    page.locator('.approval-progress [aria-current="step"]'),
  ).toContainText("Subscribe");
  await expect(
    page.locator(".approval-progress .done .step-indicator svg"),
  ).toBeVisible();
  await page.screenshot({
    caret: "initial",
    path: ".context/subscription-approved.png",
    fullPage: true,
  });
  results.push({
    step: "Numbered subscription steps stay circular and unclipped at three widths; approval advances the active step to Subscribe",
    passed: true,
  });
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(
    page.getByTestId("receipt").filter({ hasText: "Subscribed" }),
  ).toBeVisible({ timeout: 120000 });
  const subscriptionReceipt = await investor.ctx.client.getTransactionReceipt({
    hash: investor.transactions.at(-1)!,
  });
  const subscribed = parseEventLogs({
    abi: hBTokenAbi,
    eventName: "Subscribed",
    logs: subscriptionReceipt.logs,
  });
  if (subscribed[0]?.args.usdcIn !== 200_000n)
    throw new Error("The signed subscription differs from the entered amount.");
  await page.screenshot({
    caret: "initial",
    path: ".context/step-3-subscribe.png",
    fullPage: true,
  });
  results.push({ step: "Approve and subscribe via UI", passed: true });
  await expect(
    page.getByRole("heading", { name: "Portfolio", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".setup-progress")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Portfolio", exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await expect(page.locator(".activity-table")).toBeVisible({
    timeout: 120000,
  });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width > 800 ? 1050 : 844 });
    assert.equal(
      await page
        .locator("body")
        .evaluate((e) => e.scrollWidth > window.innerWidth),
      false,
      `Portfolio overflow at ${width}`,
    );
    await page.screenshot({
      caret: "initial",
      path: `.context/portfolio-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole("tab", { name: "Subscribe", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Redeem", exact: true }),
  ).toBeFocused();
  await expect(page.getByLabel("hbTRS amount")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByLabel("USDC amount")).toBeVisible();
  results.push({
    step: "Automatic workspace entry, remembered after reload, four viewport sizes and keyboard order tabs",
    passed: true,
  });
  const issuer = await walletPage(browser, "ISSUER_PRIVATE_KEY", baseUrl);
  await issuer.page.goto(baseUrl + "/admin");
  await issuer.page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(
    issuer.page.getByRole("heading", { name: "Fund a coupon" }),
  ).toBeVisible({ timeout: 120000 });
  await issuer.page.getByLabel("Coupon amount").fill("0.04");
  await issuer.page
    .getByRole("button", { name: "Approve coupon funding", exact: true })
    .click();
  await expect(
    issuer.page.getByRole("button", { name: "Distribute coupon", exact: true }),
  ).toBeEnabled({ timeout: 120000 });
  await issuer.page
    .getByRole("button", { name: "Distribute coupon", exact: true })
    .click();
  await expect(
    issuer.page.getByTestId("receipt").filter({ hasText: "CouponDistributed" }),
  ).toBeVisible({
    timeout: 120000,
  });
  const coupons = page.getByRole("region", {
    name: "Claimable coupons",
    exact: true,
  });
  const claim = coupons.getByRole("button", {
    name: "Claim coupons",
    exact: true,
  });
  await expect(claim).toBeEnabled({ timeout: 120000 });
  await page.getByRole("heading", { name: "Portfolio", exact: true }).click();
  await expect(page.getByRole("region", { name: "Coupon payout" })).toHaveCount(
    0,
  );
  assert.equal(
    await coupons.evaluate(
      (e) => !!e.closest('[aria-label="Account balances"]'),
    ),
    true,
  );
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width > 800 ? 1050 : 844 });
    assert.equal(
      await page.locator("body").evaluate((e) => e.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({
      caret: "initial",
      path: `.context/coupon-ready-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  // Delay only post-confirmation balance reads; transaction inclusion stays real.
  const beforeClaim = investor.transactions.length;
  const laggingHead = await investor.ctx.client.getBlockNumber({
    cacheTime: 0,
  });
  let receiptSeen = false;
  let delayedHeadReads = 0;
  const delayHead = async (route: Route) => {
    let requests: { method?: string; id?: number; params?: unknown[] }[];
    try {
      const body = route.request().postDataJSON();
      requests = Array.isArray(body) ? body : [body];
    } catch {
      return route.continue();
    }
    const headIds = requests
      .filter((r) => r?.method === "eth_blockNumber")
      .map((r) => r.id);
    const receiptIds = requests
      .filter(
        (r) =>
          r?.method === "eth_getTransactionReceipt" &&
          investor.transactions.length > beforeClaim &&
          r.params?.[0] === investor.transactions.at(-1),
      )
      .map((r) => r.id);
    if (!receiptIds.length && (!receiptSeen || !headIds.length))
      return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    const responses = (Array.isArray(body) ? body : [body]) as {
      id?: number;
      result?: unknown;
    }[];
    if (
      responses.some(
        (r) =>
          receiptIds.includes(r.id) &&
          (r.result as { blockNumber?: string } | null)?.blockNumber,
      )
    )
      receiptSeen = true;
    const change = (r: { id?: number; result?: unknown }) => {
      if (receiptSeen && headIds.includes(r.id) && r.result) {
        delayedHeadReads++;
        return { ...r, result: `0x${laggingHead.toString(16)}` };
      }
      return r;
    };
    await route.fulfill({
      response,
      json: Array.isArray(body) ? responses.map(change) : change(body),
    });
  };
  await page.route("**/*", delayHead);
  // Decline one wallet request in the browser only, then retry the actual claim.
  await page.evaluate(() => {
    const bridge = window as unknown as {
      testWalletRequest: (input: { method: string }) => Promise<unknown>;
    };
    const request = bridge.testWalletRequest;
    let decline = true;
    bridge.testWalletRequest = async (input) => {
      if (decline && input.method === "eth_sendTransaction") {
        decline = false;
        await new Promise((resolve) => setTimeout(resolve, 600));
        throw Object.assign(new Error("User rejected the request"), {
          code: 4001,
        });
      }
      return request(input);
    };
  });
  await claim.click();
  await expect(coupons.locator(".action-inline")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(coupons.locator("button")).toBeDisabled();
  await expect(coupons.getByRole("alert")).toContainText("Signature declined", {
    timeout: 120000,
  });
  assert.equal(investor.transactions.length, beforeClaim);
  await expect(claim).toBeEnabled();
  await claim.click();
  await expect(
    coupons.getByText("Claim confirmed", { exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await coupons.locator(".inline-confirmation summary").click();
  await expect(
    coupons.getByTestId("receipt").filter({ hasText: "CouponClaimed" }),
  ).toBeVisible({
    timeout: 120000,
  });
  await expect(coupons.getByTestId("portfolio-coupons")).toContainText(
    "0.000000",
    { timeout: 120000 },
  );
  await expect(coupons.locator(".action-inline")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const claimedReceipt = await investor.ctx.client.getTransactionReceipt({
    hash: investor.transactions.at(-1)!,
  });
  const displayedBlock = BigInt(
    (await page.locator(".workspace-status .mono").innerText()).slice(1),
  );
  assert(
    displayedBlock >= claimedReceipt.blockNumber &&
      claimedReceipt.blockNumber > laggingHead,
  );
  assert(delayedHeadReads > 0, "The delayed RPC-head fixture was exercised.");
  await page.unroute("**/*", delayHead);
  await expect(claim).toBeDisabled();
  await expect(coupons.getByRole("alert")).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 844 });
  assert.equal(
    await page.locator("body").evaluate((e) => e.scrollWidth > innerWidth),
    false,
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({
    caret: "initial",
    path: ".context/step-4-hold.png",
    fullPage: true,
  });
  results.push({
    step: "Coupon metric handles funded balance, wallet decline/retry, pending lock, real claim and zero balance despite a lagging RPC head",
    passed: true,
  });
  await page.getByRole("tab", { name: "Redeem", exact: true }).click();
  await page.getByRole("button", { name: "Use full token balance" }).click();
  await page
    .getByRole("button", { name: "Redeem tokens", exact: true })
    .click();
  await expect(page.getByLabel("hbTRS amount")).toBeDisabled();
  await expect(
    page.getByRole("tab", { name: "Subscribe", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByTestId("receipt").filter({ hasText: "Redeemed" }),
  ).toBeVisible({
    timeout: 120000,
  });
  await expect(
    page.getByRole("heading", { name: "Portfolio", exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await expect(
    page.getByRole("button", { name: "Your position", exact: true }),
  ).toContainText("0.00 USDC");
  await page.screenshot({
    caret: "initial",
    path: ".context/step-5-redeem.png",
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Portfolio", exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await expect(page.getByTestId("portfolio-value")).toContainText("0.000000");
  await expect(page.locator(".setup-progress")).toHaveCount(0);
  results.push({
    step: "Full redemption via UI; empty account remains in workspace after reload",
    passed: true,
  });
  await issuer.page.getByLabel("Vault funding amount").fill("0.1");
  await issuer.page
    .getByRole("button", { name: "Transfer USDC to vault", exact: true })
    .click();
  await expect(
    issuer.page
      .locator("section.card")
      .filter({
        has: issuer.page.getByRole("heading", {
          name: "Fund the vault",
          exact: true,
        }),
      })
      .getByTestId("receipt"),
  ).toBeVisible({
    timeout: 120000,
  });
  await issuer.page.screenshot({
    caret: "initial",
    path: ".context/admin-issuer.png",
    fullPage: true,
  });
  const nav = await investor.ctx.client.readContract({
    address: investor.deployment.addresses.HBToken,
    abi: hBTokenAbi,
    functionName: "navPerToken",
  });
  await page.goto(baseUrl + "/app");
  await expect(page.getByTestId("app-nav")).toContainText(units(nav, 6, 6), {
    timeout: 120000,
  });
  await page.goto(baseUrl + "/transparency");
  await expect(page.getByTestId("transparency-nav")).toContainText(
    units(nav, 6, 6),
    { timeout: 120000 },
  );
  const snapshot = await (
    await page.request.get(baseUrl + "/data/nav.json")
  ).json();
  if (snapshot.nav_units !== nav.toString())
    throw new Error("Published and displayed NAV differ.");
  results.push({
    step: "App and Transparency NAV agreement",
    passed: true,
  });

  await page.getByRole("button", { name: "Verify signature" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Signature verified" }),
  ).toContainText("Signature verified", {
    timeout: 15000,
  });
  await page.screenshot({
    caret: "initial",
    path: ".context/transparency-verified.png",
    fullPage: true,
  });
  results.push({ step: "Client-side signature verification", passed: true });
  await expect(page.getByRole("checkbox", { name: "Walkthrough" })).toHaveCount(
    0,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseUrl + "/app");

  await expect(
    page.getByRole("heading", { name: "Portfolio", exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await page.screenshot({
    caret: "initial",
    path: ".context/portfolio-mobile-empty.png",
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
    step: "Mobile layout and removed walkthrough control",
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
      transactions: [...investor.transactions, ...issuer.transactions],
      kind: "Automated injected-wallet browser test; not founder acceptance",
      results,
      pageErrors: errors,
    }),
  );
  console.log(json(results));
} catch (e) {
  for (const c of browser.contexts())
    for (const p of c.pages()) {
      await p.screenshot({
        caret: "initial",
        path: ".context/ui-failure.png",
        fullPage: true,
      });
      console.log((await p.locator("body").innerText()).slice(0, 6500));
    }
  console.error(safeError(e));
  process.exitCode = 1;
} finally {
  await browser.close();
}
