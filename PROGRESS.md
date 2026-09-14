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

**Broke / surprised**
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

**Next**
- Phase 7: `/verify` and `/subscribe`, the faucet, the registrar worker and the verification store
  (D7, D8), plus the full country list (D23). This is the first phase that needs a wallet in the
  browser, so the wallet bundle finally gets loaded — on those pages only, never on the public ones.

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
