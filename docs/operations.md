# Operations

Commands run from the repository root. These procedures target test networks only. See [the trust model](security-model.md) for privileged roles and failure modes.

## Local configuration

Copy `.env.example` to the ignored `.env`. The public simulated attestor is `0x60Be08C7e2dA3b9C1fe2955d237b8833C2D63254`; set `NEXT_PUBLIC_ATTESTOR_ADDRESS` to verify current records locally. Set `NEXT_PUBLIC_APP_URL=http://localhost:3000` for local eligibility requests. A local registrar additionally needs a funded key with `REGISTRAR_ROLE` and a random `VERIFICATION_SECRET` of at least 32 characters. Viewing and builds need no private keys.

Supported network selectors are `arc-testnet`, `base-sepolia` and `local`. Runtime and tooling validate RPC chain IDs; a fallback selector does not create a deployment. Arc uses native USDC for fees; transactions apply a minimum 20-gwei maximum fee. Mainnet is not configured.

## Verification firewall

The Vercel project `hitbite-testnet-v2` has a fixed-window rule matching path `/api/verify` and method `POST`: 20 requests per 60 seconds keyed by IP, with `rate_limit` action (HTTP 429). It applies at the edge, before the registrar function. See [provider behavior and limits](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).

Inspect current rules before changing them:

```sh
pnpm dlx vercel firewall rules list --project hitbite-testnet-v2
pnpm dlx vercel firewall diff --project hitbite-testnet-v2
```

To reproduce the rule on a new project, use the CLI's `firewall rules add` with conditions `{"type":"path","op":"eq","value":"/api/verify"}` and `{"type":"method","op":"eq","value":"POST"}`, action `rate_limit`, window `60`, requests `20` and keys `ip`. Review the draft diff before publishing. Do not duplicate the existing rule or overwrite unrelated drafts.

After publication, verify a bounded series of invalid requests returns 429 while the landing still returns 200. Allow the window to expire and check that normal input validation resumes. Use your own source IP; do not attempt load testing or send registrar transactions for this check. Preserve only statuses and timing, never credentials or submitted names.

## Protected NAV delivery

Main requires a PR and all four CI jobs. Daily NAV uses the short-lived `GITHUB_TOKEN`, not an administrator bypass or stored PAT. The repository allows Actions to create PRs; its default token remains read-only and only the NAV job grants the necessary `contents`, `pull-requests` and `actions` write permissions.

The publisher allows only `app/public/data/nav.json` and `app/public/data/attestation.json` to change. It opens an isolated branch/PR, explicitly dispatches CI, verifies a fresh successful run for that exact commit, then requests a normal protected merge. Explicit dispatch is needed because [events created by GITHUB_TOKEN have special trigger rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).

If CI, a concurrent main update, merge policy or deployment fails, the workflow fails visibly and leaves the PR for review. Inspect the chain receipt and signed records before rerunning or closing it. Do not disable protection to force publication. The on-chain NAV write is not rolled back by a failed JSON merge. The dedicated Vercel hook runs only after the snapshot PR merges and verifies the live publication hash.

## Deployment and publication


Use funded, separate, testnet-only role keys. `.env.example` documents every setting.

```sh
pnpm run deploy --chain arc-testnet --dry-run
pnpm run deploy --chain arc-testnet      # refuses to overwrite a confirmed deployment
pnpm verify:contracts --chain arc-testnet
pnpm fund:vault --chain arc-testnet --amount 10
pnpm sync:contracts
pnpm exec tsx scripts/cast-subscribe.ts  # real 0.5-USDC deployer subscription; not read-only

pnpm nav nav
pnpm nav push --dry-run
pnpm nav push
pnpm nav attest
```

`pnpm run deploy` uses `run` intentionally: plain `pnpm deploy` is pnpm's own workspace command. The cast wrapper signs only in memory and passes only the public signed transaction to `cast publish`; keys never enter argv. Contract ABIs and the application deployment manifest are generated with `pnpm sync:contracts`.

The [daily NAV workflow](../.github/workflows/nav.yml) runs at 07:00 UTC, publishes with the oracle, signs with the simulated attestor and opens a PR containing only the two confirmed JSON snapshots, explicitly dispatches the normal CI workflow, and merges the exact tested commit under main branch protection. A failed check or concurrent change to main leaves the PR open for operator review; automation never bypasses protection. It needs GitHub secrets `ORACLE_PRIVATE_KEY`, `ATTESTOR_PRIVATE_KEY` and repository variable `NEXT_PUBLIC_ATTESTOR_ADDRESS`. It runs on the default branch. A dedicated `VERCEL_DEPLOY_HOOK` secret and `NEXT_PUBLIC_APP_URL` repository variable trigger a production rebuild and verify that the live site serves the new publication. Manual prices must be reviewed separately. Monthly coupon automation is not enabled; the issuer funds distributions explicitly in Admin.

The Vercel project uses `app/` as its root with parent workspace files included. Build with `pnpm build`, install with `pnpm install --frozen-lockfile`, Node 22. Production is the only environment with registrar credentials. Preview deployments have no registrar signer or ticket secret. The only server credentials required in Production are `REGISTRAR_PRIVATE_KEY` and `VERIFICATION_SECRET`; do not upload issuer/oracle/attestor/E2E keys. Set public chain, app URL and expected attestor as documented. `.vercelignore` excludes local credentials and archived work.

## Reproduce the live acceptance run

`pnpm e2e` makes real testnet transactions. Configure two **fresh, distinct** funded wallets in `E2E_WALLET_A_PRIVATE_KEY` and `E2E_WALLET_B_PRIVATE_KEY`, plus the authorized issuer/registrar keys. The default is 1 USDC per subscription and 0.2 USDC total coupon funding. Each investor needs additional USDC for gas. Set `E2E_BASE_URL` to the live app origin.

For browser evidence, configure a separate funded `UI_WALLET_PRIVATE_KEY` and run:

```sh
pnpm exec playwright install chromium
pnpm test:ui
pnpm exec tsx scripts/ui-layout.ts       # read-only layout, navigation and fresh-wallet form checks
pnpm e2e
```

The browser test injects a test provider while keeping signing keys in the Node process. It performs actual API and Arc transactions and saves screenshots under `.context/`. It is not a substitute for a founder personally testing a real wallet extension. The E2E runner requires recent browser evidence, recorded founder acceptance and green CI for its exact source commit before touching the fresh investor wallets. It then verifies both wallets through the live API, approves/subscribes, distributes/claims coupons, redeems, checks restrictions, pauses and restores the token. It generates `STATUS.md` and public receipt evidence; failures remain visible. Rerunning a fresh-wallet acceptance run requires new wallet keys/funding.

After the founder explicitly confirms their own complete fresh-wallet flow, record the confirmation in `.context/founder-acceptance.json` with `confirmed: true`, an ISO `timestamp`, the exact `baseUrl`, and the actual `source`, `statement` and `scope`. The current confirmation is preserved in [the public acceptance record](../deployments/evidence/founder-acceptance.json); for a repeat run against the same deployment, copy that record to the local path. Do not manufacture a confirmation for a new deployment. The runner copies its provenance into the generated evidence separately from automated test results.

`pnpm test:transparency` checks the redesigned records page in Chromium without sending transactions: real published data/signatures, responsive layouts, downloads, clipboard, keyboard history and browser-only failure fixtures. Set `UI_BASE_URL` to test a local build; otherwise it uses the configured live URL.

`pnpm smoke` performs no transactions and never edits STATUS. Only `pnpm e2e` writes STATUS. [PROGRESS.md](../PROGRESS.md) is the append-only implementation/evidence log; [PLAN.md](../PLAN.md) records approved decisions and dated amendments. Founder acceptance is explicitly separate from automated checks. The generated STATUS is a dated acceptance record. The September 20 landing revision makes `/` the public introduction and keeps the approved investor workspace at `/app`; subsequent browser evidence is recorded in PROGRESS without rewriting historical STATUS by hand.

## Domains and frontend delivery


`/` is statically generated and uses the founder-supplied landing copy. Wallet providers and platform CSS live in the `(platform)` route group and are not loaded by the landing. NAV fetches after mount from `/data/nav.json`; absent, invalid, future-dated or over-48-hour data stays hidden. No wallet connection, analytics, third-party scripts or cookies are required. `next/font/local` serves local fonts; optimized/subset assets preserve their included font licenses. Next's `inlineCss` option removes the initial stylesheet round trip, at the cost of inlining styles into each document.

- The testnet is publicly reachable without an invitation or access request. Both landing actions always open `/app`; the former `NEXT_PUBLIC_APP_LIVE` presentation switch is removed. Transactions still use the existing self-service simulated verification, country restrictions and contract permissions.
- Production uses **https://hitbite.markets**. Both `NEXT_PUBLIC_SITE_URL` (canonical metadata, share images, robots and sitemap) and `NEXT_PUBLIC_APP_URL` (wallet metadata and verification origin) are configured to this origin in Vercel Production. The daily NAV workflow's `NEXT_PUBLIC_APP_URL` repository variable uses the same address. Rebuild after changing these values. Local development keeps `NEXT_PUBLIC_APP_URL=http://localhost:3000`.
- Vercel serves the apex domain directly; `www.hitbite.markets` redirects to the apex, matching the existing Next redirect. Never configure the apex to redirect back to www: that creates a redirect loop. DNS remains at the founder's registrar, with Vercel handling HTTPS. The previous Vercel public address redirects to the canonical domain so existing links reach the supported verification origin.
- The brief's `hello@hitbite.com` remains the contact address until a replacement mailbox is supplied. The landing has no GitHub links; the platform's Source link uses the public source repository. Public source access does not waive wallet eligibility requirements.
- `UI_BASE_URL=http://localhost:3000 pnpm test:landing` checks exact copy, public entry without access-request links, viewports, live/missing/stale NAV, reduced motion, navigation and share metadata/images. Test the optimized server with `pnpm start`.
- OG/Twitter images are generated with `next/og`; `robots.txt` allows the landing and Transparency and excludes Admin/API. The sitemap lists landing, app and Transparency. Bot-response tests validate metadata and image bytes; actual X/Slack account previews are separate from these checks.
