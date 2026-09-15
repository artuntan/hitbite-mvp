import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InlineNodes } from "../components/content/inline";

import {
  blocksToText,
  CONTENT_DOCUMENTS,
  CONTENT_DOCUMENT_IDS,
  inlineToText,
  parseInline,
  parseMarkdown,
  safeHref,
  slugify,
  type Block,
  type InlineNode,
  type TableBlock,
} from "./content";

/**
 * The Markdown parser and its renderer (PLAN.md D12).
 *
 * Three kinds of test, and the third is the one that matters most:
 *
 *   1. **Fixtures** for every construct the documents use — tables, nested lists, inline code,
 *      links, emphasis, blockquotes, em dashes — because getting any of them wrong shows up on a
 *      page a reviewer reads.
 *   2. **Injection**, asserted against rendered HTML: raw HTML, event handlers and `javascript:`
 *      destinations have to reach the page as text. Every word of both documents passes through
 *      `InlineNodes`, so that is the renderer these assertions exercise; the block renderer lives
 *      in a `.tsx` file that Vitest cannot transform under this repository's `jsx: "preserve"`
 *      TypeScript configuration, and `e2e/content.spec.ts` asserts its output in the browser
 *      instead — tables as tables, headings as linkable headings.
 *   3. **The real documents.** Every word of `COMPLIANCE_RULES.md` and `RISKS.md` has to survive
 *      the round trip, the headings have to be the document's headings in the document's order, and
 *      the copies under `web/content/` have to be byte-identical to the canonical files. Those are
 *      what make "the page is the document" true rather than aspirational.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const CONTENT_DIR = path.resolve(import.meta.dirname, "..", "content");
const COMPONENTS_DIR = path.resolve(import.meta.dirname, "..", "components", "content");

/** Render an inline run the way every page does, and hand back the HTML. */
function renderInline(source: string): string {
  return renderToStaticMarkup(createElement(InlineNodes, { nodes: parseInline(source) }));
}

function firstOfType<T extends Block["type"]>(
  blocks: readonly Block[],
  type: T,
): Extract<Block, { type: T }> {
  const found = blocks.find((block) => block.type === type);
  if (!found) throw new Error(`no ${type} block in ${JSON.stringify(blocks.map((b) => b.type))}`);
  return found as Extract<Block, { type: T }>;
}

function tablesOf(blocks: readonly Block[]): TableBlock[] {
  return blocks.filter((block): block is TableBlock => block.type === "table");
}

// --------------------------------------------------------------------------- inline

describe("inline: code spans", () => {
  it("renders backticks in the mono font and keeps the contents literal", () => {
    const html = renderInline("Reverts with `NotEligible(account)`.");
    expect(html).toContain("font-mono");
    expect(html).toContain("<code");
    expect(html).toContain("NotEligible(account)");
  });

  it("treats `*` and `_` inside a code span as literal characters", () => {
    const nodes = parseInline("`DEFAULT_ADMIN_ROLE` and `a*b*c`");
    expect(nodes.filter((node) => node.type === "code").map((node) => node.value)).toEqual([
      "DEFAULT_ADMIN_ROLE",
      "a*b*c",
    ]);
    expect(nodes.some((node) => node.type === "emphasis")).toBe(false);
  });

  it("supports multi-backtick spans and strips one padding space from each side", () => {
    expect(parseInline("``a ` b``")).toEqual([{ type: "code", value: "a ` b" }]);
    expect(parseInline("` `` `")).toEqual([{ type: "code", value: "``" }]);
  });

  it("leaves an unterminated run as literal text", () => {
    expect(inlineToText(parseInline("a ` b"))).toBe("a ` b");
  });
});

describe("inline: emphasis", () => {
  it("parses **strong** and *emphasis*", () => {
    expect(parseInline("**no**")).toEqual([
      { type: "strong", children: [{ type: "text", value: "no" }] },
    ]);
    expect(parseInline("*after*")).toEqual([
      { type: "emphasis", children: [{ type: "text", value: "after" }] },
    ]);
    expect(renderInline("**no**")).toContain("<strong");
    expect(renderInline("*after*")).toContain("<em");
  });

  it("nests emphasis inside strong", () => {
    const html = renderInline("**bold with *emphasis* inside**");
    expect(html).toContain("<strong");
    expect(html).toContain("<em");
    expect(html).toContain("emphasis");
  });

  it("spans a soft line break, the way the documents' closing italic paragraph does", () => {
    const nodes = parseInline("*This is a technical demonstration\non a public test network.*");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("emphasis");
    expect(inlineToText(nodes)).toBe("This is a technical demonstration on a public test network.");
  });

  it("does not italicise an underscore inside a word", () => {
    // `REGISTRAR_ROLE` unbackticked must not become `REGISTRARROLE` in italics.
    expect(parseInline("REGISTRAR_ROLE and ISSUER_ROLE")).toEqual([
      { type: "text", value: "REGISTRAR_ROLE and ISSUER_ROLE" },
    ]);
  });

  it("still supports _emphasis_ and __strong__ between words", () => {
    expect(parseInline("_yes_")).toEqual([
      { type: "emphasis", children: [{ type: "text", value: "yes" }] },
    ]);
    expect(parseInline("__yes__")).toEqual([
      { type: "strong", children: [{ type: "text", value: "yes" }] },
    ]);
  });

  it("leaves an unmatched delimiter as text", () => {
    expect(inlineToText(parseInline("2 * 3 * 4 = 24"))).toBe("2 * 3 * 4 = 24");
    expect(inlineToText(parseInline("a *dangling"))).toBe("a *dangling");
  });
});

describe("inline: links", () => {
  it("parses an inline link with a title", () => {
    expect(parseInline('[the rules](/rules "Compliance rules")')).toEqual([
      {
        type: "link",
        href: "/rules",
        title: "Compliance rules",
        children: [{ type: "text", value: "the rules" }],
      },
    ]);
    expect(renderInline('[the rules](/rules "Compliance rules")')).toContain('href="/rules"');
  });

  it("parses a pointy-bracket destination", () => {
    expect(parseInline("[a](<https://example.test/a b>)")[0]).toMatchObject({
      type: "link",
      href: "https://example.test/a b",
    });
  });

  it("marks an absolute destination rel=noreferrer and leaves a relative one alone", () => {
    expect(renderInline("[x](https://example.test)")).toContain('rel="noreferrer"');
    expect(renderInline("[x](/rules)")).not.toContain("noreferrer");
  });

  it("parses autolinks, including email", () => {
    expect(parseInline("<https://example.test/a>")[0]).toMatchObject({
      type: "link",
      href: "https://example.test/a",
    });
    expect(parseInline("<team@example.test>")[0]).toMatchObject({
      type: "link",
      href: "mailto:team@example.test",
    });
  });

  it("leaves a malformed link as literal text", () => {
    expect(inlineToText(parseInline("[not a link] (nope)"))).toBe("[not a link] (nope)");
  });
});

describe("inline: escapes, breaks and punctuation", () => {
  it("honours backslash escapes", () => {
    expect(parseInline("\\*not emphasis\\*")).toEqual([{ type: "text", value: "*not emphasis*" }]);
    expect(parseInline("a \\| b")).toEqual([{ type: "text", value: "a | b" }]);
  });

  it("makes a newline a soft break and two trailing spaces a hard break", () => {
    expect(parseInline("a\nb")).toEqual([
      { type: "text", value: "a" },
      { type: "softbreak" },
      { type: "text", value: "b" },
    ]);
    expect(parseInline("a  \nb")).toEqual([
      { type: "text", value: "a" },
      { type: "hardbreak" },
      { type: "text", value: "b" },
    ]);
    expect(renderInline("a  \nb")).toContain("<br/>");
    // a soft break is whitespace in the HTML, not a <br>
    expect(renderInline("a\nb")).not.toContain("<br");
  });

  it("passes em dashes, the minus sign and Turkish characters through untouched", () => {
    const source = "Türkiye — 2^128 − 1, ±200 bp, “quoted”, 0.75 %";
    expect(inlineToText(parseInline(source))).toBe(source);
    expect(renderInline(source)).toContain("Türkiye — 2^128 − 1, ±200 bp, “quoted”, 0.75 %");
  });
});

// --------------------------------------------------------------------------- safety

describe("safety: nothing in a document can become markup", () => {
  const hostile = [
    "<script>alert(1)</script>",
    '<img src=x onerror="alert(1)">',
    "<iframe src=https://example.test></iframe>",
    '<a href="https://example.test" onclick="alert(1)">x</a>',
    "<!-- a comment -->",
    "<style>body{display:none}</style>",
    "<svg/onload=alert(1)>",
  ];

  for (const source of hostile) {
    it(`renders ${source.slice(0, 26)}… as text`, () => {
      const html = renderInline(source);
      // Nothing in the source opened an element: the run is plain text, so the rendered HTML
      // contains no `<` at all, and every angle bracket the author typed came out as `&lt;`.
      expect(html).not.toContain("<");
      expect(html).toContain("&lt;");
      // and the author's characters are all still on the page
      expect(inlineToText(parseInline(source))).toBe(source);
    });
  }

  it("escapes markup inside a code span too", () => {
    const html = renderInline("`<script>alert(1)</script>`");
    expect(html).toContain("<code");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("refuses a javascript: destination but keeps the link text", () => {
    const nodes = parseInline("[click me](javascript:alert(1))");
    expect(nodes.some((node) => node.type === "link")).toBe(false);
    expect(inlineToText(nodes)).toBe("click me");
    const html = renderInline("[click me](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a");
    expect(html).toContain("click me");
  });

  it("refuses the obfuscated forms a browser would still execute", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeHref("  javascript:alert(1)")).toBeNull();
    expect(safeHref("java\tscript:alert(1)")).toBeNull();
    expect(safeHref("java\nscript:alert(1)")).toBeNull();
    expect(safeHref("jav ascript:alert(1)")).toBeNull();
    expect(safeHref("vbscript:msgbox(1)")).toBeNull();
    expect(safeHref("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(safeHref("file:///etc/passwd")).toBeNull();
    expect(safeHref("")).toBeNull();
  });

  it("allows the destinations a document legitimately uses", () => {
    expect(safeHref("https://example.test/a?b=1#c")).toBe("https://example.test/a?b=1#c");
    expect(safeHref("http://example.test")).toBe("http://example.test");
    expect(safeHref("mailto:team@example.test")).toBe("mailto:team@example.test");
    expect(safeHref("/rules")).toBe("/rules");
    expect(safeHref("#section-1")).toBe("#section-1");
    expect(safeHref("COMPLIANCE_RULES.md")).toBe("COMPLIANCE_RULES.md");
    // a colon after the first `/`, `?` or `#` is part of the path, not a scheme
    expect(safeHref("/a/b:c")).toBe("/a/b:c");
  });

  it("refuses an unsafe autolink and leaves the text", () => {
    const nodes = parseInline("<javascript:alert(1)>");
    expect(nodes.some((node) => node.type === "link")).toBe(false);
    expect(inlineToText(nodes)).toBe("javascript:alert(1)");
  });

  it("renders a heading's markup characters as text", () => {
    const heading = parseMarkdown("## <script>alert(1)</script>\n").blocks[0];
    expect(heading?.type).toBe("heading");
    const html = renderToStaticMarkup(
      createElement(InlineNodes, {
        nodes: heading?.type === "heading" ? heading.children : [],
      }),
    );
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps the renderer free of raw-HTML escape hatches", () => {
    // The safety property is structural: React escapes every text node it is given. It stops being
    // structural the moment someone reaches for innerHTML, so this fails if anyone does.
    for (const file of [
      "inline.ts",
      "markdown.tsx",
      "table-of-contents.tsx",
      "document-page.tsx",
    ]) {
      const source = readFileSync(path.join(COMPONENTS_DIR, file), "utf8");
      // The prose in these files mentions `dangerouslySetInnerHTML` to say it is never used, so
      // the guard looks for the syntax that would actually set it.
      expect(source, file).not.toMatch(/dangerouslySetInnerHTML\s*[=:]/);
      expect(source, file).not.toMatch(/\.innerHTML\s*=/);
    }
  });
});

// --------------------------------------------------------------------------- blocks

describe("blocks: headings", () => {
  it("gives every heading a GitHub-style slug", () => {
    const doc = parseMarkdown("# Title\n\n## 1. Who may hold the token\n\n### Blocked countries\n");
    expect(doc.title?.text).toBe("Title");
    expect(doc.title?.level).toBe(1);
    expect(
      doc.blocks
        .filter((block) => block.type === "heading")
        .map((block) => [block.level, block.id]),
    ).toEqual([
      [2, "1-who-may-hold-the-token"],
      [3, "blocked-countries"],
    ]);
  });

  it("de-duplicates repeated headings so no two ids collide", () => {
    const doc = parseMarkdown("## Pause\n\n## Pause\n\n## Pause\n");
    expect(doc.blocks.map((block) => (block.type === "heading" ? block.id : null))).toEqual([
      "pause",
      "pause-1",
      "pause-2",
    ]);
  });

  it("does not collide a de-duplicated id with a heading that already spells it", () => {
    const doc = parseMarkdown("## Pause\n\n## Pause 1\n\n## Pause\n");
    const ids = doc.blocks.map((block) => (block.type === "heading" ? block.id : null));
    expect(ids).toEqual(["pause", "pause-1", "pause-2"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps non-ASCII letters in a slug and drops punctuation", () => {
    expect(slugify("Türkiye, and the 5 % rail")).toBe("türkiye-and-the-5-rail");
    expect(slugify("NAV is computed, not quoted")).toBe("nav-is-computed-not-quoted");
    expect(slugify("!!!")).toBe("");
  });

  it("does not treat a hash inside a word as a heading", () => {
    expect(parseMarkdown("#nothashtag\n").blocks[0]?.type).toBe("paragraph");
  });

  it("builds a nested table of contents from ## and ### only", () => {
    const doc = parseMarkdown("# T\n\n## A\n\n### A1\n\n#### A1a\n\n## B\n");
    expect(doc.toc.map((entry) => [entry.text, entry.children.map((child) => child.text)])).toEqual(
      [
        ["A", ["A1"]],
        ["B", []],
      ],
    );
  });
});

describe("blocks: paragraphs, rules and blockquotes", () => {
  it("joins hard-wrapped lines into one paragraph with soft breaks", () => {
    const doc = parseMarkdown("one two\nthree four\n\nnext\n");
    expect(doc.blocks).toHaveLength(2);
    expect(inlineToText(firstOfType(doc.blocks, "paragraph").children)).toBe("one two three four");
  });

  it("reads a --- line between blank lines as a thematic break, not a list", () => {
    const doc = parseMarkdown("a\n\n---\n\nb\n");
    expect(doc.blocks.map((block) => block.type)).toEqual([
      "paragraph",
      "thematicBreak",
      "paragraph",
    ]);
  });

  it("parses a blockquote, the blocks inside it and a lazy continuation", () => {
    const doc = parseMarkdown("> **Note.** First line\n> second line\nthird line\n\nafter\n");
    const quote = firstOfType(doc.blocks, "blockquote");
    expect(quote.children).toHaveLength(1);
    expect(inlineToText(firstOfType(quote.children, "paragraph").children)).toBe(
      "Note. First line second line third line",
    );
    expect(doc.blocks.map((block) => block.type)).toEqual(["blockquote", "paragraph"]);
  });

  it("parses a fenced code block with a language and keeps the lines", () => {
    const doc = parseMarkdown("```solidity\nfunction f() {\n  revert X();\n}\n```\n");
    const code = firstOfType(doc.blocks, "codeBlock");
    expect(code.language).toBe("solidity");
    expect(code.value).toBe("function f() {\n  revert X();\n}");
  });
});

describe("blocks: lists", () => {
  it("parses a tight bullet list whose items wrap onto continuation lines", () => {
    const doc = parseMarkdown(
      "- The issuer calls `distributeCoupon(usdcAmount)`, which pulls the USDC\n" +
        "  into the vault.\n" +
        "- `claimCoupon()` pays out everything accrued.\n",
    );
    const list = firstOfType(doc.blocks, "list");
    expect(list.ordered).toBe(false);
    expect(list.tight).toBe(true);
    expect(list.items).toHaveLength(2);
    expect(blocksToText(list.items[0]!.children)).toEqual([
      "The issuer calls distributeCoupon(usdcAmount), which pulls the USDC into the vault.",
    ]);
  });

  it("parses an ordered list and keeps its start number", () => {
    const list = firstOfType(
      parseMarkdown("1. It has a verification record, and\n2. the country is not blocked.\n")
        .blocks,
      "list",
    );
    expect(list.ordered).toBe(true);
    expect(list.start).toBe(1);
    expect(list.items).toHaveLength(2);
    expect(firstOfType(parseMarkdown("3. three\n4. four\n").blocks, "list").start).toBe(3);
  });

  it("nests a list inside a list item", () => {
    const doc = parseMarkdown("- outer one\n  - inner a\n  - inner b\n- outer two\n");
    const list = firstOfType(doc.blocks, "list");
    expect(list.items).toHaveLength(2);
    const nested = firstOfType(list.items[0]!.children, "list");
    expect(nested.items).toHaveLength(2);
    expect(blocksToText(nested.items[1]!.children)).toEqual(["inner b"]);
    expect(blocksToText(list.items[0]!.children)).toEqual(["outer one", "inner a", "inner b"]);
  });

  it("marks a list loose when a blank line separates its items", () => {
    expect(firstOfType(parseMarkdown("- a\n- b\n").blocks, "list").tight).toBe(true);
    expect(firstOfType(parseMarkdown("- a\n\n- b\n").blocks, "list").tight).toBe(false);
  });

  it("does not swallow the paragraph that follows a list", () => {
    const doc = parseMarkdown("- a\n- b\n\nA following paragraph.\n");
    expect(doc.blocks.map((block) => block.type)).toEqual(["list", "paragraph"]);
  });
});

describe("blocks: tables", () => {
  const fixture = [
    "### Blocked countries",
    "",
    "| Code | Country | Why it is blocked |",
    "|---|---|---|",
    "| `840` | United States | US securities law. |",
    "| `792` | Türkiye | Not offered in phase one. |",
    "",
  ].join("\n");

  it("parses a GFM pipe table into columns and rows", () => {
    const table = firstOfType(parseMarkdown(fixture).blocks, "table");
    expect(table.columns.map((column) => inlineToText(column.header))).toEqual([
      "Code",
      "Country",
      "Why it is blocked",
    ]);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1]!.map(inlineToText)).toEqual([
      "792",
      "Türkiye",
      "Not offered in phase one.",
    ]);
  });

  it("names the table after the heading above it, because Markdown has no caption", () => {
    expect(firstOfType(parseMarkdown(fixture).blocks, "table").label).toBe("Blocked countries");
    expect(
      firstOfType(parseMarkdown("| Role | Held by |\n|---|---|\n| admin | key |\n").blocks, "table")
        .label,
    ).toBe("Role, Held by");
  });

  it("right-aligns a column whose body cells are all figures, and only that column", () => {
    const table = firstOfType(parseMarkdown(fixture).blocks, "table");
    expect(table.columns.map((column) => column.numeric)).toEqual([true, false, false]);
  });

  it("does not call a column of words numeric", () => {
    const table = firstOfType(
      parseMarkdown("| Movement | Sender checked |\n|---|---|\n| Transfer | yes |\n").blocks,
      "table",
    );
    expect(table.columns.every((column) => !column.numeric)).toBe(true);
  });

  it("honours explicit GFM alignment over the numeric heuristic", () => {
    const table = firstOfType(
      parseMarkdown("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n").blocks,
      "table",
    );
    expect(table.columns.map((column) => column.align)).toEqual(["left", "center", "right"]);
    expect(table.columns.every((column) => !column.numeric)).toBe(true);
  });

  it("pads a short row and truncates a long one to the header width", () => {
    const table = firstOfType(
      parseMarkdown("| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |\n").blocks,
      "table",
    );
    expect(table.rows.map((row) => row.length)).toEqual([2, 2]);
    expect(table.rows[1]!.map(inlineToText)).toEqual(["1", "2"]);
  });

  it("keeps an escaped pipe inside a cell", () => {
    const table = firstOfType(
      parseMarkdown("| a | b |\n|---|---|\n| x \\| y | z |\n").blocks,
      "table",
    );
    expect(table.rows[0]!.map(inlineToText)).toEqual(["x | y", "z"]);
  });

  it("parses markup inside a cell", () => {
    const table = firstOfType(
      parseMarkdown("| a | b |\n|---|---|\n| **no** | `x` |\n").blocks,
      "table",
    );
    expect(table.rows[0]![0]![0]?.type).toBe("strong");
    expect(table.rows[0]![1]![0]).toEqual({ type: "code", value: "x" });
  });

  it("does not read a plain paragraph as a table", () => {
    expect(parseMarkdown("a | b\nc | d\n").blocks.map((block) => block.type)).toEqual([
      "paragraph",
    ]);
  });
});

// --------------------------------------------------------------------------- the real documents

/** Strip the Markdown syntax from a source line, leaving the words a reader should see. */
function visibleWords(line: string): string[] {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d{1,9}[.)]\s+/, "")
    .replace(/[|`*_\\]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4);
}

const STRUCTURAL_LINE = /^\s{0,3}(-{3,}|\|[-:|\s]+\|)\s*$/;

describe.each(CONTENT_DOCUMENT_IDS)("the canonical document %s", (id) => {
  const entry = CONTENT_DOCUMENTS[id];
  const source = readFileSync(path.join(CONTENT_DIR, entry.file), "utf8");
  const doc = parseMarkdown(source);

  it("is byte-identical to the canonical file at the repository root (D12)", () => {
    // The same check `pnpm sync:docs --check` runs in CI, repeated here so `pnpm test` catches
    // drift too: the page must render the canonical document, not a reformatted version of it.
    expect(source).toBe(readFileSync(path.join(REPO_ROOT, entry.canonical), "utf8"));
  });

  it("has the document's own title as its only level-1 heading", () => {
    expect(doc.title).not.toBeNull();
    expect(doc.title?.level).toBe(1);
    expect(source.startsWith(`# ${doc.title?.text}`)).toBe(true);
    expect(doc.blocks.some((block) => block.type === "heading" && block.level === 1)).toBe(false);
  });

  it("renders every heading in the source, in the source's order", () => {
    const fromSource = source
      .split("\n")
      .map((line) => /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => ({
        level: (match[1] as string).length,
        text: inlineToText(parseInline(match[2] as string)),
      }));

    const parsed = [
      ...(doc.title ? [{ level: doc.title.level as number, text: doc.title.text }] : []),
      ...doc.blocks
        .filter((block) => block.type === "heading")
        .map((block) => ({ level: block.level as number, text: block.text })),
    ];

    expect(parsed).toEqual(fromSource);
    expect(parsed.length).toBeGreaterThan(5);
  });

  it("gives every heading a unique, non-empty id", () => {
    const ids = doc.blocks
      .filter((block) => block.type === "heading")
      .map((block) => block.id)
      .concat(doc.title ? [doc.title.id] : []);
    expect(ids.every((value) => value.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("drops no word of the document", () => {
    const rendered = [doc.title ? doc.title.text : "", ...blocksToText(doc.blocks)]
      .join("\n")
      .replace(/\s+/g, " ");

    const missing = new Set<string>();
    for (const line of source.split("\n")) {
      if (STRUCTURAL_LINE.test(line)) continue;
      for (const word of visibleWords(line)) {
        if (!rendered.includes(word)) missing.add(word);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it("keeps every table, every row of it, and names each one", () => {
    const tables = tablesOf(doc.blocks);
    const pipeRows = source.split("\n").filter((line) => line.trim().startsWith("|"));
    if (pipeRows.length === 0) {
      expect(tables).toHaveLength(0);
      return;
    }
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.every((table) => table.label.length > 0)).toBe(true);
    // every pipe row is either a header, a delimiter, or a body row that survived
    const bodyRows = tables.reduce((total, table) => total + table.rows.length, 0);
    expect(bodyRows).toBe(pipeRows.length - tables.length * 2);
  });

  it("contains no link this app would refuse to render", () => {
    const links: string[] = [];
    const walkInline = (nodes: readonly InlineNode[]): void => {
      for (const node of nodes) {
        if (node.type === "link") {
          links.push(node.href);
          walkInline(node.children);
        }
        if (node.type === "strong" || node.type === "emphasis") walkInline(node.children);
      }
    };
    const walk = (blocks: readonly Block[]): void => {
      for (const block of blocks) {
        if (block.type === "paragraph" || block.type === "heading") walkInline(block.children);
        if (block.type === "blockquote") walk(block.children);
        if (block.type === "list") for (const item of block.items) walk(item.children);
        if (block.type === "table") {
          for (const column of block.columns) walkInline(column.header);
          for (const row of block.rows) for (const cell of row) walkInline(cell);
        }
      }
    };
    walk(doc.blocks);
    expect(links.filter((href) => safeHref(href) === null)).toEqual([]);
  });
});

describe("the compliance rules document in particular", () => {
  const doc = parseMarkdown(
    readFileSync(path.join(CONTENT_DIR, CONTENT_DOCUMENTS["compliance-rules"].file), "utf8"),
  );

  it("renders the blocked-country codes as a right-aligned figure column", () => {
    const table = tablesOf(doc.blocks).find((block) => block.label === "Blocked countries");
    expect(table).toBeDefined();
    expect(table?.columns[0]?.numeric).toBe(true);
    expect(table?.columns.slice(1).every((column) => !column.numeric)).toBe(true);
    expect(table?.rows.map((row) => inlineToText(row[0] as readonly InlineNode[]))).toEqual([
      "840",
      "792",
    ]);
  });

  it("keeps the on-chain identifiers in code spans", () => {
    const codes = new Set<string>();
    const walk = (blocks: readonly Block[]): void => {
      for (const block of blocks) {
        if (block.type === "paragraph" || block.type === "heading") {
          for (const node of block.children) if (node.type === "code") codes.add(node.value);
        }
        if (block.type === "list") for (const item of block.items) walk(item.children);
        if (block.type === "table") {
          for (const row of block.rows) {
            for (const cell of row) {
              for (const node of cell) if (node.type === "code") codes.add(node.value);
            }
          }
        }
      }
    };
    walk(doc.blocks);
    expect(codes).toContain("canHold(address)");
    expect(codes).toContain("NotEligible(account)");
    expect(codes).toContain("DEFAULT_ADMIN_ROLE");
  });

  it("lists nine numbered sections in the table of contents, in order", () => {
    expect(doc.toc.map((entry) => entry.text)).toEqual([
      "1. Who may hold the token",
      "2. Transfer restrictions",
      "3. Coupons",
      "4. Getting out",
      "5. NAV and the oracle rail",
      "6. Pause",
      "7. Input bounds",
      "8. Roles",
      "9. What is enforced here versus in production",
    ]);
    expect(doc.toc[0]?.children.map((child) => child.text)).toEqual([
      "Verification",
      "Investor type",
      "Blocked countries",
    ]);
  });
});
