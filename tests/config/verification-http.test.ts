import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readVerificationRequest,
  readVerificationResponse,
} from "../../app/src/lib/verification-http.ts";

const request = (
  body: string,
  headers = { "Content-Type": "application/json" },
) =>
  new Request("https://test.example/api/verify", {
    method: "POST",
    headers,
    body,
  });

test("verification rejects null, arrays, invalid JSON and unknown actions", async () => {
  for (const body of ["null", "[]", "true", "{", "{}", '{"action":"other"}'])
    await assert.rejects(readVerificationRequest(request(body)), {
      status: 400,
    });
  await assert.rejects(
    readVerificationRequest(request("{}", { "Content-Type": "text/plain" })),
    { status: 415 },
  );
  assert.equal(
    (await readVerificationRequest(request('{"action":"challenge"}'))).action,
    "challenge",
  );
});

test("request limit counts UTF-8 bytes without trusting Content-Length", async () => {
  const body = JSON.stringify({ action: "challenge", name: "é".repeat(5000) });
  assert.ok(body.length < 8192);
  await assert.rejects(readVerificationRequest(request(body)), { status: 413 });
});

test("oversized chunked requests stop reading and cancel the stream", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(5000));
    },
    cancel() {
      cancelled = true;
    },
  });
  const input = new Request("https://test.example/api/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInit);
  await assert.rejects(readVerificationRequest(input), { status: 413 });
  assert.equal(cancelled, true);
});

test("firewall HTML returns a readable retry message with a bounded delay", async () => {
  await assert.rejects(
    readVerificationResponse(
      new Response("<html>Blocked</html>", {
        status: 429,
        headers: { "Retry-After": "27" },
      }),
    ),
    /Try again in 27 seconds/,
  );
  await assert.rejects(
    readVerificationResponse(
      new Response("", {
        status: 429,
        headers: { "Retry-After": "9999999" },
      }),
    ),
    /Try again in 60 seconds/,
  );
});

test("upstream errors do not expose HTML or parser details; API errors survive", async () => {
  await assert.rejects(
    readVerificationResponse(
      new Response("<html>Upstream</html>", { status: 503 }),
    ),
    /temporarily unavailable/,
  );
  await assert.rejects(
    readVerificationResponse(Response.json(null)),
    /temporarily unavailable/,
  );
  await assert.rejects(
    readVerificationResponse(
      Response.json({ error: "Ticket expired." }, { status: 400 }),
    ),
    /Ticket expired/,
  );
  assert.deepEqual(
    await readVerificationResponse(Response.json({ verified: true })),
    { verified: true },
  );
});
