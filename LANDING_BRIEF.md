# HitBite — Landing Page Brief (paste into the same Codex session that is building v2)

> Context for the agent: this adds the public landing page to the v2 repository so that hitbite.com and the testnet app go live together. It **supersedes Section 5.3 "/ Overview" in `BUILD_PROMPT_V2.md`**: the root route `/` is now the landing page described here, the guided flow stays at `/app`, and the composition chart and five-step strip that Section 5.3 put on `/` move to the top of `/app`. Everything else in `BUILD_PROMPT_V2.md` still applies, including the rule that `design.md` is the visual source of truth.

## 1. The idea

One screen. No scrolling. A wordmark, one headline, one paragraph, one button, one live number, one line of small print. Nothing else. The page should feel like a product announcement, not a marketing site: the reader understands what HitBite is in ten seconds and has exactly one thing to do, open the testnet.

Two people will land here: a technical reviewer at an accelerator who clicked the link from our application, and a partner at a licensed fund manager. Both should leave with the same sentence in their head: "Türkiye's sovereign bonds, on-chain, through a regulated fund, and it already runs."

## 2. Layout (desktop and mobile, everything fits in the viewport)

Use `100dvh`, a centred column, and `design.md` for type, colour, spacing and the wordmark. If `design.md` is silent, use its base font at large size, one accent colour for the button, and generous whitespace. No images, no illustration, no gradient backgrounds, no cards, no icons other than the wordmark.

```
┌──────────────────────────────────────────────────────────────┐
│ HitBite                                   GitHub   Open the testnet │  ← header, 56px, wordmark left, two links right
│                                                              │
│                                                              │
│              Türkiye's sovereign bonds, on-chain.            │  ← H1, largest type in the system, max 2 lines
│                                                              │
│   A licensed fund manager in Abu Dhabi issues a regulated     │  ← paragraph, max 3 lines at 640px width
│   fund that holds the bonds. Our token represents units in    │
│   that fund. Daily NAV, coupon pass-through and signed        │
│   attestations, all on-chain.                                 │
│                                                              │
│                    [ Open the testnet ]                       │  ← one primary button
│              Read the code  ·  Request access                 │  ← two quiet text links
│                                                              │
│         NAV 1.0038 USDC · Arc Testnet · updated 2 h ago       │  ← the live number, small, monospace
│                                                              │
│ Testnet only. Simulated portfolio. Not an offer of securities.│  ← footer line, small
│ © 2026 HitBite · X · hello@hitbite.com                         │
└──────────────────────────────────────────────────────────────┘
```

Mobile (≥ 360px wide): same order, stacked, header keeps only the wordmark and the button. If the content cannot fit a short viewport (< 640px tall), allow scrolling rather than shrinking type below readable sizes; that is the only case scrolling is acceptable.

## 3. Copy (verbatim; do not rewrite, do not add)

- Header wordmark: `HitBite`
- Header links: `GitHub` (repo URL) · `Open the testnet` (→ `/app`)
- H1: `Türkiye's sovereign bonds, on-chain.`
- Paragraph: `A licensed fund manager in Abu Dhabi issues a regulated fund that holds the bonds. Our token represents units in that fund. Daily NAV, coupon pass-through and signed attestations, all on-chain.`
- Primary button: `Open the testnet` (→ `/app`)
- Quiet links: `Read the code` (→ repo) · `Request access` (→ `mailto:hello@hitbite.com?subject=HitBite%20access%20request`; replace the address with the one the founder provides)
- Live line: `NAV {nav} USDC · Arc Testnet · updated {relative time}` read from `/data/nav.json` (`nav_per_token`, `timestamp`). If the file is missing or older than 48 hours, render nothing in this slot. Never show a placeholder number.
- Footer line 1: `Testnet only. Simulated portfolio. Not an offer of securities.`
- Footer line 2: `© 2026 HitBite` · `X` (→ https://x.com/hitbiterwa) · `hello@hitbite.com`

Words that must not appear anywhere on this page: invest, investing, returns, APY, yield (except inside "sovereign yield" if the founder later asks for it), guaranteed, coming soon, waitlist, airdrop, points.

## 4. Motion

One entrance only: header, H1, paragraph, button and live line fade in and rise 8px, staggered 60ms, total under 600ms, once, on load. Respect `prefers-reduced-motion` (no motion). No hover animations beyond the button's standard state change. No scroll effects, no parallax, no cursor effects.

## 5. Technical

- Route: `app/page.tsx` in the same Next.js app as `/app`. Statically generated; the live line fetches `/data/nav.json` client-side after mount so the HTML is complete without it.
- Head: `<title>HitBite — Türkiye's sovereign bonds, on-chain</title>`; meta description `Compliant on-chain access to Türkiye's USD sovereign bonds through a licensed fund manager in ADGM. Testnet live on Arc. Not an offer of securities.`; Open Graph and Twitter card with a generated OG image (`next/og`): wordmark top-left, the H1 centred, footer line small, same type and colours as the page. Favicon from the wordmark mark.
- Fonts via `next/font` (self-hosted, `display: swap`). No third-party scripts, no analytics, no cookies, no consent banner needed.
- Performance budget: Lighthouse ≥ 95 on all four categories on mobile; total transfer under 150 KB excluding the font; LCP under 1.5 s on a throttled 4G profile. First paint must not depend on the NAV fetch.
- Accessibility: one `h1`, real `<a>` and `<button>` elements, visible focus rings, contrast ≥ 4.5:1 for text, ≥ 3:1 for the button, `lang="en"`.
- `robots.txt` allows indexing of `/` and `/transparency`, disallows `/admin`. `sitemap.xml` lists `/`, `/app`, `/transparency`.
- Domain: `hitbite.com` on Vercel, `www` redirects to apex, HTTPS with HSTS. The app stays under the same domain at `/app`.
- Feature flag `NEXT_PUBLIC_APP_LIVE` (default `true`). When `false`, the primary button reads `Request access` and points to the mailto, the header's "Open the testnet" link is hidden, and the live line is hidden. This exists only as a safety switch for launch day.

## 6. Acceptance

1. On a 1440×900 desktop and a 390×844 phone the whole page is visible without scrolling, with the copy in Section 3 exactly.
2. `pnpm build` passes; Lighthouse mobile scores ≥ 95 in Performance, Accessibility, Best Practices and SEO.
3. The live line shows the real NAV from `nav.json` and disappears when the file is absent or stale.
4. With `prefers-reduced-motion: reduce` nothing animates.
5. The OG image renders correctly in an X card preview and a Slack unfurl.
6. A screenshot of desktop and mobile is added to `PROGRESS.md` before the founder's review.
