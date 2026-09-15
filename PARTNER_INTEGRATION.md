# Partner integration

**Testnet demonstration on Base Sepolia. Simulated portfolio and attestation. Not an offer of securities.**

This page is for a DeFi vault curator, an exchange listing team, or anyone else deciding whether
`hbTRS` can sit inside their system. It covers how to read the price, what the transfer rules do to
a custody wallet, how to check the transparency documents, and how to price the token as collateral.

Read [`RISKS.md`](RISKS.md) first if you have not. The short version: this is a testnet reference
implementation, the portfolio is simulated, the contracts are unaudited, and there is no legal
issuer. Nothing below describes an asset you can hold today.

---

## 1. The one thing that will surprise you

**`hbTRS` is whitelisted at the token level.** An address that is not in the registry cannot receive
it. That is enforced in the contract, on every mint and every transfer, not in an interface you
could bypass.

For an integrator this has a specific consequence: **the wallet that actually holds the tokens must
be verified.** If you run an omnibus or vault wallet, that contract address needs a registry entry
of its own. Verifying your users does nothing for a transfer into a vault they do not control.

Two deliberate asymmetries follow, and they are worth knowing before you model anything:

- **Receiving is restricted, exiting is not.** Redemption and coupon claims do not check the
  sender's eligibility. An address that loses its verification can still get its money out. Your
  vault will never be trapped by a registry change.
- **A country can be blocked after the fact.** The admin can block a jurisdiction at any time, and
  holders in it immediately stop being able to receive. Their existing balance is untouched and
  still redeemable.

---

## 2. Reading NAV

NAV is an integer in USDC units, six decimals, per one whole token. It starts at `1000000`, meaning
1.00.

### On-chain, which is the authoritative source

```ts
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { hbTokenAbi } from "./abis"; // contracts/out/HBToken.sol/HBToken.json

const client = createPublicClient({ chain: baseSepolia, transport: http() });

const nav = await client.readContract({
  address: HB_TOKEN_ADDRESS,
  abi: hbTokenAbi,
  functionName: "nav",
}); // 1003061n  ->  1.003061 USDC per token
```

Do not divide that by `1e6` into a float. Keep it as an integer and format at the edge. Every layer
of this system does the same thing, which is why the numbers agree.

### Off-chain, with the assumptions attached

```bash
curl -s https://<host>/api/nav
```

```json
{
  "ok": true,
  "data": {
    "as_of": "2026-09-14",
    "simulated": true,
    "nav": { "per_token_usd": "1.003061", "usdc_6dec": 1003061 },
    "source_note": "Simulated reference book. Coupons and maturities are illustrative placeholders..."
  }
}
```

Money arrives twice: as a fixed-scale decimal string and as the six-decimal integer beside it. They
are the same number. Parse the integer; the string is for display. Never parse either into a
floating-point number, and note that the string always carries a fixed number of fractional digits,
which is what makes an exact parse safe.

Every response is wrapped in `{ ok, data }`, with a stable error envelope on failure, and carries
`Cache-Control: s-maxage=60`.

### Checking that the two agree

They must. The transparency page does this check in public, and you should do it yourself before
trusting anything else:

```bash
ONCHAIN=$(cast call $HB_TOKEN "nav()(uint256)" --rpc-url $RPC)
OFFCHAIN=$(curl -s https://<host>/api/nav | jq '.data.nav.usdc_6dec')
[ "$ONCHAIN" = "$OFFCHAIN" ] && echo agree || echo DISAGREE
```

A disagreement is not a rounding issue. It means the published document and the price the contract
is settling at have diverged, and nothing downstream should be trusted until it is explained.

---

## 3. Can this address hold the token?

```ts
const eligible = await client.readContract({
  address: IDENTITY_REGISTRY_ADDRESS,
  abi: identityRegistryAbi,
  functionName: "canHold",
  args: [vaultAddress],
}); // false until the vault address itself is verified
```

`canHold` is the single question the token asks. It is true when the address has a verification
record and its country is not blocked. `identityOf(address)` returns the full record if you need the
country or the timestamp.

Call this before you attempt a transfer, not after. A transfer to an ineligible address reverts with
`NotEligible(address)`, which is clear but costs gas and looks like a failure to your users.

---

## 4. The other endpoints

| Endpoint | What it gives you |
|---|---|
| `/api/nav` | NAV per token, NAV total, valuation date, and the assumptions behind them |
| `/api/holdings` | Every position: face, clean price, accrued, dirty, market value, weight, yield, duration |
| `/api/stats` | Supply, chain id, NAV agreement, and what is not yet available |
| `/api/attestation` | The signed holdings document, or an explicit `not_published` state |
| `/api/events` | Recent contract events over a bounded block window |

Two of these are honest about their limits in ways worth reading rather than discovering:

**`/api/attestation` may return `status: "not_published"`.** That is a normal state, answered with
HTTP 200, carrying the reason and the command that would publish one. It is not an error and should
not be retried as one. Until an attestation exists there is nothing to verify, and the API says so
rather than returning an empty object you might mistake for a valid document.

**`/api/events` is deliberately minimal.** One bounded `eth_getLogs` over a 10,000-block window,
newest first. Every response carries a `limitations` array naming exactly what is missing, plus
`window_truncated` and `results_truncated` flags. There is no cursor, no filter by event name, and
no server-side index. `/api/stats` returns `holders: null` for the same reason. If you need complete
history today, index the chain yourself from the `deployBlock` in
`contracts/deployments/<chain>.json`.

---

## 5. Verifying an attestation

The attestation is a canonical JSON document signed with EIP-191. The exact signed string is
published as `signature.message`, so you never have to reproduce the canonicalisation yourself:

```ts
import { verifyMessage } from "viem";

const doc = await fetch("https://<host>/api/attestation").then((r) => r.json());
if (doc.data.status !== "published") {
  // Nothing has been signed yet. Do not treat this as a failure.
  return;
}

const { message, signature, attestor_address } = doc.data.signature;
const valid = await verifyMessage({ address: attestor_address, message, signature });
```

**What a valid signature proves, and what it does not.** It proves the document has not been altered
since that key signed it. It does not prove the holdings exist. In this MVP the attestor key is ours,
which is why the document labels itself *Simulated attestor — an independent firm signs in
production.* Treat it as a tamper-evidence seal, not as an audit.

---

## 6. Event schemas

All from `contracts/src/interfaces/IHBToken.sol` and `IIdentityRegistry.sol`.

| Event | Signature | What it tells you |
|---|---|---|
| `NAVUpdated` | `(uint256 oldNav, uint256 newNav, uint256 reportedAUM, uint256 timestamp)` | Every price change, including the drop at a distribution |
| `NAVForced` | `(uint256 oldNav, uint256 newNav, address indexed by)` | An admin bypassed the rail. Always investigate |
| `Subscribed` | `(address indexed account, uint256 usdcIn, uint256 tokensOut, uint256 nav)` | A subscription and the price it settled at |
| `Redeemed` | `(address indexed account, uint256 tokensIn, uint256 usdcOut, uint256 nav)` | A redemption |
| `CouponDistributed` | `(uint256 indexed distributionId, uint256 usdcAmount, uint256 allocated, uint256 couponIndex, uint256 supply)` | A distribution. `NAVUpdated` fires alongside it |
| `CouponClaimed` | `(address indexed account, uint256 usdcAmount)` | A holder took their coupon |
| `OperationalMint` / `OperationalBurn` | `(address indexed, uint256 amount)` | Issuer correction. Deliberately its own event rather than hiding in `Transfer` |
| `IdentityVerified` | `(address indexed account, uint16 country, uint8 investorType, uint64 verifiedAt)` | An address became eligible |
| `IdentityRemoved` | `(address indexed account)` | An address stopped being eligible to receive |
| `CountryBlockStatusChanged` | `(uint16 country, bool blocked)` | The jurisdiction list changed |

If you monitor one event, monitor `NAVForced`. Every other NAV change is bounded by the rail; that
one is not.

---

## 7. Pricing it as collateral

The honest inputs, and where each comes from:

| Input | Source | Note |
|---|---|---|
| Price per token | `nav()` on-chain | Six-decimal integer. The only authoritative price |
| Position value | `balanceOf(account) × nav / 1e18` | Integer arithmetic throughout |
| Liquidatable now | `availableLiquidity()` | Vault USDC **minus** the coupon reserve |
| Interest-rate risk | `/api/holdings` modified duration | Simulated book, but the arithmetic is real |
| Is the token frozen | `paused()` | A paused token cannot be liquidated at all |

```ts
const [balance, nav, available, paused] = await Promise.all([
  client.readContract({ ...hb, functionName: "balanceOf", args: [account] }),
  client.readContract({ ...hb, functionName: "nav" }),
  client.readContract({ ...hb, functionName: "availableLiquidity" }),
  client.readContract({ ...hb, functionName: "paused" }),
]);

const valueUsdc = (balance * nav) / 10n ** 18n; // 6 decimals
const HAIRCUT_BPS = 2500n; // your risk parameter, not ours
const collateralUsdc = (valueUsdc * (10_000n - HAIRCUT_BPS)) / 10_000n;
```

Four things should shape the haircut you choose, and the first two are the ones integrators usually
miss:

1. **`availableLiquidity()` is the real exit, not NAV.** Redemption is first come, first served and
   simply reverts once the vault runs dry. A position larger than available liquidity cannot be
   liquidated at NAV on demand, whatever NAV says.
2. **Coupon money is ring-fenced and is not liquidity.** `availableLiquidity()` already excludes it.
   Do not use `vaultBalance()` in its place.
3. **The oracle can move the price 5% per 24-hour window** without anyone's approval, measured from
   the window's starting value, and further than that with the admin key.
4. **A pause stops liquidation entirely.** There is no time limit on it and no guardian.

Size your haircut against the liquidity you can actually draw, not the notional you can see.

---

## 8. Addresses and chains

Testnet only: Base Sepolia (84532) and a local Anvil (31337). There is no mainnet deployment and no
mainnet configuration anywhere in this repository.

Addresses, the deploy block and the creation transaction hashes live in
`contracts/deployments/<chain>.json`, which is written by the deploy script and committed. Start any
log scan from `deployBlock` rather than from genesis.

---

*This is a technical demonstration on a public test network. Portfolio data, prices and attestations
are simulated or illustrative and are labelled as such. Nothing here is an offer, solicitation or
recommendation to buy any security. HitBite is not a licensed financial institution.*
