import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const scanner = resolve("scripts/check-secrets.py");

test("secret checks detect new files and forced tracked env files without leaking their values", () => {
  const directory = mkdtempSync(join(tmpdir(), "hitbite-secret-check-test-"));
  const fakeSecret = `0x${"a1".repeat(32)}`;
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: directory });
    writeFileSync(join(directory, ".gitignore"), ".env*\n!.env.example\n");
    writeFileSync(join(directory, ".env"), `PRIVATE_KEY=${fakeSecret}\n`);
    writeFileSync(join(directory, ".env.example"), "PRIVATE_KEY=\n");
    const scan = () =>
      spawnSync("python3", [scanner], { cwd: directory, encoding: "utf8" });
    assert.equal(
      scan().status,
      0,
      "ignored local .env must not be scanned or printed",
    );

    writeFileSync(
      join(directory, "new.ts"),
      `export const PRIVATE_KEY = "${fakeSecret}";\n`,
    );
    const untracked = scan();
    assert.equal(untracked.status, 1);
    assert.match(untracked.stderr, /new.ts:1/);
    assert.ok(!(untracked.stdout + untracked.stderr).includes(fakeSecret));
    rmSync(join(directory, "new.ts"));

    execFileSync("git", ["add", "--force", ".env"], { cwd: directory });
    const tracked = scan();
    assert.equal(tracked.status, 1);
    assert.match(tracked.stderr, /environment files must not be tracked/);
    assert.ok(!(tracked.stdout + tracked.stderr).includes(fakeSecret));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
