/**
 * Server configuration: the worker delay, the worker secret's three states, and the sentence the
 * store tells the truth with (PLAN.md D7, D8).
 *
 * The storage descriptor is the one place this project says out loud that the default file store
 * does not persist on Vercel, so what it says is pinned here. A note that quietly stopped
 * rendering would leave a founder believing a queue survives a deploy when it does not.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_AUTO_APPROVE_DELAY_MS,
  describeStorage,
  getAutoApproveDelayMs,
  getWorkerAuthMode,
  MAX_AUTO_APPROVE_DELAY_MS,
  ServerConfigError,
} from "../env";

const SAVED = { ...process.env };

beforeEach(() => {
  for (const key of [
    "AUTO_APPROVE_DELAY_MS",
    "DATABASE_URL",
    "DATABASE_AUTH_TOKEN",
    "REGISTRAR_WORKER_SECRET",
    "VERCEL",
  ]) {
    delete process.env[key];
  }
});

afterEach(() => {
  process.env = { ...SAVED };
});

describe("AUTO_APPROVE_DELAY_MS", () => {
  it("defaults to ten seconds (PLAN.md D8)", () => {
    expect(getAutoApproveDelayMs()).toBe(DEFAULT_AUTO_APPROVE_DELAY_MS);
    expect(DEFAULT_AUTO_APPROVE_DELAY_MS).toBe(10_000);
  });

  it("takes a configured value, including zero", () => {
    process.env.AUTO_APPROVE_DELAY_MS = "0";
    expect(getAutoApproveDelayMs()).toBe(0);

    process.env.AUTO_APPROVE_DELAY_MS = "2500";
    expect(getAutoApproveDelayMs()).toBe(2_500);
  });

  it("refuses a value that is not a whole number of milliseconds", () => {
    process.env.AUTO_APPROVE_DELAY_MS = "10s";
    expect(() => getAutoApproveDelayMs()).toThrow(ServerConfigError);

    process.env.AUTO_APPROVE_DELAY_MS = "-1";
    expect(() => getAutoApproveDelayMs()).toThrow(ServerConfigError);
  });

  it("refuses a delay nobody would sit through", () => {
    process.env.AUTO_APPROVE_DELAY_MS = String(MAX_AUTO_APPROVE_DELAY_MS + 1);
    expect(() => getAutoApproveDelayMs()).toThrow(/outside the accepted range/);
  });
});

describe("the worker secret's mode", () => {
  it("is open when none is configured, which is the local default", () => {
    expect(getWorkerAuthMode()).toEqual({ mode: "open" });

    process.env.REGISTRAR_WORKER_SECRET = "   ";
    expect(getWorkerAuthMode()).toEqual({ mode: "open" });
  });

  it("requires the secret once one is set", () => {
    process.env.REGISTRAR_WORKER_SECRET = "a-secret-long-enough-to-be-one";
    expect(getWorkerAuthMode()).toEqual({ mode: "secret" });
  });

  it("refuses to run half-secured on a secret that is really a typo", () => {
    process.env.REGISTRAR_WORKER_SECRET = "hunter2";
    const mode = getWorkerAuthMode();

    expect(mode.mode).toBe("misconfigured");
    if (mode.mode === "misconfigured") expect(mode.reason).toMatch(/shorter than 16/);
  });
});

describe("where the store lives, said plainly", () => {
  it("defaults to a local file and describes it as persistent on a machine", () => {
    const storage = describeStorage();

    expect(storage.kind).toBe("file");
    expect(storage.ephemeral).toBe(false);
    expect(storage.display).toBe("file:./.data/hitbite.db");
    expect(storage.note).toMatch(/persists on this machine/);
  });

  it("says a file store on Vercel is thrown away, and names the fix", () => {
    process.env.VERCEL = "1";
    const storage = describeStorage();

    expect(storage.ephemeral).toBe(true);
    expect(storage.note).toMatch(/lost on redeploy/);
    expect(storage.note).toMatch(/Turso/);
    expect(storage.note).toMatch(/DATABASE_URL/);
  });

  it("recognises a remote libSQL database and never prints its credentials", () => {
    process.env.DATABASE_URL = "libsql://hitbite-demo.turso.io?authToken=super-secret-token";
    const storage = describeStorage();

    expect(storage.kind).toBe("remote");
    expect(storage.ephemeral).toBe(false);
    expect(storage.display).toBe("libsql://hitbite-demo.turso.io");
    expect(storage.note).not.toContain("super-secret-token");
  });

  it("calls an in-memory database what it is", () => {
    process.env.DATABASE_URL = ":memory:";
    const storage = describeStorage();

    expect(storage.kind).toBe("memory");
    expect(storage.ephemeral).toBe(true);
    expect(storage.note).toMatch(/disappear/);
  });
});
