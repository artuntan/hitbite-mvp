/**
 * Screenshot generator config. Same server and browser as the test suite, but it runs only
 * `e2e/screenshots.spec.ts`, which the main config ignores. See that file for why they are split.
 */
import { defineConfig, devices } from "@playwright/test";

const port = process.env.E2E_PORT ?? "3457";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/screenshots.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm start -p ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
