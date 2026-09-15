/**
 * Screenshot generator, not a test.
 *
 * BUILD_PROMPT section 11 asks for a screenshot of each page in light and dark. This writes them to
 * `docs/screenshots/` so the README and the reviewer packet can use them.
 *
 * It is excluded from `pnpm test:e2e` by `testIgnore` in playwright.config.ts, because a failure
 * here means "a picture is missing", not "the app is broken", and mixing the two makes a red suite
 * ambiguous. Run it deliberately:
 *
 *     pnpm build && pnpm screenshots
 *
 * The pages are captured with no wallet connected, which is what a reviewer sees first and the only
 * state reachable without a funded key.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

// Playwright runs from web/, so the repository root is one level up.
const OUT = path.resolve(process.cwd(), "../docs/screenshots");

const PAGES = [
  { slug: "overview", path: "/" },
  { slug: "transparency", path: "/transparency" },
  { slug: "verify", path: "/verify" },
  { slug: "subscribe", path: "/subscribe" },
  { slug: "portfolio", path: "/portfolio" },
  { slug: "stats", path: "/stats" },
  { slug: "rules", path: "/rules" },
  { slug: "risks", path: "/risks" },
  { slug: "developers", path: "/developers" },
  { slug: "admin", path: "/admin" },
] as const;

const THEMES = ["light", "dark"] as const;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

for (const theme of THEMES) {
  for (const page of PAGES) {
    test(`${page.slug} — ${theme}`, async ({ page: browserPage }) => {
      // next-themes reads this before paint, so the page renders in the right theme from the first
      // frame rather than flashing and settling.
      await browserPage.addInitScript(
        (value) => window.localStorage.setItem("theme", value),
        theme,
      );
      await browserPage.setViewportSize({ width: 1280, height: 900 });

      const response = await browserPage.goto(page.path, { waitUntil: "networkidle" });
      expect(response?.status(), `${page.path} should render`).toBeLessThan(400);

      // Charts animate in on some pages; give layout a beat so the capture is not mid-transition.
      await browserPage.waitForTimeout(400);

      await browserPage.screenshot({
        path: path.join(OUT, `${page.slug}-${theme}.png`),
        fullPage: true,
      });
    });
  }
}
