# Risks

**Testnet demonstration on Base Sepolia. Simulated portfolio and attestation. Not an offer of securities.**

This page is written in plain language, without hedging, because a risk page that reads like a
disclaimer is useless to the person it is supposed to protect. The `/risks` page in the web app renders
this file (D12).

Read section 1 first. It is the one that applies to everything else on this page.

---

## 1. Nothing here is real yet

This is a public reference implementation on a test network. Specifically:

- **The portfolio is simulated.** The three bond positions are illustrative placeholders. Their
  coupons and maturities were chosen to sit at the yield levels observed on the Türkiye USD curve on
  31 August 2026. They are labelled `(illustrative)` in the data and in the interface, and their ISINs
  are marked `TBD` rather than invented. No bond has been bought. No custodian holds anything.
- **The money is fake.** Subscriptions settle in `MockUSDC`, a test token this repository deploys and
  gives away from a faucet. It has no value.
- **The verification is not KYC.** A simulated registrar approves requests automatically after a short
  delay. No identity document is checked, collected or stored. Do not submit real personal data.
- **The attestation is self-signed.** A key in this repository's environment signs the holdings
  document. In production an independent firm signs it. The signature proves the document has not been
  altered since it was signed. It proves nothing about whether the holdings exist.
- **There is no legal issuer, no licence and no audit.** HitBite is not a licensed financial
  institution. Nothing on this site is an offer, a solicitation or a recommendation.

Everything below describes risks that **would** apply to the real product this demonstrates. They are
written so that a reviewer can judge whether the team understands what it is building toward.

---

## 2. Risks in the bonds themselves

### Interest rate risk

The portfolio holds fixed-coupon bonds maturing between 2029 and 2036. When market yields rise, the
price of a fixed coupon falls, and NAV falls with it. Longer bonds fall further for the same move in
yield. This is the single largest driver of day-to-day NAV movement, and it is not a tail risk. It is
the normal behaviour of the asset.

The engine computes modified duration and convexity for each position and for the portfolio, and
publishes a sensitivity table for parallel yield shifts of ±50, ±100 and ±200 basis points. Those
numbers are on the transparency page. They are the honest answer to "how much can this move".

### Sovereign credit risk

These are obligations of the Republic of Türkiye. If Türkiye's creditworthiness deteriorates, the
bonds fall in price. If Türkiye fails to pay a coupon or principal, holders lose money, and the loss
can be most of the investment. Türkiye's five-year credit default swap spread was near 217 basis
points on 31 August 2026, which is the market's price for that risk at that moment. It moves.

Sovereign debt restructuring is not a hypothetical category of event. When it happens, it typically
happens quickly and the recovery is negotiated, not contractual.

### Concentration

Every position is an obligation of a single issuer, in a single currency, from a single country. There
is no diversification here and none is claimed. A concentrated country fund is the product. An
investor who wants diversification gets it by sizing this position within a wider portfolio, not from
inside it.

### Currency

The bonds are denominated in US dollars, so there is no Turkish lira exposure in the instrument. An
investor whose own base currency is not the dollar carries dollar exposure regardless.

### Reinvestment and call features

Coupons received are passed through to holders rather than reinvested, so the yield an investor
actually realises depends on what they do with the cash. Where a real bond carries a call or a make-
whole provision, its yield to maturity overstates the return if the issuer calls it. The illustrative
placeholders here are modelled as bullet bonds with no call.

---

## 3. Risks in the structure

### Redemption liquidity

Redemptions are paid from USDC actually sitting in the vault. Bonds do not settle instantly, and in
the real product a large redemption would require selling positions into the market at whatever price
is available that day. If the vault cannot cover a redemption, it reverts, visibly, with the amount
that *is* available.

Two consequences follow, and both are deliberate. First, coupon money is ring-fenced: the contract
will not pay a redemption out of USDC owed to holders who have not yet claimed their coupons. Second,
a redemption that cannot be met fails rather than partially filling, so nobody is left guessing what
happened.

An investor should assume that in stressed markets, redeeming a large position takes time or costs
more than NAV.

### NAV is computed, not quoted

NAV is calculated from clean prices, accrued interest, cash and accrued fees. Bond prices for
instruments like these come from dealers, not from a continuous exchange. Two reasonable sources can
disagree. Prices for a given day may be stale. The NAV published here is a model output, and the
transparency page shows every input that went into it precisely so the model can be checked rather
than trusted.

### Oracle risk

NAV reaches the contract through an oracle key. If that key is compromised, an attacker can move the
published price, and subscriptions and redemptions settle at whatever it says. The contract limits any
oracle key to a 5% move per 24-hour window, measured from the window's starting value, so the damage
is bounded even across repeated updates. Moving further requires the admin key and emits a distinct
event. This bounds the risk. It does not remove it.

### Key compromise

The registrar key can whitelist addresses. The issuer key can mint, burn, pause and distribute. The
admin key can do all of the above and grant roles. In this MVP these are test keys, and the registrar
key sits on a web server, which is the weakest link in the design and is treated as such in
`SECURITY.md`. In production these are institutional keys under a licensed operator's controls.
Anyone evaluating the production design should ask how those keys are held, not whether they exist.

### Smart contract risk

The contracts in this repository are tested, fuzzed, checked with invariants and run through static
analysis. **They have not been audited.** No amount of self-testing substitutes for an independent
audit, and the production intent is that a licensed vendor's audited implementation of this spec is
what holds real assets. A bug in a token contract can be unrecoverable in a way that a bug in a web
app is not.

### Pause

The issuer can freeze all value movement. That is a protection during an incident and a risk to a
holder who wants to exit during one. Both are true at once. The pause state is public and visible in
the interface.

### Fees

A management fee and simulated fund expenses accrue daily against NAV, at 0.75% and 0.30% a year in
the current configuration. Fees reduce NAV every single day, whatever the market does. Over a
multi-year holding period this compounds into a real drag, which the analytics notebook illustrates
at several fund sizes rather than leaving it as a line in a table.

### Counterparty and custody

In production the assets sit with a broker through Euroclear and a licensed digital custodian, and the
fund is issued and managed by a licensed fund manager in ADGM. Each of those is a counterparty whose
failure matters to a holder. None of them exists in this demonstration.

---

## 4. Regulatory risk

Tokenized sovereign debt is a young area and the rules are being written now. Türkiye's Medium-Term
Programme for 2027 to 2029, published in the Official Gazette on 6 September 2026, committed the state
to writing rules for issuing capital-market instruments as crypto assets. That is a commitment to make
rules, not a completed framework, and the final shape of those rules could change what this product
can be, who may hold it, or whether it can exist in this form at all.

The whitelist already excludes United States and Türkiye residents for exactly this reason. That
exclusion list can grow. An investor whose jurisdiction is added would keep the ability to redeem and
to claim coupons, but would lose the ability to receive tokens.

---

## 5. Technology risk outside the contracts

The token lives on Base Sepolia, a test network that can be reset, halted or reorganised without
notice or recourse. The production chain choice carries its own version of this: an L2 depends on its
sequencer, its bridge and its upgrade keys.

Losing a wallet's private key loses the position. There is no password reset, no support line, and no
mechanism in the contract for anyone to restore access to an address whose key is gone.

---

## 6. What would reduce these risks

Listed plainly, because the honest answer to most of the above is "this is what an MVP looks like":

- An independent audit of the contracts, and a licensed vendor's audited implementation holding real
  assets.
- An independent administrator computing NAV, and an independent firm signing attestations monthly.
- Institutional key custody with multiple signatures on the admin and issuer roles.
- Multiple oracle keys required to agree before NAV updates, which is documented as the production
  direction.
- A real custody chain, with holdings confirmable against the custodian rather than against a file in
  this repository.

---

*This is a technical demonstration on a public test network. Portfolio data, prices and attestations
are simulated or illustrative and are labelled as such. Nothing here is an offer, solicitation or
recommendation to buy any security. HitBite is not a licensed financial institution.*
