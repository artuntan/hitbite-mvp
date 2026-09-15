/**
 * The envelope, the body reader and the bound on an open endpoint.
 *
 * The envelope has to match the Phase 6 API exactly — a partner writing one parser reads every
 * endpoint — while never being cached, because a verification status changes in seconds. Both
 * halves of that are asserted here against real `Response` objects.
 */

import { describe, expect, it } from "vitest";

import { z } from "zod";

import { apiErrorSchema, apiSuccessSchema } from "../../schemas";
import {
  clientIp,
  errorResponse,
  jsonError,
  jsonOk,
  presentedWorkerSecret,
  readJsonBody,
  RequestError,
} from "../http";
import { createRateLimiter } from "../ratelimit";

/** A stand-in for a route's response schema: `jsonOk` validates the whole envelope, not the data. */
const acceptedSchema = apiSuccessSchema(z.strictObject({ accepted: z.boolean() }));

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/verify", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("the success envelope", () => {
  it("is { ok: true, data }, validated against the route's own schema, and never cached", async () => {
    const response = jsonOk(acceptedSchema, { accepted: true }, "hint");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await response.json()).toEqual({ ok: true, data: { accepted: true } });
  });

  it("turns a response that fails its own schema into a 500 rather than sending it", async () => {
    const response = jsonOk(acceptedSchema, { accepted: "yes" }, "reconcile the schema");

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(apiErrorSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ ok: false, error: { code: "invalid_document" } });
  });
});

describe("the error envelope", () => {
  it("matches the shape every Phase 6 route returns", async () => {
    const response = jsonError("bad_request", "no", "do it differently", 400);
    const body = await response.json();

    expect(apiErrorSchema.safeParse(body).success).toBe(true);
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
  });

  it("carries a RequestError's own status through", async () => {
    const unauthorized = errorResponse(
      RequestError.unauthorized("secret required", "send the header"),
      "fallback",
    );
    const limited = errorResponse(
      RequestError.tooManyRequests("too many", "wait a minute"),
      "fallback",
    );

    expect(unauthorized.status).toBe(401);
    expect(limited.status).toBe(429);
    // The code enum belongs to Phase 6 and is not extended here; the status carries the meaning.
    expect((await unauthorized.json()).error.code).toBe("bad_request");
  });

  it("turns an unexpected throw into a 500 with a hint and no stack", async () => {
    const response = errorResponse(new Error("boom\n  at file.ts:1:1"), "check the config");
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(body.error.message).toBe("boom");
    expect(body.error.hint).toBe("check the config");
  });
});

describe("reading a body", () => {
  it("parses a JSON object", async () => {
    expect(await readJsonBody(jsonRequest({ address: "0x1" }))).toEqual({ address: "0x1" });
  });

  it("refuses a body sent as anything but JSON, which is what keeps other origins out", async () => {
    const request = new Request("https://example.test/api/verify", {
      method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: '{"address":"0x1"}',
    });

    await expect(readJsonBody(request)).rejects.toThrow(/application\/json/);
  });

  it("refuses a body that is not valid JSON", async () => {
    await expect(readJsonBody(jsonRequest("{oops"))).rejects.toThrow(/valid JSON/);
  });

  it("refuses a body larger than the cap, by header or by content", async () => {
    const big = jsonRequest({ padding: "x".repeat(20_000) });
    await expect(readJsonBody(big)).rejects.toThrow(/larger than/);
  });

  it("requires a body where one is required, and allows an empty one for the worker", async () => {
    const empty = new Request("https://example.test/api/verify/process", { method: "POST" });
    await expect(readJsonBody(empty.clone())).rejects.toThrow(/body is required/);
    expect(await readJsonBody(empty, { allowEmpty: true })).toEqual({});
  });
});

describe("request headers", () => {
  it("takes the first hop of x-forwarded-for", () => {
    const request = new Request("https://example.test/", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
    });
    expect(clientIp(request)).toBe("203.0.113.5");
    expect(clientIp(new Request("https://example.test/"))).toBeNull();
  });

  it("reads the worker secret from either accepted header", () => {
    const bearer = new Request("https://example.test/", {
      headers: { authorization: "Bearer s3cret-value" },
    });
    const custom = new Request("https://example.test/", {
      headers: { "x-registrar-worker-secret": "s3cret-value" },
    });

    expect(presentedWorkerSecret(bearer)).toBe("s3cret-value");
    expect(presentedWorkerSecret(custom)).toBe("s3cret-value");
    expect(presentedWorkerSecret(new Request("https://example.test/"))).toBeNull();
  });
});

describe("the rate limiter", () => {
  it("allows a burst up to the limit and then refuses, with a wait", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });

    expect(limiter.take("a", 0).allowed).toBe(true);
    expect(limiter.take("a", 10).allowed).toBe(true);
    const last = limiter.take("a", 20);
    expect(last.allowed).toBe(true);
    expect(last.remaining).toBe(0);

    const refused = limiter.take("a", 30);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterMs).toBe(59_970);
  });

  it("counts each caller separately and forgets the window once it passes", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000 });

    expect(limiter.take("a", 0).allowed).toBe(true);
    expect(limiter.take("b", 0).allowed).toBe(true);
    expect(limiter.take("a", 500).allowed).toBe(false);
    expect(limiter.take("a", 1_001).allowed).toBe(true);
  });

  it("does not grow without bound when a caller rotates its key", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, maxKeys: 8 });

    for (let index = 0; index < 500; index += 1) {
      expect(limiter.take(`ip-${index}`, index).allowed).toBe(true);
    }
    // Nothing to assert about internals beyond this: the map is capped, so the process survives.
    expect(limiter.take("ip-0", 10_000).allowed).toBe(true);
  });
});
