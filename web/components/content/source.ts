import { readFileSync } from "node:fs";
import path from "node:path";

import {
  CONTENT_DOCUMENTS,
  parseMarkdown,
  type ContentDocumentId,
  type MarkdownDocument,
} from "@/lib/content";

/**
 * Reads a canonical document out of `web/content/` and parses it.
 *
 * **Server only**, and in practice **build only**: `/rules` and `/risks` are `force-static`, so the
 * file is read while `next build` prerenders the page and never again — no request ever touches the
 * filesystem, which is the same reason `lib/data.ts` prefers a static import for the published NAV
 * documents (Vercel serves a serverless function that cannot be assumed to be able to `readFile`
 * anything outside its own bundle).
 *
 * A missing file throws, which fails the build with a message naming the command that fixes it.
 * That is deliberate: a compliance page that silently renders nothing is worse than a red build.
 */

/** Where the copies live, relative to the `web/` build root. */
const CONTENT_DIR = "content";

export interface LoadedDocument {
  readonly id: ContentDocumentId;
  /** Path of the canonical file, relative to the repository root. */
  readonly canonicalPath: string;
  /** Path of the copy this page actually read, relative to the repository root. */
  readonly contentPath: string;
  readonly document: MarkdownDocument;
}

export function loadContentDocument(id: ContentDocumentId): LoadedDocument {
  const entry = CONTENT_DOCUMENTS[id];
  const file = path.join(process.cwd(), CONTENT_DIR, entry.file);

  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch (cause) {
    throw new Error(
      `cannot read web/${CONTENT_DIR}/${entry.file}, the copy of the canonical ${entry.canonical}: ` +
        `${(cause as Error).message}. Run \`pnpm sync:docs\` from web/ and commit the result (PLAN.md D12).`,
    );
  }

  return {
    id,
    canonicalPath: entry.canonical,
    contentPath: `web/${CONTENT_DIR}/${entry.file}`,
    document: parseMarkdown(source),
  };
}
