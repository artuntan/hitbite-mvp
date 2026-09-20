import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  { settings: { next: { rootDir: "app/" } } },
  globalIgnores(["app/.next/**", "app/next-env.d.ts", ".context/**", "contracts/lib/**"]),
]);
