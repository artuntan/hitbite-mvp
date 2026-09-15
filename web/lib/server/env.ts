/**
 * Server-only configuration for the verification store and the registrar worker (PLAN.md D7, D8).
 *
 * **This module must never be evaluated in a browser.** It reads `REGISTRAR_PRIVATE_KEY`, and a
 * private key that reaches a client bundle is the worst outcome this repository can produce. Three
 * things stop that, in order of when they fire:
 *
 *   1. Nothing under `lib/server/` is imported by a `"use client"` module, and
 *      `lib/server/__tests__/secrets.test.ts` walks the source tree asserting it.
 *   2. `assertServerOnly()` runs on import and throws if `window` exists, so a mistake fails at
 *      module load with a message naming the file, not silently.
 *   3. The key is never interpolated into a message. Everything that can reach an HTTP response
 *      or a log goes through `redactSecrets()`, and the key is format-checked here rather than
 *      handed to viem raw, because a library's "invalid private key: 0x…" error is a leak.
 *
 * Environment variables, all documented in `.env.example`:
 *
 *   DATABASE_URL             libSQL URL. Default `file:./.data/hitbite.db` (PLAN.md D7).
 *   DATABASE_AUTH_TOKEN      Turso token, when `DATABASE_URL` is remote.
 *   AUTO_APPROVE_DELAY_MS    Testnet auto-approval delay. Default 10000 (PLAN.md D8).
 *   REGISTRAR_WORKER_SECRET  Shared secret for `POST /api/verify/process`. Optional; see below.
 *   REGISTRAR_PRIVATE_KEY    Testnet key holding REGISTRAR_ROLE. Server-side, never public.
 */

import path from "node:path";

/** What `redactSecrets` leaves behind. Deliberately not the right length to be mistaken for one. */
export const REDACTED = "[redacted]";

/** Bounds on `AUTO_APPROVE_DELAY_MS`: instant is allowed, an hour is the ceiling. */
export const MIN_AUTO_APPROVE_DELAY_MS = 0;
export const MAX_AUTO_APPROVE_DELAY_MS = 3_600_000;
export const DEFAULT_AUTO_APPROVE_DELAY_MS = 10_000;

export const DEFAULT_DATABASE_URL = "file:./.data/hitbite.db";

/** A worker secret shorter than this is a typo, not a secret, and is refused rather than used. */
export const MIN_WORKER_SECRET_LENGTH = 16;

export class ServerConfigError extends Error {
  readonly hint: string;

  constructor(message: string, hint: string) {
    super(message);
    this.name = "ServerConfigError";
    this.hint = hint;
  }
}

/**
 * Throw if this module is being evaluated anywhere with a `window`.
 *
 * Next would normally fail the build first — `lib/server/store.ts` imports `node:fs` — but this
 * check does not depend on the bundler noticing, and it names the file that did it.
 */
export function assertServerOnly(moduleName = "lib/server/env.ts"): void {
  if (typeof window !== "undefined") {
    throw new Error(
      `${moduleName} was imported into a browser bundle. It reads REGISTRAR_PRIVATE_KEY and must ` +
        "stay on the server: import it only from a route handler or a server component, and pass " +
        "plain data to client components.",
    );
  }
}

assertServerOnly();

// --------------------------------------------------------------------------- redaction

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every configured secret value, plus the bare-hex form of anything `0x`-prefixed, so a key that
 * is echoed without its prefix is still caught. Read fresh on every call: the environment is read
 * at runtime, not inlined at build time, and tests change it between cases.
 */
function secretFragments(): string[] {
  const fragments: string[] = [];
  for (const raw of [
    process.env.REGISTRAR_PRIVATE_KEY,
    process.env.DATABASE_AUTH_TOKEN,
    process.env.REGISTRAR_WORKER_SECRET,
  ]) {
    const value = raw?.trim();
    // Below 8 characters a "secret" is not one, and redacting a short string would blank out
    // ordinary words in an error message.
    if (!value || value.length < 8) continue;
    fragments.push(value);
    if (value.startsWith("0x") || value.startsWith("0X")) fragments.push(value.slice(2));
  }
  return fragments;
}

/**
 * Replace every configured secret in `text` with `[redacted]`, case-insensitively.
 *
 * Exact values only. A blanket "redact any 32-byte hex string" rule would also blank out every
 * transaction hash, and the transaction hash is the one thing a reviewer most wants to see in
 * the response. Precision here is what lets the rest of the output stay useful.
 */
export function redactSecrets(text: string): string {
  let result = text;
  for (const fragment of secretFragments()) {
    result = result.replace(new RegExp(escapeForRegExp(fragment), "gi"), REDACTED);
  }
  return result;
}

/** An error as a single redacted line, with no stack trace. Use this for anything user-visible. */
export function describeError(error: unknown): string {
  const message =
    error instanceof Error
      ? (error.message ?? "").split("\n")[0]?.trim() || error.name
      : String(error);
  return redactSecrets(message || "unexpected error");
}

// --------------------------------------------------------------------------- store location

export type StorageKind = "file" | "memory" | "remote";

export interface StorageDescriptor {
  readonly kind: StorageKind;
  /** The URL with any credentials removed — safe to put in a response or a log. */
  readonly display: string;
  /** True when a write can be lost without anyone doing anything wrong. */
  readonly ephemeral: boolean;
  /** Said plainly, because pretending a file on Vercel persists would be a lie (PLAN.md D7). */
  readonly note: string;
}

/** `libsql://name-org.turso.io?authToken=…` → `libsql://name-org.turso.io`. */
function displayUrl(url: string): string {
  const withoutQuery = url.split("?")[0] ?? url;
  return withoutQuery.replace(/\/\/[^/@]*@/, "//");
}

export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
}

export function getDatabaseAuthToken(): string | undefined {
  const token = process.env.DATABASE_AUTH_TOKEN?.trim();
  return token ? token : undefined;
}

/** True on Vercel, where a file store is per-instance and thrown away. */
function isServerlessHost(): boolean {
  return Boolean(process.env.VERCEL) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * Where verification requests live, and whether that survives the next request.
 *
 * The honest version of PLAN.md D7: the default file store is right for local work, CI and Docker,
 * and wrong on Vercel, where each invocation may get a different instance with a different
 * filesystem. The fix is one environment variable, and this says so wherever it is rendered.
 */
export function describeStorage(): StorageDescriptor {
  const url = getDatabaseUrl();
  const display = displayUrl(url);

  if (url.startsWith("file:") || url === ":memory:" || url.startsWith("file::memory:")) {
    const memory = url.includes(":memory:");
    if (memory) {
      return {
        kind: "memory",
        display,
        ephemeral: true,
        note: "Verification requests are held in memory and disappear when this process exits. This is the test and preview setting, not a store.",
      };
    }
    if (isServerlessHost()) {
      return {
        kind: "file",
        display,
        ephemeral: true,
        note:
          `DATABASE_URL is a local file (${display}) on a serverless host. Each instance gets its own ` +
          "filesystem and it is discarded, so a request written by one invocation may be invisible to " +
          "the next and every request is lost on redeploy. Verification still works end to end — the " +
          "registry on chain is the record that matters — but the pending queue will not persist. Set " +
          "DATABASE_URL to a Turso `libsql://` URL and DATABASE_AUTH_TOKEN to fix it (PLAN.md D7).",
      };
    }
    return {
      kind: "file",
      display,
      ephemeral: false,
      note: `Verification requests are stored in ${display}, relative to ${path.basename(process.cwd())}/. The file persists on this machine and is not shared with any other deployment.`,
    };
  }

  return {
    kind: "remote",
    display,
    ephemeral: false,
    note: `Verification requests are stored in the libSQL database at ${display}.`,
  };
}

// --------------------------------------------------------------------------- worker settings

export function getAutoApproveDelayMs(): number {
  const raw = process.env.AUTO_APPROVE_DELAY_MS?.trim();
  if (!raw) return DEFAULT_AUTO_APPROVE_DELAY_MS;
  if (!/^\d+$/.test(raw)) {
    throw new ServerConfigError(
      `AUTO_APPROVE_DELAY_MS="${raw}" is not a whole number of milliseconds.`,
      `Set it to a value between ${MIN_AUTO_APPROVE_DELAY_MS} and ${MAX_AUTO_APPROVE_DELAY_MS}, or unset it for the ${DEFAULT_AUTO_APPROVE_DELAY_MS} ms default.`,
    );
  }
  const value = Number(raw);
  if (value < MIN_AUTO_APPROVE_DELAY_MS || value > MAX_AUTO_APPROVE_DELAY_MS) {
    throw new ServerConfigError(
      `AUTO_APPROVE_DELAY_MS=${value} is outside the accepted range.`,
      `Use ${MIN_AUTO_APPROVE_DELAY_MS}..${MAX_AUTO_APPROVE_DELAY_MS} ms. The delay exists to make the pending state visible on the demo, not to gate anything.`,
    );
  }
  return value;
}

export type WorkerAuthMode =
  /** A secret is configured: `POST /api/verify/process` requires it. */
  | { readonly mode: "secret" }
  /** No secret is configured: the endpoint is open, and bounded by everything else. */
  | { readonly mode: "open" }
  /** A secret is configured but unusable, which is refused rather than silently ignored. */
  | { readonly mode: "misconfigured"; readonly reason: string };

export function getWorkerAuthMode(): WorkerAuthMode {
  const raw = process.env.REGISTRAR_WORKER_SECRET;
  if (raw === undefined || raw.trim() === "") return { mode: "open" };
  if (raw.trim().length < MIN_WORKER_SECRET_LENGTH) {
    return {
      mode: "misconfigured",
      reason: `REGISTRAR_WORKER_SECRET is set but shorter than ${MIN_WORKER_SECRET_LENGTH} characters, which is a typo rather than a secret. The worker endpoint refuses every call until it is fixed or unset.`,
    };
  }
  return { mode: "secret" };
}

/**
 * Constant-time comparison of a presented secret against the configured one.
 *
 * Returns false when nothing is configured: callers must check `getWorkerAuthMode()` first and
 * decide what an unconfigured secret means, rather than have this function answer "true, there is
 * no password".
 */
export function workerSecretMatches(presented: string | null | undefined): boolean {
  const expected = process.env.REGISTRAR_WORKER_SECRET?.trim();
  if (!expected || expected.length < MIN_WORKER_SECRET_LENGTH) return false;
  if (!presented) return false;

  const a = Buffer.from(presented.trim(), "utf8");
  const b = Buffer.from(expected, "utf8");
  // Compare every byte of the longer buffer so the loop's duration does not depend on where the
  // first difference is. Lengths are compared afterwards, not as an early return.
  let diff = a.length === b.length ? 0 : 1;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

// --------------------------------------------------------------------------- registrar key

export type RegistrarKeyStatus =
  | { readonly status: "configured" }
  | { readonly status: "missing"; readonly reason: string }
  | { readonly status: "malformed"; readonly reason: string };

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/**
 * Whether a usable registrar key is configured — **without returning it**.
 *
 * Every status string here is a constant. Nothing derived from the value, not even its length, is
 * reported: "the key is 63 characters" is a small leak and there is no reason to take it.
 */
export function getRegistrarKeyStatus(): RegistrarKeyStatus {
  const raw = process.env.REGISTRAR_PRIVATE_KEY?.trim();
  if (!raw) {
    return {
      status: "missing",
      reason:
        "REGISTRAR_PRIVATE_KEY is not set, so nothing can be verified on chain. Requests are still recorded and stay pending. Set the testnet key that holds REGISTRAR_ROLE (see .env.example) to enable auto-approval.",
    };
  }
  if (!PRIVATE_KEY_PATTERN.test(raw)) {
    return {
      status: "malformed",
      reason:
        "REGISTRAR_PRIVATE_KEY is set but is not a 0x-prefixed 32-byte hex string, so it is refused without being used. The value is not echoed here or anywhere else.",
    };
  }
  return { status: "configured" };
}

/**
 * The registrar key, or `null`.
 *
 * The only caller is `lib/server/chain.ts`, which turns it straight into a viem account. Format is
 * checked here so that viem is never handed a malformed value it might quote back in an error.
 */
export function getRegistrarPrivateKey(): `0x${string}` | null {
  const raw = process.env.REGISTRAR_PRIVATE_KEY?.trim();
  if (!raw || !PRIVATE_KEY_PATTERN.test(raw)) return null;
  return raw as `0x${string}`;
}
