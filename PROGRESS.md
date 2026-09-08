# PROGRESS.md — dated log

Founders: read the latest entry first. "Needs from founders" items block only real-testnet checkpoints; everything else runs locally on Anvil.

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

**Next**
- Phase 0: scaffolding, Makefile, CI, `.env.example`, secret scan. Checkpoint: CI green on an empty build.
