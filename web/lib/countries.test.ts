/**
 * The generated country list (PLAN.md D23).
 *
 * `countries.json` is written by `pnpm gen:countries` and committed, so the thing worth testing is
 * the committed file: that it is the whole ISO 3166-1 list, that it is internally consistent, and
 * that every code BUILD_PROMPT.md 16.1 names is present with the right alpha-2. A wrong country
 * code is not a visual bug — it is an address verified against the wrong jurisdiction.
 */

import { describe, expect, it } from "vitest";

import countriesJson from "./countries.json";
import {
  COUNTRIES,
  COUNTRIES_BY_NAME,
  COUNTRY_LIST_SOURCE,
  describeCountry,
  getCountryByAlpha2,
  getCountryByNumeric,
  isCountryCodeInContractRange,
  isKnownCountryCode,
  SEED_BLOCKED_CODES,
  SEED_BLOCKED_COUNTRIES,
  seedBlockedReason,
} from "./countries";

/** BUILD_PROMPT.md 16.1, verbatim. */
const REQUIRED = [
  [784, "AE", "United Arab Emirates"],
  [682, "SA", "Saudi Arabia"],
  [634, "QA", "Qatar"],
  [276, "DE", "Germany"],
  [826, "GB", "United Kingdom"],
  [756, "CH", "Switzerland"],
  [702, "SG", "Singapore"],
  [840, "US", "United States"],
  [792, "TR", "Türkiye"],
] as const;

describe("the committed countries.json", () => {
  it("is the full ISO 3166-1 list", () => {
    // ISO 3166-1 has 249 officially assigned entries; the file must be that list, not a subset.
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(249);
    expect(countriesJson.count).toBe(COUNTRIES.length);
    expect(COUNTRY_LIST_SOURCE).toMatch(/i18n-iso-countries/);
  });

  it("carries a numeric code, an alpha-2 and an English name for every entry", () => {
    for (const country of COUNTRIES) {
      expect(Number.isInteger(country.numeric)).toBe(true);
      expect(isCountryCodeInContractRange(country.numeric)).toBe(true);
      expect(country.alpha2).toMatch(/^[A-Z]{2}$/);
      expect(country.name.trim().length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate numeric code and no duplicate alpha-2", () => {
    expect(new Set(COUNTRIES.map((c) => c.numeric)).size).toBe(COUNTRIES.length);
    expect(new Set(COUNTRIES.map((c) => c.alpha2)).size).toBe(COUNTRIES.length);
  });

  it("is sorted by numeric code, so a regeneration produces a readable diff", () => {
    const codes = COUNTRIES.map((c) => c.numeric);
    expect(codes).toEqual([...codes].sort((a, b) => a - b));
  });
});

describe("BUILD_PROMPT 16.1 codes", () => {
  for (const [numeric, alpha2, name] of REQUIRED) {
    it(`${numeric} is ${alpha2} (${name})`, () => {
      const country = getCountryByNumeric(numeric);
      expect(country).not.toBeNull();
      expect(country?.alpha2).toBe(alpha2);
      expect(country?.name).toContain(name);
      // and the reverse lookup agrees, so the two maps cannot drift
      expect(getCountryByAlpha2(alpha2)?.numeric).toBe(numeric);
    });
  }

  it("resolves alpha-2 case-insensitively, because a query string is not a form", () => {
    expect(getCountryByAlpha2("de")?.numeric).toBe(276);
    expect(getCountryByAlpha2(" gb ")?.numeric).toBe(826);
  });
});

describe("the seeded blocklist", () => {
  it("is exactly the pair the deploy script passes to IdentityRegistry", () => {
    expect(SEED_BLOCKED_CODES).toEqual([792, 840]);
    expect(countriesJson.blocked_count).toBe(SEED_BLOCKED_COUNTRIES.length);
  });

  it("explains each blocked country in a sentence the UI can render", () => {
    for (const country of SEED_BLOCKED_COUNTRIES) {
      expect(country.blocked).toBe(true);
      expect(country.reason).not.toBeNull();
      expect((country.reason ?? "").length).toBeGreaterThan(30);
    }
    expect(seedBlockedReason(840)).toMatch(/US securities law|not registered/i);
    expect(seedBlockedReason(792)).toMatch(/phase one/i);
  });

  it("marks nothing else as blocked", () => {
    expect(seedBlockedReason(276)).toBeNull();
    expect(seedBlockedReason(784)).toBeNull();
    expect(
      COUNTRIES.filter((c) => c.blocked)
        .map((c) => c.numeric)
        .sort((a, b) => a - b),
    ).toEqual([792, 840]);
  });
});

describe("the accessors", () => {
  it("rejects codes that are not in the list", () => {
    expect(isKnownCountryCode(0)).toBe(false);
    expect(isKnownCountryCode(999)).toBe(false);
    expect(isKnownCountryCode(1000)).toBe(false);
    expect(isKnownCountryCode("276")).toBe(false);
    expect(isKnownCountryCode(276.5)).toBe(false);
    expect(getCountryByNumeric(999)).toBeNull();
    expect(getCountryByAlpha2("ZZ")).toBeNull();
  });

  it("matches the registry's 1..999 range, where 0 is rejected on chain", () => {
    expect(isCountryCodeInContractRange(0)).toBe(false);
    expect(isCountryCodeInContractRange(1)).toBe(true);
    expect(isCountryCodeInContractRange(999)).toBe(true);
    expect(isCountryCodeInContractRange(1000)).toBe(false);
  });

  it("sorts a by-name list for the select without disturbing the by-code list", () => {
    const names = COUNTRIES_BY_NAME.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
    expect(COUNTRIES_BY_NAME.length).toBe(COUNTRIES.length);
    expect(COUNTRIES[0]?.numeric).toBeLessThan(COUNTRIES[1]?.numeric ?? 0);
  });

  it("describes a country for a log line", () => {
    expect(describeCountry(276)).toBe("Germany (276)");
    expect(describeCountry(999)).toBe("country 999");
  });
});
