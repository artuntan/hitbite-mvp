/**
 * A small, dependency-free Markdown parser for the two canonical documents this repository
 * publishes as pages: `COMPLIANCE_RULES.md` (`/rules`) and `RISKS.md` (`/risks`), PLAN.md D12.
 *
 * **Why a parser instead of a library.** No Markdown package is installed and this task may not add
 * one. The alternative — shipping the files as preformatted text — would throw away the tables, the
 * headings a reviewer wants to link to, and the mono-font code spans that name the actual Solidity
 * errors. So this parses the subset the documents use and hands back a typed tree.
 *
 * **Why a tree and not an HTML string.** The renderer in `components/content/markdown.tsx` turns
 * these nodes into React elements. No HTML string is ever produced and nothing is ever passed to
 * `dangerouslySetInnerHTML`, so raw HTML in the source — `<script>`, `<img onerror=…>`, an
 * `onclick` attribute — reaches the page as text that React escapes, and cannot become markup.
 * That is a structural property of the output type, not a filter that has to be kept up to date.
 * Link destinations are the one place a string does reach the DOM as a URL, and `safeHref` below
 * is the check on that path.
 *
 * **The supported subset**, which is everything the two documents use plus the constructs a future
 * edit is likely to reach for:
 *
 *   blocks   ATX headings (`#`…`######`), paragraphs, thematic breaks, blockquotes, fenced code,
 *            bullet and ordered lists (nested, tight or loose), GFM pipe tables with alignment
 *   inline   code spans, `**strong**`, `*emphasis*` (and the `_` forms, with CommonMark's
 *            intra-word rule so `SOME_ROLE` is never italicised), links, autolinks, backslash
 *            escapes, soft and hard line breaks
 *
 * Deliberately **not** supported, because neither document uses them and a half-implementation is
 * worse than a documented absence: setext headings (`===` / `---` underlines), reference links,
 * images, HTML entities (`&amp;` renders literally), indented code blocks, footnotes. Anything the
 * parser does not recognise stays on the page as the literal source text — nothing is ever dropped,
 * which is the property the "no paraphrasing" rule needs and which `content.test.ts` asserts over
 * the real documents word by word.
 */

// --------------------------------------------------------------------------- document manifest

/**
 * The canonical documents, their copies under `web/content/`, and the routes that render them.
 *
 * `web/scripts/sync-docs.ts` imports this so the copy script, the drift check and the pages can
 * never disagree about which file is which. The root markdown is the source of truth; the copy
 * exists only because Vercel's build root is `web/` and cannot read the repository root (D12).
 */
export const CONTENT_DOCUMENTS = {
  "compliance-rules": {
    /** Path of the canonical file, relative to the repository root. */
    canonical: "COMPLIANCE_RULES.md",
    /** File name of the copy inside `web/content/`. */
    file: "COMPLIANCE_RULES.md",
    route: "/rules",
  },
  risks: {
    canonical: "RISKS.md",
    file: "RISKS.md",
    route: "/risks",
  },
} as const;

export type ContentDocumentId = keyof typeof CONTENT_DOCUMENTS;

/** Stable order for iteration: the sync script and its check both walk this. */
export const CONTENT_DOCUMENT_IDS = Object.keys(CONTENT_DOCUMENTS) as readonly ContentDocumentId[];

// --------------------------------------------------------------------------- node types

export interface TextNode {
  readonly type: "text";
  readonly value: string;
}

export interface CodeSpanNode {
  readonly type: "code";
  readonly value: string;
}

export interface StrongNode {
  readonly type: "strong";
  readonly children: readonly InlineNode[];
}

export interface EmphasisNode {
  readonly type: "emphasis";
  readonly children: readonly InlineNode[];
}

export interface LinkNode {
  readonly type: "link";
  /** Already passed through `safeHref`; a destination that failed it never becomes a link. */
  readonly href: string;
  readonly title: string | null;
  readonly children: readonly InlineNode[];
}

export interface BreakNode {
  /** A newline inside a paragraph (`soft`) or an explicit two-space break (`hard`). */
  readonly type: "softbreak" | "hardbreak";
}

export type InlineNode = TextNode | CodeSpanNode | StrongNode | EmphasisNode | LinkNode | BreakNode;

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface HeadingBlock {
  readonly type: "heading";
  readonly level: HeadingLevel;
  /** Slug used as the element `id` and as the anchor-link target. Unique within a document. */
  readonly id: string;
  /** The heading with its inline markup stripped — for the table of contents and `aria-label`s. */
  readonly text: string;
  readonly children: readonly InlineNode[];
}

export interface ParagraphBlock {
  readonly type: "paragraph";
  readonly children: readonly InlineNode[];
}

export interface ThematicBreakBlock {
  readonly type: "thematicBreak";
}

export interface BlockquoteBlock {
  readonly type: "blockquote";
  readonly children: readonly Block[];
}

export interface CodeBlockBlock {
  readonly type: "codeBlock";
  readonly language: string | null;
  readonly value: string;
}

export interface ListItem {
  readonly children: readonly Block[];
}

export interface ListBlock {
  readonly type: "list";
  readonly ordered: boolean;
  /** First number of an ordered list; `1` for bullets. */
  readonly start: number;
  /** Tight lists render their single paragraph inline, the way every Markdown renderer does. */
  readonly tight: boolean;
  readonly items: readonly ListItem[];
}

export type ColumnAlign = "left" | "center" | "right";

export interface TableColumn {
  readonly header: readonly InlineNode[];
  /** Explicit GFM alignment (`:--`, `--:`, `:-:`), or `null` when the delimiter row is plain. */
  readonly align: ColumnAlign | null;
  /**
   * Every body cell in the column reads as a figure, so it is right-aligned and set in the
   * tabular mono face — `<TableCell numeric>`. Only ever inferred where GFM gave no alignment.
   */
  readonly numeric: boolean;
}

export interface TableBlock {
  readonly type: "table";
  readonly columns: readonly TableColumn[];
  readonly rows: readonly (readonly (readonly InlineNode[])[])[];
  /**
   * Accessible name. Markdown tables carry no caption, so this is the nearest heading above the
   * table, falling back to the header cells joined — `<Table>` promotes its scroll container to a
   * labelled region and an unnamed region is noise.
   */
  readonly label: string;
}

export type Block =
  | HeadingBlock
  | ParagraphBlock
  | ThematicBreakBlock
  | BlockquoteBlock
  | CodeBlockBlock
  | ListBlock
  | TableBlock;

export interface TocEntry {
  readonly id: string;
  readonly text: string;
  readonly level: HeadingLevel;
  readonly children: readonly TocEntry[];
}

export interface MarkdownDocument {
  /** The leading `#` heading, lifted out so a page can render it as its own `<h1>`. */
  readonly title: HeadingBlock | null;
  /** Everything after the title, in source order. Nothing is reordered, merged or dropped. */
  readonly blocks: readonly Block[];
  /** `##` and `###` headings, nested, for a table of contents. */
  readonly toc: readonly TocEntry[];
}

// --------------------------------------------------------------------------- link safety

/** Schemes a destination may use. Everything else is refused; relative URLs are allowed. */
const ALLOWED_SCHEMES = new Set(["http", "https", "mailto"]);

/**
 * Return `raw` when it is safe to put in an `href`, or `null` when it is not.
 *
 * The check is on the scheme, and it is done on a probe copy with ASCII whitespace and control
 * characters removed, because a browser strips those before resolving a URL: `java\tscript:alert(1)`
 * and `javascript\n:alert(1)` are live URLs and a naive `startsWith("javascript:")` misses both.
 * A destination with no scheme before the first `/`, `?` or `#` is a relative URL and is allowed.
 * The value returned is the original string, never the probe.
 */
export function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (url === "") return null;

  // The escaped ranges are exactly the bytes a browser strips before resolving a URL.
  const probe = url.replace(/[\u0000-\u0020\u007f]/g, "").toLowerCase();
  const colon = probe.indexOf(":");
  if (colon === -1) return url;

  const delimiters = [probe.indexOf("/"), probe.indexOf("?"), probe.indexOf("#")].filter(
    (index) => index !== -1,
  );
  const firstDelimiter = delimiters.length > 0 ? Math.min(...delimiters) : Number.POSITIVE_INFINITY;
  if (colon > firstDelimiter) return url; // the colon is inside a path or a query, not a scheme

  return ALLOWED_SCHEMES.has(probe.slice(0, colon)) ? url : null;
}

// --------------------------------------------------------------------------- slugs

const NON_SLUG = /[^\p{L}\p{N}\s-]/gu;

/**
 * GitHub-style anchor slug: lower-cased, punctuation dropped, spaces to hyphens. Letters outside
 * ASCII are kept (`Türkiye` → `türkiye`), because a fragment may hold any character and dropping
 * them would collide two different headings onto one id.
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(NON_SLUG, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

// --------------------------------------------------------------------------- plain text

/** The visible text of an inline run, with breaks as single spaces. */
export function inlineToText(nodes: readonly InlineNode[]): string {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
      case "code":
        out += node.value;
        break;
      case "strong":
      case "emphasis":
      case "link":
        out += inlineToText(node.children);
        break;
      case "softbreak":
      case "hardbreak":
        out += " ";
        break;
    }
  }
  return out;
}

/**
 * Every visible word in a block tree, one string per block, in source order. Used by the tests to
 * prove the parser drops nothing, and by the pages to derive a meta description.
 */
export function blocksToText(blocks: readonly Block[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly Block[]): void => {
    for (const block of list) {
      switch (block.type) {
        case "heading":
        case "paragraph":
          out.push(inlineToText(block.children));
          break;
        case "codeBlock":
          out.push(block.value);
          break;
        case "thematicBreak":
          break;
        case "blockquote":
          walk(block.children);
          break;
        case "list":
          for (const item of block.items) walk(item.children);
          break;
        case "table":
          out.push(block.columns.map((column) => inlineToText(column.header)).join(" "));
          for (const row of block.rows) out.push(row.map(inlineToText).join(" "));
          break;
      }
    }
  };
  walk(blocks);
  return out;
}

// --------------------------------------------------------------------------- inline parsing

const ASCII_PUNCTUATION = new Set(
  `!"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~`.split("") as readonly string[],
);

function isWhitespace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

function isPunctuation(char: string | undefined): boolean {
  if (char === undefined) return false;
  return ASCII_PUNCTUATION.has(char) || /\p{P}|\p{S}/u.test(char);
}

interface Flanking {
  readonly left: boolean;
  readonly right: boolean;
}

/** CommonMark's left/right-flanking delimiter run test. */
function flanking(source: string, start: number, end: number): Flanking {
  const before = start > 0 ? source[start - 1] : undefined;
  const after = end < source.length ? source[end] : undefined;

  const afterWhitespace = isWhitespace(after);
  const beforeWhitespace = isWhitespace(before);
  const afterPunctuation = isPunctuation(after);
  const beforePunctuation = isPunctuation(before);

  const left = !afterWhitespace && (!afterPunctuation || beforeWhitespace || beforePunctuation);
  const right = !beforeWhitespace && (!beforePunctuation || afterWhitespace || afterPunctuation);
  return { left, right };
}

/** Length of the run of `char` starting at `index`. */
function runLength(source: string, index: number, char: string): number {
  let end = index;
  while (end < source.length && source[end] === char) end += 1;
  return end - index;
}

/**
 * End index (exclusive) of the code span opened by a run of `ticks` backticks at `open`, or `-1`.
 * Used both to build a code-span node and, while scanning for a closing delimiter, to skip over
 * code spans so that a `*` inside backticks never closes emphasis.
 */
function codeSpanEnd(source: string, open: number, ticks: number): number {
  let index = open + ticks;
  while (index < source.length) {
    if (source[index] !== "`") {
      index += 1;
      continue;
    }
    const length = runLength(source, index, "`");
    if (length === ticks) return index + ticks;
    index += length;
  }
  return -1;
}

function normaliseCodeSpan(raw: string): string {
  const collapsed = raw.replace(/\n/g, " ");
  if (
    collapsed.length > 2 &&
    collapsed.startsWith(" ") &&
    collapsed.endsWith(" ") &&
    collapsed.trim() !== ""
  ) {
    return collapsed.slice(1, -1);
  }
  return collapsed;
}

/** Index of the `]` matching the `[` at `open`, honouring escapes, code spans and nesting. */
function closingBracket(source: string, open: number): number {
  let depth = 0;
  let index = open;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "`") {
      const ticks = runLength(source, index, "`");
      const end = codeSpanEnd(source, index, ticks);
      index = end === -1 ? index + ticks : end;
      continue;
    }
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return -1;
}

interface Destination {
  readonly href: string;
  readonly title: string | null;
  readonly end: number;
}

/** Parse `(dest "title")` starting at the `(`. */
function parseDestination(source: string, open: number): Destination | null {
  let index = open + 1;
  while (index < source.length && /[ \t\n]/.test(source[index] ?? "")) index += 1;

  let href = "";
  if (source[index] === "<") {
    const close = source.indexOf(">", index + 1);
    if (close === -1) return null;
    href = source.slice(index + 1, close);
    if (/[<\n]/.test(href)) return null;
    index = close + 1;
  } else {
    let depth = 0;
    const start = index;
    while (index < source.length) {
      const char = source[index] ?? "";
      if (char === "\\" && index + 1 < source.length) {
        index += 2;
        continue;
      }
      if (/[ \t\n]/.test(char)) break;
      if (char === "(") depth += 1;
      if (char === ")") {
        if (depth === 0) break;
        depth -= 1;
      }
      index += 1;
    }
    href = source.slice(start, index);
  }

  while (index < source.length && /[ \t\n]/.test(source[index] ?? "")) index += 1;

  let title: string | null = null;
  const quote = source[index];
  if (quote === '"' || quote === "'") {
    const close = source.indexOf(quote, index + 1);
    if (close === -1) return null;
    title = source.slice(index + 1, close);
    index = close + 1;
    while (index < source.length && /[ \t\n]/.test(source[index] ?? "")) index += 1;
  }

  if (source[index] !== ")") return null;
  return { href: unescapePunctuation(href), title, end: index + 1 };
}

function unescapePunctuation(value: string): string {
  return value.replace(/\\(\p{P}|\p{S})/gu, "$1");
}

const AUTOLINK = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^<>\u0000-\u0020]*)>/;
const EMAIL_AUTOLINK =
  /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/;

/**
 * Parse an inline run. `text` may contain newlines: they become soft breaks, and a line ending in
 * two or more spaces (or a backslash) becomes a hard break, exactly as in CommonMark.
 */
export function parseInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = "";
  let index = 0;

  const flush = (): void => {
    if (buffer !== "") {
      nodes.push({ type: "text", value: buffer });
      buffer = "";
    }
  };

  while (index < source.length) {
    const char = source[index] as string;

    // backslash escape, and the backslash hard break
    if (char === "\\") {
      const next = source[index + 1];
      if (next === "\n") {
        flush();
        nodes.push({ type: "hardbreak" });
        index += 2;
        continue;
      }
      if (next !== undefined && isPunctuation(next)) {
        buffer += next;
        index += 2;
        continue;
      }
      buffer += char;
      index += 1;
      continue;
    }

    // line breaks
    if (char === "\n") {
      const hard = /[ \t]{2,}$/.test(buffer);
      buffer = buffer.replace(/[ \t]+$/, "");
      flush();
      nodes.push({ type: hard ? "hardbreak" : "softbreak" });
      index += 1;
      while (source[index] === " " || source[index] === "\t") index += 1; // leading indent is not content
      continue;
    }

    // code span
    if (char === "`") {
      const ticks = runLength(source, index, "`");
      const end = codeSpanEnd(source, index, ticks);
      if (end !== -1) {
        flush();
        nodes.push({
          type: "code",
          value: normaliseCodeSpan(source.slice(index + ticks, end - ticks)),
        });
        index = end;
        continue;
      }
      buffer += "`".repeat(ticks);
      index += ticks;
      continue;
    }

    // autolink — and the reason `<script>` stays text: it has no scheme, so it matches neither
    if (char === "<") {
      const rest = source.slice(index);
      const scheme = AUTOLINK.exec(rest);
      if (scheme) {
        const href = safeHref(scheme[1] as string);
        flush();
        const label: InlineNode[] = [{ type: "text", value: scheme[1] as string }];
        if (href === null) {
          nodes.push(...label);
        } else {
          nodes.push({ type: "link", href, title: null, children: label });
        }
        index += scheme[0].length;
        continue;
      }
      const email = EMAIL_AUTOLINK.exec(rest);
      if (email) {
        flush();
        nodes.push({
          type: "link",
          href: `mailto:${email[1] as string}`,
          title: null,
          children: [{ type: "text", value: email[1] as string }],
        });
        index += email[0].length;
        continue;
      }
      buffer += char;
      index += 1;
      continue;
    }

    // link
    if (char === "[") {
      const close = closingBracket(source, index);
      if (close !== -1 && source[close + 1] === "(") {
        const destination = parseDestination(source, close + 1);
        if (destination) {
          const children = parseInline(source.slice(index + 1, close));
          const href = safeHref(destination.href);
          flush();
          if (href === null) {
            // A refused destination keeps the link *text* and loses only the URL. Nothing the
            // author wrote disappears from the page; the unusable part does.
            nodes.push(...children);
          } else {
            nodes.push({ type: "link", href, title: destination.title, children });
          }
          index = destination.end;
          continue;
        }
      }
      buffer += char;
      index += 1;
      continue;
    }

    // emphasis
    if (char === "*" || char === "_") {
      const node = parseEmphasis(source, index, char);
      if (node) {
        flush();
        nodes.push(node.node);
        index = node.end;
        continue;
      }
      const length = runLength(source, index, char);
      buffer += char.repeat(length);
      index += length;
      continue;
    }

    buffer += char;
    index += 1;
  }

  flush();
  return nodes;
}

interface EmphasisMatch {
  readonly node: InlineNode;
  readonly end: number;
}

function parseEmphasis(source: string, start: number, char: string): EmphasisMatch | null {
  const run = runLength(source, start, char);
  const size = run >= 2 ? 2 : 1;
  const openEnd = start + size;

  const open = flanking(source, start, start + run);
  const before = start > 0 ? source[start - 1] : undefined;
  const canOpen = char === "*" ? open.left : open.left && (!open.right || isPunctuation(before));
  if (!canOpen) return null;

  let index = openEnd;
  while (index < source.length) {
    const current = source[index] as string;

    if (current === "\\") {
      index += 2;
      continue;
    }
    if (current === "`") {
      const ticks = runLength(source, index, "`");
      const end = codeSpanEnd(source, index, ticks);
      index = end === -1 ? index + ticks : end;
      continue;
    }
    if (current !== char) {
      index += 1;
      continue;
    }

    const closeRun = runLength(source, index, char);
    const close = flanking(source, index, index + closeRun);
    const after = index + closeRun < source.length ? source[index + closeRun] : undefined;
    const canClose =
      char === "*" ? close.right : close.right && (!close.left || isPunctuation(after));

    if (canClose && closeRun >= size && index > openEnd) {
      const children = parseInline(source.slice(openEnd, index));
      return {
        node: size === 2 ? { type: "strong", children } : { type: "emphasis", children },
        end: index + size,
      };
    }
    index += closeRun;
  }

  return null;
}

// --------------------------------------------------------------------------- block parsing

const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*([^`\s]*)[ \t]*$/;
const BLOCKQUOTE = /^ {0,3}>[ \t]?(.*)$/;
const BULLET_ITEM = /^( *)([-*+])([ \t]+)(.*)$/;
const ORDERED_ITEM = /^( *)(\d{1,9})([.)])([ \t]+)(.*)$/;
const DELIMITER_CELL = /^:?-+:?$/;

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === "";
}

function indentOf(line: string): number {
  const match = /^ */.exec(line);
  return match ? match[0].length : 0;
}

/** Split a table row on unescaped pipes, keeping `\|` escaped for the inline parser. */
function splitRow(line: string): string[] {
  let source = line.trim();
  if (source.startsWith("|")) source = source.slice(1);
  if (source.endsWith("|") && !source.endsWith("\\|")) source = source.slice(0, -1);

  const cells: string[] = [];
  let buffer = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] as string;
    if (char === "\\" && source[index + 1] === "|") {
      buffer += "\\|";
      index += 1;
      continue;
    }
    if (char === "`") {
      const ticks = runLength(source, index, "`");
      const end = codeSpanEnd(source, index, ticks);
      if (end !== -1) {
        buffer += source.slice(index, end);
        index = end - 1;
        continue;
      }
    }
    if (char === "|") {
      cells.push(buffer);
      buffer = "";
      continue;
    }
    buffer += char;
  }
  cells.push(buffer);
  return cells.map((cell) => cell.trim());
}

function parseDelimiterRow(line: string): (ColumnAlign | null)[] | null {
  if (!line.includes("|") || !line.includes("-")) return null;
  const cells = splitRow(line);
  if (cells.length === 0) return null;
  const aligns: (ColumnAlign | null)[] = [];
  for (const cell of cells) {
    if (!DELIMITER_CELL.test(cell)) return null;
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    aligns.push(left && right ? "center" : right ? "right" : left ? "left" : null);
  }
  return aligns;
}

/** Is this line, plus the one after it, the start of a GFM table? */
function tableStartsAt(lines: readonly string[], index: number): boolean {
  const header = lines[index];
  const delimiter = lines[index + 1];
  if (header === undefined || delimiter === undefined) return false;
  if (!header.includes("|")) return false;
  const aligns = parseDelimiterRow(delimiter);
  return aligns !== null && aligns.length === splitRow(header).length;
}

/** A column whose every non-empty body cell reads as a figure: `840`, `1,000.00`, `-5%`. */
const NUMERIC_CELL = /^[-+−]?[\d][\d,_ ]*(?:\.\d+)?\s*%?$/;

function isNumericColumn(cells: readonly string[]): boolean {
  const values = cells.map((cell) => cell.trim()).filter((cell) => cell !== "");
  if (values.length === 0) return false;
  return values.every((value) => NUMERIC_CELL.test(value.replace(/^`|`$/g, "")));
}

interface HeadingContext {
  /** Nearest heading seen so far, used to name tables. */
  current: string;
  /** How many times each base slug has been used, and every id handed out so far. */
  readonly slugs: Map<string, number>;
  readonly used: Set<string>;
}

/**
 * `Pause`, `Pause`, `Pause` → `pause`, `pause-1`, `pause-2`.
 *
 * The loop matters: a document containing both "Pause" twice *and* a literal "Pause 1" would
 * otherwise mint the same id twice, and a duplicate id breaks both the permalink and the anchor
 * the table of contents points at.
 */
function uniqueSlug(text: string, context: HeadingContext, fallbackIndex: number): string {
  const base = slugify(text) || `section-${fallbackIndex}`;
  let suffix = context.slugs.get(base) ?? 0;
  let candidate = suffix === 0 ? base : `${base}-${suffix}`;
  while (context.used.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  context.slugs.set(base, suffix + 1);
  context.used.add(candidate);
  return candidate;
}

function parseBlocks(lines: readonly string[], context: HeadingContext): Block[] {
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] as string;

    if (isBlank(line)) {
      index += 1;
      continue;
    }

    // fenced code
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[2] as string;
      const fenceChar = marker[0] as string;
      const language = (fence[3] ?? "").trim() || null;
      const indent = (fence[1] ?? "").length;
      /** A closing fence: up to three spaces, then at least as many of the same character. */
      const closesFence = (candidate: string): boolean => {
        if (indentOf(candidate) > 3) return false;
        const trimmed = candidate.trim();
        return trimmed.length >= marker.length && [...trimmed].every((c) => c === fenceChar);
      };
      const body: string[] = [];
      index += 1;
      while (index < lines.length) {
        const current = lines[index] as string;
        if (closesFence(current)) {
          index += 1;
          break;
        }
        body.push(current.slice(Math.min(indent, indentOf(current))));
        index += 1;
      }
      blocks.push({ type: "codeBlock", language, value: body.join("\n") });
      continue;
    }

    // thematic break — checked before lists so `---` never reads as a bullet
    if (THEMATIC_BREAK.test(line)) {
      blocks.push({ type: "thematicBreak" });
      index += 1;
      continue;
    }

    // heading
    const heading = ATX_HEADING.exec(line);
    if (heading) {
      const level = (heading[1] as string).length as HeadingLevel;
      const raw = (heading[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "");
      const children = parseInline(raw);
      const text = inlineToText(children).trim();
      context.current = text;
      blocks.push({
        type: "heading",
        level,
        id: uniqueSlug(text, context, blocks.length),
        text,
        children,
      });
      index += 1;
      continue;
    }

    // blockquote
    if (BLOCKQUOTE.test(line)) {
      const body: string[] = [];
      while (index < lines.length) {
        const current = lines[index] as string;
        const match = BLOCKQUOTE.exec(current);
        if (match) {
          body.push(match[1] as string);
          index += 1;
          continue;
        }
        // lazy continuation: a plain paragraph line directly under a quoted one stays inside it
        if (!isBlank(current) && body.length > 0 && !isBlank(body[body.length - 1])) {
          body.push(current);
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: "blockquote", children: parseBlocks(body, context) });
      continue;
    }

    // table
    if (tableStartsAt(lines, index)) {
      const headerCells = splitRow(lines[index] as string);
      const aligns = parseDelimiterRow(lines[index + 1] as string) as (ColumnAlign | null)[];
      index += 2;
      const rawRows: string[][] = [];
      while (
        index < lines.length &&
        !isBlank(lines[index]) &&
        (lines[index] as string).includes("|")
      ) {
        rawRows.push(splitRow(lines[index] as string));
        index += 1;
      }

      const width = headerCells.length;
      const rows = rawRows.map((row) =>
        Array.from({ length: width }, (_, column) => parseInline(row[column] ?? "")),
      );
      const columns: TableColumn[] = headerCells.map((header, column) => {
        const align = aligns[column] ?? null;
        const body = rawRows.map((row) => row[column] ?? "");
        return {
          header: parseInline(header),
          align,
          numeric: align === null && isNumericColumn(body),
        };
      });
      blocks.push({
        type: "table",
        columns,
        rows,
        label: context.current || headerCells.join(", "),
      });
      continue;
    }

    // list
    if (BULLET_ITEM.test(line) || ORDERED_ITEM.test(line)) {
      const list = parseList(lines, index, context);
      blocks.push(list.block);
      index = list.end;
      continue;
    }

    // paragraph
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] as string;
      if (isBlank(current)) break;
      if (paragraph.length > 0) {
        if (
          ATX_HEADING.test(current) ||
          THEMATIC_BREAK.test(current) ||
          FENCE.test(current) ||
          BLOCKQUOTE.test(current) ||
          BULLET_ITEM.test(current) ||
          ORDERED_ITEM.test(current) ||
          tableStartsAt(lines, index)
        ) {
          break;
        }
      }
      paragraph.push(current.trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join("\n")) });
  }

  return blocks;
}

interface ParsedList {
  readonly block: ListBlock;
  readonly end: number;
}

function parseList(lines: readonly string[], start: number, context: HeadingContext): ParsedList {
  const first = lines[start] as string;
  const firstBullet = BULLET_ITEM.exec(first);
  const firstOrdered = ORDERED_ITEM.exec(first);
  const ordered = firstOrdered !== null && firstBullet === null;
  const listIndent = indentOf(first);
  const startNumber = ordered ? Number.parseInt(firstOrdered?.[2] ?? "1", 10) : 1;

  const items: ListItem[] = [];
  let index = start;
  let loose = false;

  while (index < lines.length) {
    const line = lines[index] as string;
    const bullet = BULLET_ITEM.exec(line);
    const numbered = ORDERED_ITEM.exec(line);
    const match = ordered ? numbered : bullet;
    if (!match || (ordered ? bullet !== null : numbered !== null)) break;
    if (indentOf(line) !== listIndent) break;

    const markerWidth = ordered
      ? (match[2] as string).length + (match[3] as string).length + (match[4] as string).length
      : (match[2] as string).length + (match[3] as string).length;
    const contentIndent = listIndent + markerWidth;
    const body: string[] = [ordered ? (match[5] as string) : (match[4] as string)];
    index += 1;

    let pendingBlank = 0;
    while (index < lines.length) {
      const current = lines[index] as string;
      if (isBlank(current)) {
        pendingBlank += 1;
        index += 1;
        continue;
      }
      const currentIndent = indentOf(current);
      const startsItem = BULLET_ITEM.test(current) || ORDERED_ITEM.test(current);

      if (currentIndent >= contentIndent) {
        if (pendingBlank > 0) {
          body.push(...Array<string>(pendingBlank).fill(""));
          loose = true;
          pendingBlank = 0;
        }
        body.push(current.slice(contentIndent));
        index += 1;
        continue;
      }
      // lazy continuation of the item's paragraph
      if (
        pendingBlank === 0 &&
        !startsItem &&
        !THEMATIC_BREAK.test(current) &&
        !ATX_HEADING.test(current)
      ) {
        body.push(current.trim());
        index += 1;
        continue;
      }
      break;
    }

    if (pendingBlank > 0 && index < lines.length) {
      const next = lines[index] as string;
      const nextIsItem = ordered ? ORDERED_ITEM.test(next) : BULLET_ITEM.test(next);
      if (nextIsItem && indentOf(next) === listIndent) loose = true;
    }

    items.push({ children: parseBlocks(body, context) });
  }

  return {
    block: { type: "list", ordered, start: startNumber, tight: !loose, items },
    end: index,
  };
}

// --------------------------------------------------------------------------- document

function buildToc(blocks: readonly Block[]): TocEntry[] {
  const top: TocEntry[] = [];
  let current: { entry: TocEntry; children: TocEntry[] } | null = null;

  for (const block of blocks) {
    if (block.type !== "heading") continue;
    if (block.level === 2) {
      const children: TocEntry[] = [];
      const entry: TocEntry = { id: block.id, text: block.text, level: 2, children };
      top.push(entry);
      current = { entry, children };
      continue;
    }
    if (block.level === 3 && current) {
      current.children.push({ id: block.id, text: block.text, level: 3, children: [] });
    }
  }

  return top;
}

/**
 * Parse a whole document. The leading `#` heading is lifted into `title` so a page can render it
 * as its `<h1>` above the table of contents; everything else stays exactly where the author put it.
 */
export function parseMarkdown(source: string): MarkdownDocument {
  const normalised = source.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  const context: HeadingContext = { current: "", slugs: new Map(), used: new Set() };
  const blocks = parseBlocks(normalised.split("\n"), context);

  const first = blocks[0];
  const hasTitle = first !== undefined && first.type === "heading" && first.level === 1;
  const body = hasTitle ? blocks.slice(1) : blocks;

  return {
    title: hasTitle ? (first as HeadingBlock) : null,
    blocks: body,
    toc: buildToc(body),
  };
}
