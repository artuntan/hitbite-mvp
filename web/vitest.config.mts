import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirrors the "@/*" path alias in tsconfig.json, so a test can import a module that uses it.
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
  test: {
    environment: "node",
    // components/ is included so the pure logic that lives beside a page — the subscribe
    // quote arithmetic and its gate table — is unit-tested and not left to Playwright alone.
    include: ["lib/**/*.test.ts", "components/**/*.test.ts", "tests/unit/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
});
