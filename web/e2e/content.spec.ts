import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { CONTENT_DOCUMENTS, inlineToText, parseMarkdown, type Block } from "../lib/content";
import { FOOTER_DISCLAIMER, TESTNET_BANNER } from "../lib/copy";

/**
 * `/rules` and `/risks` (BUILD_PROMPT 7.2, PLAN.md D12).
 *
 * The pages render `COMPLIANCE_RULES.md` and `RISKS.md`, so these tests take the canonical
 * documents as the oracle: they parse the same files the build read and assert the page against
 * them — every heading, in order, at the same level; every table, as a real table with the right
 * number of rows; the numeric column right-aligned in the tabular mono face. A page that quietly
 * paraphrased, reordered or dropped a section would fail here rather than in a reviewer's reading.
 *
 * Runs against a production build — `playwright.config.ts` starts `pnpm start`, so `pnpm build`
 * must have happened first.
 */

const CONTENT_DIR = path.join(__dirname, "..", "content");

interface DocumentFixture {
  readonly route: string;
  readonly name: string;
  readonly file: string;
  readonly titleText: string;
  readonly headings: readonly { level: number; text: string; id: string }[];
  readonly tables: readonly { label: string; columns: string[]; rows: string[][] }[];
  readonly sections: readonly { id: string; text: string }[];
}

function load(id: keyof typeof CONTENT_DOCUMENTS, name: string): DocumentFixture {
  const entry = CONTENT_DOCUMENTS[id];
  const document = parseMarkdown(readFileSync(path.join(CONTENT_DIR, entry.file), "utf8"));
  if (!document.title) throw new Error(`${entry.file} has no level-1 heading`);

  const headings = [
    { level: 1, text: document.title.text, id: document.title.id },
    ...document.blocks
      .filter((block): block is Extract<Block, { type: "heading" }> => block.type === "heading")
      .map((block) => ({ level: block.level as number, text: block.text, id: block.id })),
  ];

  const tables = document.blocks
    .filter((block): block is Extract<Block, { type: "table" }> => block.type === "table")
    .map((block) => ({
      label: block.label,
      columns: block.columns.map((column) => inlineToText(column.header)),
      rows: block.rows.map((row) => row.map(inlineToText)),
    }));

  return {
    route: entry.route,
    name,
    file: entry.file,
    titleText: document.title.text,
    headings,
    tables,
    sections: document.toc.map((entry_) => ({ id: entry_.id, text: entry_.text })),
  };
}

const DOCUMENTS: readonly DocumentFixture[] = [
  load("compliance-rules", "Compliance rules"),
  load("risks", "Risks"),
];

/** Collapse the soft line breaks the renderer keeps from the source, as the DOM does visually. */
function normalise(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function collectPageProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

for (const document of DOCUMENTS) {
  test.describe(`${document.route} renders ${document.file}`, () => {
    test("renders with the testnet banner, the footer disclaimer and one h1", async ({ page }) => {
      const problems = collectPageProblems(page);
      const response = await page.goto(document.route);
      expect(response?.status()).toBe(200);

      await expect(page).toHaveTitle(/HitBite/);

      // `.first()`: the documents themselves open with the banner sentence, so the page contains
      // it twice on purpose — the layout's banner and the document's own first paragraph.
      await expect(page.getByText(TESTNET_BANNER).first()).toBeVisible();
      await expect(page.getByRole("contentinfo").getByText(FOOTER_DISCLAIMER)).toBeVisible();

      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1).toHaveCount(1);
      await expect(h1).toHaveText(document.titleText);

      // Public page: the wallet slot in the header stays empty (PLAN.md D63).
      await expect(page.locator("#wallet-slot")).toBeEmpty();

      expect(problems).toEqual([]);
    });

    test("has exactly the document's headings, in the document's order and at its levels", async ({
      page,
    }) => {
      await page.goto(document.route);

      const rendered = await page
        .locator("main :is(h1, h2, h3, h4, h5, h6)")
        .evaluateAll((elements) =>
          elements.map((element) => ({
            level: Number(element.tagName.slice(1)),
            text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
            id: element.id,
          })),
        );

      expect(rendered).toEqual(
        document.headings.map((heading) => ({
          level: heading.level,
          text: heading.text,
          id: heading.id,
        })),
      );
    });

    test("gives every heading a permalink that resolves to it", async ({ page }) => {
      await page.goto(document.route);

      for (const heading of document.headings) {
        // `[aria-label]` tells the heading's permalink apart from the table-of-contents link to
        // the same id: the contents entry is named by its own text and carries no label.
        const anchor = page.locator(`main a[href="#${heading.id}"][aria-label]`);
        await expect(anchor, `no permalink for “${heading.text}”`).toHaveCount(1);
        await expect(anchor).toHaveAttribute(
          "aria-label",
          new RegExp(heading.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        );
        await expect(page.locator(`[id="${heading.id}"]`)).toHaveCount(1);
      }
    });

    test("lists the document's sections in the table of contents and jumps to them", async ({
      page,
    }) => {
      await page.goto(document.route);

      const toc = page.getByTestId("table-of-contents");
      await expect(toc).toBeVisible();

      const links = await toc.locator("a").evaluateAll((elements) =>
        elements.map((element) => ({
          href: (element as HTMLAnchorElement).getAttribute("href"),
          text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
        })),
      );
      // Every top-level section is in the contents, in order (sub-sections are listed under them).
      const topLevel = links.filter((link) =>
        document.sections.some((section) => link.href === `#${section.id}`),
      );
      expect(topLevel).toEqual(
        document.sections.map((section) => ({ href: `#${section.id}`, text: section.text })),
      );

      const first = document.sections[0];
      if (!first) throw new Error(`${document.file} has no level-2 sections`);
      await toc.locator(`a[href="#${first.id}"]`).click();
      await expect(page).toHaveURL(new RegExp(`#${first.id}$`));
      await expect(page.locator(`[id="${first.id}"]`)).toBeInViewport();
    });

    test("renders every table as a table, with its headers and all of its rows", async ({
      page,
    }) => {
      await page.goto(document.route);

      const tables = page.locator("main table");
      await expect(tables).toHaveCount(document.tables.length);

      for (const [index, expected] of document.tables.entries()) {
        const table = tables.nth(index);

        // The scroll container is a labelled region, named after the heading above the table.
        await expect(
          page.locator(`main [role="region"][aria-label="${expected.label}"]`),
        ).toHaveCount(1);

        const columns = await table.locator("thead th").allTextContents();
        expect(columns.map(normalise), `${expected.label}: column headers`).toEqual(
          expected.columns,
        );
        await expect(table.locator("thead th").first()).toHaveAttribute("scope", "col");

        const rows = await table
          .locator("tbody tr")
          .evaluateAll((elements) =>
            elements.map((row) =>
              [...row.querySelectorAll("td")].map((cell) =>
                (cell.textContent ?? "").replace(/\s+/g, " ").trim(),
              ),
            ),
          );
        expect(rows, `${expected.label}: body rows`).toEqual(expected.rows);
      }
    });
  });
}

test.describe("/rules, in detail", () => {
  test("sets the country-code column in the tabular mono face, right aligned", async ({ page }) => {
    await page.goto("/rules");

    const table = page.locator('main [role="region"][aria-label="Blocked countries"] table');
    const code = table.locator("tbody tr").first().locator("td").first();
    const country = table.locator("tbody tr").first().locator("td").nth(1);

    await expect(code).toHaveText("840");
    const codeStyle = await code.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        textAlign: style.textAlign,
        variant: style.fontVariantNumeric,
        font: style.fontFamily,
      };
    });
    expect(codeStyle.textAlign).toBe("right");
    expect(codeStyle.variant).toContain("tabular-nums");
    expect(codeStyle.font).toMatch(/mono/i);

    // A column of words is left alone: the numeric treatment is inferred per column, not applied
    // to the whole table.
    const countryStyle = await country.evaluate((element) => {
      const style = getComputedStyle(element);
      return { textAlign: style.textAlign, font: style.fontFamily };
    });
    // Chromium reports the logical default as `start`, not `left`.
    expect(["left", "start"]).toContain(countryStyle.textAlign);
    expect(countryStyle.font).not.toMatch(/mono/i);
  });

  test("keeps the contract identifiers in code spans, in the mono face", async ({ page }) => {
    await page.goto("/rules");

    const code = page.locator("main code", { hasText: "canHold(address)" }).first();
    await expect(code).toBeVisible();
    await expect(code).toHaveCSS("font-family", /mono/i);
  });

  test("renders the document's own sentences, verbatim", async ({ page }) => {
    await page.goto("/rules");
    const main = page.locator("main");

    await expect(main).toContainText(
      "The rules are enforced by the contracts, not by the interface.",
    );
    await expect(main).toContainText(
      "Attempting to verify an address with a blocked country reverts with CountryBlocked(country).",
    );
    await expect(main).toContainText(
      "NAV is stored on-chain as an integer in USDC units, six decimals, per one whole token.",
    );
    // the closing disclaimer of the document itself, in italics
    await expect(main.locator("em").last()).toContainText(
      "This is a technical demonstration on a public test network.",
    );
  });

  test("renders the bullet and numbered lists as lists", async ({ page }) => {
    await page.goto("/rules");
    const main = page.locator("main");

    await expect(main.locator("ol > li")).toContainText([
      "It has a verification record (isVerified is true), and",
      "the country on that record is not blocked.",
    ]);
    await expect(main.locator("ul > li").first()).toContainText(
      "The rules are enforced by the contracts, not by the interface.",
    );
  });
});

test.describe("/risks, in detail", () => {
  test("renders the document's own sentences, verbatim", async ({ page }) => {
    await page.goto("/risks");
    const main = page.locator("main");

    await expect(main).toContainText("Read section 1 first.");
    await expect(main).toContainText("The portfolio is simulated.");
    await expect(main).toContainText("They have not been audited.");
    await expect(main).toContainText(
      "Losing a wallet's private key loses the position. There is no password reset",
    );
  });

  test("has no tables, and says so by rendering none", async ({ page }) => {
    await page.goto("/risks");
    await expect(page.locator("main table")).toHaveCount(0);
  });
});
