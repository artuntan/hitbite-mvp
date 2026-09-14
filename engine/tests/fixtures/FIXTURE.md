# NAV fixture — hand-built conventions

`build_fixture.py` is the independent "spreadsheet" the engine ties out to. It does **not** import
`nav_engine`. Inputs are `engine/data/portfolio.json` and `engine/data/prices.csv` plus the one
simulated distribution in `distributions_fixture.csv`. Horizon: 2026-09-08 (inception) to 2026-09-15.

Tie-out tolerances the engine tests must meet:

| Quantity | Tolerance |
|---|---|
| `market_value_usd`, `accrued_usd`, `cash_usd`, `fees_payable_usd`, `nav_total_usd` | exact to the cent (Decimal, rounded HALF_UP only when written) |
| `nav_per_unit`, `nav_usdc_6dec` | exact (6 decimals, HALF_UP) |
| `ytm_pct`, `modified_duration`, `convexity` (per bond and weighted) | abs 1e-6 |
| scenario `delta_usd` | abs 0.05 USD; `delta_pct` abs 1e-4 |

## Conventions

1. **Day count 30/360 US (Bond Basis).** `D1 = min(D1, 30)`; if `D1 == 30` and `D2 == 31` then `D2 = 30`;
   `days = 360·(Y2−Y1) + 30·(M2−M1) + (D2−D1)`.

   This hand calculation omits the two February end-of-month rules, and `build_fixture.py` omits them
   too. That is exact for this book — every coupon date is the 1st of a month, so no February rule can
   fire, and the fixture remains a valid independent oracle for every number in the table below.
   It is **not** the whole convention. `nav_engine.daycount.days_30_360_us` implements 30/360 US
   (NASD/SIA) in full, including both February rules, in the canonical order. Use this fixture as the
   oracle for the shipped book; the end-of-month behaviour is pinned instead by
   `tests/test_daycount.py::test_days_30_360_us_february_end_of_month` and by the property tests in
   `tests/test_bonds.py` that assert accrued interest never reaches a full coupon and that NAV never
   falls across a coupon date. Do not extend this fixture to an end-of-month schedule without
   implementing the February rules in `build_fixture.py` first.
2. **Coupon schedule.** Semi-annual, generated backwards from maturity on the same day-of-month. For 1 March
   maturities the dates are 1 March and 1 September. Previous coupon date = latest schedule date ≤ valuation date.
3. **Accrued interest.** `face × (coupon_pct/100)/2 × days(prev_coupon, d)/180`. Dirty price (per 100) =
   clean + accrued/face × 100. Position market value = `face × dirty/100` = `face × clean/100 + accrued`.

   The constant `180` denominator is the same simplification as convention 1, and exact for the same
   reason: every coupon period in this book measures 180 days on the 30/360 clock. The engine divides
   by the live period, `days_30_360_us(prev_coupon, next_coupon)`, which differs only for end-of-month
   schedules, where a constant denominator would let accrued interest exceed a full coupon and make NAV
   fall on a coupon date.
4. **Yield to maturity.** Street convention, semi-annual compounding, fractional first period on 30/360:
   `dirty = Σ CF_k / (1 + y/2)^{t_k}` with `t_k = days(d, cf_date)/180` in periods; CF per 100 face =
   coupon/2 (+100 at maturity). Solved by Newton from `y₀ = coupon`, stop when |step| < 1e-14.
5. **Risk.** `Macaulay (years) = Σ (t_k/2)·PV_k / P`; `Modified = Macaulay/(1+y/2)`;
   `Convexity (years²) = Σ t_k(t_k+1)·PV_k / (P · 4 · (1+y/2)²)`. Portfolio figures are market-value weighted.
6. **Fees.** `(0.75% + 0.30%)/365 × NAV_total(d−1)` added to `fees_payable` every calendar day after inception
   (ACT/365F). Nothing accrues on inception day. Fees are a liability; they are never paid out in the window.
7. **Prices.** Days without a price row carry the last known clean price forward (weekends 12–13 September).
8. **Coupon receipts.** On a coupon date (none in this window) cash increases by `face × coupon/2` and accrued
   restarts from zero. The rule is implemented so the engine's behaviour is pinned even though the fixture has no case.
9. **Reference units (PLAN.md D19).** `reference_units = NAV_total(inception)` = 1,013,757.6666666667, so
   `nav_per_unit = NAV_total / reference_units` is exactly 1.000000 on inception day.
10. **Distributions.** A distribution of `x` USDC per token on day `d` reduces reference cash by
    `x × reference_units` on that day (ex-distribution NAV). Fixture: 0.008000 per token on 2026-09-11.
11. **Rounding.** All money arithmetic is exact `Decimal`; rounding HALF_UP happens only when writing
    (cents for USD, 6 decimals for the unit NAV). `nav_usdc_6dec = int(nav_per_unit × 1e6)`.
12. **Scenarios (horizon date).** Reprice every bond at `y_i + shift` (parallel) with cash and fees unchanged.
    CDS shock: `shift = shock × beta`, `beta = 1.0` (stated simplification: spread moves pass 1:1 into yields).
13. **Distribution yield (not in the fixture table).** Trailing window = min(365, days since inception + 1).
    Raw trailing yield = Σ distributions per unit in window / average `nav_per_unit` in window. Annualised
    only when the window is ≥ 30 days (`× 365/window_days`); otherwise `null` with a note. Always report
    `window_days` and months available.

## Rules the engine implements that this fixture has no case for

Like convention 8, these are pinned by tests in `engine/tests/` rather than by a row of
`nav_fixture.csv`; none of them moves a number in the table above.

14. **Maturity and redemption (buy-and-hold).** On a bond's maturity date its face is paid into cash
    alongside the final coupon (`redemptions` next to `coupon_receipts`), and from that date the line
    carries no clean price, no accrual, no market value and no yield, duration or convexity: it moves
    from `positions` to `matured_positions` and does not enter the market-value weights, the
    scenarios or `holdings.json`. NAV therefore only steps by the last day of accrual, and a fully
    redeemed book still produces a NAV (all cash). There is no sale or reinvestment rule, and a
    position whose maturity is on or before the inception date is rejected as a data error. The
    fixture horizon ends 2026-09-15; the first maturity in the book is 2029-03-01.
15. **One price row per bond per pricing day.** `prices.csv` is maintained by hand, so a repeated
    `(name, date)` is rejected with the conflicting line numbers instead of being resolved by file
    order. Carry-forward (convention 7) fills gaps; it never resolves conflicts.
16. **A distribution may not exceed the NAV it is deducted from.** Per-token amounts are checked
    against the pre-distribution unit NAV of that day and rejected when `per_token >= nav`, mirroring
    `HBToken.distributeCoupon`'s `DistributionExceedsNav` revert (PLAN.md D26), so the engine never
    publishes a NAV the chain would refuse to accept. Same-day distributions are summed before the
    check; `distributions_per_unit_cum` accumulates over the whole path.
