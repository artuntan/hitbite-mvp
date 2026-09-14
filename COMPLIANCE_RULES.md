# Compliance rules

**Testnet demonstration on Base Sepolia. Simulated portfolio and attestation. Not an offer of securities.**

This page explains, in plain language, every rule the `hbTRS` contracts enforce on-chain. It is the
canonical source: the `/rules` page in the web app renders this file (D12), so what you read here is
what the code does. Where a rule comes from a recorded decision, the decision number links it back to
`PLAN.md`.

Two things to hold in mind while reading:

- **The rules are enforced by the contracts, not by the interface.** Hiding a button does not stop a
  transaction. Every rule below is a revert in Solidity, reachable by anyone calling the contract
  directly, and covered by a test.
- **This is a testnet reference implementation.** Verification is auto-approved by a simulated
  registrar, the portfolio is simulated, and the USDC is a mock token. In production the licensed
  partner's KYC vendor writes to the same registry and the same rules apply to real holdings.

---

## 1. Who may hold the token

`IdentityRegistry` is the whitelist. `HBToken` consults it on every mint and every transfer.

An address may hold `hbTRS` when both of these are true:

1. It has a verification record (`isVerified` is true), and
2. the country on that record is not blocked.

That pair is the `canHold(address)` view, and it is the only question the token asks.

### Verification

A key holding `REGISTRAR_ROLE` calls `addVerified(account, country, investorType)`. The record stores
whether the account is verified, its ISO 3166-1 numeric country code, its investor type, and the
timestamp of verification. Re-verifying an account overwrites the previous record, which is how a
country correction is made.

`removeVerified(account)` deletes the record. The account immediately stops being able to receive
tokens. It can still get out, which is the subject of section 4.

### Investor type

Only professional investors can be verified in phase one. `investorType` 1 is professional and is
accepted. Type 2 is retail and is rejected with `RetailNotAllowed`. Any other value is rejected with
`InvalidInvestorType`. The retail field exists in storage so that a later phase can enable it without
a migration, but today no path can write it (D21).

### Blocked countries

The registry holds a country blocklist that the admin can change at any time with
`setCountryBlocked`. The deploy script seeds it with two entries:

| Code | Country | Why it is blocked |
|---|---|---|
| `840` | United States | US securities law. The product is not registered and is not offered to US persons. |
| `792` | Türkiye | The product is not offered to Turkish residents in phase one. |

Attempting to verify an address with a blocked country reverts with `CountryBlocked(country)`. The
web app shows the reason and does not let the form submit, but the on-chain check is what matters.

Blocking a country *after* addresses in it have been verified does not delete their records. It flips
`canHold` to false for them, so they can no longer receive tokens, and the exit rules in section 4
apply. This is deliberate: a sanctions-style change should take effect immediately without needing a
sweep over every holder.

Country codes must be in the range 1 to 999. Zero is rejected everywhere, including in the
constructor's initial blocklist, because an address with an unset country would otherwise slip past a
blocklist that only ever stores real codes.

---

## 2. Transfer restrictions

Every balance change routes through one hook, so there is no path around the whitelist.

| Movement | Sender checked | Receiver checked |
|---|---|---|
| Transfer between holders | yes | yes |
| Subscribe (mint) | not applicable | yes |
| Redeem (burn) | **no** | not applicable |
| Issuer operational mint | not applicable | yes |
| Issuer operational burn | **no** | not applicable |

A transfer to an address that cannot hold reverts with `NotEligible(account)`. So does a transfer
*from* an address that has lost eligibility. There is no allowance trick around this: `transferFrom`
runs the same hook.

The two deliberate exceptions are burns, covered next.

---

## 3. Coupons

Coupons are distributed pro rata to holders using a cumulative index, so distributing costs the same
gas whether there are two holders or two thousand. Nobody iterates a holder list.

- The issuer calls `distributeCoupon(usdcAmount)`, which pulls the USDC into the vault and raises the
  cumulative index by the per-token amount.
- Each holder's share is settled automatically whenever their balance changes, and on demand when
  they claim. `pendingCoupon(address)` shows what is owed.
- `claimCoupon()` pays out everything accrued to the caller.

Three properties are proven by test rather than asserted here: two holders splitting 70/30 receive
70/30 of a distribution; a transfer between two distributions does not let anyone double-count; and
an address that subscribes after a distribution receives nothing from it.

**NAV falls when a coupon is distributed.** The per-token coupon comes out of the NAV at the moment of
distribution, exactly as a fund's NAV drops on its ex-distribution date (D26). Without this, an
address could subscribe immediately before a distribution, claim its share, and redeem at an unchanged
NAV, taking the coupon from the holders who were there to earn it. The `NAVUpdated` event fires for
this drop like any other NAV change.

A distribution too small to raise the index by even one unit is rejected with `DistributionTooSmall`
rather than silently absorbed, since the whole amount would otherwise be locked in the contract. A
distribution whose *per-token* amount is not strictly below the current NAV is rejected with
`DistributionExceedsNav`, because NAV drops by that amount and cannot go to zero or below.

---

## 4. Getting out

**A holder who loses verification can still exit.** Redeeming and claiming coupons do not check the
sender's eligibility (D4). This is a deliberate asymmetry: receiving is the restriction that matters
for a whitelisted security, and trapping someone's money because their record was removed is never the
right outcome. The issuer can likewise force-burn from an address for an operational correction
without the address being eligible.

Redemption is still subject to liquidity. `redeem(tokenAmount)` pays out `tokenAmount × NAV` and
reverts with `InsufficientLiquidity(available, requested)` if the vault cannot cover it.

Critically, **coupon money is never available for redemptions** (D6). The vault's USDC is split into
the coupon reserve, which is owed to holders who have not yet claimed, and available liquidity, which
is everything else. Redemptions draw only on the latter. This is what makes the invariant hold that
the vault always physically contains every unclaimed coupon.

---

## 5. NAV and the oracle rail

NAV is stored on-chain as an integer in USDC units, six decimals, per one whole token. It starts at
`1.000000`.

A key holding `ORACLE_ROLE` updates it with `setNAV(newNav, reportedAUM, force=false)`. The update is
rejected with `NavMoveExceedsRail` if it moves NAV more than the configured limit, 5% by default.

The limit is measured against the NAV at the **start of the current 24-hour window**, not against the
previous update (D27). This matters more than it first appears. If the rail were measured
call-to-call, an oracle key could move NAV 5%, then 5% again, and again, and walk the price anywhere it
liked within a single block. Anchoring the window means a compromised oracle key is bounded to 5% per
day, full stop.

`force=true` skips the rail, but only `DEFAULT_ADMIN_ROLE` may use it, and it emits a distinct
`NAVForced` event so a forced update is never quiet. It also restarts the window at the new value. The
engine's push tool refuses to force without a written reason, which it logs.

A NAV of zero is rejected. So is any value above the input ceiling described in section 7.

---

## 6. Pause

A key holding `ISSUER_ROLE` can pause the token. While paused, everything that moves value stops:
transfers, subscribe, redeem, mint, burn, distribute and claim (D3).

Issuer burns are **not** exempt from the pause. If a correction is needed while paused, the sequence is
unpause, correct, re-pause. This is one more step for the operator and one fewer special case for a
reviewer to reason about, which is the right trade.

Two things keep working while paused, on purpose: `setNAV`, so the published price does not go stale
during an incident, and registry changes, so verification and the blocklist can still be corrected.

---

## 7. Input bounds

Every amount, NAV and reported-AUM input is capped at 2^128 − 1 and rejected with `AmountTooLarge` or
`InvalidNav` above it (D28). The cap is not there to limit anyone, it is orders of magnitude above any
real amount. It is there so that every intermediate multiplication provably fits in 256 bits, which
means the contract never reverts with a bare arithmetic panic. Every rejection a caller can trigger is
a named custom error explaining what went wrong.

Constructors reject the zero address rather than deploying a contract wired to nothing.

---

## 8. Roles

| Role | Held by | What it can do |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | Admin key | Grant and revoke roles, edit the country blocklist, force a NAV update past the rail, set the rail width and the minimum subscription |
| `REGISTRAR_ROLE` | Registrar key (the simulated KYC worker) | Verify and de-verify addresses |
| `ISSUER_ROLE` | Issuer key | Distribute coupons, operational mint and burn, pause and unpause |
| `ORACLE_ROLE` | Oracle key (the NAV engine) | Update NAV within the rail |

Roles are separate by design even though one key could hold all of them on a testnet. The separation is
the production shape, and the deploy script takes four addresses precisely so the split is real from
the first deployment.

A subscription below the minimum, 100 USDC by default, is rejected with `BelowMinimum`. The admin can
change or disable it.

---

## 9. What is enforced here versus in production

| Rule | This MVP | Production |
|---|---|---|
| Identity verification | Auto-approved by a simulated registrar after a short delay | The licensed partner's KYC vendor writes to the registry |
| Country blocklist | Same contract, same codes | Same contract, driven by the partner's compliance policy |
| Transfer restrictions | Same contract | Same rules in the vendor's audited implementation of this spec |
| Investor type | Professional only, retail rejected | Same in phase one |
| NAV | Our engine, oracle key on a test network | The fund administrator's NAV |
| Custody | None. The portfolio is simulated | Broker-Euroclear and a licensed digital custodian |

---

*This is a technical demonstration on a public test network. Portfolio data, prices and attestations
are simulated or illustrative and are labelled as such. Nothing here is an offer, solicitation or
recommendation to buy any security. HitBite is not a licensed financial institution.*
