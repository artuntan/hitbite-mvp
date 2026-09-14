import { describe, expect, it } from "vitest";

import navJson from "../public/data/nav.json";
import holdingsJson from "../public/data/holdings.json";
import navHistoryJson from "../public/data/nav_history.json";
import scenariosJson from "../public/data/scenarios.json";

import {
  ATTESTATION_COMMAND,
  ATTESTATION_PATH,
  DataError,
  describeIssues,
  getAttestationStatus,
  getHoldingsDocument,
  getNavDocument,
  getNavHistoryDocument,
  getPublishedDataset,
  getScenariosDocument,
  readAttestation,
} from "./data";
import { parseFixed } from "./format";
import {
  apiErrorSchema,
  attestationResponseSchema,
  holdingsDocumentSchema,
  holdingsResponseSchema,
  navDocumentSchema,
  navHistoryDocumentSchema,
  navResponseSchema,
  scenariosDocumentSchema,
  unit6,
  usd2,
} from "./schemas";

describe("published documents match their schemas", () => {
  it("nav.json", () => {
    expect(navDocumentSchema.safeParse(navJson).success).toBe(true);
  });

  it("holdings.json", () => {
    expect(holdingsDocumentSchema.safeParse(holdingsJson).success).toBe(true);
  });

  it("nav_history.json", () => {
    expect(navHistoryDocumentSchema.safeParse(navHistoryJson).success).toBe(true);
  });

  it("scenarios.json", () => {
    expect(scenariosDocumentSchema.safeParse(scenariosJson).success).toBe(true);
  });
});

describe("the schemas are strict, so engine drift is loud", () => {
  it("rejects a field the web app has never heard of", () => {
    const withExtra = { ...(navJson as object), unexpected_field: 1 };
    const result = navDocumentSchema.safeParse(withExtra);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(describeIssues(result.error)).toMatch(/unexpected_field|unrecognized/i);
  });

  it("rejects a missing field", () => {
    const withoutNav: Record<string, unknown> = { ...(navJson as Record<string, unknown>) };
    delete withoutNav.nav;
    expect(navDocumentSchema.safeParse(withoutNav).success).toBe(false);
  });

  it("rejects `simulated: false` — this engine only publishes simulated books", () => {
    expect(navDocumentSchema.safeParse({ ...(navJson as object), simulated: false }).success).toBe(
      false,
    );
  });

  it("rejects a money value that arrived as a float", () => {
    const broken = structuredClone(navJson as Record<string, unknown>);
    (broken.nav as Record<string, unknown>).total_usd = 1016860.71;
    expect(navDocumentSchema.safeParse(broken).success).toBe(false);
  });
});

describe("money strings are pinned to their scale", () => {
  it("usd2 wants exactly two decimals", () => {
    expect(usd2.safeParse("1016860.71").success).toBe(true);
    expect(usd2.safeParse("-22658.30").success).toBe(true);
    expect(usd2.safeParse("1016860.7").success).toBe(false);
    expect(usd2.safeParse("1016860.710").success).toBe(false);
    expect(usd2.safeParse("1016860").success).toBe(false);
    expect(usd2.safeParse("1,016,860.71").success).toBe(false);
  });

  it("unit6 wants exactly six, because that is the on-chain scale", () => {
    expect(unit6.safeParse("1.003061").success).toBe(true);
    expect(unit6.safeParse("1.00306").success).toBe(false);
    expect(unit6.safeParse("1.0030610").success).toBe(false);
  });
});

describe("the display string and the integer agree (PLAN.md D22)", () => {
  it("nav.json: per_token_usd parses to nav.usdc_6dec", () => {
    const nav = getNavDocument();
    expect(parseFixed(nav.nav.per_token_usd, 6)).toBe(BigInt(nav.nav.usdc_6dec));
  });

  it("nav.json: reported AUM string and integer agree when both are present", () => {
    const { reported_aum_usd: text, reported_aum_usdc_6dec: integer } = getNavDocument().nav;
    if (text !== null && integer !== null) {
      expect(parseFixed(text, 6)).toBe(BigInt(integer));
    } else {
      // Both are null together: an AUM needs a token supply, and the supply comes from the chain.
      expect(text).toBeNull();
      expect(integer).toBeNull();
    }
  });

  it("nav_history.json: every entry's string parses to its integer", () => {
    for (const entry of getNavHistoryDocument().entries) {
      expect(parseFixed(entry.nav_per_token_usd, 6)).toBe(BigInt(entry.usdc_6dec));
    }
  });

  it("holdings.json: market values sum to nav.json's sum_market_value_usd, to the cent", () => {
    const holdings = getHoldingsDocument();
    const total = holdings.positions.reduce(
      (sum, position) => sum + parseFixed(position.market_value_usd, 6),
      0n,
    );
    expect(total).toBe(parseFixed(getNavDocument().portfolio.sum_market_value_usd, 6));
  });

  it("holdings.json: cash and fees payable agree with nav.json", () => {
    const holdings = getHoldingsDocument();
    const nav = getNavDocument();
    expect(parseFixed(holdings.cash_usd, 6)).toBe(parseFixed(nav.portfolio.cash_usd, 6));
    expect(parseFixed(holdings.fees_payable_usd, 6)).toBe(
      parseFixed(nav.portfolio.fees_payable_usd, 6),
    );
    expect(parseFixed(holdings.nav_total_usd, 6)).toBe(parseFixed(nav.nav.total_usd, 6));
  });
});

describe("data readers", () => {
  it("return parsed, typed documents", () => {
    const dataset = getPublishedDataset();
    expect(dataset.nav.simulated).toBe(true);
    expect(dataset.holdings.positions.length).toBeGreaterThan(0);
    expect(dataset.history.entries.length).toBeGreaterThan(0);
    expect(dataset.scenarios.parallel.length).toBeGreaterThan(0);
  });

  it("label every position as illustrative, as the engine does", () => {
    for (const position of getHoldingsDocument().positions) {
      expect(position.illustrative).toBe(true);
    }
  });

  it("keep the comparison reference labelled illustrative", () => {
    expect(getNavDocument().comparison.tokenized_tbill_reference.illustrative).toBe(true);
  });

  it("carry the scenario assumptions rather than leaving them implied", () => {
    expect(getScenariosDocument().assumptions.length).toBeGreaterThan(0);
  });

  it("memoise: two reads return the same object", () => {
    expect(getNavDocument()).toBe(getNavDocument());
  });

  it("DataError names the document it could not read", () => {
    const error = new DataError("nav.json", "boom");
    expect(error.document).toBe("nav.json");
    expect(error.name).toBe("DataError");
  });
});

describe("attestation absence is modelled, not papered over (PLAN.md D34)", () => {
  it("readAttestation reports the file as absent with the command that creates it", async () => {
    const result = await readAttestation();
    // attestation.json is not committed; it appears only after `make attest` runs with the key.
    expect(result.status).toBe("absent");
    if (result.status === "absent") {
      expect(result.howToPublish).toBe(ATTESTATION_COMMAND);
      expect(result.expectedPath).toBe(ATTESTATION_PATH);
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it("the absent case cannot be reached without handling it", async () => {
    const result = await readAttestation();
    // The union has no `document` on the absent branch, so this narrowing is the only way in.
    // @ts-expect-error — proving the type, not the value: `document` is not on DocumentResult.
    expect(result.document).toBeUndefined();
  });

  it("getAttestationStatus produces a response the schema accepts", async () => {
    const status = await getAttestationStatus();
    const parsed = attestationResponseSchema.safeParse({ ok: true, data: status });
    expect(parsed.success).toBe(true);
    expect(status.status).toBe("not_published");
    if (status.status === "not_published") {
      expect(status.attestor_note).toMatch(/Simulated attestor/);
      expect(status.expected_path).toBe(ATTESTATION_PATH);
    }
  });
});

describe("API envelopes", () => {
  it("wrap the nav document", () => {
    expect(navResponseSchema.safeParse({ ok: true, data: getNavDocument() }).success).toBe(true);
    expect(navResponseSchema.safeParse({ ok: false, data: getNavDocument() }).success).toBe(false);
    expect(navResponseSchema.safeParse({ data: getNavDocument() }).success).toBe(false);
  });

  it("wrap the holdings document", () => {
    expect(
      holdingsResponseSchema.safeParse({ ok: true, data: getHoldingsDocument() }).success,
    ).toBe(true);
  });

  it("pin one error shape, with an actionable hint", () => {
    expect(
      apiErrorSchema.safeParse({
        ok: false,
        error: {
          code: "chain_unavailable",
          message: "rpc timed out",
          hint: "check SERVER_RPC_URL",
        },
      }).success,
    ).toBe(true);

    // An unknown code is rejected: partners switch on these.
    expect(
      apiErrorSchema.safeParse({
        ok: false,
        error: { code: "kaboom", message: "m", hint: "h" },
      }).success,
    ).toBe(false);

    // A hint is not optional. An error a caller cannot act on is half an error.
    expect(
      apiErrorSchema.safeParse({ ok: false, error: { code: "not_found", message: "m" } }).success,
    ).toBe(false);
  });
});
