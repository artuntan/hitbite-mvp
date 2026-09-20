# Security policy

## Report privately

Use [GitHub private vulnerability reporting](https://github.com/artuntan/hitbite-mvp/security/advisories/new). Do not open public issues containing exploits, credentials, private keys, seed phrases or personal verification data.

Include the affected commit, route or contract, impact, minimal reproduction and relevant public transaction links. Use your own test wallets and local fixtures. Do not access another person's data, exhaust the public registrar's gas, or disrupt the live testnet to demonstrate a problem.

The maintainer will assess reports, coordinate fixes where possible, and discuss disclosure with the reporter. This policy offers no response-time commitment, paid bounty or legal safe-harbor program.

## Supported scope

Fixes target current `main` and the Arc Testnet deployment in [the manifest](deployments/arc-testnet.json). Archived v1/Base Sepolia is unsupported. Dependency/hosting reports should identify their impact on HitBite; provider-specific issues may also need the provider's reporting channel.

This is a simulation, with no independent security audit or production-money deployment. Read [the trust model](docs/security-model.md). Public source, passing tests and explorer verification do not establish production readiness.

## Credential incident procedure

Treat suspected exposed credentials as compromised even if their files were later deleted:

1. Restrict the affected service or revoke the affected on-chain role using an unaffected administrator. Preserve evidence without reposting the secret.
2. Revoke/replace the provider credential. For signing keys, provision a fresh testnet account, grant only its intended role, remove the old role, and confirm both changes on-chain. Rotate the ticket secret to invalidate outstanding tickets when relevant.
3. Update only the required Production/workflow secret store, deploy and verify. Do not reuse keys across roles or environments.
4. Inspect history, PRs, logs, artifacts and deployment outputs. Coordinate any history cleanup separately; deleting files or rewriting history never substitutes for revocation.

Scanner output must be redacted. Never attach unredacted reports to public issues or Actions artifacts.
