import { expect, test } from "@playwright/test";

test("home page renders the testnet placeholder", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/HitBite/);
  await expect(page.getByText("Testnet")).toBeVisible();
});
