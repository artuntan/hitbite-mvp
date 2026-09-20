# Security and trust model

**Scope:** current Arc Testnet v2. This is an implementation description, not an independent audit. No real bonds, real investor funds, licensed issuance, independent custodian or production deployment are represented here.

## Privileged roles

The [deployment manifest](../deployments/arc-testnet.json) records initial addresses. Query current `hasRole` values and role events before relying on that snapshot.

| Role | Authority and consequence |
|---|---|
| `DEFAULT_ADMIN_ROLE` | Grants/revokes roles and manages role administrators; can confer operational powers on new keys |
| `ISSUER_ROLE` | Mints/burns balances, funds distributions, pauses/unpauses, forces a positive NAV; can change balances/value or block exits |
| `ORACLE_ROLE` | Publishes positive NAV within 5% of the preceding value per update; repeated updates can move farther than 5% overall |
| `REGISTRAR_ROLE` | Adds/revokes verification and country blocks; controls entry and transfers, but cannot itself withdraw investor funds |
| Simulated attestor | Signs historical JSON off-chain; has no independent custody/audit authority |

Roles use separate individual testnet keys. **No multisig, timelock or independent approval quorum exists.** Contracts are deployed directly without an upgradeable proxy, but role powers still give operators substantial control. See [HBToken](../contracts/src/HBToken.sol) and [IdentityRegistry](../contracts/src/IdentityRegistry.sol).

## Investor and accounting boundaries

The UI requests an exact entered USDC allowance. Transactions settle at execution-time NAV; contracts have no investor-specified minimum output or transaction deadline. NAV changes between submission and execution can change output.

Transfers require eligible sender and receiver. Revoked or newly blocked holders can redeem existing tokens and claim accrued coupons **while unpaused**. Pausing blocks transfers, subscriptions, redemptions, claims and distributions. Issuer mint/burn follows contract eligibility/pause hooks.

Unpaid coupon distributions, including rounding dust, are reserved from redemption liquidity. Integer outputs are floored at declared decimals. [Tests](../contracts/test/) exercise accounting and restrictions but cannot prove the absence of every bug.

Model bond assets are separate from actual vault USDC. Redemption depends on testnet vault liquidity. Arc native gas uses 18 decimals and its USDC ERC-20 interface uses 6; these are interfaces to the same asset, not separate balances.

## Verification API and privacy

Tickets bind a wallet, application, origin and chain, expire after five minutes and require a ten-second review plus a valid wallet signature. Eligibility is a simulation, not production KYC. Origin checks do not authenticate non-browser callers.

The API reads at most 8 KiB while streaming and rejects malformed envelopes before RPC work. Vercel's edge firewall limits `POST /api/verify` to **20 requests per IP per 60-second fixed window**, returning 429 before function execution. The UI handles HTML firewall responses. This hosting configuration must be reproduced when moving to another provider.

[Vercel rate-limit counters](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) are regional. Shared networks share a limit; distributed clients and window boundaries can still create bursts. There is no CAPTCHA or distributed registrar transaction queue. A per-instance queue reduces nonce conflicts; cross-instance conflicts are retriable and success requires a confirmed receipt.

Names are processed transiently and hashed into tickets; the application does not persist names or put them on-chain. Hashing is not anonymization. Wallet addresses, country codes and verification changes are public on-chain. Provider request metadata follows provider retention rules.

## Repository and delivery controls

- Secret scanning, push protection, dependency alerts, Dependabot updates, CodeQL and private vulnerability reporting are enabled. Scanners cannot detect every possible secret or vulnerability.
- CI scans the candidate tree and new commit history, including credentials deleted before the final tree. Output is redacted. A [bounded exposure review](verification.md#public-repository-review) covers preserved history separately.
- Main requires a PR, four passing CI jobs, an up-to-date branch and resolved conversations. Administrators are subject to protection; force pushes and deletion are disabled. Zero approving reviews are required in this single-maintainer repo.
- Actions default to read-only access and use full commit SHAs. The main-branch NAV job alone gets the write permissions needed to create a PR, dispatch CI and merge after checks. Role secrets are scoped to the steps that use them.
- External fork workflows require approval. Vercel fork protection is enabled. Registrar and ticket secrets are Production-only, absent from Preview. Vercel does not receive issuer/oracle/attestor/E2E keys.

The [NAV workflow](../.github/workflows/nav.yml) writes on-chain before merging JSON. CI/merge/deployment failures can temporarily leave records stale or different from the chain. The run fails visibly for operator review; it does not rewrite chain history.

## Outstanding production requirements

Any production use needs a separately designed legal/custody arrangement, real identity/compliance controls, independent contract/accounting review, secure key governance, monitoring/incident response and explicit liquidity/slippage policies. These are outstanding requirements, not capabilities or partnerships claimed by this repository.
