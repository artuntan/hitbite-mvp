# HitBite Testnet v2

[![CI](https://github.com/artuntan/hitbite-mvp/actions/workflows/ci.yml/badge.svg?branch=plan-and-build-from-build-prompt)](https://github.com/artuntan/hitbite-mvp/actions/workflows/ci.yml?query=branch%3Aplan-and-build-from-build-prompt)

An Arc Testnet reference implementation of the intended investor experience for tokenized Türkiye USD sovereign bonds. The portfolio is simulated and the settlement asset is testnet USDC. Not an offer of securities. Testnet only.

This is the **Phase 1 repository scaffold**. The investor flow, contracts, deployment and NAV engine are scheduled in the [approved plan](PLAN.md). [STATUS.md](STATUS.md) will be generated only by the live transaction runner in Phase 7; it is intentionally absent until then. The CI badge describes repository checks, not live product verification.

V1 is preserved on [branch v1-base-sepolia](https://github.com/artuntan/hitbite-mvp/tree/v1-base-sepolia) and [tag v1](https://github.com/artuntan/hitbite-mvp/tree/v1). Current requirements are [BUILD_PROMPT_V2.md](BUILD_PROMPT_V2.md) and [design.md](design.md). Checkpoint evidence and approval history are in [PROGRESS.md](PROGRESS.md).

## Run the scaffold

Prerequisites: Node 22.13 or later (CI uses Node 22), pnpm 10.22.0, Python 3.11 for repository checks, and Foundry 1.8.1 for the contract scaffold. No wallet or private key is needed for this phase.

```sh
cp -n .env.example .env
pnpm install --frozen-lockfile
# Required only for Foundry dependencies:
git submodule update --init --recursive
pnpm check
pnpm dev
```

Open [localhost:3000](http://localhost:3000). The page is an under-construction shell. `pnpm build` and `pnpm start` run the production build locally. Root dev/build/start/typecheck commands load the root `.env`; keep keys out of application source and `NEXT_PUBLIC_` variables. [.env.example](.env.example) documents all planned settings and the phase that needs each one.

Available checks:

```sh
pnpm lint
pnpm typecheck
pnpm test:config
forge fmt --check --root contracts
forge build --root contracts
# Also requires gitleaks 8.30.1, as installed in CI:
pnpm check:secrets
```

Contract tests begin in Phase 2, the Python NAV checks in Phase 4, and `pnpm smoke` / `pnpm e2e` in Phase 7. No placeholder command claims a future feature passes. Secret checks scan current git-visible files, including untracked candidate files, with redacted diagnostics; the preserved v1 history is outside that scan.

## Layout and network configuration

| Path | Purpose |
| --- | --- |
| `app/` | Next.js 16 package; eventual four routes `/`, `/app`, `/transparency`, `/admin` |
| `packages/config/` | Testnet chain data, public environment validation, exact disclaimer copy and production mapping |
| `contracts/` | Foundry scaffold; pinned OpenZeppelin 5 and forge-std submodules |
| `nav_engine/` | Reserved for the three-file Python engine |
| `scripts/` | Repository checks; deployment and E2E tools arrive in their phases |
| `deployments/` | Reserved for actual deployment/verification evidence, with no fabricated addresses |

`NEXT_PUBLIC_CHAIN` selects `arc-testnet` (default), `base-sepolia`, or `local`. Every future RPC/signing path must call the chain-ID guard after connecting; changing a URL alone never authorizes another chain. Configuring the fallback does not establish a deployed fallback contract.

Arc Testnet uses chain ID 5042002 and [Circle's faucet](https://faucet.circle.com). The USDC ERC-20 interface is `0x3600000000000000000000000000000000000000` with **6 decimals**; native gas accounting uses **18 decimals** for the same balance. Arc must never deploy MockUSDC. See [Arc network documentation](https://docs.arc.io/arc/references/connect-to-arc) and [USDC documentation](https://docs.arc.io/arc/references/contract-addresses).

## Intended production mapping

The production column describes the intended partner model, not current licensing, custody, audit or partner claims.

| Layer | Testnet v2 | Production (first issuance) |
|---|---|---|
| Legal issuer | none (simulation) | Licensed ADGM fund manager's fund |
| KYC / whitelist | 10-second simulated review | Partner's KYC vendor writes to the registry |
| Money | testnet USDC on Arc | Fiat/USDC into the fund's account via the partner |
| Custody | none | Bonds at broker/Euroclear; tokens with a licensed digital custodian |
| Token contract | ours | Vendor's audited contract implementing this behaviour |
| NAV | our Python job | Fund administrator's NAV, published by us |
| Attestation | simulated signer | Independent firm, monthly |
| App and transparency | ours | ours, fronting the partner's flow |

MIT licensed; see [LICENSE](LICENSE). Dependency licences remain with their packages and pinned submodules.
