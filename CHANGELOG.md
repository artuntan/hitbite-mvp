# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer once released.

Nothing here has been released. This is a testnet reference implementation under construction; see
[`PROGRESS.md`](PROGRESS.md) for the dated build log and [`PLAN.md`](PLAN.md) for the phase plan.

## [Unreleased]

### Added

**Phase 0 — scaffolding.** Foundry project (Solidity 0.8.26, OpenZeppelin v5 as a submodule), Python
3.11 NAV engine managed with uv, Next.js 15 web app, root `Makefile`, `.env.example` documenting
every variable, a regex secret scan alongside gitleaks, and CI with contracts, engine, web and
secrets jobs.

**Phase 1 — contracts.** `IdentityRegistry` (registrar role, country blocklist seeded with 840 and
792, professional-only verification), `HBToken` (`hbTRS`: transfer restrictions on both sides, a NAV
rail anchored to a 24-hour window, subscribe and redeem with a coupon-aware liquidity split, the
coupon index, an ex-distribution NAV drop, and `uint128` input bounds so no path reverts with a
panic), and `MockUSDC` with a per-address daily faucet cap. 100% line, statement, branch and
function coverage on every file in `src/`.

**Phase 2 — proof layer.** Seven fuzz properties, nine stateful invariants over a 32,768-call
campaign with `fail_on_revert` enabled, a committed gas snapshot, Slither with no detector disabled
and all 15 findings triaged, and `SECURITY.md` with an 18-row threat model that states what is not
mitigated. The suite was validated by injecting three deliberate bugs and confirming each was caught.

**Phase 3 — deployment.** `Deploy`, `Seed` and `Config` scripts with a chain allowlist that refuses
anything but Anvil and Base Sepolia, a committed Anvil deployment record, Makefile targets, and a
founder runbook. Verified on a real chain, including that a second seed broadcasts nothing.

**Phase 4 — NAV engine.** Reference-unit NAV computed day by day from inception: 30/360 accrual,
Newton yield solving with a bisection safeguard, modified duration and convexity, daily fee accrual,
scenario analysis, and four published JSON documents that tie out to a hand-built fixture.

**Phase 5 — oracle and attestation.** `nav-engine push` with a rail pre-check read from the deployed
contract and per-day idempotency, `nav-engine attest` signing canonical JSON under EIP-191, key
handling that cannot leak through a repr or an exception, a daily workflow that opens a pull request
with refreshed figures, and a manual, environment-gated oracle push.

**Phase 6 — web foundation.** Design system with light and dark tokens, the app shell, a typed data
layer, five public API routes, contract and ABI generation from the deployment record, and the
Overview and Transparency pages. Lighthouse 97 performance, 100 accessibility and 100 best practices
on both public pages.

**Phase 7 — investor flow.** The verification store and registrar worker, the full ISO country list
with blocked codes disabled and explained, the wallet layer (mounted only by the pages that need it,
so the public pages keep their scores), and the `/verify` and `/subscribe` pages.

### Changed

- The engine's numerical core was reviewed adversarially and repaired: the yield solver now stops on
  a price residual with a bisection safeguard rather than on a tolerance below the float noise floor,
  30/360 implements both February end-of-month rules, accrued interest divides by the live coupon
  period, and a bond maturing inside the valuation window redeems into cash. No published number
  changed.
- The secret scan now covers untracked files, so a leak fails the gate before it is ever staged.
- Slither runs in CI.

### Security

- No audit has been performed. See [`SECURITY.md`](SECURITY.md) for the threat model, the triaged
  static-analysis findings, and the list of things that are deliberately not mitigated in this MVP.
