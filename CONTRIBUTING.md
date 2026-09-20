# Contributing

Start with the [README](README.md) and [trust model](docs/security-model.md). Use a [bug report or feature proposal](https://github.com/artuntan/hitbite-mvp/issues/new/choose) for discussion and [private reporting](SECURITY.md) for vulnerabilities.

## Development and validation

Clone recursively, install with `pnpm install --frozen-lockfile`, copy `.env.example` to ignored `.env`, and run `pnpm dev`. A read-only build needs no private keys. Never use real-fund wallets.

Run `pnpm check` and `pnpm check:secrets` before a PR. Contract changes also need `forge fmt --check --root contracts` and `FOUNDRY_PROFILE=ci forge test --root contracts`. NAV changes need the Python tests, pinned Ruff check and deterministic dry-run in [CI](.github/workflows/ci.yml). Automation changes need `python3 -m unittest discover -s tests/automation -v`.

Test meaningful behavior: authorization, rounding, reserved liquidity, signatures and failure handling. Label browser fixtures separately from live reads or actual testnet transactions.

## Pull requests

- Target `main`; explain the problem, resulting behavior, validation and operational risks.
- Keep credentials, environment files, verification names and unredacted logs out of Git. Save temporary material in ignored `.context/`.
- Required checks must pass on an up-to-date branch and conversations must be resolved. Main disallows force pushes and deletion, including administrator bypass.
- Pin third-party Actions to full commit SHAs. Dependency updates use PRs and the same checks. External fork workflows require maintainer approval and receive no production credentials.
- Generate ABI/deployment changes with existing scripts and back them with receipts. Do not casually replace a confirmed deployment.
- Only the real `pnpm e2e` runner writes `STATUS.md`. Never hand-edit it or manufacture founder acceptance. Append evidence to `PROGRESS.md`; add dated scope amendments to `PLAN.md`.

This single-maintainer repository has zero required approving reviews. Ownership and required CI do not imply independent two-person review. Automated NAV PRs contain only two generated records and merge the exact checked commit without bypass privileges.

Contributions use the repository's [MIT license](LICENSE). Preserve third-party notices, including fonts and contract dependencies.
