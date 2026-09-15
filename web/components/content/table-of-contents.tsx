import type { TocEntry } from "@/lib/content";
import { cn } from "@/lib/utils";

/**
 * "On this page", built from the document's own `##` and `###` headings.
 *
 * It is navigation, not content: the label is a `<p>`, not a heading, so the page's heading outline
 * stays exactly the outline of the canonical document — which is what `e2e/content.spec.ts` asserts,
 * heading for heading, to prove nothing on the page was added, dropped or reordered.
 */
export function TableOfContents({
  entries,
  className,
}: {
  entries: readonly TocEntry[];
  className?: string;
}) {
  if (entries.length === 0) return null;

  return (
    <nav
      aria-label="On this page"
      data-testid="table-of-contents"
      className={cn("border-border bg-surface rounded-lg border p-4", className)}
    >
      <p className="text-muted text-xs font-semibold tracking-wide uppercase">On this page</p>
      <ol className="mt-3 flex flex-col gap-2 text-sm">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              className="text-muted hover:text-ink rounded transition-colors"
            >
              {entry.text}
            </a>
            {entry.children.length > 0 ? (
              <ol className="border-border mt-2 flex flex-col gap-2 border-l pl-3">
                {entry.children.map((child) => (
                  <li key={child.id}>
                    <a
                      href={`#${child.id}`}
                      className="text-muted hover:text-ink rounded text-[0.8125rem] transition-colors"
                    >
                      {child.text}
                    </a>
                  </li>
                ))}
              </ol>
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}
