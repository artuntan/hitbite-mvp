# notebooks/

`portfolio_analytics.ipynb` — the risk write-up for `hbTRS`: cash-flow calendar, yield/duration/
convexity, NAV sensitivity to parallel yield shifts, a CDS-shock mapping, fee drag, and distribution
yield against an illustrative tokenized T-bill reference (BUILD_PROMPT.md section 10).

> **Testnet demonstration on Base Sepolia. Simulated portfolio and attestation. Not an offer of
> securities.** Every holding, price and figure in the notebook is simulated or illustrative and is
> labelled as such in the notebook, on the figures and in the engine's own output documents.

Rendered output:

- `../docs/portfolio_analytics.html` — the executed notebook, for a reader who does not want to clone.
- `../docs/figures/*.svg` — every figure, in a light and a dark variant.

## Running it

```sh
make notebook          # from the repository root: execute, export the HTML, write the figures
```

or directly, from `engine/`:

```sh
uv sync --group notebook
uv run --group notebook jupyter nbconvert --to notebook --execute --inplace \
    --ExecutePreprocessor.record_timing=False ../notebooks/portfolio_analytics.ipynb
uv run --group notebook jupyter nbconvert --to html \
    --output-dir ../docs --output portfolio_analytics.html ../notebooks/portfolio_analytics.ipynb
```

The `notebook` dependency group (`ipykernel`, `nbconvert`, `matplotlib`) is **not** in the engine's
default groups, so a plain `uv sync` — what CI and a first-time contributor run — installs nothing
extra.

## The two rules this notebook is built on

**1. It imports the engine; it never re-derives it.** Accrual, the yield solver, duration, convexity,
the fee accrual, the scenario repricing and the distribution yield all come from `nav_engine`, the
same package that writes `web/public/data/*.json`, pushes the NAV integer on chain and signs the
attestation. The notebook's second cell rebuilds `nav.json` and `scenarios.json` from
`engine/data/` and asserts they are field-for-field identical to the documents committed under
`web/public/data/` — one field excluded, `chain.warning`, which quotes a machine-local path. If the
engine, the reference book and the published documents ever move apart, the notebook stops there
rather than publishing a second set of numbers.

**2. It has no wall-clock input.** The valuation date and the `generated_at` stamp are read from the
published `nav.json` (with a pinned fallback for a checkout that has never run the engine), the
figures are saved with the SVG date metadata suppressed and a per-figure hash salt, and
`record_timing` is off during execution. Two consecutive runs produce a byte-identical `.ipynb`,
HTML export and set of SVGs — verified by hashing both runs, not assumed.

## Figures

| File stem (`docs/figures/`) | Shows |
|---|---|
| `cashflow-calendar` | Coupon income by calendar year, stacked by bond, over principal repaid at maturity |
| `risk-by-bond` | Modified duration and yield to maturity per bond, against the weighted portfolio figure |
| `nav-sensitivity` | NAV change at ±50/100/200 bp, full repricing, with the duration+convexity approximation over it |
| `cds-shock` | CDS spread shock mapped to NAV at β = 0.50 / 0.75 / 1.00, with the assumption printed on the figure |
| `fee-drag` | Fees accrued over 365 days at 10M/50M/100M AUM, and the compounded drag on unit NAV |
| `distribution-yield` | Gross YTM, indicative coupon yield, YTM net of fees, and the illustrative T-bill reference |

Every figure carries its own title, its assumptions and a "simulated / illustrative" footer, because a
figure lifted into a README travels without the prose around it.

### Using them in a Markdown file

Each figure ships as `<stem>-light.svg` and `<stem>-dark.svg`, each drawn on its own opaque surface
(`#ffffff` and `#14171d`, the app's `--surface` token in each mode). Nothing is transparent: a
transparent figure is legible on exactly one of GitHub's two backgrounds. Pick the variant with
`<picture>` so the README follows the reader's theme, and always write the `alt` text:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/figures/nav-sensitivity-dark.svg">
  <img alt="NAV falls 8.49% on a +200 bp parallel yield shift and gains 9.71% on -200 bp."
       src="docs/figures/nav-sensitivity-light.svg">
</picture>
```

## Theme

The figures are drawn in the web app's chart language, not matplotlib's defaults: the design tokens
from `web/app/globals.css` (`--surface`, `--ink`, `--muted`, `--border`, `--border-strong`,
`--accent`, `--danger`) and the ordinal blue ramp from `web/components/charts/chart-theme.css`, which
was already validated for colour-vision separation and for contrast against both surfaces. Bars are
capped at 24 px with a 4 px rounded data-end and a 2 px surface gap between touching marks; gridlines
are solid hairlines on the value axis only; axis and legend text wear the muted ink token, never a
series colour. Bonds are coloured by maturity order — an ordinal scale, so the reader sees the order
in the colour — and the "not a bond" neutral is reserved for principal repayments and for the
external reference. Every chart ships the table that produced it.

One deliberate departure: the app sets IBM Plex Sans, and the figures use DejaVu Sans, the face
bundled inside matplotlib. A system font renders differently on a contributor's machine and in CI,
and a figure whose text metrics depend on who ran it is not a reproducible artifact.

## What it does not model

Stated in full in the notebook's closing section: no credit or default model, parallel shifts only,
no liquidity or bid-offer model, no operating-cost curve, no reinvestment rule, β = 1.0 for the CDS
mapping as a stated assumption rather than a measurement, and an unsourced placeholder for the T-bill
reference. `RISKS.md` and `SECURITY.md` cover the risks this notebook is silent about.
