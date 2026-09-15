import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
// Dedicated port so a stray `next dev` on 3000 (common on shared machines) is never reused by mistake.
const port = process.env.E2E_PORT ?? "3457";
const baseURL = `http://127.0.0.1:${port}`;

// Runs against a production build: `pnpm build` must precede `pnpm test:e2e`.
export default defineConfig({
  testDir: "e2e",
  // screenshots.spec.ts is a generator, not a test: a missing picture is not a broken app, and
  // mixing the two makes a red suite ambiguous. Run it with `pnpm screenshots`.
  testIgnore: "**/screenshots.spec.ts",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm start -p ${port}`,
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
