# HitBite MVP — Türkiye USD sovereign bonds, on-chain (testnet reference implementation)

> **Testnet demonstration on Base Sepolia. Simulated portfolio and attestation. Not an offer of securities.**

[![ci](https://github.com/artuntan/hitbite-mvp/actions/workflows/ci.yml/badge.svg)](https://github.com/artuntan/hitbite-mvp/actions/workflows/ci.yml)

`hbTRS` is a whitelisted token representing a simulated, custodied portfolio of Türkiye USD sovereign bonds. Subscriptions and redemptions settle at net asset value in test USDC; coupons are passed through pro-rata. In production the fund is issued and managed by a licensed fund manager; HitBite designs the product, runs the data and transparency layers, and builds distribution.

**Status:** under construction — see [`PROGRESS.md`](PROGRESS.md) for the dated log and [`PLAN.md`](PLAN.md) for the phase plan. Still to come in Phase 10: the live demo link, the screen recording, verified contract addresses and the team section.

## What is real vs. simulated

Read this before anything else on the page. Everything in the middle column is what this repository
actually does today.

| | This MVP | Production |
|---|---|---|
| Legal issuer | None | Licensed ADGM fund manager |
| KYC | Auto-approved on testnet by a simulated registrar | The partner's KYC vendor |
| Money | `MockUSDC`, a test token with a faucet | Fiat or USDC to the fund's account |
| Custody | None. The portfolio is simulated | Broker-Euroclear and a licensed digital custodian |
| Token contract | Ours, tested and analysed, **not audited** | The vendor's audited implementation of this spec |
| NAV | Our engine, from illustrative prices | The fund administrator's NAV |
| Attestation | Simulated signer, labelled as such | An independent firm, monthly |
| Dashboard and transparency | Ours | Ours |

The bond positions are illustrative placeholders whose coupons and maturities were chosen to match
the yield levels observed on the Türkiye USD curve on 31 August 2026. Their ISINs are marked `TBD`
rather than invented. No audit, licence, partnership or endorsement is claimed anywhere in this
repository.

## Documentation

| Document | What it answers |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | How the engine, contracts and web app fit together, with sequence diagrams |
| [`COMPLIANCE_RULES.md`](COMPLIANCE_RULES.md) | Every rule the contracts enforce: whitelist, blocked countries, transfers, pause, NAV rail |
| [`RISKS.md`](RISKS.md) | What can go wrong, in plain language, starting with what is simulated |
| [`SPEC.md`](SPEC.md) | The product spec |
| [`PLAN.md`](PLAN.md) | Phases, and every ambiguity resolved as a numbered decision |
| [`PROGRESS.md`](PROGRESS.md) | Dated build log: what shipped, what broke, what is blocked |

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
