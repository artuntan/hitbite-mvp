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
| `pnpm sync:contracts`               | Regenerate `lib/generated/` from the Foundry build      |

`pnpm test:e2e` starts the production server (`pnpm start -p 3457`) on http://127.0.0.1:3457, so
**`pnpm build` must run before `pnpm test:e2e`**. The dedicated port avoids reusing an unrelated
`next dev` on 3000. Locally an already-running server on that port is reused; in CI (`CI=1`) a
fresh one is started and an HTML report is written to `playwright-report/`. Override the port
with `E2E_PORT=4000 pnpm test:e2e`.

---

## Contract sync

`lib/generated/abis.ts` and `lib/generated/addresses.ts` are **generated and committed**. Vercel's
build root is `web/`, which has no Foundry toolchain, so the ABIs and addresses have to be in the
source tree rather than produced during the build.

```bash
cd ../contracts && forge build      # or: make build-contracts, from the repo root
cd ../web       && pnpm sync:contracts
```

Re-run it whenever any of these change:

- a contract's **interface** — a function, event or custom error added, removed or renamed;
- a **deployment** — after `make deploy CHAIN=anvil` or `make deploy CHAIN=base-sepolia` writes a
  new `contracts/deployments/<network>.json` (a fresh Anvil rewrites `deployBlock` and `timestamp`,
  so expect a diff);

and then commit the result. Nothing else in the app writes these files.

The script refuses to produce output it cannot vouch for, and says what to do about it:

| Situation                                                | What happens                                             |
| -------------------------------------------------------- | -------------------------------------------------------- |
| `contracts/out` missing                                  | Fails with the `forge build` command to run              |
| An artefact has no ABI, or an empty one                  | Fails naming the artefact                                |
| An address or transaction hash is malformed              | Fails naming the field                                   |
| A deployment file targets a chain other than 84532/31337 | Fails: this project is testnet-only (BUILD_PROMPT.md §2) |
| A deployment file's name disagrees with its `chainId`    | Fails: the file name must not lie about its contents     |

There is a second, independent check. `lib/chains.ts` assigns the generated `deployments` object to
`Partial<Record<SupportedChainId, DeploymentRecord>>`, where `SupportedChainId` is the literal union
`84532 | 31337`. A deployment on any other chain therefore also fails `pnpm typecheck`.

---

## Data layer

The NAV engine writes four documents into `public/data/`. `lib/data.ts` reads them **server-side**
and returns them parsed and typed.

| Document           | Reader                    | Contents                                                     |
| ------------------ | ------------------------- | ------------------------------------------------------------ |
| `nav.json`         | `getNavDocument()`        | NAV per token, portfolio analytics, distribution yield, fees |
| `holdings.json`    | `getHoldingsDocument()`   | The simulated reference book, position by position           |
| `nav_history.json` | `getNavHistoryDocument()` | One entry per calendar day since inception                   |
| `scenarios.json`   | `getScenariosDocument()`  | Parallel yield shifts and the CDS-shock mapping              |
| `attestation.json` | `await readAttestation()` | **Not committed.** See below.                                |

Three things about this layer are deliberate.

**Money is an integer.** The engine publishes a display string and, next to it, the six-decimal
integer the contract stores (PLAN.md D22). `lib/format.ts` parses the string _exactly_ with
`parseFixed` and formats from the integer; no money value is ever routed through a JavaScript
number. `previewSubscribeTokens` and `previewRedeemUsdc` reproduce the contract's truncating
division, so a quoted amount is the amount that settles.

**The schemas are strict.** `lib/schemas.ts` mirrors `engine/nav_engine/schemas.py`, whose output
models are `extra="forbid"`. An engine that starts emitting an unfamiliar field fails the build
here rather than reaching a page unnoticed. If the engine's output changed on purpose, update
`lib/schemas.ts` in the same commit.

**`attestation.json` does not exist yet, and that is not an error.** Signing it needs the real
`ATTESTOR_PRIVATE_KEY`, held by the founders; publishing a signature from a throwaway key would put
something in the repository that looks like proof and is not (PLAN.md D34). `readAttestation()`
returns a discriminated union, so a caller cannot reach the document without handling the absent
branch, and `/api/attestation` answers **200** with `status: "not_published"` plus the command that
creates it. Run `make attest` from the repository root and redeploy to publish one.

The four committed documents are **statically imported**, not read from disk: they change only when
a deploy changes them, a static import cannot silently 404 on Vercel's CDN-served `public/`, and a
malformed document becomes a build failure instead of a 500 in front of a reviewer.

`lib/data.ts` imports `node:fs/promises`, which means importing it from a client component breaks
the build. That is intentional — public pages read through it and must stay server components.

---

## Public API

Five read-only JSON endpoints. They are the partner integration surface
(`PARTNER_INTEGRATION.md`): no credentials, no privileged variant, `Access-Control-Allow-Origin: *`,
and `Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=300` so a poller hits
the CDN rather than a function.

| Route              | Returns                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| `/api/nav`         | `nav.json`, verbatim                                                       |
| `/api/holdings`    | `holdings.json`, verbatim                                                  |
| `/api/attestation` | `{ status: "published", document }` or `{ status: "not_published", … }`    |
| `/api/stats`       | Published figures + NAV history + on-chain reads + the NAV agreement check |
| `/api/events`      | Indexed events from the deploy block, filterable, paged by cursor          |

Every response is `{ "ok": true, "data": … }`. Every failure is

```json
{ "ok": false, "error": { "code": "…", "message": "…", "hint": "…" } }
```

with `code` one of `bad_request`, `invalid_document`, `not_found`, `chain_unavailable`,
`internal_error`. Errors are sent `no-store`, so a transient RPC failure is never cached for a
minute. Responses are validated against their own zod schema before they are sent.

```bash
curl -s http://localhost:3000/api/nav       | jq '.data.nav'
curl -s http://localhost:3000/api/holdings  | jq '.data.positions[] | {name, market_value_usd}'
curl -s http://localhost:3000/api/attestation | jq '.data.status'
curl -s http://localhost:3000/api/stats     | jq '{nav: .data.nav.per_token_usd, chain: .data.chain.status, agrees: .data.nav_agreement.matches}'
curl -s 'http://localhost:3000/api/events?limit=5' | jq '.data.events[] | {name, block_number}'
```

### What `/api/stats` can and cannot say

It always returns the published half: NAV, portfolio analytics, distribution yield, the fee
schedule and the NAV history series. The on-chain half is a discriminated union — `status: "ok"`
with the contract's own integers, or `status: "unavailable"` with the reason. It never invents a
zero when an RPC times out. `holders` is a real count now, folded from `Transfer` logs and excluding
the zero address; it is reported as a floor when index coverage is incomplete, and is `null` only
when no index could be built. `data.activity` carries the distribution, verification, pause and
daily-flow aggregates.

`nav_agreement` is the check BUILD_PROMPT.md §13 asks for — the engine's `nav.usdc_6dec` against
the contract's `nav()`, compared as integers. `matches` is `null` (not `false`) when there is
nothing to compare against: "we could not check" and "the check failed" are different facts.

### Reading `/api/events`

Indexed from the recorded `deployBlock`, chunked, cached for 60 seconds, no database (D10). Filter
with `?event=` (repeatable and comma-separated) and `?account=`, which matches an address in every
argument position rather than only the first indexed one. Page with `?cursor=`, `?limit=` (1–200,
default 50) and `?order=`.

The cursor is a position, `chainId:blockNumber:logIndex`, and exclusive — new events at the head do
not shift the pages behind it, and a cursor from another chain is a 400 rather than a silent
misread.

Read `coverage` before trusting a result: it reports completeness, any range that could not be read
and why, duplicates dropped, reorg conflicts, the cache age, and whether a stale index is being
served after a failed rebuild. `limitations` is derived from that build, not a fixed disclaimer. A
range the node refuses becomes a named gap, never a short list that looks complete.

---

## Chains and the wallet

Two chain ids exist for this app and no others: **Base Sepolia (84532)** and **Anvil (31337)**.
`lib/chains.ts` enforces that three ways — `SupportedChainId` is the literal union `84532 | 31337`;
a module-load check throws if a mainnet id were ever added to it; and `assertRpcIsConfiguredChain`
asks the RPC for `eth_chainId` and refuses to read from it if the answer is not the configured
testnet, which is what catches a `SERVER_RPC_URL` pointed somewhere it should not be.

`lib/wagmi.ts` is the wallet config and carries `"use client"`. That is enforcement, not decoration:
a server component importing `wagmiConfig` gets a client reference it cannot call, so the wallet
bundle cannot drift onto a public page by accident. The public pages — `/`,
`/transparency` and `/stats` — render from JSON and the event index and import nothing from it.
`/rules` and `/risks` join them in Phase 9.

`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is **optional**. Without it, WalletConnect's relay is
unavailable, so only injected browser-extension wallets (MetaMask, Rabby, Brave) are offered — which
is enough to run the entire demo. `WALLETCONNECT_ENABLED` and `WALLETCONNECT_STATUS_NOTE` are
exported so the interface can say so rather than leave a gap.

---

## Environment

Copy the web block of the repository-root `.env.example` into `web/.env.local`. Only
`NEXT_PUBLIC_*` values reach the browser; nothing secret belongs in one.

| Variable                               | Default                      | Used for                                                    |
| -------------------------------------- | ---------------------------- | ----------------------------------------------------------- |
| `NEXT_PUBLIC_CHAIN`                    | `base-sepolia`               | `base-sepolia` or `anvil`. Anything else throws on startup. |
| `NEXT_PUBLIC_RPC_URL`                  | the chain's own              | Browser reads and wallet transactions                       |
| `NEXT_PUBLIC_EXPLORER_URL`             | Basescan Sepolia             | Explorer links in toasts and on the transparency page       |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | unset                        | Optional; enables WalletConnect wallets                     |
| `SERVER_RPC_URL`                       | falls back to the public URL | Server-side reads in `/api/stats` and `/api/events`         |

`NEXT_PUBLIC_CHAIN` throws on an unrecognised value instead of falling back, because a silent
fallback would make the network badge lie about which chain the numbers came from.

## Deployment (Vercel)

`vercel.json` pins the framework, the install and build commands, and a set of response headers
(`X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`,
`Strict-Transport-Security`). Set the Vercel project's **root directory** to `web/` and its
environment variables from the table above. `X-Frame-Options: DENY` means the app cannot run inside
a Safe App iframe; the wallet list does not offer Safe for that reason.
