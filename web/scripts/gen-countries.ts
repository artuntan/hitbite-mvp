/**
 * gen-countries — write `web/lib/countries.json` from `i18n-iso-countries` (PLAN.md D23).
 *
 * Run it from `web/` with `pnpm gen:countries` and commit the result. The list is generated
 * rather than hand-typed because BUILD_PROMPT.md 16.1 asks for the *full* ISO 3166-1 list with
 * blocked entries disabled and explained, and a hand-typed list of 249 countries is a list with
 * mistakes in it. `i18n-iso-countries` is a dev dependency for exactly this reason: the data is
 * baked into a committed file, so nothing about the country select costs the browser a library.
 *
 * Two properties this script deliberately guarantees:
 *
 *   - **It is byte-stable.** No timestamp is written, entries are sorted by numeric code, and the
 *     output goes through Prettier with the repository's config. Re-running it on an unchanged
 *     dependency produces an identical file, so `git status` after `pnpm gen:countries` is empty
 *     unless ISO 3166-1 itself moved.
 *   - **It fails loudly.** Every code BUILD_PROMPT.md 16.1 names (784, 682, 634, 276, 826, 756,
 *     702, 840, 792) and every blocked code must resolve to the expected alpha-2, or the script
 *     throws instead of writing a file that type-checks and is wrong. `lib/countries.test.ts`
 *     asserts the same thing over the committed output.
 *
 * The `blocked` marks here are the **deployment seed** — the pair `script/Deploy.s.sol` passes to
 * the `IdentityRegistry` constructor. The registry's admin can block or unblock a country at any
 * time, so the live answer comes from the chain (`lib/server/chain.ts`), and this file is the
 * floor the server never goes below. See `lib/countries.ts` for that split in full.
 */

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import * as prettier from "prettier";

// --------------------------------------------------------------------------- the library

/** Only the four functions this script uses, so the untyped CJS import stays contained. */
interface IsoCountries {
  registerLocale(locale: unknown): void;
  getNumericCodes(): Record<string, string>;
  getName(code: string | number, lang: string): string | undefined;
  alpha2ToNumeric(alpha2: string): string | undefined;
}

const requireCjs = createRequire(import.meta.url);
const iso = requireCjs("i18n-iso-countries") as IsoCountries;
iso.registerLocale(requireCjs("i18n-iso-countries/langs/en.json"));

const ISO_PACKAGE_VERSION = (requireCjs("i18n-iso-countries/package.json") as { version: string })
  .version;

// --------------------------------------------------------------------------- policy

const WEB_DIR = path.resolve(import.meta.dirname, "..");
const OUTPUT_FILE = path.join(WEB_DIR, "lib", "countries.json");

/**
 * The blocklist `contracts/script/Deploy.s.sol` seeds the registry with, with the reason
 * COMPLIANCE_RULES.md section 1 gives for each. Reasons are written for a person reading a
 * disabled option in a select, not for a developer reading a log.
 */
const SEED_BLOCKED: Record<number, { alpha2: string; reason: string }> = {
  840: {
    alpha2: "US",
    reason:
      "Not available to US persons: hbTRS is not registered under US securities law and is not offered in the United States.",
  },
  792: {
    alpha2: "TR",
    reason: "Not offered to residents of Türkiye in phase one.",
  },
};

/** BUILD_PROMPT.md 16.1 — the codes the tests, the demo and the UI copy all depend on. */
const REQUIRED_CODES: Record<number, string> = {
  784: "AE",
  682: "SA",
  634: "QA",
  276: "DE",
  826: "GB",
  756: "CH",
  702: "SG",
  840: "US",
  792: "TR",
};

// --------------------------------------------------------------------------- failure

class GenError extends Error {
  readonly hint: string;

  constructor(message: string, hint: string) {
    super(message);
    this.name = "GenError";
    this.hint = hint;
  }
}

// --------------------------------------------------------------------------- build

interface CountryEntry {
  numeric: number;
  alpha2: string;
  name: string;
  blocked?: true;
  reason?: string;
}

function buildEntries(): CountryEntry[] {
  const numericCodes = iso.getNumericCodes();
  const entries: CountryEntry[] = [];

  for (const [numericKey, alpha2] of Object.entries(numericCodes)) {
    const numeric = Number(numericKey);
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 999) {
      throw new GenError(
        `i18n-iso-countries returned numeric code "${numericKey}", which is outside the 1..999 range the IdentityRegistry accepts.`,
        "IdentityRegistry._checkCountry rejects 0 and anything above 999. Investigate before regenerating.",
      );
    }
    const name = iso.getName(alpha2, "en");
    if (!name) {
      throw new GenError(
        `no English name for ${alpha2} (numeric ${numeric}).`,
        "The English locale failed to register, or the library's data changed shape.",
      );
    }
    const blocked = SEED_BLOCKED[numeric];
    if (blocked) {
      if (blocked.alpha2 !== alpha2) {
        throw new GenError(
          `blocked code ${numeric} is ${alpha2} in ISO 3166-1, not ${blocked.alpha2}.`,
          "The blocklist in this script and the ISO data disagree. Fix the script, not the data.",
        );
      }
      entries.push({ numeric, alpha2, name, blocked: true, reason: blocked.reason });
    } else {
      entries.push({ numeric, alpha2, name });
    }
  }

  entries.sort((a, b) => a.numeric - b.numeric);
  return entries;
}

function assertRequiredCodes(entries: readonly CountryEntry[]): void {
  const byNumeric = new Map(entries.map((entry) => [entry.numeric, entry]));

  for (const [numeric, alpha2] of Object.entries(REQUIRED_CODES)) {
    const entry = byNumeric.get(Number(numeric));
    if (!entry) {
      throw new GenError(
        `BUILD_PROMPT.md 16.1 requires country ${numeric} (${alpha2}) and it is not in the generated list.`,
        "The i18n-iso-countries version may have dropped it. Do not hand-edit countries.json; fix the source.",
      );
    }
    if (entry.alpha2 !== alpha2) {
      throw new GenError(
        `country ${numeric} generated as ${entry.alpha2}, but BUILD_PROMPT.md 16.1 says ${alpha2}.`,
        "One of the two is wrong. Check ISO 3166-1 before changing either.",
      );
    }
  }

  for (const numeric of Object.keys(SEED_BLOCKED)) {
    const entry = byNumeric.get(Number(numeric));
    if (!entry?.blocked) {
      throw new GenError(
        `seed-blocked country ${numeric} was not marked blocked in the output.`,
        "SEED_BLOCKED and the generated entries disagree; this is a bug in this script.",
      );
    }
  }
}

/**
 * Serialise with one entry per line before Prettier sees it. Prettier keeps an object on one line
 * when the source had no break after `{`, so this is what makes the 249-entry file readable in a
 * diff: a country that changes name changes exactly one line.
 */
function serialise(entries: readonly CountryEntry[]): string {
  const blockedCount = entries.filter((entry) => entry.blocked).length;
  const lines = entries.map((entry) => `    ${JSON.stringify(entry)}`).join(",\n");

  return `{
  "generated_by": "pnpm gen:countries (web/scripts/gen-countries.ts)",
  "source": "i18n-iso-countries ${ISO_PACKAGE_VERSION} — ISO 3166-1, English names",
  "note": "\`blocked\` marks the codes the deploy script seeds into IdentityRegistry. The registry's admin can change the blocklist at any time, so the live answer is read from the chain; this file is the floor the server never goes below.",
  "count": ${entries.length},
  "blocked_count": ${blockedCount},
  "countries": [
${lines}
  ]
}
`;
}

async function writeFormatted(file: string, source: string): Promise<void> {
  const options = await prettier.resolveConfig(file);
  const formatted = await prettier.format(source, { ...options, filepath: file });
  writeFileSync(file, formatted, "utf8");
}

async function main(): Promise<void> {
  const entries = buildEntries();
  assertRequiredCodes(entries);
  await writeFormatted(OUTPUT_FILE, serialise(entries));

  const blocked = entries.filter((entry) => entry.blocked);
  console.log(
    `gen-countries: wrote lib/countries.json — ${entries.length} countries from i18n-iso-countries ${ISO_PACKAGE_VERSION}`,
  );
  for (const entry of blocked) {
    console.log(`  blocked  ${entry.numeric} ${entry.alpha2}  ${entry.name}`);
  }
  console.log(
    "  the registry's live blocklist is read from the chain; these marks are the deploy-time seed",
  );
}

try {
  await main();
} catch (error) {
  if (error instanceof GenError) {
    console.error(`\ngen-countries failed: ${error.message}\n\n${error.hint}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
