# Contributing

This is a testnet-only reference implementation. Contributions are welcome under the MIT licence.

## Ground rules
- **Never commit secrets.** No private keys, mnemonics, `.env` files or RPC keys. CI runs gitleaks and `scripts/check-secrets.sh`; run `make check-secrets` before pushing.
- **Never add a mainnet configuration**, a HitBite token, airdrop, points or any incentive mechanic.
- **Label simulated data.** Any illustrative number carries `illustrative` or `simulated: true` in code and UI.
- **No invented facts** in copy: no ISINs, prices, partners, audits or legal claims without a cited public source.

## Workflow
1. Branch from `main`. Keep changes small.
2. `make lint && make test` must pass locally.
3. Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`, `refactor:`.
4. Update `CHANGELOG.md` under *Unreleased* and, for product-visible changes, the relevant doc (`SPEC.md`, `COMPLIANCE_RULES.md`, `RISKS.md`).
5. Open a PR against `main`. CI must be green.

## Toolchain
See the root `README.md` quickstart and `Makefile` targets. Sub-project details live in `contracts/README.md`, `engine/README.md`, `web/README.md`.
