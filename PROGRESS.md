# PROGRESS.md — dated log

Founders: read the latest entry first. "Needs from founders" items block only real-testnet checkpoints; everything else runs locally on Anvil.

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
