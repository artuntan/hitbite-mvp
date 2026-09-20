# NAV and coupon model


No real bonds are held, no real investor funds are accepted, and hbTRS has no claim on a real security. The portfolio contains model holdings named TURKEY 6.0% 2029, TURKEY 6.65% 2034 and TURKEY 7.04% 2036, with target weights of 40% / 40% / 20%. Their identifiers, coupon schedules, prices and valuations are explicitly simulated. There are no real ISINs, audit claims or partner endorsements.

The reference basket has 100,000 units. Its dirty prices, retained simulated coupon cash and accrued fees determine a reference price per unit. Holdings are scaled to the **actual on-chain token supply at a recorded block**. Subscriptions therefore cannot mechanically dilute the simulated NAV. Faucet-funded vault cash is reported separately and is never added to the simulated bond value.

- Clean prices are manual inputs with visible source/date fields. They carry forward until revised; daily NAV publication does not make these market quotes fresh.
- Bond accrued interest uses declared semiannual Actual/Actual periods. Simulated bond coupons received since purchase remain in model cash, preventing a discontinuity at a coupon date.
- Fees accrue on the fixed reference units at 0.75% management plus 0.30% simulated expenses per year, Actual/365. They are model expenses, not a cash subscription fee; subscription fees are zero.
- NAV is floored to six USDC decimals. Token quantities use 18 decimals. At zero supply, the reference price remains available but the backing ratio is undefined and the snapshot says `bootstrap`.
- Simulated yield to maturity is computed from discounted model cash flows. The simulated trailing 30-day distribution yield uses actual funded coupon-index increments divided by current NAV and is **not annualized**. These figures appear only on Transparency.
- On-chain coupons are independently funded by the issuer. They do not silently reduce NAV. Unpaid coupons, including rounding dust, are reserved from redeemable vault liquidity.
- Simulated attestor. Replaced by an independent firm in production. An EIP-191 signature authenticates the exact historical JSON payload against the configured public signer; it is not evidence of real custody or independent review.

## Inputs and implementation

See [`nav_engine/hb.py`](../nav_engine/hb.py), the files in [`nav_engine/`](../nav_engine/), and the [math tests](../tests/nav/). Public [NAV](https://hitbite.markets/data/nav.json) and [attestation](https://hitbite.markets/data/attestation.json) records preserve valuation inputs and publication receipts.

A model valuation is not evidence of real assets. The on-chain vault balance is the source for testnet redemption liquidity. A signature proves the configured signer signed a payload; it does not make its inputs independently verified.
