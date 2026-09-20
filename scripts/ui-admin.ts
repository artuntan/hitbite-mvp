import { chromium, expect } from "@playwright/test";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { writeFileSync } from "node:fs";
import { walletPage } from "../tests/browser/wallet.ts";
import { hBTokenAbi, identityRegistryAbi } from "../packages/config/abi.ts";
import {
  context,
  readDeployment,
  transact,
  json,
  safeError,
} from "./runtime.ts";
const baseUrl =
  process.env.UI_BASE_URL ||
  process.env.E2E_BASE_URL ||
  "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await context();
const d = readDeployment(ctx.name);
let paused = false;
const target = privateKeyToAccount(generatePrivateKey()).address;
try {
  const registrar = await walletPage(browser, "REGISTRAR_PRIVATE_KEY", baseUrl);
  const p = registrar.page;
  await p.goto(baseUrl + "/admin");
  await p.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await expect(
    p.getByRole("heading", { name: "Wallet eligibility" }),
  ).toBeVisible({ timeout: 30000 });
  await p.getByLabel("Wallet address", { exact: true }).fill(target);
  await p.getByLabel("Country of residence").selectOption("36");
  await p.getByRole("button", { name: "Verify wallet", exact: true }).click();
  await expect(p.getByTestId("receipt")).toHaveCount(1, { timeout: 30000 });
  if (
    !(await ctx.client.readContract({
      address: d.addresses.IdentityRegistry,
      abi: identityRegistryAbi,
      functionName: "isVerified",
      args: [target],
    }))
  )
    throw new Error("UI registration not reflected on chain.");
  await p.getByRole("button", { name: "Revoke wallet", exact: true }).click();
  await expect(p.getByTestId("receipt")).toHaveCount(2, { timeout: 30000 });
  if (
    await ctx.client.readContract({
      address: d.addresses.IdentityRegistry,
      abi: identityRegistryAbi,
      functionName: "isVerified",
      args: [target],
    })
  )
    throw new Error("UI revocation not reflected on chain.");
  await p.screenshot({ path: ".context/admin-registrar.png", fullPage: true });
  await registrar.browserContext.close();
  const oracle = await walletPage(browser, "ORACLE_PRIVATE_KEY", baseUrl);
  await oracle.page.goto(baseUrl + "/admin");
  await oracle.page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(
    oracle.page.getByRole("heading", {
      name: "Publish NAV",
      exact: true,
      level: 2,
    }),
  ).toBeVisible({ timeout: 30000 });
  const nav = await ctx.client.readContract({
    address: d.addresses.HBToken,
    abi: hBTokenAbi,
    functionName: "navPerToken",
  });
  await oracle.page.getByLabel("New NAV").fill((Number(nav) / 1e6).toFixed(6));
  await oracle.page
    .getByRole("button", { name: "Publish NAV", exact: true })
    .click();
  await expect(oracle.page.getByTestId("receipt")).toHaveCount(1, {
    timeout: 30000,
  });
  await oracle.page.screenshot({
    path: ".context/admin-oracle.png",
    fullPage: true,
  });
  await oracle.browserContext.close();
  const issuer = await walletPage(browser, "ISSUER_PRIVATE_KEY", baseUrl);
  await issuer.page.goto(baseUrl + "/admin");
  await issuer.page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(
    issuer.page.getByRole("button", { name: "Pause token", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await issuer.page
    .getByRole("button", { name: "Pause token", exact: true })
    .click();
  paused = true;
  await expect(
    issuer.page.getByRole("button", { name: "Unpause token", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await issuer.page
    .getByRole("button", { name: "Unpause token", exact: true })
    .click();
  await expect(
    issuer.page.getByRole("button", { name: "Pause token", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  paused = false;
  writeFileSync(
    ".context/admin-ui-evidence.json",
    json({
      timestamp: new Date().toISOString(),
      baseUrl,
      steps: [
        "Registrar verify and revoke",
        "Oracle NAV publication",
        "Issuer pause and unpause",
      ],
      target,
    }),
  );
  console.log("All three operator roles exercised through the live UI.");
} catch (e) {
  console.error(safeError(e));
  process.exitCode = 1;
} finally {
  if (
    paused &&
    (await ctx.client.readContract({
      address: d.addresses.HBToken,
      abi: hBTokenAbi,
      functionName: "paused",
    }))
  )
    await transact(
      ctx,
      "ISSUER_PRIVATE_KEY",
      d.addresses.HBToken,
      hBTokenAbi,
      "unpause",
    );
  await browser.close();
}
