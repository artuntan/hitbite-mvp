# `web/components`

Three folders, three jobs.

| Folder    | What lives there                                                  | Rule of thumb                                                         |
| --------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| `ui/`     | Generic primitives (shadcn-style, Radix where a primitive exists) | Knows nothing about HitBite. No data fetching, no chain, no copy.     |
| `layout/` | The app shell: banner, header, footer, theme, container           | Rendered once by `app/layout.tsx`. Never imports wagmi or RainbowKit. |
| `states/` | Loading / empty / error presentations                             | Every page that can be slow, empty or broken uses these, not ad-hoc.  |

Charts (`components/charts/`) and feature components belong to the pages that own them and are not
part of this set.

## Design tokens

All colour, type and elevation tokens live in `app/globals.css` under `@theme inline`, with the raw
values in `:root` and `.dark`. Tailwind v4 is CSS-first — there is no `tailwind.config.js`.

| Token                                                 | Use                                                   |
| ----------------------------------------------------- | ----------------------------------------------------- |
| `bg-paper` / `bg-surface` / `bg-surface-sunken`       | Page, raised panel, well                              |
| `text-ink` / `text-muted`                             | Primary and secondary text                            |
| `border-border` / `border-border-strong`              | Hairline divider / edge of an interactive control     |
| `accent`, `accent-ink`, `accent-on`, `accent-surface` | Fill, accent-as-text, text on an accent fill, tint    |
| `success` / `warning` / `danger` (+ `-surface`)       | Status only. Never decoration.                        |
| `skeleton`                                            | Loading bars. Reads on both `paper` and `surface`.    |
| `ring`                                                | Focus outline colour                                  |
| `font-sans` / `font-mono`                             | IBM Plex Sans / IBM Plex Mono, via `next/font/google` |
| `shadow-raised` / `shadow-overlay`                    | Card lift / dialog + popover lift                     |

`--accent` is **`#2E6BFF`, a placeholder** (BUILD_PROMPT 7.1). When the founders supply the real
brand hex, change it in both `:root` and `.dark`, then re-measure the contrast ratios recorded in
the comments beside each token.

Three custom utilities:

- `.num` — IBM Plex Mono, tabular figures, slashed zero. **Every figure that can line up in a
  column uses it.** `<TableCell numeric>` applies it for you.
- `.addr` — IBM Plex Mono for addresses and hashes, wraps anywhere.
- `.skip-link` — off-screen until focused; used once, by the root layout.

## Using the primitives

```tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, Stat, StatList } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
```

Import from the exact file, not a barrel: that keeps the client-component primitives (`tabs`,
`tooltip`, `dialog`, `dropdown-menu`) out of the bundle of a server page that does not use them.

Numeric tables, the shape `/transparency` and `/portfolio` need:

```tsx
<Table aria-label="Holdings">
  <TableHeader>
    <TableRow>
      <TableHead>Bond</TableHead>
      <TableHead numeric>Face (USD)</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>TURKEY USD 6.00% 2029 (illustrative)</TableCell>
      <TableCell numeric>400,000.00</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

`numeric` right-aligns the column and switches it to `.num`, so decimal points line up.

## Adding a component

1. Does a `ui/` primitive already cover it? Extend that one instead of adding a near-duplicate.
2. Radix first if the thing has behaviour (focus trap, roving tabindex, `aria-expanded`). The
   installed primitives are `slot`, `dialog`, `dropdown-menu`, `label`, `tabs`, `tooltip`. There is
   no separator package — `ui/separator.tsx` is hand-rolled. **Do not add dependencies**; ask.
3. File name kebab-case, exports PascalCase. `React.forwardRef`, spread `...props`, and merge
   `className` last through `cn()` so callers can always override.
4. Variants via `class-variance-authority`, never a pile of booleans.
5. Only token classes. If you reach for a raw hex or a stock Tailwind colour, the token set is
   missing something — add the token.
6. `"use client"` only when the component needs state, effects or event handlers. The shell and the
   public pages must stay server-rendered.
7. Accessibility is graded: a visible `focus-visible` outline, a real label on every control,
   status never signalled by colour alone, and AA contrast **in both themes**.

## The wallet slot

`Header` renders an empty `#wallet-slot`. The shell must never import wagmi or RainbowKit — the
public pages have to hold Lighthouse performance ≥ 90 without the wallet bundle. Phase 7 fills the
slot either by portalling into `#wallet-slot` from a client component on a wallet page, or by
giving the wallet routes a route-group layout that renders `<Header walletSlot={…} />`.

## Navigation

`layout/nav-items.ts` is the single source for header and footer links. It lists only routes that
exist; `PLANNED_ROUTES` records the rest with the phase that delivers them. When you ship a page,
move its entry across in the same commit — a header link to a 404 is a review finding
(BUILD_PROMPT 16.5).

## Fixed copy

`TESTNET_BANNER_TEXT` (`layout/testnet-banner.tsx`) and `FOOTER_DISCLAIMER` (`layout/footer.tsx`)
are verbatim from BUILD_PROMPT Section 15. They are exported so other surfaces can reuse the exact
string. Do not edit, shorten or paraphrase them.
