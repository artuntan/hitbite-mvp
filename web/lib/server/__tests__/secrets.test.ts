/**
 * The registrar key stays on the server, and stays out of every message.
 *
 * Two claims are made in the task and both are testable, so both are tested rather than asserted
 * in a comment:
 *
 *   1. **It cannot reach a client bundle.** Nothing marked `"use client"` imports `lib/server/` at
 *      runtime, no file outside `lib/server/` and these tests names the variable, and the module
 *      that reads it throws if it is ever evaluated somewhere with a `window`.
 *   2. **It cannot appear in an error message.** Every string that can leave the server — an API
 *      error body, a stored `last_error`, the registrar's own status — goes through
 *      `redactSecrets`, and each of those paths is exercised here with the key deliberately
 *      planted in the text.
 *
 * The scan in the first half walks the real source tree, so a page added later by anyone that
 * imports a server module into the browser fails this test rather than shipping.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "../http";
import {
  assertServerOnly,
  describeError,
  getRegistrarKeyStatus,
  getRegistrarPrivateKey,
  REDACTED,
  redactSecrets,
  workerSecretMatches,
} from "../env";
import { createStore } from "../store";

/** A real-looking testnet key: Anvil's account #0, published in its own banner. */
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const WORKER_SECRET = "a-worker-secret-long-enough-to-be-one";

const WEB_DIR = path.resolve(import.meta.dirname, "..", "..", "..");

beforeEach(() => {
  process.env.REGISTRAR_PRIVATE_KEY = KEY;
  process.env.REGISTRAR_WORKER_SECRET = WORKER_SECRET;
});

afterEach(() => {
  delete process.env.REGISTRAR_PRIVATE_KEY;
  delete process.env.REGISTRAR_WORKER_SECRET;
});

// --------------------------------------------------------------------------- the source scan

function sourceFiles(directory: string): string[] {
  const absolute = path.join(WEB_DIR, directory);
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // the directory does not exist yet; nothing to check
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts|js|jsx)$/.test(entry)) found.push(full);
    }
  };
  walk(absolute);
  return found;
}

function isClientFile(source: string): boolean {
  const head = source.slice(0, 200);
  return /^\s*["']use client["']/m.test(head);
}

/** Import statements that pull a module in at runtime — `import type` is erased and is fine. */
function runtimeImports(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:^|\n)\s*import\s+(?!type\s)([^;]*?)from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const clause = match[1] ?? "";
    const specifier = match[2] ?? "";
    // `import { type A, type B } from "x"` is also erased entirely.
    const bindings = clause.match(/\{([^}]*)\}/)?.[1];
    const typeOnly =
      bindings !== undefined &&
      clause.trim().startsWith("{") &&
      bindings
        .split(",")
        .map((binding) => binding.trim())
        .filter(Boolean)
        .every((binding) => binding.startsWith("type "));
    if (!typeOnly) specifiers.push(specifier);
  }
  const dynamic = /import\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = dynamic.exec(source)) !== null) {
    if (match[1]) specifiers.push(match[1]);
  }
  return specifiers;
}

describe("the registrar key cannot reach a client bundle", () => {
  it("is named only in server-only files, and never in one that ships to the browser", () => {
    // Naming the variable in a route handler's documentation is fine — a route handler never
    // reaches a browser. Naming it in a page, a component or anything marked "use client" is not.
    const serverOnly = [path.join("lib", "server"), path.join("app", "api")];
    const offenders: string[] = [];

    for (const directory of ["app", "components", "lib", "e2e", "scripts"]) {
      for (const file of sourceFiles(directory)) {
        const relative = path.relative(WEB_DIR, file);
        const source = readFileSync(file, "utf8");
        if (!source.includes("REGISTRAR_PRIVATE_KEY")) continue;
        const inServerOnlyDir = serverOnly.some((prefix) => relative.startsWith(prefix));
        if (!inServerOnlyDir || isClientFile(source)) offenders.push(relative);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("is read in exactly one module", () => {
    const readers = sourceFiles(path.join("lib", "server"))
      .filter(
        (file) =>
          !file.includes(`${path.sep}__tests__${path.sep}`) &&
          readFileSync(file, "utf8").includes("process.env.REGISTRAR_PRIVATE_KEY"),
      )
      .map((file) => path.relative(WEB_DIR, file));

    expect(readers).toEqual([path.join("lib", "server", "env.ts")]);
  });

  it("is not reachable from any client component", () => {
    const offenders: { file: string; specifier: string }[] = [];
    for (const directory of ["app", "components"]) {
      for (const file of sourceFiles(directory)) {
        const source = readFileSync(file, "utf8");
        if (!isClientFile(source)) continue;
        for (const specifier of runtimeImports(source)) {
          if (
            /(^|\/)lib\/server(\/|$)/.test(specifier) ||
            /(^|\/)server\/(env|chain|store)$/.test(specifier)
          ) {
            offenders.push({ file: path.relative(WEB_DIR, file), specifier });
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("lives behind a guard that throws if the module is evaluated in a browser", async () => {
    expect(() => assertServerOnly("lib/server/env.ts")).not.toThrow();

    const globals = globalThis as { window?: unknown };
    globals.window = {};
    try {
      expect(() => assertServerOnly("lib/server/env.ts")).toThrow(/browser bundle/);

      vi.resetModules();
      await expect(import("../env")).rejects.toThrow(/browser bundle/);
    } finally {
      delete globals.window;
      vi.resetModules();
    }
  });

  it("guards every server module that touches it", () => {
    for (const name of ["env.ts", "store.ts", "chain.ts"]) {
      const source = readFileSync(path.join(WEB_DIR, "lib", "server", name), "utf8");
      expect(source).toMatch(/assertServerOnly\(/);
    }
  });

  it("leaves lib/server/verification.ts importable from the browser", () => {
    // The /verify page needs the statuses, the schemas and the types. It must be able to import
    // them without reaching env.ts, so the whole transitive graph is pinned here: adding a
    // server-only import to verification.ts fails this test rather than the page's build.
    const graph = new Set<string>();
    const walk = (file: string): void => {
      if (graph.has(file)) return;
      graph.add(file);
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
        const base = path.resolve(path.dirname(file), match[1] ?? "");
        for (const suffix of ["", ".ts", ".tsx", ".json"]) {
          try {
            statSync(base + suffix);
            walk(base + suffix);
            break;
          } catch {
            continue;
          }
        }
      }
      expect(source).not.toMatch(/from\s+["']node:/);
    };

    walk(path.join(WEB_DIR, "lib", "server", "verification.ts"));

    expect([...graph].map((file) => path.relative(WEB_DIR, file)).sort()).toEqual([
      path.join("lib", "countries.json"),
      path.join("lib", "countries.ts"),
      path.join("lib", "schemas.ts"),
      path.join("lib", "server", "errors.ts"),
      path.join("lib", "server", "verification.ts"),
    ]);
  });
});

// --------------------------------------------------------------------------- redaction

describe("the registrar key cannot appear in an error message", () => {
  it("is replaced wherever it occurs, in any case, with or without its prefix", () => {
    const text = `sending failed for key ${KEY}, also ${KEY.toUpperCase()} and bare ${KEY.slice(2)}`;
    const redacted = redactSecrets(text);

    expect(redacted).not.toContain(KEY.slice(2));
    expect(redacted.toLowerCase()).not.toContain(KEY.slice(2).toLowerCase());
    expect(redacted).toContain(REDACTED);
  });

  it("redacts the worker secret and the database token too", () => {
    process.env.DATABASE_AUTH_TOKEN = "turso-token-that-is-long-enough";

    const redacted = redactSecrets(
      `auth ${WORKER_SECRET} and token turso-token-that-is-long-enough`,
    );

    expect(redacted).not.toContain(WORKER_SECRET);
    expect(redacted).not.toContain("turso-token-that-is-long-enough");
    delete process.env.DATABASE_AUTH_TOKEN;
  });

  it("leaves a transaction hash alone, because that is the thing worth reading", () => {
    const hash = "0x5e8ed126a35a187a3706300d6b4cf231dbac1942d71b22aa74a11955811872cb"; // allow-secret
    expect(redactSecrets(`mined as ${hash}`)).toBe(`mined as ${hash}`);
  });

  it("strips the stack and redacts the message of anything thrown", () => {
    const error = new Error(`viem: invalid private key ${KEY}\n  at somewhere.js:1:1`);

    const described = describeError(error);

    expect(described).not.toContain(KEY);
    expect(described).not.toContain("at somewhere.js");
    expect(described).toContain(REDACTED);
  });

  it("keeps it out of an API error body", async () => {
    const response = jsonError("internal_error", `failed with ${KEY}`, "check the key", 500);
    const text = await response.text();

    expect(text).not.toContain(KEY);
    expect(text).toContain(REDACTED);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
  });

  it("keeps it out of a stored failure, and caps how much is stored", async () => {
    const store = createStore(":memory:");
    await store.submit({
      address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      country: 276,
      investorType: 1,
      attestation: true,
      consent: true,
      status: "pending",
      reason: null,
      now: 1_789_420_690_000,
    });

    await store.recordFailure({
      address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      error: `signing failed with ${KEY} `.repeat(40),
      now: 1_789_420_690_001,
    });

    const record = await store.get("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    expect(record?.lastError).not.toContain(KEY);
    expect((record?.lastError ?? "").length).toBeLessThanOrEqual(500);
    await store.close();
  });

  it("never reports the value through the key's own status, however broken it is", () => {
    process.env.REGISTRAR_PRIVATE_KEY = `${KEY}zz`;
    const malformed = getRegistrarKeyStatus();
    expect(malformed.status).toBe("malformed");
    expect(JSON.stringify(malformed)).not.toContain(KEY.slice(2, 20));
    expect(getRegistrarPrivateKey()).toBeNull();

    delete process.env.REGISTRAR_PRIVATE_KEY;
    const missing = getRegistrarKeyStatus();
    expect(missing.status).toBe("missing");
    expect(JSON.stringify(missing)).not.toContain(KEY.slice(2, 20));
  });

  it("hands the key to viem only when it is the right shape", () => {
    expect(getRegistrarPrivateKey()).toBe(KEY);

    process.env.REGISTRAR_PRIVATE_KEY = "not-a-key";
    expect(getRegistrarPrivateKey()).toBeNull();

    process.env.REGISTRAR_PRIVATE_KEY = KEY.slice(0, -2);
    expect(getRegistrarPrivateKey()).toBeNull();
  });
});

// --------------------------------------------------------------------------- worker secret

describe("the worker secret", () => {
  it("matches only the configured value", () => {
    expect(workerSecretMatches(WORKER_SECRET)).toBe(true);
    expect(workerSecretMatches(` ${WORKER_SECRET} `)).toBe(true);
    expect(workerSecretMatches(`${WORKER_SECRET}x`)).toBe(false);
    expect(workerSecretMatches(WORKER_SECRET.slice(0, -1))).toBe(false);
    expect(workerSecretMatches("")).toBe(false);
    expect(workerSecretMatches(null)).toBe(false);
    expect(workerSecretMatches(undefined)).toBe(false);
  });

  it("matches nothing when none is configured, rather than waving everyone through", () => {
    delete process.env.REGISTRAR_WORKER_SECRET;
    expect(workerSecretMatches("")).toBe(false);
    expect(workerSecretMatches("anything")).toBe(false);
  });

  it("refuses a secret too short to be one", () => {
    process.env.REGISTRAR_WORKER_SECRET = "short";
    expect(workerSecretMatches("short")).toBe(false);
  });
});
