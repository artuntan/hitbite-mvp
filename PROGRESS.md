# PROGRESS.md — dated log

Founders: read the latest entry first. "Needs from founders" items block only real-testnet checkpoints; everything else runs locally on Anvil.

## 2026-09-14/15 — Session 3: Phases 1–5 complete, engine reviewed and repaired

**Did**
- Verified the tree Session 2 left uncommitted by running it, not by trusting the report: 149 forge
  tests, 100 % line/statement/branch/function coverage on `src/`, 99 pytest tests, lint clean, and a
  full `nav-engine compute`. All green, so nothing was lost when that session died.
- Committed Phase 1 (contracts) and Phase 4 (NAV engine), then built the three remaining backend
  phases and landed them:
  - **Phase 2** — 7 fuzz properties, 9 stateful invariants over a 32 768-call campaign with
    `fail_on_revert = true` and zero reverts, a committed gas snapshot, Slither with no detector
    disabled (15 findings, 0 high, all triaged), and `SECURITY.md` with an 18-row threat model that
    says plainly what is *not* mitigated. Contract tests went 149 → 161 with coverage still 100 %.
    The suite was itself validated by mutation: three deliberate bugs were injected into `HBToken`
    and each was caught.
  - **Phase 3** — `Deploy`/`Seed`/`Config` scripts, `deployments/anvil.json`, Makefile targets, and a
    founder runbook. Verified on a real fresh Anvil: deploy, then seed twice, with `cast` assertions
    on every role, both demo wallets and the blocklist.
  - **Phase 5** — oracle push with a contract-read rail pre-check, EIP-191 attestation over canonical
    JSON, key handling that cannot leak through `repr` or an exception, and the two scheduled
    workflows. Engine tests 99 → 185, six against a real Anvil.
- Ran an adversarial review of the Phase 4 engine maths, which had 99 tests but had never been
  reviewed. Six lenses raised 36 findings; each went to a refuter that had to reproduce it by running
  code, and 21 survived. All 21 are now fixed, engine tests 185 → 385.
- Wrote `ARCHITECTURE.md`, `COMPLIANCE_RULES.md`, `RISKS.md`, and the README's real-vs-simulated
  table. Recorded D30–D48 in `PLAN.md`.

**Verified end to end on a local chain (the Phase 5 checkpoint, run by hand)**
- Fresh Anvil → `make deploy-local` → `make seed` → `make push`. Every contract address and every
  creation tx hash came out byte-identical to the committed `deployments/anvil.json`; only the
  timestamp moved, so D15's determinism claim holds.
- On-chain `nav()` returned `1003061` and `nav.json`'s `nav.usdc_6dec` is `1003061`. They match, so
  the Phase 5 checkpoint passes.
- Pushing a second time did nothing, as D30 requires: *"on-chain nav already equals 1003061 and was
  set on 2026-09-14 (UTC), on or after as_of 2026-09-14."*
- The attestation was signed with a throwaway key and then verified **with Foundry's
  `cast wallet verify`**, not with the `eth_account` library that produced it, so the signature is
  confirmed by an independent implementation of the same EIP-191 scheme viem uses in the browser.
  Flipping a single digit in the signed message made verification fail, as it must.

**Phase 6 (web) — shipped and measured**
- Design system, app shell, typed data layer, five public API routes, contract sync, and the
  Overview and Transparency pages. 80 unit tests and 19 Playwright tests.
- **Lighthouse, against a production build, as D16 requires:**

  | Page | Performance | Accessibility | Best practices |
  |---|---|---|---|
  | `/` | 97 | 100 | 100 |
  | `/transparency` | 97 | 100 | 100 |

  The checkpoint is 90. No wallet code reaches either page: the whole wagmi and RainbowKit tree is
  confined to `lib/wagmi.ts`, which nothing on a public page imports.
- I ran the acceptance myself, because the acceptance agent died on a spend limit. Checked by hand:
  every Section 15 copy block is byte-for-byte verbatim; the NAV check renders "Not checked" and
  explicitly warns against reading it as a pass when no deployment is recorded; `/api/attestation`
  says no attestation has been published and names the command that would publish one; and no
  mainnet chain id or RPC appears anywhere under `web/`.
- Two defects found and fixed during that pass. `/transparency` shipped but was linked from nowhere,
  because its entry was still in the planned-routes list. And the hardened secret scan correctly
  flagged deployment tx hashes in newly generated files — they are public chain data, so the
  generator now emits the `allow-secret` marker itself rather than the marker being hand-added and
  lost on the next regeneration.

**CI green on all five jobs** (run 34911482390): contracts, Slither, engine, web, secrets.
Getting there took one fix. The secrets job failed on 21 gitleaks findings which were all the
`generic-api-key` rule matching public chain data on entropy alone — three unique values, two
Ethereum addresses and one creation transaction hash. Fixed precisely rather than by disabling the
rule: a 40-hex string is the wrong length to be a 32-byte private key, so that shape is allowed
globally and provably cannot hide one; the transaction hashes, which *are* the same length as a key,
are listed by value. Verified by planting a real-looking key and confirming gitleaks still fails.

**Phase 7 (verify, subscribe) — shipped**
- The verification store and registrar worker (D7, D8), the wallet layer, `/verify` and
  `/subscribe`. Web unit tests 80 → 292, Playwright 19 → 36. CI green on all five jobs.
- The wallet bundle stays where it belongs. Route first-load sizes: `/` 232 kB and `/transparency`
  120 kB, unchanged; `/verify` 393 kB and `/subscribe` 396 kB carry the wallet. Lighthouse on `/`
  is 93 / 100 / 100, down from 97 on performance but still above the checkpoint's 90.
- `/verify` leads with what it is not: *"This is not KYC, and nothing here checks who you are. No
  identity document is requested, read, uploaded or stored. There is no vendor behind this form, no
  reviewer, no sanctions screen and no register of people."* It then tells the reader not to type
  real personal data. The form collects no name and the route drops one if sent (D59).
- Closed a gap both page agents flagged and neither could fix: vitest's include reached only `lib/`,
  so the pure logic beside a page had no unit coverage. The subscribe quote arithmetic is now tested
  against the contract's formula written out independently, and validated by mutation — rounding the
  division up instead of down fails four of the sixteen.

**Phase 8 checkpoint proved on a live chain, at the contract level**
Ran it by hand on a private Anvil (port 8547, chosen to avoid an agent's node on 8545). Two verified
holders subscribed 7,000 and 3,000 test USDC, the issuer distributed a 12.00 USDC coupon, and both
claimed:

| | Expected | Actual |
|---|---|---|
| Holder A pending | 8.400000 | 8.400000 |
| Holder B pending | 3.600000 | 3.600000 |
| A actually received on claim | 8.400000 | 8.400000 |
| NAV after distribution | 0.998800 | 0.998800 |
| Available liquidity | 10,000.000000 | 10,000.000000 |

The 70/30 split is exact. The NAV drop is exactly the per-token coupon, which is D26 holding on a
real chain rather than only in a unit test. Available liquidity is the subscription money alone, so
the coupon reserve was correctly excluded and then correctly released once both holders had claimed.

**Attestation seam closed.** The Phase 6 transparency agent flagged that its published-attestation
branch had only ever run against a document it made up in a scratch directory, never against real
`nav-engine attest` output. Verified that seam directly: the engine's real output satisfies the web
app's *strict* zod schema (an unknown field would fail), viem — the library the browser actually
uses — verifies the published signature, and flipping one digit in the signed message is rejected.
`web/public/data/` still holds only the four committed documents; no attestation is committed (D34).

**Phase 8 (portfolio, stats, indexer) — shipped**
- The events indexer, the rebuilt `/api/events` and upgraded `/api/stats`, `/portfolio` with claim
  and redeem, and `/stats`. Web unit tests 292 → 445, Playwright 36 → 53 passing with 3 skipping on
  documented chain-state conditions.
- Lighthouse on all three public pages, against a production build:

  | Page | Performance | Accessibility | Best practices |
  |---|---|---|---|
  | `/` | 92 | 100 | 100 |
  | `/stats` | 92 | 100 | 100 |
  | `/transparency` | 93 | 100 | 100 |

  `/stats` carries charts and still holds the line; it imports nothing from the wallet layer.
- The indexer agent verified itself on a private Anvil and reported the numbers: 19 events indexed
  across 13 of 14 names, holders 2, supply folded from events matching the chain, an exact 2:1
  coupon split, and the ex-distribution NAV drop landing where D26 says it should.
- Fixed a documentation defect that agent surfaced: `PARTNER_INTEGRATION.md` and `web/README.md`
  both still described the Phase 6 placeholder endpoint — no filters, no pagination, `holders: null`.
  All of it was false by then. Both now describe the real contract, including that the cursor is a
  position rather than an offset and that `coverage` must be read before a result is trusted.

**Phases 9 and 10 — shipped**
- Phase 9: the role-gated `/admin` console, `/rules` and `/risks` rendered from the canonical root
  documents (D12), `/developers` and the OpenAPI description. Web unit tests 445 → 632, Playwright
  53 → 99 passing.
- Phase 10: the eight-step demo runner with `demo/REPORT.md`, the analytics notebook with twelve
  exported figures, and twenty screenshots covering every page in both themes.
- Lighthouse on all six public pages: 92 to 96 performance, 100 accessibility, 100 best practices.
- CI is now six jobs. The new `demo` job runs the whole eight-step scenario on a fresh Anvil **twice
  in a row** on every push — the second run is the idempotency check — and uploads the report as an
  artefact. I also added a coverage gate that fails if any contract in `src/` drops below 100%, and
  a check that `web/content/` has not drifted from the canonical root documents.

**Broke / surprised**
- I misdiagnosed a test failure and should record it. After linking the two new routes, ten
  Playwright tests failed and reverting the link made them pass, which looked conclusive. It was
  not: a server I had started by hand for the Lighthouse run was still bound to Playwright's port,
  so Playwright reused it and tested a stale build. The link was never the cause. Kill stray servers
  before trusting a bisect.
- The yield solver was quietly wrong. It stopped on an absolute 1e-14 step in yield units, which is
  smaller than the smallest representable step near maturity, so it reported failure *after*
  converging. On the shipped book it returned a silent −3.46 % yield on 2029-02-28 and then aborted
  the whole run on 2029-02-27. Re-running the old solver on 254 adversarial cases failed 44 of them
  with `ZeroDivisionError`, `OverflowError` and complex exponentiation. It is now a bracketed Newton
  with a bisection safeguard, stopping on the price residual: 8 421 cases, no round-trip failure.
- 30/360 was missing both February end-of-month rules, and accrued interest divided by a constant
  180 rather than the live coupon period. On an end-of-month schedule that let accrued exceed a full
  coupon and made NAV *fall* on a coupon date. Neither shows on the shipped book, because every
  coupon date in it is the 1st of a month — which is exactly why no test caught it.
- The engine had no notion of a bond maturing inside the valuation window: it raised on the maturity
  date and produced no NAV for that day or any later one, and face was never redeemed into cash.
  Dated 2029 on the current book, but unhandled rather than scoped out.
- `forge script --broadcast` without `--slow` writes `transactions[].hash` mis-associated — the hash
  recorded against the `HBToken` creation was actually a later `grantRole` call, confirmed against
  the node with `cast tx` and `cast receipt`. `make deploy` now passes `--slow` and re-checks every
  recorded hash against its receipt (D45).
- No published number moved through any of this. `nav_per_token` is still 1.003061 and the hand-built
  fixture still ties to the cent.

**Needs from founders** (unchanged; see `PLAN.md` Section 5)

**Next — and this is now mostly the founders' list**
Every phase 0 through 10 is built, tested and green. What remains needs credentials this machine
does not have, and is tracked in `PLAN.md` Section 5:

1. A funded Base Sepolia deployer key, so `make deploy CHAIN=base-sepolia` and `make verify` can run
   and the README's address table can be filled.
2. Demo wallets with a little testnet ETH, so `make demo` runs against the public testnet rather
   than only against Anvil.
3. A Vercel project and a WalletConnect id, for the live demo link.
4. The brand hex, two team bios, and the 90-second recording.
5. Confirmation of D19 (reference-unit NAV), D4 (de-verified holders may still redeem) and D26
   (NAV drops at distribution).

Showcase items (BUILD_PROMPT Section 14) are deliberately not started: they come only after the
definition of done passes, and item 2 of that list needs the testnet run above.

## 2026-09-14 — Session 2: Phase 1 review triage, fixes in flight, engine build started

**Did**
- Phase 1 build landed on 2026-09-08 (uncommitted until the review closes): `IdentityRegistry`, `HBToken`, `MockUSDC`, 111 unit tests, 100 % line/branch coverage on `src/`.
- The four-lens review (spec, security, coverage, arithmetic) produced 35 findings, but the refutation and fix agents died on a session limit. Triaged all 35 by hand today; 18 lead to code or test changes, 8 are Phase 2 scope, 9 are documentation.
- New decisions in `PLAN.md`: D26 (ex-distribution NAV drop closes a coupon-capture sandwich), D27 (NAV rail measured against a 24 h window anchor so in-rail updates cannot compound), D28 (uint128 input bounds, no `Panic` paths, zero-address and country-code checks), D29 (allocated vs distributed coupon accounting, `DistributionTooSmall`). D14 and D20 wording corrected. Interfaces rewritten with full NatSpec.
- Fix workflow running on `contracts/`; Phase 4 engine workflow running on `engine/` against the hand-built fixture committed on 2026-09-08.

**Broke / surprised**
- Workflow agents can hit the account session limit mid-run; the build stage had already finished, so nothing was lost, but verification had to be redone by hand.

**Needs from founders** (unchanged, plus)
5. Confirm D26: `distributeCoupon` lowers the on-chain NAV by the per-token coupon at distribution time (standard ex-distribution behaviour; BUILD_PROMPT 5.2 is silent on it).

**Next**
- Commit Phase 1 once the fix workflow's acceptance run is green; then Phase 2 (fuzz, invariants, gas snapshot, Slither, `SECURITY.md`) and Phase 3 (deploy/seed scripts, Anvil deployment JSON).

## 2026-09-08 — Session 1: planning and scaffolding

**Did**
- Read `BUILD_PROMPT.md` and `SPEC.md` in full. Copied both into the repo root (D1 in `PLAN.md`).
- Surveyed the machine: Node 25 / pnpm 10, Python 3.11 / uv, Docker, gh (logged in). Installed Foundry 1.8.1 (`foundryup`). No Slither yet.
- Wrote `PLAN.md` (phases, file paths, 24 decisions, risks, founder asks).

**Broke / surprised**
- The literal NAV formula (`NAV_total / tokens_outstanding` with a fixed 1,000,000-face book) gives a NAV of several hundred USDC per token, not 1.00. Adopted a reference-unit model (D19). Please confirm.
- No deployer / oracle / registrar keys, no Basescan key, no Vercel or WalletConnect ids are available to the agent. Every phase is verified on a local Anvil chain; the Base Sepolia steps are documented as exact commands for you to run.

**Needs from founders** (see `PLAN.md` Section 5)
1. Funded Base Sepolia deployer key (+ registrar/issuer/oracle keys or one admin key) and a Basescan API key.
2. Demo wallets A/B/C with a little Base Sepolia ETH.
3. Vercel project linked to `web/`, WalletConnect project id.
4. Confirm D19 (reference-unit NAV) and D4 (de-verified holders may still redeem).

**Phase 0 shipped (same day)**
- Foundry project (solc 0.8.26, OpenZeppelin v5.7.0 + forge-std v1.11 as submodules), `IIdentityRegistry` / `IHBToken` interfaces written up-front as the contract for Phase 1.
- Python 3.11 engine skeleton (`uv`, pandas 2.3, web3 7.16, pydantic 2.13; ruff + mypy + pytest).
- Next.js 15.5 web skeleton (TypeScript strict, Tailwind 4, vitest 4, Playwright 1.63 on a dedicated port 3457).
- Root: `Makefile` (`make lint`, `make test`, `make setup`), `.env.example` (every variable documented), `scripts/check-secrets.sh` + `.gitleaks.toml`, `ci.yml` (contracts / engine / web / secrets jobs), `nav-daily.yml` skeleton, MIT licence, CHANGELOG, CONTRIBUTING.
- Checkpoint passed: `make lint` and `make test` green locally (forge 1 test, pytest 2, vitest 6, next build, Playwright 1); CI run 34272520257 green on all four jobs (contracts, engine, web, secrets) after one fix (pnpm action needed `package_json_file: web/package.json`).

**Next**
- Phase 1: `IdentityRegistry`, `HBToken` core (restrictions, roles, NAV rail, subscribe/redeem), `MockUSDC`, unit tests covering every revert path.

## 2026-09-20 — v2 Phase 0: Arc Testnet plan awaiting approval

This entry begins v2. All preceding entries describe v1 and do not establish v2 functionality. `BUILD_PROMPT_V2.md` and `design.md` now define the requested scope; the root `PLAN.md` has a dated scope-replacement note. No application, contract, workflow, or environment implementation was changed in this phase. `STATUS.md` remains absent because only the future `pnpm e2e` may generate it.

**Work performed**

- Read both supplied attachments fully and copied them unchanged to `BUILD_PROMPT_V2.md` and `design.md`.
- Before file changes, preserved existing v1 commit `2fc8f9e75229ceca4a7347ffd089e76185030c16` as branch `v1-base-sepolia` and annotated tag `v1`; pushed both to GitHub atomically.
- Kept workspace branch `plan-and-build-from-build-prompt`. `origin/main` currently contains only `.gitkeep`; the plan proposes developing the fresh v2 tree here and integrating into `main` through review.
- Replaced the root v1 plan with the v2 plan: file tree, design mapping, interfaces, financial/decimal rules, environment contract, commands, all nine checkpoints, evidence requirements, and founder questions. The original plan and code remain at tag `v1`.
- Checked official Arc network, gas, USDC and deployment documentation. Arc documents Blockscout verification; plan includes its endpoint plus reproducible verification inputs.
- Checked the official Next.js support policy. Version 14 is listed as unsupported; the plan proposes version 16, pending founder approval.

**Verification and evidence**

- `git ls-remote origin refs/heads/v1-base-sepolia refs/tags/v1 'refs/tags/v1^{}'` confirms the branch and peeled tag both point to `2fc8f9e75229ceca4a7347ffd089e76185030c16`. The annotated tag object is `0d0d45c21f9cf2cec64c58c324bc78f6edefb680`.
- [Preserved branch](https://github.com/artuntan/hitbite-mvp/tree/v1-base-sepolia) · [Preserved tag](https://github.com/artuntan/hitbite-mvp/tree/v1).
- Input copies checked byte-for-byte against attachments; `git diff --check` used for documentation whitespace. Confirmed existing `.env*` exclusions and `.context/` exclusion before the checkpoint commit.
- No application tests or testnet transactions were run for this documentation-only checkpoint. Network documentation checks are not live deployment evidence.
- Primary sources: [Arc connection](https://docs.arc.io/arc/references/connect-to-arc), [gas](https://docs.arc.io/arc/references/gas-and-fees), [USDC](https://docs.arc.io/arc/references/contract-addresses), [verification](https://docs.arc.io/arc/tutorials/deploy-on-arc), [Next.js support](https://nextjs.org/support-policy).

**Questions for the founder**

1. Approve `PLAN.md` before Phase 1, including supported Next.js 16 in place of the requested unsupported 14.
2. NAV bootstrap: approve the disclosed supply-scaled simulated reference basket and separate actual vault reporting, or specify a fixed-capitalization model. Decision needed before Phase 4; a fixed large book divided by tiny testnet supply would create misleading per-token NAV.
3. Revoked holders: approve redemption and earned-coupon claims for existing holdings while receiving/transferring tokens stays prohibited, subject to pause. Decision needed before Phase 2.

**Design gaps and conservative defaults**

- No proprietary fonts or HitBite screen mockups supplied. Plan uses the design's permitted Inter/Inconsolata substitutes and the brief's screen structure.
- No explicit stepper widths, mobile flow layout, control states, focus treatment, select/checkbox/toggle, chart styling, or wallet-modal specification. Plan uses native controls, supplied tokens, white/hairline cards, near-black actions, and records any implementation deviation at its checkpoint.
- Client-side signature verification is Core because the product specification and definition of done require it, despite its duplicate Excellence listing. Chain configuration is also Core; an actual fallback deployment remains Excellence.

**Known gaps and next checkpoint**

- V2 is planned only. Existing v1 files remain until the approved repository phase. `STATUS.md` contains no v2 claims because it does not yet exist.
- Credentials, hosted verification store, faucet funding, WalletConnect and Vercel access remain unestablished; the plan lists when each becomes necessary. No secrets were inspected or printed.
- Next: founder approval, then Phase 1 (repo and safety). Do not advance before approval; commit and push this planning checkpoint first.

## 2026-09-20 — v2 Phase 1: repository and safety checkpoint

**Approval received**

- The founder approved Phase 0 and its proposed decisions: Next.js 16, the disclosed supply-scaled NAV model, and revoked holders being allowed to redeem/claim existing entitlements while unpaused. Later phases retain their individual approval gates.

**Work performed**

- Reconfirmed the remote v1 branch/tag at `2fc8f9e75229ceca4a7347ffd089e76185030c16`. Replaced the v1 working tree with the v2 scaffold on the unchanged workspace branch. Preserved ignored v1 artifacts and local caches in `.context/v1-worktree/`; no history was reset or rewritten.
- Created the pnpm workspace with `app/`, `packages/config/`, `contracts/`, `nav_engine/`, `scripts/`, `tests/`, and `deployments/`. Kept the MIT licence and exact pinned OpenZeppelin 5.7.0/forge-std 1.11.0 submodule commits. No v1 contract or application implementation is active in the new tree.
- Added a minimal Next.js 16.3.5/React 19.3.0/Tailwind 4.3.3 shell with the exact testnet banner/footer, strict TypeScript, root commands, and a committed pnpm lockfile. This is not the investor app or final screen design.
- Centralized the three permitted networks, Arc USDC address/decimal constants, chain-ID guard, validated public environment fields, exact copy blocks, and the production mapping. Production-chain selections, prototype-property names and mismatched RPC chain IDs fail closed.
- Replaced `.env.example` with commented current/future settings and empty credentials; expanded ignore rules for the new app and local database. Added redacted candidate-tree checks with gitleaks and a regression check for untracked secrets/forced tracked env files. The scanner never prints matched values and does not scan ignored local environments or preserved v1 history.
- Replaced v1 workflows with Phase 1 CI for workspace checks, Foundry scaffolding, and secret checks. Foundry has no contract sources yet; CI describes this explicitly. NAV jobs/dry-runs arrive in Phase 4 rather than returning a fake success now.
- Rewrote README as a scaffold guide with exact available commands, the unchanged production mapping, preserved-v1 links, and the future generated STATUS link. `STATUS.md` remains absent.

**Verification**

- `pnpm install --frozen-lockfile`: lockfile installation succeeds.
- `pnpm check`: ESLint, TypeScript/Next route types, eight configuration/security checks, and optimized Next build pass locally. Lint warnings were corrected and now fail the lint command.
- Production server: HTTP 200 with the exact banner and footer; under-construction content rendered. The temporary server was stopped after verification.
- `forge fmt --check --root contracts` / `forge build --root contracts`: empty scaffold recognized (nothing to format/compile), not a claim of contract test coverage.
- `python3 scripts/check-secrets.py --gitleaks`: candidate files pass with no findings. `git diff --check` and ignored-path checks pass.
- Remote CI evidence will be appended after the pushed implementation commit runs.

**Implementation findings and limits**

- Next.js's current React/import/accessibility lint plugins reject ESLint 10 and one crashes at runtime. Pinned ESLint 9.39.5 for compatibility; it emits an upstream deprecation warning. This is development tooling, and the limitation remains recorded for upgrade when the plugins support 10.
- Auditing the unused wagmi/RainbowKit dependency tree found known ws, uuid and decode-uri-component advisories. Deferred wallet packages until their consuming Phase 5 implementation, when SDK compatibility and audit remediation can be verified together. Phase 1 retains only dependencies used by the scaffold; wallet integration is not claimed.
- Gitleaks initially misread adjacent empty wallet-key assignments as a credential. Added a descriptive comment between those entries; no secret-detection exemption was introduced.
- System-font fallback and the plain shell are temporary Phase 1 design defaults; approved self-hosted Inter/Inconsolata and product components remain Phase 5 work.
- No contracts, NAV computation, wallets, real transactions, or deployment were implemented in this checkpoint.

**Questions for the founder / next**

- Once the CI evidence is recorded, approve Phase 2 to implement and test the contracts. No additional product decision is required for that phase.

**Additional Phase 1 verification before push**

- Re-ran `pnpm check` after the final dependency changes: zero lint warnings, eight passing checks, successful typecheck and production build.
- `pnpm audit --prod`: zero reported vulnerabilities across the remaining scaffold production dependency tree. This is the package advisory result, not a security audit of the future product.
- Confirmed the CI-pinned gitleaks checksum release asset exists. Both supplied source files remain byte-identical to the attachments; `STATUS.md` is still absent.
