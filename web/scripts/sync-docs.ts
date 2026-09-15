/**
 * sync-docs — copy the canonical compliance and risk documents into `web/content/` (PLAN.md D12).
 *
 *   pnpm sync:docs           copy `../COMPLIANCE_RULES.md` and `../RISKS.md` into `content/`
 *   pnpm sync:docs --check   verify the copies are byte-identical; exit 1 if they are not
 *
 * The root markdown is canonical: it is what a reviewer reads in the repository, what the README
 * links to, and what the founders edit. `/rules` and `/risks` render it. The copy exists for one
 * reason — Vercel's build root is `web/`, so the build cannot read a file above it — which is also
 * why the copy is committed rather than produced during the build.
 *
 * Two committed copies of the same text is a drift risk, so `--check` runs in CI and fails the
 * build the moment they disagree. That turns "someone edited the root document and forgot the copy"
 * from a silently stale page into a red build with the exact command that fixes it.
 *
 * The check is on **bytes**, not on meaning: a page that renders the canonical document has to
 * render that document, not a reformatted version of it. `web/content/.prettierignore` exists for
 * the same reason — Prettier would happily re-lay-out the markdown tables and turn `*after*` into
 * `_after_`, and every one of those edits would be drift.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The manifest lives in `lib/content.ts` beside the parser that consumes it, so the pages, the
 * copier and the check can never disagree about which file is which.
 *
 * It is loaded through `import()` on a URL rather than a static `import "../lib/content.ts"`
 * because Node needs the `.ts` extension to resolve the file at runtime while `tsc` rejects that
 * extension in an import specifier (TS5097, and `allowImportingTsExtensions` is not set for this
 * project). The `typeof import(...)` cast keeps the value fully typed either way.
 */
const { CONTENT_DOCUMENTS, CONTENT_DOCUMENT_IDS } = (await import(
  new URL("../lib/content.ts", import.meta.url).href
)) as typeof import("../lib/content");

const WEB_DIR = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(WEB_DIR, "..");
const CONTENT_DIR = path.join(WEB_DIR, "content");

/** Hand-written, not copied: the note explaining why the directory exists. */
const NOT_A_COPY = "README.md";

const FIX_COMMAND = "pnpm sync:docs   (from web/)";

class SyncError extends Error {
  readonly hint: string;

  constructor(message: string, hint: string) {
    super(message);
    this.name = "SyncError";
    this.hint = hint;
  }
}

function rel(absolute: string): string {
  return path.relative(REPO_ROOT, absolute) || ".";
}

function readCanonical(file: string): string {
  const absolute = path.join(REPO_ROOT, file);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new SyncError(
      `the canonical document ${rel(absolute)} is missing`,
      [
        "This script runs from web/ but copies from the repository root, so it needs the whole",
        "repository checked out — not just web/. If the document was renamed, update",
        "CONTENT_DOCUMENTS in web/lib/content.ts and re-run.",
      ].join(" "),
    );
  }
  return readFileSync(absolute, "utf8");
}

function bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/** First line number where two documents differ, 1-based, or `null` when they are identical. */
function firstDifferingLine(left: string, right: string): number | null {
  if (left === right) return null;
  const a = left.split("\n");
  const b = right.split("\n");
  const limit = Math.max(a.length, b.length);
  for (let index = 0; index < limit; index += 1) {
    if (a[index] !== b[index]) return index + 1;
  }
  return null;
}

interface Drift {
  readonly copy: string;
  readonly canonical: string;
  readonly reason: string;
}

function check(): void {
  const drifted: Drift[] = [];

  for (const id of CONTENT_DOCUMENT_IDS) {
    const document = CONTENT_DOCUMENTS[id];
    const canonical = readCanonical(document.canonical);
    const copy = path.join(CONTENT_DIR, document.file);

    if (!existsSync(copy)) {
      drifted.push({
        copy: rel(copy),
        canonical: document.canonical,
        reason: "the copy does not exist",
      });
      continue;
    }

    const current = readFileSync(copy, "utf8");
    if (current === canonical) continue;

    const line = firstDifferingLine(canonical, current);
    drifted.push({
      copy: rel(copy),
      canonical: document.canonical,
      reason:
        line === null
          ? `the copy is ${bytes(current)} bytes and the canonical document is ${bytes(canonical)}`
          : `they first differ at line ${line}`,
    });
  }

  const expected = new Set<string>(CONTENT_DOCUMENT_IDS.map((id) => CONTENT_DOCUMENTS[id].file));
  if (existsSync(CONTENT_DIR)) {
    for (const entry of readdirSync(CONTENT_DIR)) {
      if (!entry.endsWith(".md") || entry === NOT_A_COPY || expected.has(entry)) continue;
      drifted.push({
        copy: rel(path.join(CONTENT_DIR, entry)),
        canonical: "(none)",
        reason: "no canonical document maps to this file — it is a leftover copy",
      });
    }
  }

  if (drifted.length === 0) {
    console.log(
      `sync-docs: ${CONTENT_DOCUMENT_IDS.length} document(s) in ${rel(CONTENT_DIR)} match the canonical files.`,
    );
    return;
  }

  const lines = drifted.map((entry) => `  ${entry.copy}  ←  ${entry.canonical}: ${entry.reason}`);
  throw new SyncError(
    `${drifted.length} document(s) have drifted from the canonical source`,
    [
      ...lines,
      "",
      "The root markdown is canonical (PLAN.md D12). Refresh the copies and commit them:",
      "",
      `  ${FIX_COMMAND}`,
      "",
      "Never edit web/content/*.md by hand — the next sync overwrites it.",
    ].join("\n"),
  );
}

function write(): void {
  mkdirSync(CONTENT_DIR, { recursive: true });

  for (const id of CONTENT_DOCUMENT_IDS) {
    const document = CONTENT_DOCUMENTS[id];
    const canonical = readCanonical(document.canonical);
    const copy = path.join(CONTENT_DIR, document.file);
    const current = existsSync(copy) ? readFileSync(copy, "utf8") : null;

    if (current === canonical) {
      console.log(`sync-docs: ${rel(copy)} already matches ${document.canonical}`);
      continue;
    }

    writeFileSync(copy, canonical, "utf8");
    console.log(
      `sync-docs: wrote ${rel(copy)} from ${document.canonical} (${bytes(canonical)} bytes) → ${document.route}`,
    );
  }
}

const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg !== "--check");
if (unknown.length > 0) {
  console.error(`sync-docs: unrecognised argument(s): ${unknown.join(", ")}\n`);
  console.error("Usage: pnpm sync:docs [--check]");
  process.exit(2);
}

try {
  if (args.includes("--check")) {
    check();
  } else {
    write();
  }
} catch (error) {
  if (error instanceof SyncError) {
    console.error(`\nsync-docs failed: ${error.message}\n\n${error.hint}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
