# HitBite MVP — web

Next.js 15 (App Router) front end for the HitBite testnet MVP. Testnet demonstration only;
simulated portfolio and attestation, not an offer of securities.

## Requirements

- Node.js >= 20 (CI uses Node 22)
- pnpm 10.22 (`packageManager` field; Corepack or `npm i -g pnpm@10.22.0`)
- Playwright's Chromium for e2e tests: `pnpm exec playwright install chromium`

## Commands

| Command                             | What it does                                            |
| ----------------------------------- | ------------------------------------------------------- |
| `pnpm install --frozen-lockfile`    | Install dependencies from the lockfile                  |
| `pnpm dev`                          | Start the dev server on http://localhost:3000           |
| `pnpm lint` / `pnpm lint:fix`       | ESLint (next core-web-vitals + typescript)              |
| `pnpm format:check` / `pnpm format` | Prettier check / write                                  |
| `pnpm typecheck`                    | `tsc --noEmit`                                          |
| `pnpm test` / `pnpm test:watch`     | Vitest unit tests (`lib/**/*.test.ts`, `tests/unit/**`) |
| `pnpm build`                        | Production build                                        |
| `pnpm test:e2e`                     | Playwright smoke tests (chromium)                       |

`pnpm test:e2e` starts the production server (`pnpm start -p 3457`) on http://127.0.0.1:3457, so
**`pnpm build` must run before `pnpm test:e2e`**. The dedicated port avoids reusing an unrelated
`next dev` on 3000. Locally an already-running server on that port is reused; in CI (`CI=1`) a
fresh one is started and an HTML report is written to `playwright-report/`. Override the port
with `E2E_PORT=4000 pnpm test:e2e`.
