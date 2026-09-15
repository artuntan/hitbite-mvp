import { readdirSync } from "node:fs";
import path from "node:path";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { FOOTER_DISCLAIMER, TESTNET_BANNER } from "../lib/copy";
import {
  buildOpenApiDocument,
  curlFor,
  ENDPOINTS,
  ENVELOPE_ENDPOINTS,
  isUndocumentedNamespace,
  OPENAPI_ROUTE,
  PUBLIC_CACHE_CONTROL,
  UNDOCUMENTED_ROUTES,
} from "../lib/openapi";
import { apiErrorSchema } from "../lib/schemas";

/**
 * `/developers` and `/api/openapi.json` (BUILD_PROMPT 7.2, 8).
 *
 * Runs against a production build — `playwright.config.ts` starts `pnpm start`, so `pnpm build`
 * must have happened first.
 *
 * Three things are checked here that unit tests cannot reach:
 *
 *   1. **The route serves the document the builder builds.** `lib/openapi.test.ts` validates that
 *      document against the OpenAPI 3.1 meta-schema; this asserts the bytes on the wire are that
 *      exact document, parsed back out of the response by a real JSON parser. The two together are
 *      the claim "the published description is valid OpenAPI".
 *   2. **Every route the app actually serves is accounted for.** The walk is over `app/`, not over
 *      a list — a handler added by anyone, anywhere, must be described or must fall inside a
 *      namespace the description says it does not cover.
 *   3. **The documented responses are the real ones.** Each documented endpoint is called, and its
 *      status, its cache header and its CORS header are compared with what the description
 *      promises. A description that is merely internally consistent is not worth much.
 */

const WEB_DIR = path.join(__dirname, "..");

/** Every route handler the app serves, as the URL path it answers on. */
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

interface ParsedDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: { url: string }[];
  paths: Record<
    string,
    Record<string, { operationId: string; responses: Record<string, unknown> }>
  >;
  components: { schemas: Record<string, Record<string, unknown>> };
}

/**
 * Parse an OpenAPI document out of a response body and resolve it.
 *
 * Deliberately more than "it is an object": the body goes through `JSON.parse`, the version is
 * checked against the 3.1 line, every operation is required to declare a 200, and **every `$ref`
 * is followed** to the component it names — which is the step a generator performs first and the
 * one a hand-assembled document fails.
 */
async function parseOpenApi(request: APIRequestContext, url: string): Promise<ParsedDocument> {
  const response = await request.get(url);
  expect(response.status(), `${url} should answer 200`).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");

  const body = await response.text();
  const parsed = JSON.parse(body) as ParsedDocument;

  expect(parsed.openapi).toMatch(/^3\.1\.\d+$/);
  expect(typeof parsed.info.title).toBe("string");
  expect(typeof parsed.info.version).toBe("string");
  expect(Object.keys(parsed.paths).length).toBeGreaterThan(0);

  const names = new Set(Object.keys(parsed.components.schemas));
  const refs: string[] = [];
  JSON.parse(body, (key: string, value: unknown) => {
    if (key === "$ref" && typeof value === "string") refs.push(value);
    return value;
  });
  expect(refs.length).toBeGreaterThan(0);
  for (const ref of new Set(refs)) {
    expect(ref, "every $ref is a local component reference").toMatch(/^#\/components\/schemas\//);
    expect(names, `${ref} resolves`).toContain(ref.slice("#/components/schemas/".length));
  }

  for (const [routePath, item] of Object.entries(parsed.paths)) {
    expect(routePath, "a path is a URL template starting with /").toMatch(/^\//);
    for (const [method, operation] of Object.entries(item)) {
      expect(["get", "put", "post", "delete", "options", "head", "patch", "trace"]).toContain(
        method,
      );
      expect(typeof operation.operationId).toBe("string");
      expect(Object.keys(operation.responses), `${method} ${routePath} declares a 200`).toContain(
        "200",
      );
    }
  }

  return parsed;
}

test.describe("/api/openapi.json", () => {
  test("is valid JSON that parses as an OpenAPI 3.1 document", async ({ request }) => {
    const parsed = await parseOpenApi(request, OPENAPI_ROUTE);
    expect(parsed.info.title).toContain("hbTRS");
  });

  test("serves exactly the document the builder produces", async ({ request }) => {
    // `lib/openapi.test.ts` validates that object against the OpenAPI 3.1 meta-schema. Asserting
    // the wire bytes equal it is what carries that guarantee onto the running server, rather than
    // re-implementing a validator here.
    const response = await request.get(OPENAPI_ROUTE);
    expect(await response.json()).toEqual(JSON.parse(JSON.stringify(buildOpenApiDocument())));
  });

  test("is the one endpoint that is not wrapped in the envelope", async ({ request }) => {
    const body = (await (await request.get(OPENAPI_ROUTE)).json()) as Record<string, unknown>;
    expect(body.ok).toBeUndefined();
    expect(body.data).toBeUndefined();
    expect(body.openapi).toBe("3.1.0");
    expect(String((body.info as { description: string }).description)).toContain(
      "single exception",
    );
  });

  test("carries the public cache and CORS headers", async ({ request }) => {
    const headers = (await request.get(OPENAPI_ROUTE)).headers();
    expect(headers["cache-control"]).toBe(PUBLIC_CACHE_CONTROL);
    expect(headers["access-control-allow-origin"]).toBe("*");
  });

  test("names no host this project does not run", async ({ request }) => {
    const body = await (await request.get(OPENAPI_ROUTE)).text();
    const hosts = new Set(
      [...body.matchAll(/https?:\/\/([^/"'\s\\)]+)/g)].map((match) => match[1] ?? ""),
    );
    expect([...hosts].sort()).toEqual(["localhost:3000"]);
  });
});

test.describe("the description matches the app", () => {
  test("describes every route the app serves, or declares the namespace it is in", async () => {
    const served = servedRoutes();
    const described = new Set(ENDPOINTS.map((endpoint) => endpoint.path));
    const excluded = new Set(UNDOCUMENTED_ROUTES.map((route) => route.path));

    expect(served, "the description's own route is served").toContain(OPENAPI_ROUTE);
    expect(
      served.filter(
        (route) => !described.has(route) && !excluded.has(route) && !isUndocumentedNamespace(route),
      ),
      "a route exists that is neither described nor explicitly left out",
    ).toEqual([]);
    expect(
      [...described, ...excluded].filter((route) => !served.includes(route)),
      "the description names a route the app does not serve",
    ).toEqual([]);
  });

  test("every documented endpoint answers, with the documented headers", async ({ request }) => {
    for (const endpoint of ENDPOINTS) {
      const url =
        endpoint.path === "/api/events"
          ? `${endpoint.path}?event=Subscribed&limit=5`
          : endpoint.path;
      const response = await request.get(url);
      expect(response.status(), `${url} should answer 200`).toBe(200);
      const headers = response.headers();
      expect(headers["cache-control"], `${url} cache policy`).toBe(endpoint.cacheControl);
      expect(headers["access-control-allow-origin"], `${url} is readable cross-origin`).toBe("*");
    }
  });

  test("every documented envelope endpoint really is { ok: true, data }", async ({ request }) => {
    for (const endpoint of ENVELOPE_ENDPOINTS) {
      const body = (await (await request.get(endpoint.path)).json()) as Record<string, unknown>;
      expect(body.ok, `${endpoint.path} envelope`).toBe(true);
      expect(body.data, `${endpoint.path} carries data`).toBeDefined();
      expect(Object.keys(body).sort()).toEqual(["data", "ok"]);
    }
  });

  test("a refused request is the documented 400, uncached", async ({ request }) => {
    // The one documented failure that can be produced on demand: `limit` outside 1..200.
    const response = await request.get("/api/events?limit=0");
    expect(response.status()).toBe(400);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const error = apiErrorSchema.parse(await response.json());
    expect(error.error.code).toBe("bad_request");
    expect(error.error.hint.length).toBeGreaterThan(0);

    const documented = ENDPOINTS.find((endpoint) => endpoint.path === "/api/events")?.failures.find(
      (failure) => failure.status === 400,
    );
    expect(documented?.code).toBe(error.error.code);
  });

  test("an undescribed verification route is served and is not cross-origin readable", async ({
    request,
  }) => {
    // The exclusion list claims these exist and are same-origin. Both halves are checked, so the
    // reason on /developers cannot quietly become untrue.
    const response = await request.get("/api/verify/status");
    expect(response.status(), "the route is served").toBe(400);
    expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers()["cache-control"]).toContain("no-store");
  });
});

test.describe("/developers", () => {
  test("renders with the shell, one h1 and every endpoint", async ({ page }) => {
    const response = await page.goto("/developers");
    expect(response?.status()).toBe(200);

    await expect(page).toHaveTitle(/HitBite/);
    await expect(page.getByText(TESTNET_BANNER).first()).toBeVisible();
    await expect(page.getByRole("contentinfo").getByText(FOOTER_DISCLAIMER)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1, name: "Developers" })).toBeVisible();

    for (const endpoint of ENDPOINTS) {
      const anchor = endpoint.path.replace(/^\//, "").replaceAll(/[^a-zA-Z0-9]+/g, "-");
      const card = page.getByTestId(`endpoint-${anchor}`);
      await expect(card, `${endpoint.path} has a card`).toBeVisible();
      await expect(card.getByRole("heading", { name: endpoint.path })).toBeVisible();
    }
  });

  test("shows a curl for every endpoint, against the origin that served the page", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/developers");
    const origin = new URL(baseURL ?? "http://127.0.0.1:3457").origin;

    for (const endpoint of ENDPOINTS) {
      const anchor = endpoint.path.replace(/^\//, "").replaceAll(/[^a-zA-Z0-9]+/g, "-");
      const block = page
        .getByTestId(`endpoint-${anchor}`)
        .getByRole("region", { name: `curl for GET ${endpoint.path}` });
      await expect(block).toBeVisible();
      // The exact command, origin substituted, so it can be pasted and run as it stands.
      expect((await block.innerText()).trim()).toBe(curlFor(endpoint, origin));
    }
  });

  test("names the money rule and the cache policy it publishes", async ({ page }) => {
    await page.goto("/developers");
    await expect(page.getByText("Money is never a JSON number")).toBeVisible();
    await expect(page.getByText(PUBLIC_CACHE_CONTROL).first()).toBeVisible();
  });

  test("links to the raw description and says what is left out of it", async ({ page }) => {
    await page.goto("/developers");
    // Two links carry that text — the one in the page header and the one in the endpoint index —
    // so the assertion is that both go somewhere real, not that there is exactly one.
    const links = page.getByRole("link", { name: OPENAPI_ROUTE });
    await expect(links).toHaveCount(2);
    await expect(links.first()).toHaveAttribute("href", OPENAPI_ROUTE);

    const excluded = page.getByTestId("undocumented-routes");
    await expect(excluded).toBeVisible();
    for (const route of UNDOCUMENTED_ROUTES) {
      await expect(excluded.getByText(route.path, { exact: true })).toBeVisible();
    }

    // The narrative lives in PARTNER_INTEGRATION.md and is referenced rather than copied.
    await expect(
      page.getByTestId("partner-guide").getByText("PARTNER_INTEGRATION.md").first(),
    ).toBeVisible();
  });

  test("shows the viem snippets for nav() and canHold()", async ({ page }) => {
    await page.goto("/developers");
    const card = page.getByTestId("contract-reads");
    await expect(card).toBeVisible();

    const nav = card.getByRole("region", { name: "nav() with viem" });
    await expect(nav).toBeVisible();
    expect(await nav.innerText()).toContain('functionName: "nav"');

    const canHold = card.getByRole("region", { name: "canHold() with viem" });
    await expect(canHold).toBeVisible();
    expect(await canHold.innerText()).toContain('functionName: "canHold"');
  });

  test("ships no wallet bundle", async ({ request }) => {
    // The public pages hold their Lighthouse scores because none of them pulls wagmi or
    // RainbowKit (PLAN.md D63). The only client component here is the copy button.
    //
    // The scripts are read out of the served HTML rather than recorded from the browser: an App
    // Router page prefetches the routes its header links to, so a browser sitting on /developers
    // does eventually fetch /subscribe's chunks. That is the router working, not this page
    // shipping a wallet — the question here is what *this document* loads.
    const html = await (await request.get("/developers")).text();
    const sources = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(sources.length, "the page loads its own scripts").toBeGreaterThan(0);

    const bodies = await Promise.all(
      sources.map(async (source) => (await request.get(source)).text()),
    );
    const joined = bodies.join("\n").toLowerCase();
    for (const marker of ["rainbowkit", "walletconnect", "wagmi", "@coinbase", "metamask"]) {
      expect(joined, `no ${marker} on a public page`).not.toContain(marker);
    }
  });

  test("copies a curl to the clipboard", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "clipboard permissions are chromium-only here");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/developers");

    const endpoint = ENDPOINTS[0];
    if (!endpoint) throw new Error("no endpoints to test");
    const anchor = endpoint.path.replace(/^\//, "").replaceAll(/[^a-zA-Z0-9]+/g, "-");
    await page
      .getByTestId(`endpoint-${anchor}`)
      .getByRole("button", { name: `Copy curl for GET ${endpoint.path}` })
      .click();

    await expect(
      page.getByTestId(`endpoint-${anchor}`).getByRole("button", { name: /copied/i }),
    ).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain(endpoint.path);
  });
});
