import { createElement, type ReactNode } from "react";

import type { InlineNode } from "@/lib/content";

/**
 * The inline half of the Markdown renderer: text, code spans, emphasis, links and line breaks.
 *
 * **Why `createElement` and not JSX.** This is the module whose output the injection tests have to
 * inspect, and it is the funnel every word of both documents passes through — headings, paragraphs,
 * list items and table cells all render their contents with `InlineNodes`. The repository's
 * `tsconfig.json` sets `jsx: "preserve"` (Next compiles JSX itself), which means Vitest's transform
 * cannot compile a `.tsx` file, so a `.tsx` renderer could only ever be tested through a browser.
 * Keeping this file plain TypeScript lets `lib/content.test.ts` render fixtures with
 * `react-dom/server` and assert on the actual HTML — that `<script>alert(1)</script>` comes out as
 * `&lt;script&gt;`, that a `javascript:` destination never becomes an `href`. Forty lines of
 * `createElement` is a small price for testing the property that matters.
 *
 * There is no `dangerouslySetInnerHTML` here and there must never be one: React escapes every text
 * node it is given, which is what makes "raw HTML in the document cannot inject" structural.
 */

/** Code spans: IBM Plex Mono on a sunken chip, so `NotEligible(account)` reads as an identifier. */
export const CODE_SPAN_CLASS =
  "border-border bg-surface-sunken text-ink rounded border px-1 py-0.5 font-mono text-[0.9em]";

export const LINK_CLASS = "text-accent-ink underline underline-offset-4 hover:no-underline";

const STRONG_CLASS = "text-ink font-semibold";

/** An absolute destination leaves the site; a relative one stays inside it. */
const ABSOLUTE_URL = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export function InlineNodes({ nodes }: { nodes: readonly InlineNode[] }): ReactNode {
  // Index keys are correct here: the tree is parsed from a committed file and never reorders.
  return nodes.map((node, index) => renderInlineNode(node, index));
}

function children(nodes: readonly InlineNode[]): ReactNode {
  return createElement(InlineNodes, { nodes });
}

function renderInlineNode(node: InlineNode, key: number): ReactNode {
  switch (node.type) {
    case "text":
      return node.value;

    case "code":
      return createElement("code", { key, className: CODE_SPAN_CLASS }, node.value);

    case "strong":
      return createElement("strong", { key, className: STRONG_CLASS }, children(node.children));

    case "emphasis":
      return createElement("em", { key, className: "italic" }, children(node.children));

    case "link":
      return createElement(
        "a",
        {
          key,
          href: node.href,
          title: node.title ?? undefined,
          className: LINK_CLASS,
          rel: ABSOLUTE_URL.test(node.href) ? "noreferrer" : undefined,
        },
        children(node.children),
      );

    case "softbreak":
      // The source's own line break. HTML collapses it to a single space, exactly as every
      // Markdown renderer does, and the page keeps the line structure of the canonical file.
      return "\n";

    case "hardbreak":
      return createElement("br", { key });
  }
}
