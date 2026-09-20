import assert from "node:assert/strict";
import { test } from "node:test";
import { landingNav } from "../../app/src/lib/landing-nav.ts";
const now = Date.parse("2026-09-20T12:00:00Z");
test("landing NAV uses published value and hides snapshots older than 48 hours", () => {
  assert.deepEqual(
    landingNav(
      { nav_per_token: "1.0038", timestamp: "2026-09-20T10:00:00Z" },
      now,
    ),
    {
      value: "1.0038",
      timestamp: "2026-09-20T10:00:00Z",
      relative: "2 h ago",
    },
  );
  assert(
    landingNav({ nav_per_token: "1", timestamp: "2026-09-18T12:00:00Z" }, now),
  );
  assert.equal(
    landingNav({ nav_per_token: "1", timestamp: "2026-09-18T11:59:59Z" }, now),
    null,
  );
});
test("landing NAV never invents a price for missing, malformed or future data", () => {
  for (const value of [
    null,
    {},
    [],
    { nav_per_token: "1", timestamp: "invalid" },
    { nav_per_token: "1", timestamp: "2026-09-21T00:00:00Z" },
  ])
    assert.equal(landingNav(value, now), null);
  for (const nav of [0, "0", "-1", "Infinity", "NaN", "1oops", "1e300", ""])
    assert.equal(
      landingNav(
        { nav_per_token: nav, timestamp: "2026-09-20T10:00:00Z" },
        now,
      ),
      null,
    );
});
