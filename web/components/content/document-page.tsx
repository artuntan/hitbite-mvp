import { Blocks, Heading } from "@/components/content/markdown";
import type { LoadedDocument } from "@/components/content/source";
import { TableOfContents } from "@/components/content/table-of-contents";
import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";

/**
 * The shell both document pages use: title, provenance line, table of contents, document.
 *
 * Everything inside `<article>` is the canonical file and nothing else — not summarised, not
 * reordered, not reworded. The only page furniture is the badge, the one sentence saying where the
 * text comes from, and the "On this page" navigation, none of which is a heading, so the heading
 * outline the reader (and the e2e test) sees is the document's own.
 */
export function DocumentPage({ loaded }: { loaded: LoadedDocument }) {
  const { document } = loaded;

  return (
    <Container className="py-10 sm:py-12">
      <header className="flex max-w-3xl flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">Canonical document</Badge>
        </div>
        {document.title ? <Heading block={document.title} spacing={false} /> : null}
        <p className="text-muted text-sm leading-relaxed">
          This page is <code className="addr text-ink">{loaded.canonicalPath}</code> from the
          repository, rendered. <code className="addr text-ink">pnpm sync:docs</code> copies that
          file to <code className="addr text-ink">{loaded.contentPath}</code>, which is what the
          build reads, and CI fails if the two ever differ — so the words here are the words in the
          repository, down to the byte.
        </p>
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-16">
        {/* First in the DOM so a reader on a phone meets the contents before the document, and
            placed into the second column on a wide screen. */}
        <TableOfContents
          entries={document.toc}
          // `self-start` keeps the card its own height: a grid item stretches by default, and a
          // stretched sticky card would be a full-column-height panel that never scrolls.
          className="lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1 lg:self-start"
        />
        <article className="max-w-[46rem] min-w-0 lg:col-start-1 lg:row-start-1">
          <Blocks blocks={document.blocks} />
        </article>
      </div>
    </Container>
  );
}
