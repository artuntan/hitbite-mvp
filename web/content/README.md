# `web/content`

**Generated. Do not edit the markdown in this directory.**

| File                  | Copy of                     | Rendered by                     |
| --------------------- | --------------------------- | ------------------------------- |
| `COMPLIANCE_RULES.md` | `../../COMPLIANCE_RULES.md` | `/rules` (`app/rules/page.tsx`) |
| `RISKS.md`            | `../../RISKS.md`            | `/risks` (`app/risks/page.tsx`) |

The markdown at the repository root is canonical (PLAN.md **D12**). These are byte-identical copies,
and they exist for one reason: Vercel's build root is `web/`, so the build cannot read a file above
it. That is also why they are committed rather than produced during the build.

```sh
pnpm sync:docs           # refresh the copies from the canonical documents
pnpm sync:docs --check   # fail if they have drifted; this runs in CI
```

Edit the root document, run `pnpm sync:docs`, commit both. If you edit a copy here instead, the next
sync overwrites it and CI fails in the meantime — which is the point.

`.prettierignore` in this directory keeps Prettier off the copies: it would re-lay-out the markdown
tables and rewrite `*emphasis*` as `_emphasis_`, and every one of those edits is drift from the
canonical file. `web/package.json` passes that file to Prettier with `--ignore-path`.

The pages parse the markdown with `lib/content.ts` — a small renderer, no markdown dependency — and
render it with `components/content/`. `lib/content.test.ts` covers the parser; `e2e/content.spec.ts`
asserts the rendered pages against these files, heading for heading and table for table.
