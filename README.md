# HitBite MVP — Türkiye USD sovereign bonds, on-chain (testnet reference implementation)

> **Testnet demonstration on Base Sepolia. Simulated portfolio and attestation. Not an offer of securities.**

[![ci](https://github.com/artuntan/hitbite-mvp/actions/workflows/ci.yml/badge.svg)](https://github.com/artuntan/hitbite-mvp/actions/workflows/ci.yml)

`hbTRS` is a whitelisted token representing a simulated, custodied portfolio of Türkiye USD sovereign bonds. Subscriptions and redemptions settle at net asset value in test USDC; coupons are passed through pro-rata. In production the fund is issued and managed by a licensed fund manager; HitBite designs the product, runs the data and transparency layers, and builds distribution.

**Status:** under construction — see [`PROGRESS.md`](PROGRESS.md) for the dated log and [`PLAN.md`](PLAN.md) for the phase plan. This README is completed in Phase 10 (live demo, recording, verified addresses, real-vs-simulated table, architecture, quickstart, team).

## Quickstart (Phase 0)

```bash
make setup     # submodules, uv, pnpm, playwright
make lint      # forge fmt, ruff, mypy, eslint, prettier, tsc, secret scan
make test      # forge test, pytest, vitest, next build, playwright smoke
```

Copy `.env.example` to `.env` (root) and `web/.env.local` (web). Leave every key empty unless you are deploying to Base Sepolia.

## Layout

| Path | What |
|---|---|
| `contracts/` | Foundry: `IdentityRegistry`, `HBToken` (`hbTRS`), `MockUSDC` |
| `engine/` | Python 3.11: NAV, attestation, oracle push |
| `web/` | Next.js app: investor pages, admin console, public JSON API |
| `demo/` | End-to-end testnet scenario runner and `REPORT.md` |
| `notebooks/` | Portfolio analytics notebook and exported figures |
| `docs/` | Screenshots, diagrams, figures |

## Disclaimer

This is a technical demonstration on a public test network. Portfolio data, prices and attestations are simulated or illustrative and are labelled as such. Nothing here is an offer, solicitation or recommendation to buy any security. HitBite is not a licensed financial institution.

## Licence

MIT — see [`LICENSE`](LICENSE).
