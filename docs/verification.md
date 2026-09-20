# Verify the implementation

Source, reproducible checks and dated receipts answer different questions. None is an independent audit or evidence of real bond custody.

## Inspect deployment and records

1. Check the [manifest](../deployments/arc-testnet.json): chain **5042002**, addresses, receipts and compiler records.
2. Compare committed [HBToken](../contracts/src/HBToken.sol) and [IdentityRegistry](../contracts/src/IdentityRegistry.sol) with verified explorer source. [Standard JSON inputs](../deployments/verification/) are committed.
3. Inspect current role permissions, pause status, NAV, supply and vault liquidity on-chain. The manifest's initial roles are not a live role directory.
4. Open [Transparency](https://hitbite.markets/transparency) without a wallet and inspect publication receipts and downloadable signed records. A signature authenticates the configured signer, not custody or independent valuation.

Native USDC's ERC-20 interface is `0x3600000000000000000000000000000000000000`, with six decimals; gas uses eighteen. The Arc deployment has no MockUSDC.

## Reproduce checks

[CI](../.github/workflows/ci.yml) runs workspace lint/types/security tests/build, Foundry unit/fuzz/invariant tests, candidate/new-commit secret scans, Python NAV/automation tests and a deterministic dry-run. Run the README commands from a fresh clone with pinned dependencies.

`pnpm smoke` reads configured live routes, chain/deployment state, records and signatures without transactions. `pnpm test:landing` and `pnpm test:transparency` run browser checks; `UI_BASE_URL` chooses their target.

`pnpm e2e` makes real **testnet** transactions with fresh funded wallets and generates [STATUS](../STATUS.md). It needs authorized role keys and prior browser/founder evidence: see [operations](operations.md#reproduce-the-live-acceptance-run). Historical passes are never silently relabelled as current reruns.

## Evidence index

| Record | Establishes | Limits |
|---|---|---|
| [Acceptance](../STATUS.md), [E2E receipts](../deployments/evidence/e2e.json) | Dated subscription/coupon/redemption and restriction checks | Recorded source, deployment and wallets |
| [Founder acceptance](../deployments/evidence/founder-acceptance.json) | Founder's actual wallet-flow confirmation | Separate from automated or independent review |
| [Public entry](../deployments/evidence/public-entry.json) | Public navigation and responsive behavior | No new financial transactions |
| [Domain checks](../deployments/evidence/domain-activation.json) | Canonical domain, redirects and read-only checks | Hosting/DNS may subsequently change |
| [CI runs](https://github.com/artuntan/hitbite-mvp/actions/workflows/ci.yml) | Checks for a particular commit | No production-safety guarantee |
| [NAV runs](https://github.com/artuntan/hitbite-mvp/actions/workflows/nav.yml) | Publication and delivery outcomes | Simulated prices need separate operator review |

## Public repository review

An internal exposure review on **2026-09-20**, before this hardening change, examined the then-current tree and **147 commits / 883 unique Git blobs**, plus **14 available/recent Actions logs and all 24 retained artifacts**. Exact comparison against nine locally available active credential values found no matches. Pattern findings were reviewed as public EVM addresses, transaction hashes, commit identifiers and known local Anvil fixtures. No tracked environment/key file was found.

This is a bounded internal review, **not an independent audit**. GitHub-only secrets cannot be retrieved for exact comparison; logs/artifacts also received pattern scanning. Expired/deleted remote logs, forks, external caches and third-party accounts are outside its scope. Raw reports and active credentials are not published. It does not establish that no secret ever leaked elsewhere.

The production dependency audit at this change reported zero known advisories across 535 resolved dependencies. That is a point-in-time advisory result, not proof of vulnerability-free dependencies. Dependabot and CodeQL continue checking for new information.

Read [operator powers and limitations](security-model.md), inspect actual CI/explorer records, and reproduce relevant checks. Report vulnerabilities [privately](../SECURITY.md). No independent audit, regulatory authorization, guaranteed return, production readiness or real-asset backing is claimed.
