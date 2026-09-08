"""Hand-built NAV fixture (independent of nav_engine).

This script is the "spreadsheet" the engine must tie out to. It deliberately does not import
nav_engine: every formula is written out explicitly so a reviewer can follow it line by line.
Conventions are documented in FIXTURE.md next to this file. Run:

    uv run python tests/fixtures/build_fixture.py

Outputs (all in this directory): nav_fixture.csv, bonds_fixture.csv, scenarios_fixture.csv,
distributions_fixture.csv (input, written here so the fixture is self-contained).
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal, getcontext
from pathlib import Path

getcontext().prec = 40

HERE = Path(__file__).resolve().parent
DATA = HERE.parent.parent / "data"

MGMT_FEE = Decimal("0.0075")
FUND_EXP = Decimal("0.0030")
FEE_BASIS = Decimal(365)
CENT = Decimal("0.01")
MICRO = Decimal("0.000001")

START = date(2026, 9, 8)  # inception
END = date(2026, 9, 15)  # fixture horizon
SHIFTS_BP = [-200, -100, -50, 50, 100, 200]
CDS_BETA = 1.0
CDS_SHOCKS_BP = [50, 100, 200]

# One simulated on-chain distribution inside the window (usdc per token = per reference unit).
DISTRIBUTIONS = [
    {"date": date(2026, 9, 11), "distribution_id": 1, "usdc_per_token": Decimal("0.008000")},
]


# ----------------------------------------------------------------------------- day count
def days_30_360(d1: date, d2: date) -> int:
    """30/360 US (Bond Basis): D1 = min(D1, 30); if D1 == 30 and D2 == 31 then D2 = 30."""
    dd1 = min(d1.day, 30)
    dd2 = d2.day
    if dd1 == 30 and dd2 == 31:
        dd2 = 30
    return 360 * (d2.year - d1.year) + 30 * (d2.month - d1.month) + (dd2 - dd1)


def add_months(d: date, months: int) -> date:
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    return date(y, m, d.day)  # day-of-month is 1 for every bond here


# ----------------------------------------------------------------------------- bonds
@dataclass(frozen=True)
class Bond:
    name: str
    coupon_pct: Decimal
    maturity: date
    face: Decimal
    freq: int = 2

    def schedule(self, after: date) -> list[date]:
        """Coupon dates strictly after `after`, ascending, generated backwards from maturity."""
        dates: list[date] = []
        d = self.maturity
        while d > after:
            dates.append(d)
            d = add_months(d, -12 // self.freq)
        return sorted(dates)

    def prev_coupon(self, on: date) -> date:
        d = self.maturity
        while d > on:
            d = add_months(d, -12 // self.freq)
        return d

    def accrued(self, on: date) -> Decimal:
        prev = self.prev_coupon(on)
        days = days_30_360(prev, on)
        per_period = self.face * self.coupon_pct / Decimal(100) / Decimal(self.freq)
        return per_period * Decimal(days) / Decimal(360 // self.freq)

    def cash_flows(self, on: date) -> list[tuple[float, float]]:
        """(t in periods, amount per 100 face) for each remaining flow after `on`."""
        c = float(self.coupon_pct) / self.freq
        flows = []
        for d in self.schedule(on):
            t = days_30_360(on, d) / (360 / self.freq)
            amt = c + (100.0 if d == self.maturity else 0.0)
            flows.append((t, amt))
        return flows


def price_from_yield(flows: list[tuple[float, float]], y: float, freq: int = 2) -> float:
    return sum(a / (1 + y / freq) ** t for t, a in flows)


def ytm_from_price(
    flows: list[tuple[float, float]], dirty: float, y0: float, freq: int = 2
) -> float:
    y = y0
    for _ in range(100):
        f = price_from_yield(flows, y, freq) - dirty
        dfdy = sum(-t / freq * a / (1 + y / freq) ** (t + 1) for t, a in flows)
        step = f / dfdy
        y -= step
        if abs(step) < 1e-14:
            break
    return y


def risk(flows: list[tuple[float, float]], y: float, freq: int = 2) -> tuple[float, float]:
    """(modified duration in years, convexity in years^2)."""
    p = price_from_yield(flows, y, freq)
    pv = [(t, a / (1 + y / freq) ** t) for t, a in flows]
    macaulay = sum(t / freq * v for t, v in pv) / p
    modified = macaulay / (1 + y / freq)
    convexity = sum(t * (t + 1) * v for t, v in pv) / (p * freq**2 * (1 + y / freq) ** 2)
    return modified, convexity


# ----------------------------------------------------------------------------- inputs
def load_bonds() -> tuple[list[Bond], Decimal, Decimal]:
    pf = json.loads((DATA / "portfolio.json").read_text())
    bonds = [
        Bond(
            name=p["name"],
            coupon_pct=Decimal(str(p["coupon_pct"])),
            maturity=date.fromisoformat(p["maturity"]),
            face=Decimal(str(p["face_usd"])),
            freq=int(p["frequency"]),
        )
        for p in pf["positions"]
    ]
    return bonds, Decimal(str(pf["cash_usd"])), Decimal(str(pf["fees_payable_usd"]))


def load_prices() -> dict[tuple[date, str], Decimal]:
    out: dict[tuple[date, str], Decimal] = {}
    with (DATA / "prices.csv").open() as f:
        for row in csv.DictReader(f):
            out[(date.fromisoformat(row["date"]), row["name"])] = Decimal(row["clean_price"])
    return out


def clean_price(prices: dict[tuple[date, str], Decimal], on: date, name: str) -> Decimal:
    d = on
    while (d, name) not in prices:
        d -= timedelta(days=1)
        if d < START - timedelta(days=30):
            raise KeyError(f"no price for {name} on or before {on}")
    return prices[(d, name)]


# ----------------------------------------------------------------------------- build
def main() -> None:
    bonds, cash, fees_payable = load_bonds()
    prices = load_prices()

    with (HERE / "distributions_fixture.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date", "distribution_id", "usdc_per_token"])
        for d in DISTRIBUTIONS:
            w.writerow([d["date"].isoformat(), d["distribution_id"], f"{d['usdc_per_token']:.6f}"])

    nav_rows: list[dict[str, str]] = []
    bond_rows: list[dict[str, str]] = []
    reference_units: Decimal | None = None
    nav_total_prev: Decimal | None = None
    dist_per_unit_cum = Decimal(0)

    d = START
    while d <= END:
        # 1. fee accrual on the previous day's NAV_total (ACT/365F), none on inception day
        if nav_total_prev is not None:
            fees_payable += nav_total_prev * (MGMT_FEE + FUND_EXP) / FEE_BASIS

        # 2. coupon receipts (none in this window, but the rule is applied)
        for b in bonds:
            if d != START and b.prev_coupon(d) == d:
                cash += b.face * b.coupon_pct / Decimal(100) / Decimal(b.freq)

        # 3. positions
        sum_mv = Decimal(0)
        per_bond = []
        for b in bonds:
            clean = clean_price(prices, d, b.name)
            accrued = b.accrued(d)
            dirty = clean + accrued / b.face * Decimal(100)
            mv = b.face * dirty / Decimal(100)  # == face*clean/100 + accrued
            sum_mv += mv
            flows = b.cash_flows(d)
            y = ytm_from_price(flows, float(dirty), float(b.coupon_pct) / 100)
            mod_dur, conv = risk(flows, y)
            per_bond.append((b, clean, accrued, dirty, mv, y, mod_dur, conv))

        # 4. distributions on this day reduce reference cash pro-rata (after inception units are known)
        if reference_units is not None:
            for dist in DISTRIBUTIONS:
                if dist["date"] == d:
                    cash -= dist["usdc_per_token"] * reference_units
                    dist_per_unit_cum += dist["usdc_per_token"]

        nav_total = sum_mv + cash - fees_payable
        if reference_units is None:
            reference_units = nav_total  # inception: unit NAV = 1.000000 by construction
        nav_per_unit = (nav_total / reference_units).quantize(MICRO, rounding=ROUND_HALF_UP)

        # portfolio risk, market-value weighted
        ytm_w = sum(float(mv / sum_mv) * y for (_, _, _, _, mv, y, _, _) in per_bond)
        dur_w = sum(float(mv / sum_mv) * md for (_, _, _, _, mv, _, md, _) in per_bond)
        conv_w = sum(float(mv / sum_mv) * cv for (_, _, _, _, mv, _, _, cv) in per_bond)

        for b, clean, accrued, dirty, mv, y, mod_dur, conv in per_bond:
            bond_rows.append(
                {
                    "date": d.isoformat(),
                    "name": b.name,
                    "clean_price": f"{clean:.4f}",
                    "prev_coupon_date": b.prev_coupon(d).isoformat(),
                    "next_coupon_date": b.schedule(d)[0].isoformat(),
                    "days_accrued_30_360": str(days_30_360(b.prev_coupon(d), d)),
                    "accrued_usd": f"{accrued.quantize(CENT, ROUND_HALF_UP)}",
                    "dirty_price": f"{dirty:.8f}",
                    "market_value_usd": f"{mv.quantize(CENT, ROUND_HALF_UP)}",
                    "ytm_pct": f"{y * 100:.8f}",
                    "modified_duration": f"{mod_dur:.8f}",
                    "convexity": f"{conv:.8f}",
                }
            )

        nav_rows.append(
            {
                "date": d.isoformat(),
                "sum_market_value_usd": f"{sum_mv.quantize(CENT, ROUND_HALF_UP)}",
                "cash_usd": f"{cash.quantize(CENT, ROUND_HALF_UP)}",
                "fees_payable_usd": f"{fees_payable.quantize(CENT, ROUND_HALF_UP)}",
                "nav_total_usd": f"{nav_total.quantize(CENT, ROUND_HALF_UP)}",
                "reference_units": f"{reference_units:.10f}",
                "nav_per_unit": f"{nav_per_unit}",
                "nav_usdc_6dec": str(int(nav_per_unit * Decimal(1_000_000))),
                "weighted_ytm_pct": f"{ytm_w * 100:.8f}",
                "modified_duration": f"{dur_w:.8f}",
                "convexity": f"{conv_w:.8f}",
                "distributions_per_unit_cum": f"{dist_per_unit_cum:.6f}",
            }
        )
        nav_total_prev = nav_total
        d += timedelta(days=1)

    # scenarios on the horizon date: reprice each bond at y + shift, cash/fees unchanged
    last = END
    base_rows = [r for r in bond_rows if r["date"] == last.isoformat()]
    base_nav_total = Decimal(nav_rows[-1]["nav_total_usd"])
    cash_last = Decimal(nav_rows[-1]["cash_usd"])
    fees_last = Decimal(nav_rows[-1]["fees_payable_usd"])
    scen_rows = []

    def nav_after_shift(shift_bp: float) -> Decimal:
        total = Decimal(0)
        for b, r in zip(bonds, base_rows, strict=True):
            flows = b.cash_flows(last)
            y = float(r["ytm_pct"]) / 100 + shift_bp / 10_000
            dirty = price_from_yield(flows, y)
            total += b.face * Decimal(repr(dirty)) / Decimal(100)
        return total + cash_last - fees_last

    for s in SHIFTS_BP:
        n = nav_after_shift(s)
        scen_rows.append(
            {
                "scenario": f"parallel_{s:+d}bp",
                "shift_bp": str(s),
                "nav_total_usd": f"{n.quantize(CENT, ROUND_HALF_UP)}",
                "delta_usd": f"{(n - base_nav_total).quantize(CENT, ROUND_HALF_UP)}",
                "delta_pct": f"{float((n - base_nav_total) / base_nav_total) * 100:.6f}",
            }
        )
    for s in CDS_SHOCKS_BP:
        n = nav_after_shift(s * CDS_BETA)
        scen_rows.append(
            {
                "scenario": f"cds_+{s}bp_beta{CDS_BETA:g}",
                "shift_bp": f"{s * CDS_BETA:g}",
                "nav_total_usd": f"{n.quantize(CENT, ROUND_HALF_UP)}",
                "delta_usd": f"{(n - base_nav_total).quantize(CENT, ROUND_HALF_UP)}",
                "delta_pct": f"{float((n - base_nav_total) / base_nav_total) * 100:.6f}",
            }
        )

    for name, rows in (
        ("nav_fixture.csv", nav_rows),
        ("bonds_fixture.csv", bond_rows),
        ("scenarios_fixture.csv", scen_rows),
    ):
        with (HERE / name).open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        print(f"wrote {name} ({len(rows)} rows)")


if __name__ == "__main__":
    main()
