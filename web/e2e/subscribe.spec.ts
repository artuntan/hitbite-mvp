import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { ACTIVE_CHAIN, hasDeployment } from "../lib/chains";
import { FOOTER_DISCLAIMER, TESTNET_BANNER, TOKEN } from "../lib/copy";
import { formatTokens, formatUsdcExact, parseFixed, previewSubscribeTokens } from "../lib/format";
import { navDocumentSchema } from "../lib/schemas";

/**
 * `/subscribe` (BUILD_PROMPT 7.2), without a wallet.
 *
 * No wallet is faked. Injecting an EIP-1193 stub would test the stub, not the page, and every
 * signature path already has unit coverage in `lib/tx.test.ts`. What is worth asserting from a
 * browser is everything a person sees *before* they connect one:
 *
 *  - the page renders, with the mandatory testnet chrome;
 *  - every gate is present and carries an explanation rather than only a disabled button;
 *  - the quote reproduces `previewSubscribeTokens` exactly, including the truncation (PLAN.md D52),
 *    read back off the rendered page and recomputed here from the same integers.
 *
 * Runs against a production build: `playwright.config.ts` starts `pnpm start`, so `pnpm build` must
 * come first.
 */

const navFixture = navDocumentSchema.parse(
  JSON.parse(readFileSync(path.join(__dirname, "..", "public", "data", "nav.json"), "utf8")),
);

/**
 * Whether the chain this build points at has a recorded deployment. Without one the page disables
 * the flow and quotes indicatively from the published NAV, which is a state worth asserting in its
 * own right — it is what a reviewer sees on a fresh clone.
 */
const DEPLOYED = hasDeployment();

/** Every condition the page promises to explain. */
const GATE_LABELS = [
  "Wallet connected",
  `Connected to ${ACTIVE_CHAIN.label}`,
  `${TOKEN.symbol} deployed on ${ACTIVE_CHAIN.label}`,
  "Token not paused",
  "Wallet verified in the identity registry",
  "At or above the minimum subscription",
  "Enough test USDC",
  "Allowance covers the subscription",
] as const;

function collectPageProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

async function setAmount(page: Page, value: string) {
  const field = page.getByLabel("Amount to subscribe");
  await field.fill(value);
  // The quote is derived synchronously from the input, but give React a frame to commit it.
  await expect(page.getByTestId("quote-amount")).not.toBeEmpty();
}

/** The NAV the page says it used, as the 6-decimal integer the contract would hold. */
async function renderedNav6(page: Page): Promise<bigint> {
  const text = (await page.getByTestId("quote-nav").innerText()).trim();
  expect(text, "the quote must name the NAV it used").toMatch(/ USDC$/);
  return parseFixed(text.replace(" USDC", "").replace(/,/g, ""), 6);
}

test.describe("/subscribe without a wallet", () => {
  test("renders the page, the testnet chrome and the no-wallet state", async ({ page }) => {
    const problems = collectPageProblems(page);

    const response = await page.goto("/subscribe");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Subscribe/);

    // Mandatory on every page (BUILD_PROMPT section 15).
    await expect(page.getByText(TESTNET_BANNER)).toBeVisible();
    await expect(page.getByText(FOOTER_DISCLAIMER)).toBeVisible();

    await expect(page.getByRole("heading", { name: "Subscribe", level: 1 })).toBeVisible();

    // The no-wallet state: a prompt with a way forward, not an empty form.
    await expect(page.getByText("Connect a wallet", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /connect wallet/i }).first()).toBeVisible();

    // Nothing can be signed, and the primary control says so by being disabled — and by naming
    // what it is waiting for rather than leaving somebody to guess.
    await expect(page.getByTestId("primary-action")).toBeDisabled();
    await expect(page.getByTestId("blocker-summary")).toContainText(/waiting on/i);

    // With no wallet the allowance is unknown, so the flow is presented as the two transactions it
    // is for a first-time subscriber rather than as one that grows a second step on connect.
    await expect(page.getByTestId("primary-action")).toHaveAttribute("data-action", "approve");
    await expect(page.getByRole("listitem").filter({ hasText: "Approve USDC" })).toHaveCount(1);

    expect(problems, `console output on /subscribe:\n${problems.join("\n")}`).toEqual([]);
  });

  test("every gate is listed with an explanation, not just a disabled button", async ({ page }) => {
    await page.goto("/subscribe");

    const card = page.getByTestId("gate-card");
    await expect(card).toBeVisible();

    for (const label of GATE_LABELS) {
      const row = card.locator("li").filter({ hasText: label });
      await expect(row, `gate "${label}" should be listed`).toHaveCount(1);
      // A status word, never colour alone.
      await expect(row).toContainText(/Satisfied|In the way|Not checked yet|Cannot be checked/);
      // And a sentence explaining it: the shortest gate copy on the page is well over 40 chars.
      const text = (await row.innerText()).replace(label, "");
      expect(text.length, `gate "${label}" should explain itself`).toBeGreaterThan(40);
    }

    // The disconnected wallet is the first thing in the way, and it offers the way out.
    const walletRow = card.locator("li").filter({ hasText: "Wallet connected" });
    await expect(walletRow).toContainText("In the way");
    await expect(walletRow).toContainText("until a wallet is connected");

    // Whitelisting is on-chain, so the page always offers the route to verification.
    await expect(page.getByRole("link", { name: /verification/i })).toHaveAttribute(
      "href",
      "/verify",
    );
  });

  test("the fee line and the minimum are stated, and the fee is nothing", async ({ page }) => {
    await page.goto("/subscribe");

    await expect(page.getByTestId("quote-fee")).toHaveText("0.000000 USDC");
    await expect(page.getByText("hbTRS charges nothing to subscribe")).toBeVisible();

    // Ongoing fees are named so "no fee" cannot be read as "no costs".
    await expect(
      page.getByText(`${navFixture.fees.management_fee_pct_pa}%`, { exact: false }).first(),
    ).toBeVisible();

    // The minimum is read from the contract, so it is either a number or an honest refusal.
    const minimum = (await page.getByTestId("quote-minimum").innerText()).trim();
    expect(minimum === "Not readable" || / USDC$/.test(minimum)).toBe(true);
    expect(DEPLOYED || minimum === "Not readable").toBe(true);
  });

  test("the preview reproduces previewSubscribeTokens exactly, truncation included", async ({
    page,
  }) => {
    await page.goto("/subscribe");

    const cases = [
      // whole, and comfortably above any plausible minimum
      { typed: "1000", amount6: 1_000_000_000n },
      // six decimals exactly: the finest amount USDC can express
      { typed: "1234.567891", amount6: 1_234_567_891n },
      // thousands separators are tolerated, because people paste them
      { typed: "12,500.5", amount6: 12_500_500_000n },
      // a seventh decimal is dropped, never rounded up (D52)
      { typed: "100.1234567", amount6: 100_123_456n },
    ] as const;

    for (const testCase of cases) {
      await setAmount(page, testCase.typed);

      const nav6 = await renderedNav6(page);
      const expectedTokens = previewSubscribeTokens(testCase.amount6, nav6);

      await expect(
        page.getByTestId("quote-amount"),
        `"${testCase.typed}" should be sent as ${formatUsdcExact(testCase.amount6)} USDC`,
      ).toHaveText(`${formatUsdcExact(testCase.amount6)} USDC`);

      await expect(
        page.getByTestId("quote-tokens"),
        `"${testCase.typed}" at NAV ${nav6} should mint ${expectedTokens} wei of ${TOKEN.symbol}`,
      ).toHaveText(`${formatTokens(expectedTokens, 6)} ${TOKEN.symbol}`);
    }

    // The dropped decimal is stated, not silently absorbed.
    await expect(page.getByText(/Extra decimals were dropped/)).toBeVisible();
  });

  test("an unusable amount is refused in words before anything is signed", async ({ page }) => {
    await page.goto("/subscribe");

    const field = page.getByLabel("Amount to subscribe");

    await field.fill("not a number");
    await expect(page.getByText("Enter a number, for example 1000 or 1000.50.")).toBeVisible();
    await expect(field).toHaveAttribute("aria-invalid", "true");

    // Truncates to zero, which `subscribe` rejects with `ZeroAmount`.
    await field.fill("0.0000004");
    await expect(page.getByText(/Enter an amount above zero/)).toBeVisible();

    await field.fill("1000");
    await expect(field).not.toHaveAttribute("aria-invalid", "true");
  });
});

test.describe("/subscribe with no deployment on the active chain", () => {
  test.skip(DEPLOYED, "a deployment is recorded for this chain, so the flow is live");

  test("says so, disables the flow and labels the quote indicative", async ({ page }) => {
    await page.goto("/subscribe");

    const alert = page.getByTestId("chain-unavailable");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(ACTIVE_CHAIN.label);
    await expect(alert).toContainText(/nothing here can be signed/i);

    await expect(page.getByTestId("quote-nav-source")).toHaveText("Indicative");

    // With no chain to read, the quote falls back to the engine's published NAV — the same
    // 6-decimal integer `/api/nav` serves, formatted the same way (PLAN.md D22).
    await expect(page.getByTestId("quote-nav")).toHaveText(
      `${formatUsdcExact(BigInt(navFixture.nav.usdc_6dec))} USDC`,
    );

    // Every action is off, and the faucet explains why rather than reverting.
    await expect(page.getByTestId("primary-action")).toBeDisabled();
    await expect(page.getByTestId("faucet-card").getByRole("button")).toBeDisabled();
    await expect(page.getByTestId("faucet-card")).toContainText(
      /no test USDC contract recorded|Connect a wallet to mint/i,
    );
  });
});
