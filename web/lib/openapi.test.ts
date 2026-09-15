/**
 * Tests for the OpenAPI description.
 *
 * Three jobs, in order of how much they matter.
 *
 * **1. The document is valid OpenAPI 3.1.** `validateAgainstMetaSchema` evaluates it against the
 * official meta-schema, vendored below verbatim, with a JSON Schema 2020-12 evaluator written for
 * exactly the keywords that meta-schema uses. That evaluator is hand-written, and a hand-written
 * validator that is too lax is worse than none, so two things keep it honest: a census test that
 * fails if the meta-schema ever uses a keyword the evaluator does not implement, and a table of
 * mutations — a 3.0 version string, a response with no `description`, a stray key at the root —
 * each of which it must reject. A validator that passes everything would fail that table
 * immediately.
 *
 * Why hand-written: **nothing in this project can validate JSON Schema 2020-12.** `ajv` is present
 * transitively under eslint, but it is version 6, which speaks draft-07 and has never heard of
 * `$dynamicRef`, `prefixItems` or `unevaluatedProperties`, and pnpm does not expose it to this
 * package anyway. `z.fromJSONSchema` — zod's own converter, and the obvious candidate — cannot
 * read the meta-schema either: it throws on `unevaluatedProperties`, and with that keyword
 * stripped it silently *drops* `properties` and `required` wherever a schema also has a `$ref`
 * sibling, which the OAS root does, so the converted schema accepts the number `42` as an OpenAPI
 * document. That is asserted below as a regression test rather than left as a claim.
 *
 * **2. The document is a faithful description of the API.** The schemas are generated from
 * `lib/schemas.ts`, so they cannot drift; the tests here cover the things that *can*: the cache
 * header (checked against `lib/data.ts`), the two page-size bounds of `/api/events` (checked
 * against that route's source), the error codes, the event names and the sort orders (all checked
 * against the enums they are supposed to come from), and the `servers` list (checked to contain no
 * mainnet and no invented hostname).
 *
 * **3. A real consumer can load it.** Every component schema is fed back through
 * `z.fromJSONSchema` — an independent implementation that ships in this repository — and the
 * reconstructed validators are run against the committed documents and against mutations of them.
 * That is the round trip a partner's generator makes, and it is what proves the emitted JSON
 * Schema still means what the zod schema meant.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { API_CACHE_CONTROL } from "./data";
import {
  buildOpenApiDocument,
  curlFor,
  describeType,
  ENDPOINTS,
  ENVELOPE_ENDPOINTS,
  EVENTS_DEFAULT_LIMIT,
  EVENTS_MAX_LIMIT,
  OPENAPI_ROUTE,
  OPENAPI_VERSION,
  PUBLIC_CACHE_CONTROL,
  summariseComponent,
  UNDOCUMENTED_ROUTES,
  isUndocumentedNamespace,
  type OpenApiDocument,
} from "./openapi";
import { apiErrorCode, eventOrderSchema, EVENT_NAMES } from "./schemas";
import navJson from "../public/data/nav.json";
import holdingsJson from "../public/data/holdings.json";

const WEB_DIR = path.resolve(import.meta.dirname, "..");

const document = buildOpenApiDocument();

/**
 * Every route handler the app serves, as the URL path it answers on.
 *
 * Route groups — `app/(group)/…` — contribute nothing to the path, which is the whole point of
 * them, so they are dropped rather than treated as a segment.
 */
function servedRoutes(): string[] {
  const routes: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith("_")) continue;
      if (entry.isDirectory()) {
        const segment = /^\(.*\)$/.test(entry.name) ? "" : `/${entry.name}`;
        walk(path.join(dir, entry.name), prefix + segment);
      } else if (entry.name === "route.ts" || entry.name === "route.tsx") {
        routes.push(prefix === "" ? "/" : prefix);
      }
    }
  };
  walk(path.join(WEB_DIR, "app"), "");
  return routes.sort();
}

// ===========================================================================
// A JSON Schema 2020-12 evaluator, scoped to the keywords the OAS meta-schema uses.
// ===========================================================================

type JsonSchema = boolean | Record<string, unknown>;

/** Keywords that take a single subschema. */
const SCHEMA_KEYWORDS = [
  "additionalProperties",
  "propertyNames",
  "items",
  "not",
  "if",
  "then",
  "else",
  "unevaluatedProperties",
  "unevaluatedItems",
  "contains",
] as const;

/** Keywords that take an array of subschemas. */
const SCHEMA_ARRAY_KEYWORDS = ["allOf", "anyOf", "oneOf", "prefixItems"] as const;

/** Keywords that take a map of name → subschema. */
const SCHEMA_MAP_KEYWORDS = [
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
] as const;

/**
 * Keywords the evaluator deliberately does not assert on.
 *
 * `format` is an annotation in the 2020-12 default vocabulary, not an assertion, so ignoring it is
 * the specified behaviour rather than a shortcut. The rest are identifiers and documentation.
 */
const IGNORED_KEYWORDS = [
  "$id",
  "$schema",
  "$anchor",
  "$dynamicAnchor",
  "$vocabulary",
  "$comment",
  "$defs",
  "title",
  "description",
  "default",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
  "format",
] as const;

/** Keywords the evaluator asserts on. */
const ASSERTED_KEYWORDS = [
  "$ref",
  "$dynamicRef",
  "type",
  "enum",
  "const",
  "pattern",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "required",
  "properties",
  "patternProperties",
  "additionalProperties",
  "propertyNames",
  "items",
  "prefixItems",
  "dependentSchemas",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
  "unevaluatedProperties",
] as const;

const KNOWN_KEYWORDS = new Set<string>([...ASSERTED_KEYWORDS, ...IGNORED_KEYWORDS]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      throw new Error(`unknown JSON Schema type "${type}"`);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => key in b && deepEqual(a[key], b[key]));
  }
  return false;
}

interface Outcome {
  readonly errors: string[];
  readonly evaluated: Set<string>;
}

/**
 * Evaluate an instance against a JSON Schema 2020-12 schema.
 *
 * `evaluated` is the annotation `unevaluatedProperties` needs: the property names some applicator
 * at or below this schema object accounted for. It is merged from a subschema only when that
 * subschema succeeded, which is what makes `unevaluatedProperties: false` — the keyword the OAS
 * meta-schema uses to forbid stray keys — behave the way the specification says.
 */
class MetaSchemaEvaluator {
  private readonly dynamicAnchors = new Map<string, JsonSchema>();

  constructor(private readonly root: Record<string, unknown>) {
    this.collectDynamicAnchors(root);
  }

  private collectDynamicAnchors(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node) this.collectDynamicAnchors(item);
      return;
    }
    if (!isPlainObject(node)) return;
    const anchor = node.$dynamicAnchor;
    if (typeof anchor === "string") {
      if (this.dynamicAnchors.has(anchor)) {
        throw new Error(`two $dynamicAnchor "${anchor}" declarations; resolution is ambiguous`);
      }
      this.dynamicAnchors.set(anchor, node);
    }
    for (const keyword of SCHEMA_KEYWORDS) {
      if (keyword in node) this.collectDynamicAnchors(node[keyword]);
    }
    for (const keyword of SCHEMA_ARRAY_KEYWORDS) {
      const value = node[keyword];
      if (Array.isArray(value)) for (const member of value) this.collectDynamicAnchors(member);
    }
    for (const keyword of SCHEMA_MAP_KEYWORDS) {
      const value = node[keyword];
      if (isPlainObject(value))
        for (const member of Object.values(value)) {
          this.collectDynamicAnchors(member);
        }
    }
  }

  private resolvePointer(ref: string): JsonSchema {
    if (ref === "#") return this.root;
    if (!ref.startsWith("#/")) throw new Error(`only local $refs are supported; got ${ref}`);
    let node: unknown = this.root;
    for (const rawToken of ref.slice(2).split("/")) {
      const token = decodeURIComponent(rawToken).replaceAll("~1", "/").replaceAll("~0", "~");
      if (isPlainObject(node)) node = node[token];
      else if (Array.isArray(node)) node = node[Number(token)];
      else node = undefined;
      if (node === undefined) throw new Error(`$ref ${ref} does not resolve`);
    }
    return node as JsonSchema;
  }

  /**
   * `$dynamicRef` resolves to the outermost `$dynamicAnchor` of that name in the dynamic scope.
   * This meta-schema declares exactly one (`meta`, on `$defs.schema`) and nothing extends it, so
   * the outermost is the only one — and `collectDynamicAnchors` throws if a second ever appears,
   * which is when this shortcut would stop being correct.
   */
  private resolveDynamic(ref: string): JsonSchema {
    if (!ref.startsWith("#")) throw new Error(`unsupported $dynamicRef ${ref}`);
    const anchor = this.dynamicAnchors.get(ref.slice(1));
    if (!anchor) throw new Error(`$dynamicRef ${ref} has no $dynamicAnchor`);
    return anchor;
  }

  validate(instance: unknown): string[] {
    return this.evaluate(instance, this.root, "$", 0).errors;
  }

  private evaluate(instance: unknown, schema: JsonSchema, loc: string, depth: number): Outcome {
    if (depth > 200) throw new Error(`schema evaluation ran away at ${loc}`);
    const errors: string[] = [];
    const evaluated = new Set<string>();

    if (typeof schema === "boolean") {
      if (!schema) errors.push(`${loc}: nothing is allowed here`);
      return { errors, evaluated };
    }

    const merge = (outcome: Outcome): void => {
      errors.push(...outcome.errors);
      if (outcome.errors.length === 0) for (const key of outcome.evaluated) evaluated.add(key);
    };
    const sub = (value: unknown, subSchema: unknown, subLoc: string): Outcome =>
      this.evaluate(value, subSchema as JsonSchema, subLoc, depth + 1);

    if (typeof schema.$ref === "string") {
      merge(sub(instance, this.resolvePointer(schema.$ref), loc));
    }
    if (typeof schema.$dynamicRef === "string") {
      merge(sub(instance, this.resolveDynamic(schema.$dynamicRef), loc));
    }

    if (schema.type !== undefined) {
      const types = (Array.isArray(schema.type) ? schema.type : [schema.type]) as string[];
      if (!types.some((type) => matchesType(instance, type))) {
        errors.push(`${loc}: expected ${types.join(" or ")}, got ${typeName(instance)}`);
      }
    }
    if (Array.isArray(schema.enum) && !schema.enum.some((value) => deepEqual(value, instance))) {
      errors.push(
        `${loc}: ${JSON.stringify(instance)} is not one of ${JSON.stringify(schema.enum)}`,
      );
    }
    if ("const" in schema && !deepEqual(schema.const, instance)) {
      errors.push(`${loc}: expected the constant ${JSON.stringify(schema.const)}`);
    }

    if (typeof instance === "string") {
      if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(instance)) {
        errors.push(`${loc}: ${JSON.stringify(instance)} does not match /${schema.pattern}/`);
      }
      if (typeof schema.minLength === "number" && instance.length < schema.minLength) {
        errors.push(`${loc}: shorter than ${schema.minLength.toString()} characters`);
      }
      if (typeof schema.maxLength === "number" && instance.length > schema.maxLength) {
        errors.push(`${loc}: longer than ${schema.maxLength.toString()} characters`);
      }
    }

    if (Array.isArray(instance)) {
      if (typeof schema.minItems === "number" && instance.length < schema.minItems) {
        errors.push(`${loc}: fewer than ${schema.minItems.toString()} items`);
      }
      if (typeof schema.maxItems === "number" && instance.length > schema.maxItems) {
        errors.push(`${loc}: more than ${schema.maxItems.toString()} items`);
      }
      if (schema.uniqueItems === true) {
        const seen: unknown[] = [];
        for (const item of instance) {
          if (seen.some((other) => deepEqual(other, item))) errors.push(`${loc}: duplicate item`);
          seen.push(item);
        }
      }
      const prefix = Array.isArray(schema.prefixItems) ? schema.prefixItems : [];
      prefix.forEach((subSchema, index) => {
        if (index < instance.length) {
          errors.push(...sub(instance[index], subSchema, `${loc}[${index.toString()}]`).errors);
        }
      });
      if (schema.items !== undefined) {
        instance.slice(prefix.length).forEach((item, offset) => {
          const index = prefix.length + offset;
          errors.push(...sub(item, schema.items, `${loc}[${index.toString()}]`).errors);
        });
      }
    }

    if (isPlainObject(instance)) {
      const keys = Object.keys(instance);
      if (typeof schema.minProperties === "number" && keys.length < schema.minProperties) {
        errors.push(`${loc}: fewer than ${schema.minProperties.toString()} properties`);
      }
      if (typeof schema.maxProperties === "number" && keys.length > schema.maxProperties) {
        errors.push(`${loc}: more than ${schema.maxProperties.toString()} properties`);
      }
      if (Array.isArray(schema.required)) {
        for (const name of schema.required as string[]) {
          if (!(name in instance)) errors.push(`${loc}: missing required property "${name}"`);
        }
      }
      if (schema.propertyNames !== undefined) {
        for (const key of keys) {
          errors.push(...sub(key, schema.propertyNames, `${loc} property name "${key}"`).errors);
        }
      }

      const properties = isPlainObject(schema.properties) ? schema.properties : undefined;
      if (properties) {
        for (const [name, subSchema] of Object.entries(properties)) {
          if (name in instance) {
            errors.push(...sub(instance[name], subSchema, `${loc}.${name}`).errors);
            evaluated.add(name);
          }
        }
      }
      const patterns = isPlainObject(schema.patternProperties)
        ? schema.patternProperties
        : undefined;
      if (patterns) {
        for (const [pattern, subSchema] of Object.entries(patterns)) {
          const regex = new RegExp(pattern);
          for (const key of keys) {
            if (regex.test(key)) {
              errors.push(...sub(instance[key], subSchema, `${loc}.${key}`).errors);
              evaluated.add(key);
            }
          }
        }
      }
      if (schema.additionalProperties !== undefined) {
        for (const key of keys) {
          if (evaluated.has(key)) continue;
          errors.push(...sub(instance[key], schema.additionalProperties, `${loc}.${key}`).errors);
          evaluated.add(key);
        }
      }
      if (isPlainObject(schema.dependentSchemas)) {
        for (const [name, subSchema] of Object.entries(schema.dependentSchemas)) {
          if (name in instance) merge(sub(instance, subSchema, loc));
        }
      }
    }

    if (Array.isArray(schema.allOf)) {
      for (const subSchema of schema.allOf) merge(sub(instance, subSchema, loc));
    }
    if (Array.isArray(schema.anyOf)) {
      const outcomes = schema.anyOf.map((subSchema) => sub(instance, subSchema, loc));
      const passing = outcomes.filter((outcome) => outcome.errors.length === 0);
      if (passing.length === 0) {
        errors.push(
          `${loc}: matched no anyOf branch (${outcomes.flatMap((o) => o.errors).join("; ")})`,
        );
      }
      for (const outcome of passing) for (const key of outcome.evaluated) evaluated.add(key);
    }
    if (Array.isArray(schema.oneOf)) {
      const outcomes = schema.oneOf.map((subSchema) => sub(instance, subSchema, loc));
      const passing = outcomes.filter((outcome) => outcome.errors.length === 0);
      if (passing.length !== 1) {
        errors.push(
          `${loc}: matched ${passing.length.toString()} oneOf branches, expected exactly 1` +
            (passing.length === 0 ? ` (${outcomes.flatMap((o) => o.errors).join("; ")})` : ""),
        );
      }
      for (const outcome of passing) for (const key of outcome.evaluated) evaluated.add(key);
    }
    if (schema.not !== undefined && sub(instance, schema.not, loc).errors.length === 0) {
      errors.push(`${loc}: matched a schema it must not match`);
    }
    if (schema.if !== undefined) {
      const outcome = sub(instance, schema.if, loc);
      if (outcome.errors.length === 0) {
        for (const key of outcome.evaluated) evaluated.add(key);
        if (schema.then !== undefined) merge(sub(instance, schema.then, loc));
      } else if (schema.else !== undefined) {
        merge(sub(instance, schema.else, loc));
      }
    }

    // Last, so every in-place applicator above has contributed its annotations first.
    if (schema.unevaluatedProperties !== undefined && isPlainObject(instance)) {
      for (const key of Object.keys(instance)) {
        if (evaluated.has(key)) continue;
        if (schema.unevaluatedProperties === false) {
          errors.push(`${loc}: "${key}" is not a property this schema allows`);
        } else {
          errors.push(...sub(instance[key], schema.unevaluatedProperties, `${loc}.${key}`).errors);
        }
        evaluated.add(key);
      }
    }

    return { errors, evaluated };
  }
}

/** Every keyword used at a schema position anywhere in a schema document. */
function collectKeywords(node: unknown, found: Set<string>): Set<string> {
  if (!isPlainObject(node)) return found;
  for (const key of Object.keys(node)) found.add(key);
  for (const keyword of SCHEMA_KEYWORDS) {
    if (keyword in node) collectKeywords(node[keyword], found);
  }
  for (const keyword of SCHEMA_ARRAY_KEYWORDS) {
    const value = node[keyword];
    if (Array.isArray(value)) for (const member of value) collectKeywords(member, found);
  }
  for (const keyword of SCHEMA_MAP_KEYWORDS) {
    const value = node[keyword];
    if (isPlainObject(value))
      for (const member of Object.values(value)) {
        collectKeywords(member, found);
      }
  }
  return found;
}

function metaSchema(): Record<string, unknown> {
  return JSON.parse(OPENAPI_3_1_META_SCHEMA_JSON) as Record<string, unknown>;
}

let evaluator: MetaSchemaEvaluator | undefined;
function validateAgainstMetaSchema(instance: unknown): string[] {
  evaluator ??= new MetaSchemaEvaluator(metaSchema());
  return evaluator.validate(instance);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ===========================================================================

describe("the vendored OpenAPI 3.1 meta-schema", () => {
  it("is the published 2022-10-07 schema, in the 2020-12 dialect", () => {
    const schema = metaSchema();
    expect(schema.$id).toBe("https://spec.openapis.org/oas/3.1/schema/2022-10-07");
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it("uses no keyword the evaluator does not implement", () => {
    // The guard that keeps a hand-written validator honest: if the vendored schema is ever
    // replaced by a newer one that leans on a keyword this file ignores, the constraint would be
    // silently skipped and the document would "pass" without being checked. This fails instead.
    const used = [...collectKeywords(metaSchema(), new Set<string>())].sort();
    expect(used.filter((keyword) => !KNOWN_KEYWORDS.has(keyword))).toEqual([]);
  });
});

describe("the meta-schema evaluator", () => {
  it("accepts a minimal valid OpenAPI 3.1 document", () => {
    expect(
      validateAgainstMetaSchema({
        openapi: "3.1.0",
        info: { title: "t", version: "1" },
        paths: { "/a": { get: { responses: { "200": { description: "ok" } } } } },
      }),
    ).toEqual([]);
  });

  it("rejects a value that is not an object at all", () => {
    expect(validateAgainstMetaSchema(42).length).toBeGreaterThan(0);
    expect(validateAgainstMetaSchema([]).length).toBeGreaterThan(0);
  });

  /**
   * The table that proves the evaluator bites. Each entry breaks the emitted document in one
   * specific way the meta-schema forbids; a validator that rubber-stamps everything fails here on
   * the first row.
   */
  const mutations: readonly {
    readonly name: string;
    readonly break: (doc: OpenApiDocument) => void;
  }[] = [
    {
      name: "an OpenAPI 3.0 version string",
      break: (doc) => {
        (doc as Record<string, unknown>).openapi = "3.0.3";
      },
    },
    {
      name: "an info block with no version",
      break: (doc) => {
        delete (doc.info as Record<string, unknown>).version;
      },
    },
    {
      name: "a stray key at the root",
      break: (doc) => {
        (doc as Record<string, unknown>).notAnOpenApiKeyword = true;
      },
    },
    {
      name: "a response with no description",
      break: (doc) => {
        const response = (doc.paths["/api/nav"]?.get as Record<string, unknown>)
          .responses as Record<string, Record<string, unknown>>;
        delete response["200"]?.description;
      },
    },
    {
      name: "a path that does not start with a slash",
      break: (doc) => {
        (doc.paths as Record<string, unknown>)["api/nav"] = doc.paths["/api/nav"];
      },
    },
    {
      name: "a query parameter with no name",
      break: (doc) => {
        const parameters = (doc.paths["/api/events"]?.get as Record<string, unknown>)
          .parameters as Record<string, unknown>[];
        delete parameters[0]?.name;
      },
    },
    {
      name: "a parameter in an unknown location",
      break: (doc) => {
        const parameters = (doc.paths["/api/events"]?.get as Record<string, unknown>)
          .parameters as Record<string, unknown>[];
        if (parameters[0]) parameters[0].in = "body";
      },
    },
    {
      name: "a server entry with no url",
      break: (doc) => {
        (doc.servers as Record<string, unknown>[])[0] = { description: "no url" };
      },
    },
    {
      name: "a tags block that is not an array",
      break: (doc) => {
        (doc as Record<string, unknown>).tags = { name: "not an array" };
      },
    },
    {
      name: "an operation with an empty responses object",
      break: (doc) => {
        (doc.paths["/api/nav"]?.get as Record<string, unknown>).responses = {};
      },
    },
    {
      name: "a component name with a space in it",
      break: (doc) => {
        (doc.components.schemas as Record<string, unknown>)["Not A Name"] = { type: "string" };
      },
    },
  ];

  for (const mutation of mutations) {
    it(`rejects ${mutation.name}`, () => {
      const broken = clone(document);
      mutation.break(broken);
      expect(validateAgainstMetaSchema(broken).length).toBeGreaterThan(0);
    });
  }

  it("is needed because zod's own converter cannot read the meta-schema", () => {
    // Documented as a test, not as a claim in a comment. Two independent failures:
    //   1. `z.fromJSONSchema` throws outright on `unevaluatedProperties`;
    //   2. with that keyword stripped it converts, but drops `properties`/`required` wherever a
    //      schema has a `$ref` sibling — as the OAS root does — so the result accepts anything.
    expect(() => z.fromJSONSchema(metaSchema() as never)).toThrow(/unevaluatedProperties/);

    const stripped = JSON.parse(
      JSON.stringify(metaSchema(), (key, value: unknown) =>
        key === "unevaluatedProperties" || key === "unevaluatedItems" ? undefined : value,
      ),
    ) as Record<string, unknown>;
    const converted = z.fromJSONSchema(stripped as never);
    expect(converted.safeParse(42).success).toBe(true);
    expect(converted.safeParse({ openapi: "3.0.0", info: {} }).success).toBe(true);
  });
});

describe("the emitted document", () => {
  it("validates against the OpenAPI 3.1 meta-schema", () => {
    expect(validateAgainstMetaSchema(document)).toEqual([]);
  });

  it("survives a round trip through a real JSON parser", () => {
    // `Response.json` serialises with `JSON.stringify`, so anything the builder produces that
    // JSON cannot hold — an `undefined`, a `bigint`, a cycle — is a 500 in production and is
    // caught here instead. The re-parsed document is then validated again, so the assertion is
    // about the bytes a caller receives rather than about the object in this process.
    const serialised = JSON.stringify(document);
    const reparsed = JSON.parse(serialised) as OpenApiDocument;
    expect(reparsed).toEqual(document);
    expect(validateAgainstMetaSchema(reparsed)).toEqual([]);
    expect(JSON.stringify(reparsed)).toBe(serialised);
  });

  it("declares OpenAPI 3.1 and a description version", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(document.info.version).toBe(OPENAPI_VERSION);
    expect(OPENAPI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("resolves every $ref it contains", () => {
    const refs: string[] = [];
    JSON.stringify(document, (key, value: unknown) => {
      if (key === "$ref" && typeof value === "string") refs.push(value);
      return value;
    });
    expect(refs.length).toBeGreaterThan(50);
    const names = new Set(Object.keys(document.components.schemas));
    const dangling = [...new Set(refs)].filter(
      (ref) => !ref.startsWith("#/components/schemas/") || !names.has(ref.slice(21)),
    );
    expect(dangling).toEqual([]);
  });

  it("leaves no component unreachable from a path", () => {
    // A component nothing refers to is either a leftover or a `$ref` that failed to be emitted.
    // Either way a generator would produce a type nobody can reach, so the walk starts at the
    // operations and has to arrive everywhere.
    const schemas = document.components.schemas;
    const reachable = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      if (!isPlainObject(node)) return;
      const ref = node.$ref;
      if (typeof ref === "string" && ref.startsWith("#/components/schemas/")) {
        const name = ref.slice(21);
        if (!reachable.has(name)) {
          reachable.add(name);
          walk(schemas[name]);
        }
      }
      for (const value of Object.values(node)) walk(value);
    };
    walk(document.paths);
    expect([...Object.keys(schemas)].filter((name) => !reachable.has(name))).toEqual([]);
  });

  it("names no mainnet and no invented hostname in servers", () => {
    const urls = document.servers.map((server) => String(server.url));
    expect(urls).toEqual(["/", "http://localhost:3000"]);
    for (const url of urls) {
      if (url.startsWith("/")) continue;
      const host = new URL(url).hostname;
      expect(["localhost", "127.0.0.1"]).toContain(host);
    }
    // And no URL anywhere in the document — not in a description, not in an example — points at
    // a host this project does not run. A plausible `api.hitbite.…` in the one file a partner
    // pastes into a generator would be an invented fact, and a mainnet explorer link would be a
    // mainnet reference in a testnet-only repository.
    const hosts = new Set(
      [...JSON.stringify(document).matchAll(/https?:\/\/([^/"'\s\\)]+)/g)].map(
        (match) => match[1] ?? "",
      ),
    );
    expect([...hosts].sort()).toEqual(["localhost:3000"]);
    // The two testnets this project runs on are named, so a reader knows which chain answers.
    const serialised = JSON.stringify(document);
    expect(serialised).toContain("84532");
    expect(serialised).toContain("31337");
  });

  it("gives every endpoint one GET operation with a unique operationId", () => {
    expect(Object.keys(document.paths).sort()).toEqual(ENDPOINTS.map((e) => e.path).sort());
    const ids = ENDPOINTS.map((endpoint) => {
      const operation = document.paths[endpoint.path]?.get as Record<string, unknown>;
      expect(Object.keys(document.paths[endpoint.path] ?? {})).toEqual(["get"]);
      expect(operation.operationId).toBe(endpoint.operationId);
      expect(operation.summary).toBe(endpoint.summary);
      return endpoint.operationId;
    });
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("documents the cache headers each response actually carries", () => {
    for (const endpoint of ENDPOINTS) {
      const responses = (document.paths[endpoint.path]?.get as Record<string, unknown>)
        .responses as Record<string, Record<string, unknown>>;
      const ok = responses["200"]?.headers as Record<string, Record<string, unknown>>;
      expect((ok["Cache-Control"]?.schema as Record<string, unknown>).const).toBe(
        PUBLIC_CACHE_CONTROL,
      );
      expect((ok["Access-Control-Allow-Origin"]?.schema as Record<string, unknown>).const).toBe(
        "*",
      );
      for (const status of Object.keys(responses)) {
        if (status === "200") continue;
        const headers = responses[status]?.headers as Record<string, Record<string, unknown>>;
        expect((headers["Cache-Control"]?.schema as Record<string, unknown>).const).toBe(
          "no-store",
        );
      }
    }
  });
});

describe("it cannot drift from the code it describes", () => {
  it("documents the cache policy lib/data.ts actually sends", () => {
    // The one string this module copies rather than imports, because importing `lib/data.ts`
    // would drag `node:fs` and four JSON documents into every bundle that renders the
    // description. This assertion is what makes the copy safe.
    expect(PUBLIC_CACHE_CONTROL).toBe(API_CACHE_CONTROL);
  });

  it("enumerates exactly the error codes lib/schemas.ts defines", () => {
    const component = document.components.schemas.ApiErrorCode;
    expect(component?.enum).toEqual([...apiErrorCode.options]);
    for (const endpoint of ENDPOINTS) {
      for (const failure of endpoint.failures) {
        expect(apiErrorCode.options).toContain(failure.code);
      }
    }
    // Only /api/events can refuse a request: it is the only endpoint that takes one.
    const with400 = ENDPOINTS.filter((endpoint) =>
      endpoint.failures.some((failure) => failure.status === 400),
    ).map((endpoint) => endpoint.path);
    expect(with400).toEqual(["/api/events"]);
    // And the two reserved codes are named as reserved rather than quietly omitted.
    expect(String(component?.description)).toContain("not_found");
    expect(String(component?.description)).toContain("chain_unavailable");
  });

  it("lists exactly the event names the indexer decodes", () => {
    const parameter = ENDPOINTS.find(
      (endpoint) => endpoint.path === "/api/events",
    )?.parameters.find((candidate) => candidate.name === "event");
    // The parameter is an array of the named enum component, so the names live in exactly one
    // place in the document and the parameter points at it.
    expect(parameter?.schema).toEqual({
      type: "array",
      items: { $ref: "#/components/schemas/EventName" },
    });
    expect(document.components.schemas.EventName?.enum).toEqual([...EVENT_NAMES]);
  });

  it("lists exactly the sort orders the route accepts", () => {
    const parameter = ENDPOINTS.find(
      (endpoint) => endpoint.path === "/api/events",
    )?.parameters.find((candidate) => candidate.name === "order");
    expect(parameter?.schema.enum).toEqual([...eventOrderSchema.options]);
  });

  it("documents the page-size bounds app/api/events/route.ts enforces", () => {
    // Those two constants are local to the route and this module has no business exporting them
    // from it, so the drift guard reads the source instead. A change to either number fails here
    // until the description follows it.
    const source = readFileSync(path.join(WEB_DIR, "app", "api", "events", "route.ts"), "utf8");
    expect(source).toContain(`const DEFAULT_LIMIT = ${EVENTS_DEFAULT_LIMIT.toString()};`);
    expect(source).toContain(`const MAX_LIMIT = ${EVENTS_MAX_LIMIT.toString()};`);

    const parameter = ENDPOINTS.find(
      (endpoint) => endpoint.path === "/api/events",
    )?.parameters.find((candidate) => candidate.name === "limit");
    expect(parameter?.schema).toMatchObject({
      minimum: 1,
      maximum: EVENTS_MAX_LIMIT,
      default: EVENTS_DEFAULT_LIMIT,
    });
  });

  it("describes every route the app serves, or says why not", () => {
    // The same check the e2e spec makes against the running app, made here so a route added
    // without a description fails the unit tests too, long before anyone starts a browser. It
    // walks every `route.ts` under `app/`, not only the ones under `app/api/`, so a new handler
    // somewhere else cannot slip past by not being in the expected folder.
    const served = servedRoutes();

    const described = new Set(ENDPOINTS.map((endpoint) => endpoint.path));
    const excluded = new Set(UNDOCUMENTED_ROUTES.map((route) => route.path));

    // Everything under /api is either described or excluded with a reason.
    const publicApi = served.filter((route) => route.startsWith("/api/"));
    expect(publicApi.filter((route) => !described.has(route) && !excluded.has(route))).toEqual([]);

    // Nothing is excluded or described that does not exist, so a reason cannot outlive its route.
    expect([...excluded].filter((route) => !served.includes(route))).toEqual([]);
    expect([...described].filter((route) => !served.includes(route))).toEqual([]);
    expect(served).toContain(OPENAPI_ROUTE);

    // And every other route belongs to a namespace this description says it does not cover. A
    // handler that is neither under /api nor inside a declared namespace fails here, which forces
    // a decision about it rather than letting it exist undescribed.
    const leftovers = served.filter(
      (route) => !route.startsWith("/api/") && !isUndocumentedNamespace(route),
    );
    expect(leftovers).toEqual([]);
  });

  it("points every envelope endpoint at a component that exists", () => {
    for (const endpoint of ENVELOPE_ENDPOINTS) {
      const envelopeName = endpoint.responseComponent ?? "";
      const dataName = endpoint.dataComponent ?? "";
      const response = document.components.schemas[envelopeName];
      expect(response, `${endpoint.path} names an envelope component`).toBeDefined();
      expect(document.components.schemas[dataName], `${endpoint.path} data`).toBeDefined();
      // The envelope really is `{ ok: true, data: <that component> }`.
      const properties = response?.properties as Record<string, Record<string, unknown>>;
      expect(properties.ok).toMatchObject({ const: true });
      expect(properties.data?.$ref).toBe(`#/components/schemas/${dataName}`);
    }
    // The description itself is the documented exception to the envelope.
    const raw = ENDPOINTS.find((endpoint) => endpoint.path === OPENAPI_ROUTE);
    expect(raw?.dataComponent).toBeNull();
    expect(String(document.info.description)).toContain("single exception");
  });

  it("derives every discriminator mapping from the union's own members", () => {
    for (const name of ["AttestationStatus", "EventsData", "ChainStats", "EventActivity"]) {
      const schema = document.components.schemas[name];
      const discriminator = schema?.discriminator as {
        propertyName: string;
        mapping: Record<string, string>;
      };
      expect(discriminator.propertyName).toBe("status");
      const members = schema?.oneOf as { $ref: string }[];
      expect(Object.values(discriminator.mapping).sort()).toEqual(
        members.map((member) => member.$ref).sort(),
      );
      for (const [value, ref] of Object.entries(discriminator.mapping)) {
        const member = document.components.schemas[ref.slice(21)];
        const status = (member?.properties as Record<string, Record<string, unknown>>).status;
        expect(status?.const).toBe(value);
      }
    }
    expect(
      Object.keys(
        (
          document.components.schemas.AttestationStatus?.discriminator as {
            mapping: Record<string, string>;
          }
        ).mapping,
      ).sort(),
    ).toEqual(["not_published", "published"]);
  });

  it("gives every endpoint a curl that runs against a real base URL", () => {
    for (const endpoint of ENDPOINTS) {
      const command = curlFor(endpoint, "http://127.0.0.1:3000");
      expect(command).not.toContain("{{base}}");
      expect(command).toContain(`http://127.0.0.1:3000${endpoint.path}`);
      expect(command.startsWith("curl ")).toBe(true);
    }
  });
});

describe("a generated client can load these schemas", () => {
  /**
   * Rebuild a component as a zod schema through `z.fromJSONSchema`.
   *
   * That function resolves only `#/$defs/…`, so the component pointers are rewritten onto `$defs`
   * for the round trip. It is an independent implementation of the same JSON Schema dialect a
   * partner's generator reads, which is the point: if the emitted schema no longer means what the
   * zod schema meant, this is where it shows.
   */
  const defs = JSON.parse(
    JSON.stringify(document.components.schemas).replaceAll("#/components/schemas/", "#/$defs/"),
  ) as Record<string, unknown>;

  const rebuild = (name: string): z.ZodType =>
    z.fromJSONSchema({ $ref: `#/$defs/${name}`, $defs: defs } as never);

  it("converts every component without throwing", () => {
    for (const name of Object.keys(document.components.schemas)) {
      expect(() => rebuild(name), `component ${name}`).not.toThrow();
    }
  });

  it("accepts the committed nav.json through the rebuilt NavResponse", () => {
    const rebuilt = rebuild("NavResponse");
    expect(rebuilt.safeParse({ ok: true, data: navJson }).success).toBe(true);
  });

  it("accepts the committed holdings.json through the rebuilt HoldingsResponse", () => {
    const rebuilt = rebuild("HoldingsResponse");
    expect(rebuilt.safeParse({ ok: true, data: holdingsJson }).success).toBe(true);
  });

  it("still refuses what the zod schema refuses", () => {
    const rebuilt = rebuild("NavResponse");
    const broken = (change: (nav: Record<string, unknown>) => void): unknown => {
      const copy = clone(navJson) as unknown as Record<string, unknown>;
      change(copy);
      return copy;
    };

    // A money string at the wrong scale: "1.0" where six decimals are required.
    expect(
      rebuilt.safeParse({
        ok: true,
        data: broken((nav) => {
          (nav.nav as Record<string, unknown>).per_token_usd = "1.0";
        }),
      }).success,
    ).toBe(false);
    // A field the engine never emits: the documents are strict for the same reason the schemas
    // are, and the emitted JSON Schema has to carry that `additionalProperties: false`.
    expect(
      rebuilt.safeParse({
        ok: true,
        data: broken((nav) => {
          nav.surprise = 1;
        }),
      }).success,
    ).toBe(false);
    // NAV as a fraction rather than as the six-decimal integer.
    expect(
      rebuilt.safeParse({
        ok: true,
        data: broken((nav) => {
          (nav.nav as Record<string, unknown>).usdc_6dec = 1.5;
        }),
      }).success,
    ).toBe(false);
    // The envelope is not optional.
    expect(rebuilt.safeParse({ ok: false, data: navJson }).success).toBe(false);
    expect(rebuilt.safeParse(navJson).success).toBe(false);
  });

  it("keeps the error envelope shape a caller switches on", () => {
    const rebuilt = rebuild("ApiError");
    expect(
      rebuilt.safeParse({
        ok: false,
        error: { code: "bad_request", message: "m", hint: "h" },
      }).success,
    ).toBe(true);
    expect(
      rebuilt.safeParse({ ok: false, error: { code: "not_a_code", message: "m", hint: "h" } })
        .success,
    ).toBe(false);
    // `hint` is always present — a caller may render it without checking.
    expect(
      rebuilt.safeParse({ ok: false, error: { code: "bad_request", message: "m" } }).success,
    ).toBe(false);
  });
});

describe("the model /developers renders", () => {
  it("summarises an object component as its fields", () => {
    const summary = summariseComponent(document, "NavDocument");
    expect(summary.kind).toBe("object");
    if (summary.kind !== "object") return;
    const names = summary.fields.map((field) => field.name);
    expect(names).toContain("nav");
    expect(names).toContain("as_of");
    const nav = summary.fields.find((field) => field.name === "nav");
    expect(nav?.type).toBe("NavBlock");
    expect(nav?.required).toBe(true);
  });

  it("summarises a union component as its branches, not as a merged field list", () => {
    const summary = summariseComponent(document, "AttestationStatus");
    expect(summary.kind).toBe("union");
    if (summary.kind !== "union") return;
    expect(summary.propertyName).toBe("status");
    expect(summary.branches.map((branch) => branch.value).sort()).toEqual([
      "not_published",
      "published",
    ]);
  });

  it("renders a readable type for each kind of node", () => {
    expect(describeType({ type: "string" })).toBe("string");
    expect(describeType({ $ref: "#/components/schemas/ChainEvent" })).toBe("ChainEvent");
    expect(
      describeType({ type: "array", items: { $ref: "#/components/schemas/ChainEvent" } }),
    ).toBe("ChainEvent[]");
    expect(describeType({ type: ["string", "null"] })).toBe("string | null");
    expect(describeType({ anyOf: [{ type: "string" }, { type: "null" }] })).toBe("string | null");
    expect(describeType({ const: true })).toBe("true");
  });

  it("carries prose for every endpoint the page renders", () => {
    for (const endpoint of ENDPOINTS) {
      expect(endpoint.summary.length).toBeGreaterThan(10);
      expect(endpoint.description.length).toBeGreaterThan(80);
      expect(endpoint.curlNote.length).toBeGreaterThan(10);
    }
    for (const route of UNDOCUMENTED_ROUTES) {
      expect(route.reason.length).toBeGreaterThan(80);
    }
  });
});

// ===========================================================================
// The OpenAPI 3.1 meta-schema, vendored verbatim.
//
// Source:   https://spec.openapis.org/oas/3.1/schema/2022-10-07
// Retrieved 2026-09-15, minified, 18357 bytes. It is the published "without schema
// validation" variant: it describes the OpenAPI object model and leaves each Schema Object to
// any JSON Schema, which is exactly the check wanted here — the Schema Objects in this document
// are generated by zod and are covered by the round-trip tests above.
//
// `String.raw` because the schema contains regular expressions: in an ordinary template literal
// \\d would become d and the version pattern would stop pinning 3.1.x.
// ===========================================================================

const OPENAPI_3_1_META_SCHEMA_JSON = String.raw`{"$id":"https://spec.openapis.org/oas/3.1/schema/2022-10-07","$schema":"https://json-schema.org/draft/2020-12/schema","description":"The description of OpenAPI v3.1.x documents without schema validation, as defined by https://spec.openapis.org/oas/v3.1.0","type":"object","properties":{"openapi":{"type":"string","pattern":"^3\\.1\\.\\d+(-.+)?$"},"info":{"$ref":"#/$defs/info"},"jsonSchemaDialect":{"type":"string","format":"uri","default":"https://spec.openapis.org/oas/3.1/dialect/base"},"servers":{"type":"array","items":{"$ref":"#/$defs/server"},"default":[{"url":"/"}]},"paths":{"$ref":"#/$defs/paths"},"webhooks":{"type":"object","additionalProperties":{"$ref":"#/$defs/path-item-or-reference"}},"components":{"$ref":"#/$defs/components"},"security":{"type":"array","items":{"$ref":"#/$defs/security-requirement"}},"tags":{"type":"array","items":{"$ref":"#/$defs/tag"}},"externalDocs":{"$ref":"#/$defs/external-documentation"}},"required":["openapi","info"],"anyOf":[{"required":["paths"]},{"required":["components"]},{"required":["webhooks"]}],"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false,"$defs":{"info":{"$comment":"https://spec.openapis.org/oas/v3.1.0#info-object","type":"object","properties":{"title":{"type":"string"},"summary":{"type":"string"},"description":{"type":"string"},"termsOfService":{"type":"string","format":"uri"},"contact":{"$ref":"#/$defs/contact"},"license":{"$ref":"#/$defs/license"},"version":{"type":"string"}},"required":["title","version"],"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false},"contact":{"$comment":"https://spec.openapis.org/oas/v3.1.0#contact-object","type":"object","properties":{"name":{"type":"string"},"url":{"type":"string","format":"uri"},"email":{"type":"string","format":"email"}},"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false},"license":{"$comment":"https://spec.openapis.org/oas/v3.1.0#license-object","type":"object","properties":{"name":{"type":"string"},"identifier":{"type":"string"},"url":{"type":"string","format":"uri"}},"required":["name"],"dependentSchemas":{"identifier":{"not":{"required":["url"]}}},"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false},"server":{"$comment":"https://spec.openapis.org/oas/v3.1.0#server-object","type":"object","properties":{"url":{"type":"string","format":"uri-reference"},"description":{"type":"string"},"variables":{"type":"object","additionalProperties":{"$ref":"#/$defs/server-variable"}}},"required":["url"],"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false},"server-variable":{"$comment":"https://spec.openapis.org/oas/v3.1.0#server-variable-object","type":"object","properties":{"enum":{"type":"array","items":{"type":"string"},"minItems":1},"default":{"type":"string"},"description":{"type":"string"}},"required":["default"],"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false},"components":{"$comment":"https://spec.openapis.org/oas/v3.1.0#components-object","type":"object","properties":{"schemas":{"type":"object","additionalProperties":{"$dynamicRef":"#meta"}},"responses":{"type":"object","additionalProperties":{"$ref":"#/$defs/response-or-reference"}},"parameters":{"type":"object","additionalProperties":{"$ref":"#/$defs/parameter-or-reference"}},"examples":{"type":"object","additionalProperties":{"$ref":"#/$defs/example-or-reference"}},"requestBodies":{"type":"object","additionalProperties":{"$ref":"#/$defs/request-body-or-reference"}},"headers":{"type":"object","additionalProperties":{"$ref":"#/$defs/header-or-reference"}},"securitySchemes":{"type":"object","additionalProperties":{"$ref":"#/$defs/security-scheme-or-reference"}},"links":{"type":"object","additionalProperties":{"$ref":"#/$defs/link-or-reference"}},"callbacks":{"type":"object","additionalProperties":{"$ref":"#/$defs/callbacks-or-reference"}},"pathItems":{"type":"object","additionalProperties":{"$ref":"#/$defs/path-item-or-reference"}}},"patternProperties":{"^(schemas|responses|parameters|examples|requestBodies|headers|securitySchemes|links|callbacks|pathItems)$":{"$comment":"Enumerating all of the property names in the regex above is necessary for unevaluatedProperties to work as expected","propertyNames":{"pattern":"^[a-zA-Z0-9._-]+$"}}},"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false},"paths":{"$comment":"https://spec.openapis.org/oas/v3.1.0#paths-object","type":"object","patternProperties":{"^/":{"$ref":"#/$defs/path-item"}},"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false},"path-item":{"$comment":"https://spec.openapis.org/oas/v3.1.0#path-item-object","type":"object","properties":{"summary":{"type":"string"},"description":{"type":"string"},"servers":{"type":"array","items":{"$ref":"#/$defs/server"}},"parameters":{"type":"array","items":{"$ref":"#/$defs/parameter-or-reference"}},"get":{"$ref":"#/$defs/operation"},"put":{"$ref":"#/$defs/operation"},"post":{"$ref":"#/$defs/operation"},"delete":{"$ref":"#/$defs/operation"},"options":{"$ref":"#/$defs/operation"},"head":{"$ref":"#/$defs/operation"},"patch":{"$ref":"#/$defs/operation"},"trace":{"$ref":"#/$defs/operation"}},"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false},"path-item-or-reference":{"if":{"type":"object","required":["$ref"]},"then":{"$ref":"#/$defs/reference"},"else":{"$ref":"#/$defs/path-item"}},"operation":{"$comment":"https://spec.openapis.org/oas/v3.1.0#operation-object","type":"object","properties":{"tags":{"type":"array","items":{"type":"string"}},"summary":{"type":"string"},"description":{"type":"string"},"externalDocs":{"$ref":"#/$defs/external-documentation"},"operationId":{"type":"string"},"parameters":{"type":"array","items":{"$ref":"#/$defs/parameter-or-reference"}},"requestBody":{"$ref":"#/$defs/request-body-or-reference"},"responses":{"$ref":"#/$defs/responses"},"callbacks":{"type":"object","additionalProperties":{"$ref":"#/$defs/callbacks-or-reference"}},"deprecated":{"default":false,"type":"boolean"},"security":{"type":"array","items":{"$ref":"#/$defs/security-requirement"}},"servers":{"type":"array","items":{"$ref":"#/$defs/server"}}},"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false},"external-documentation":{"$comment":"https://spec.openapis.org/oas/v3.1.0#external-documentation-object","type":"object","properties":{"description":{"type":"string"},"url":{"type":"string","format":"uri"}},"required":["url"],"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false},"parameter":{"$comment":"https://spec.openapis.org/oas/v3.1.0#parameter-object","type":"object","properties":{"name":{"type":"string"},"in":{"enum":["query","header","path","cookie"]},"description":{"type":"string"},"required":{"default":false,"type":"boolean"},"deprecated":{"default":false,"type":"boolean"},"schema":{"$dynamicRef":"#meta"},"content":{"$ref":"#/$defs/content","minProperties":1,"maxProperties":1}},"required":["name","in"],"oneOf":[{"required":["schema"]},{"required":["content"]}],"if":{"properties":{"in":{"const":"query"}},"required":["in"]},"then":{"properties":{"allowEmptyValue":{"default":false,"type":"boolean"}}},"dependentSchemas":{"schema":{"properties":{"style":{"type":"string"},"explode":{"type":"boolean"}},"allOf":[{"$ref":"#/$defs/examples"},{"$ref":"#/$defs/parameter/dependentSchemas/schema/$defs/styles-for-path"},{"$ref":"#/$defs/parameter/dependentSchemas/schema/$defs/styles-for-header"},{"$ref":"#/$defs/parameter/dependentSchemas/schema/$defs/styles-for-query"},{"$ref":"#/$defs/parameter/dependentSchemas/schema/$defs/styles-for-cookie"},{"$ref":"#/$defs/parameter/dependentSchemas/schema/$defs/styles-for-form"}],"$defs":{"styles-for-path":{"if":{"properties":{"in":{"const":"path"}},"required":["in"]},"then":{"properties":{"name":{"pattern":"[^/#?]+$"},"style":{"default":"simple","enum":["matrix","label","simple"]},"required":{"const":true}},"required":["required"]}},"styles-for-header":{"if":{"properties":{"in":{"const":"header"}},"required":["in"]},"then":{"properties":{"style":{"default":"simple","const":"simple"}}}},"styles-for-query":{"if":{"properties":{"in":{"const":"query"}},"required":["in"]},"then":{"properties":{"style":{"default":"form","enum":["form","spaceDelimited","pipeDelimited","deepObject"]},"allowReserved":{"default":false,"type":"boolean"}}}},"styles-for-cookie":{"if":{"properties":{"in":{"const":"cookie"}},"required":["in"]},"then":{"properties":{"style":{"default":"form","const":"form"}}}},"styles-for-form":{"if":{"properties":{"style":{"const":"form"}},"required":["style"]},"then":{"properties":{"explode":{"default":true}}},"else":{"properties":{"explode":{"default":false}}}}}}},"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false},"parameter-or-reference":{"if":{"type":"object","required":["$ref"]},"then":{"$ref":"#/$defs/reference"},"else":{"$ref":"#/$defs/parameter"}},"request-body":{"$comment":"https://spec.openapis.org/oas/v3.1.0#request-body-object","type":"object","properties":{"description":{"type":"string"},"content":{"$ref":"#/$defs/content"},"required":{"default":false,"type":"boolean"}},"required":["content"],"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false},"request-body-or-reference":{"if":{"type":"object","required":["$ref"]},"then":{"$ref":"#/$defs/reference"},"else":{"$ref":"#/$defs/request-body"}},"content":{"$comment":"https://spec.openapis.org/oas/v3.1.0#fixed-fields-10","type":"object","additionalProperties":{"$ref":"#/$defs/media-type"},"propertyNames":{"format":"media-range"}},"media-type":{"$comment":"https://spec.openapis.org/oas/v3.1.0#media-type-object","type":"object","properties":{"schema":{"$dynamicRef":"#meta"},"encoding":{"type":"object","additionalProperties":{"$ref":"#/$defs/encoding"}}},"allOf":[{"$ref":"#/$defs/specification-extensions"},{"$ref":"#/$defs/examples"}],"unevaluatedProperties":false},"encoding":{"$comment":"https://spec.openapis.org/oas/v3.1.0#encoding-object","type":"object","properties":{"contentType":{"type":"string","format":"media-range"},"headers":{"type":"object","additionalProperties":{"$ref":"#/$defs/header-or-reference"}},"style":{"default":"form","enum":["form","spaceDelimited","pipeDelimited","deepObject"]},"explode":{"type":"boolean"},"allowReserved":{"default":false,"type":"boolean"}},"allOf":[{"$ref":"#/$defs/specification-extensions"},{"$ref":"#/$defs/encoding/$defs/explode-default"}],"unevaluatedProperties":false,"$defs":{"explode-default":{"if":{"properties":{"style":{"const":"form"}},"required":["style"]},"then":{"properties":{"explode":{"default":true}}},"else":{"properties":{"explode":{"default":false}}}}}},"responses":{"$comment":"https://spec.openapis.org/oas/v3.1.0#responses-object","type":"object","properties":{"default":{"$ref":"#/$defs/response-or-reference"}},"patternProperties":{"^[1-5](?:[0-9]{2}|XX)$":{"$ref":"#/$defs/response-or-reference"}},"minProperties":1,"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false},"response":{"$comment":"https://spec.openapis.org/oas/v3.1.0#response-object","type":"object","properties":{"description":{"type":"string"},"headers":{"type":"object","additionalProperties":{"$ref":"#/$defs/header-or-reference"}},"content":{"$ref":"#/$defs/content"},"links":{"type":"object","additionalProperties":{"$ref":"#/$defs/link-or-reference"}}},"required":["description"],"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false},"response-or-reference":{"if":{"type":"object","required":["$ref"]},"then":{"$ref":"#/$defs/reference"},"else":{"$ref":"#/$defs/response"}},"callbacks":{"$comment":"https://spec.openapis.org/oas/v3.1.0#callback-object","type":"object","$ref":"#/$defs/specification-extensions","additionalProperties":{"$ref":"#/$defs/path-item-or-reference"}},"callbacks-or-reference":{"if":{"type":"object","required":["$ref"]},"then":{"$ref":"#/$defs/reference"},"else":{"$ref":"#/$defs/callbacks"}},"example":{"$comment":"https://spec.openapis.org/oas/v3.1.0#example-object","type":"object","properties":{"summary":{"type":"string"},"description":{"type":"string"},"value":true,"externalValue":{"type":"string","format":"uri"}},"not":{"required":["value","externalValue"]},"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false},"example-or-reference":{"if":{"type":"object","required":["$ref"]},"then":{"$ref":"#/$defs/reference"},"else":{"$ref":"#/$defs/example"}},"link":{"$comment":"https://spec.openapis.org/oas/v3.1.0#link-object","type":"object","properties":{"operationRef":{"type":"string","format":"uri-reference"},"operationId":{"type":"string"},"parameters":{"$ref":"#/$defs/map-of-strings"},"requestBody":true,"description":{"type":"string"},"body":{"$ref":"#/$defs/server"}},"oneOf":[{"required":["operationRef"]},{"required":["operationId"]}],"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false},"link-or-reference":{"if":{"type":"object","required":["$ref"]},"then":{"$ref":"#/$defs/reference"},"else":{"$ref":"#/$defs/link"}},"header":{"$comment":"https://spec.openapis.org/oas/v3.1.0#header-object","type":"object","properties":{"description":{"type":"string"},"required":{"default":false,"type":"boolean"},"deprecated":{"default":false,"type":"boolean"},"schema":{"$dynamicRef":"#meta"},"content":{"$ref":"#/$defs/content","minProperties":1,"maxProperties":1}},"oneOf":[{"required":["schema"]},{"required":["content"]}],"dependentSchemas":{"schema":{"properties":{"style":{"default":"simple","const":"simple"},"explode":{"default":false,"type":"boolean"}},"$ref":"#/$defs/examples"}},"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false},"header-or-reference":{"if":{"type":"object","required":["$ref"]},"then":{"$ref":"#/$defs/reference"},"else":{"$ref":"#/$defs/header"}},"tag":{"$comment":"https://spec.openapis.org/oas/v3.1.0#tag-object","type":"object","properties":{"name":{"type":"string"},"description":{"type":"string"},"externalDocs":{"$ref":"#/$defs/external-documentation"}},"required":["name"],"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false},"reference":{"$comment":"https://spec.openapis.org/oas/v3.1.0#reference-object","type":"object","properties":{"$ref":{"type":"string","format":"uri-reference"},"summary":{"type":"string"},"description":{"type":"string"}},"unevaluatedProperties":false},"schema":{"$comment":"https://spec.openapis.org/oas/v3.1.0#schema-object","$dynamicAnchor":"meta","type":["object","boolean"]},"security-scheme":{"$comment":"https://spec.openapis.org/oas/v3.1.0#security-scheme-object","type":"object","properties":{"type":{"enum":["apiKey","http","mutualTLS","oauth2","openIdConnect"]},"description":{"type":"string"}},"required":["type"],"allOf":[{"$ref":"#/$defs/specification-extensions"},{"$ref":"#/$defs/security-scheme/$defs/type-apikey"},{"$ref":"#/$defs/security-scheme/$defs/type-http"},{"$ref":"#/$defs/security-scheme/$defs/type-http-bearer"},{"$ref":"#/$defs/security-scheme/$defs/type-oauth2"},{"$ref":"#/$defs/security-scheme/$defs/type-oidc"}],"unevaluatedProperties":false,"$defs":{"type-apikey":{"if":{"properties":{"type":{"const":"apiKey"}},"required":["type"]},"then":{"properties":{"name":{"type":"string"},"in":{"enum":["query","header","cookie"]}},"required":["name","in"]}},"type-http":{"if":{"properties":{"type":{"const":"http"}},"required":["type"]},"then":{"properties":{"scheme":{"type":"string"}},"required":["scheme"]}},"type-http-bearer":{"if":{"properties":{"type":{"const":"http"},"scheme":{"type":"string","pattern":"^[Bb][Ee][Aa][Rr][Ee][Rr]$"}},"required":["type","scheme"]},"then":{"properties":{"bearerFormat":{"type":"string"}}}},"type-oauth2":{"if":{"properties":{"type":{"const":"oauth2"}},"required":["type"]},"then":{"properties":{"flows":{"$ref":"#/$defs/oauth-flows"}},"required":["flows"]}},"type-oidc":{"if":{"properties":{"type":{"const":"openIdConnect"}},"required":["type"]},"then":{"properties":{"openIdConnectUrl":{"type":"string","format":"uri"}},"required":["openIdConnectUrl"]}}}},"security-scheme-or-reference":{"if":{"type":"object","required":["$ref"]},"then":{"$ref":"#/$defs/reference"},"else":{"$ref":"#/$defs/security-scheme"}},"oauth-flows":{"type":"object","properties":{"implicit":{"$ref":"#/$defs/oauth-flows/$defs/implicit"},"password":{"$ref":"#/$defs/oauth-flows/$defs/password"},"clientCredentials":{"$ref":"#/$defs/oauth-flows/$defs/client-credentials"},"authorizationCode":{"$ref":"#/$defs/oauth-flows/$defs/authorization-code"}},"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false,"$defs":{"implicit":{"type":"object","properties":{"authorizationUrl":{"type":"string","format":"uri"},"refreshUrl":{"type":"string","format":"uri"},"scopes":{"$ref":"#/$defs/map-of-strings"}},"required":["authorizationUrl","scopes"],"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false},"password":{"type":"object","properties":{"tokenUrl":{"type":"string","format":"uri"},"refreshUrl":{"type":"string","format":"uri"},"scopes":{"$ref":"#/$defs/map-of-strings"}},"required":["tokenUrl","scopes"],"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false},"client-credentials":{"type":"object","properties":{"tokenUrl":{"type":"string","format":"uri"},"refreshUrl":{"type":"string","format":"uri"},"scopes":{"$ref":"#/$defs/map-of-strings"}},"required":["tokenUrl","scopes"],"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false},"authorization-code":{"type":"object","properties":{"authorizationUrl":{"type":"string","format":"uri"},"tokenUrl":{"type":"string","format":"uri"},"refreshUrl":{"type":"string","format":"uri"},"scopes":{"$ref":"#/$defs/map-of-strings"}},"required":["authorizationUrl","tokenUrl","scopes"],"$ref":"#/$defs/specification-extensions","unevaluatedProperties":false}}},"security-requirement":{"$comment":"https://spec.openapis.org/oas/v3.1.0#security-requirement-object","type":"object","additionalProperties":{"type":"array","items":{"type":"string"}}},"specification-extensions":{"$comment":"https://spec.openapis.org/oas/v3.1.0#specification-extensions","patternProperties":{"^x-":true}},"examples":{"properties":{"example":true,"examples":{"type":"object","additionalProperties":{"$ref":"#/$defs/example-or-reference"}}}},"map-of-strings":{"type":"object","additionalProperties":{"type":"string"}}}}`;
