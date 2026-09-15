import * as React from "react";

import { InlineNodes } from "@/components/content/inline";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Block, HeadingBlock, TableBlock, TableColumn } from "@/lib/content";
import { cn } from "@/lib/utils";

/**
 * The block half of the Markdown renderer: headings, paragraphs, rules, quotes, lists and tables.
 * Inline content goes through `InlineNodes` (`./inline.ts`), which is where the escaping property
 * is tested.
 *
 * **Server components, and no HTML strings anywhere.** Every node becomes a React element, so text
 * from the document is escaped by React on the way out and raw HTML in the source — `<script>`, an
 * `onerror` attribute, an `<iframe>` — lands on the page as the characters the author typed. There
 * is no `dangerouslySetInnerHTML` in this file or in `inline.ts`, and there must never be one: that
 * is what makes the safety property structural rather than a filter someone has to remember.
 *
 * Tables go through the `ui/table` primitives, which is what gives them the same hairline borders,
 * the same header treatment and the same scrollable, labelled container as the holdings table on
 * `/transparency`. A column whose body cells all read as figures is rendered `numeric`: right
 * aligned, IBM Plex Mono, tabular figures, so digits line up down the column.
 *
 * Nothing here imports the wallet layer and nothing is a client component — `/rules` and `/risks`
 * are public pages and their Lighthouse scores depend on staying that way (PLAN.md D63).
 */

// --------------------------------------------------------------------------- blocks

const HEADING_TEXT: Record<number, string> = {
  1: "text-3xl font-semibold tracking-tight sm:text-4xl",
  2: "text-2xl font-semibold tracking-tight",
  3: "text-lg font-semibold tracking-tight",
  4: "text-base font-semibold",
  5: "text-base font-semibold",
  6: "text-sm font-semibold",
};

const HEADING_SPACING: Record<number, string> = {
  1: "mt-12",
  2: "mt-12",
  3: "mt-9",
  4: "mt-7",
  5: "mt-7",
  6: "mt-7",
};

/**
 * A linkable heading.
 *
 * The anchor sits *beside* the heading rather than inside it on purpose: an `aria-label` on a
 * descendant is folded into the heading's own accessible name, so a `#` link inside an `<h2>` makes
 * screen readers announce "Verification, link to this section: Verification". Outside it, the
 * heading is named by the document's words alone and the permalink is still a real, focusable link.
 */
export function Heading({
  block,
  spacing = true,
}: {
  block: HeadingBlock;
  spacing?: boolean;
}): React.ReactNode {
  const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <div
      className={cn(
        "group flex items-baseline gap-2",
        spacing && cn(HEADING_SPACING[block.level] ?? "mt-8", "first:mt-0"),
      )}
    >
      <Tag id={block.id} className={cn("text-ink scroll-mt-24", HEADING_TEXT[block.level])}>
        <InlineNodes nodes={block.children} />
      </Tag>
      <a
        href={`#${block.id}`}
        aria-label={`Permalink to “${block.text}”`}
        className="text-muted hover:text-accent-ink rounded text-sm opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        #
      </a>
    </div>
  );
}

function alignmentClass(column: TableColumn | undefined): string | undefined {
  switch (column?.align) {
    case "center":
      return "text-center";
    case "right":
      return "text-right";
    case "left":
      return "text-left";
    default:
      return undefined;
  }
}

function TableView({ block }: { block: TableBlock }): React.ReactNode {
  return (
    <div className="mt-6 first:mt-0">
      <Table aria-label={block.label}>
        <TableHeader>
          <TableRow>
            {block.columns.map((column, index) => (
              <TableHead
                key={index}
                numeric={column.numeric}
                className={alignmentClass(column)}
                scope="col"
              >
                <InlineNodes nodes={column.header} />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {block.rows.map((row, rowIndex) => (
            <TableRow key={rowIndex}>
              {row.map((cell, cellIndex) => {
                const column = block.columns[cellIndex];
                return (
                  <TableCell
                    key={cellIndex}
                    numeric={column?.numeric ?? false}
                    className={cn("align-top", alignmentClass(column))}
                  >
                    <InlineNodes nodes={cell} />
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

interface BlockProps {
  block: Block;
  /**
   * Inside a tight list item, a paragraph renders as bare inline content — no `<p>`, no margin —
   * which is what every Markdown renderer does and what keeps a bullet on one line with its text.
   */
  dense?: boolean;
}

function BlockView({ block, dense = false }: BlockProps): React.ReactNode {
  switch (block.type) {
    case "heading":
      return <Heading block={block} />;

    case "paragraph":
      if (dense) return <InlineNodes nodes={block.children} />;
      return (
        <p className="text-ink mt-5 text-sm leading-7 first:mt-0 sm:text-base">
          <InlineNodes nodes={block.children} />
        </p>
      );

    case "thematicBreak":
      return <hr className="border-border mt-12 border-t first:mt-0" />;

    case "blockquote":
      return (
        <blockquote
          className={cn(
            "border-border-strong text-muted border-l-4 pl-4 first:mt-0",
            dense ? "mt-2" : "mt-6",
          )}
        >
          <Blocks blocks={block.children} />
        </blockquote>
      );

    case "codeBlock":
      return (
        <pre
          className={cn(
            "border-border bg-surface-sunken overflow-x-auto rounded-lg border p-4 text-xs first:mt-0",
            dense ? "mt-2" : "mt-6",
          )}
        >
          <code className="font-mono">{block.value}</code>
        </pre>
      );

    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          start={block.ordered && block.start !== 1 ? block.start : undefined}
          className={cn(
            "text-ink marker:text-muted space-y-2 pl-6 text-sm leading-7 first:mt-0 sm:text-base",
            block.ordered ? "list-decimal" : "list-disc",
            dense ? "mt-2" : "mt-5",
          )}
        >
          {block.items.map((item, index) => (
            <li key={index} className="pl-1">
              <Blocks blocks={item.children} dense={block.tight} />
            </li>
          ))}
        </Tag>
      );
    }

    case "table":
      return <TableView block={block} />;
  }
}

export function Blocks({
  blocks,
  dense = false,
}: {
  blocks: readonly Block[];
  dense?: boolean;
}): React.ReactNode {
  return blocks.map((block, index) => <BlockView key={index} block={block} dense={dense} />);
}
