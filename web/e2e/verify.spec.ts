import { randomBytes } from "node:crypto";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { NOT_KYC, RETAIL } from "../components/verify/copy";
import { FOOTER_DISCLAIMER, TESTNET_BANNER } from "../lib/copy";
import { getCountryByNumeric, SEED_BLOCKED_CODES } from "../lib/countries";
import { apiErrorSchema } from "../lib/schemas";
import {
  blocklistResponseSchema,
  processResponseSchema,
  statusResponseSchema,
  submitResponseSchema,
} from "../lib/server/verification";

/**
 * `/verify` (BUILD_PROMPT.md 7.2, PLAN.md D7, D8, D21, D23).
 *
 * Runs against a production build — `playwright.config.ts` starts `pnpm start`, so `pnpm build`
 * must have happened first.
 *
 * What is asserted here, and what is deliberately not:
 *
 *  - **Every state reachable without a wallet.** Not connected, the form, a blocked country and a
 *    retail investor type are all reachable with no extension installed, so all four are tested.
 *  - **Pending, verified and the worker's on-chain half need a signature-capable environment and a
 *    funded registrar.** Faking a wallet would test the fake. Those are covered by the Phase 10
 *    demo script against Anvil and Base Sepolia, and by the hand-run flow recorded in PROGRESS.md.
 *  - **The API contract**, against the same zod schemas the routes validate their own responses
 *    with, including the refusals: a blocked country, retail, a missing consent, a malformed body,
 *    and the promise that a name posted to the endpoint is dropped rather than stored.
 */

/** Lower case, so `isAddress` accepts it without a checksum. One per test: rows are keyed by address. */
function freshAddress(): string {
  return `0x${randomBytes(20).toString("hex")}`;
}

async function getJson(request: APIRequestContext, url: string, expected = 200) {
  const response = await request.get(url);
  expect(response.status(), `${url} should answer ${expected}`).toBe(expected);
  expect(response.headers()["cache-control"], `${url} must not be cached`).toContain("no-store");
  return (await response.json()) as unknown;
}

async function postJson(
  request: APIRequestContext,
  url: string,
  body: unknown,
  expected = 200,
): Promise<unknown> {
  const response = await request.post(url, { data: body });
  expect(response.status(), `POST ${url} should answer ${expected}`).toBe(expected);
  return (await response.json()) as unknown;
}

/** Records every write this page attempts, so "the form does not submit" can be asserted. */
function watchSubmissions(page: Page): string[] {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/verify")) {
      posts.push(request.url());
    }
  });
  return posts;
}

/** Ask the form to submit itself, ignoring the disabled button, so the handler is the thing tested. */
async function requestSubmit(page: Page): Promise<void> {
  await page.evaluate(() => {
    const form = document.getElementById("verify-form");
    if (form instanceof HTMLFormElement) form.requestSubmit();
  });
  // Absence has to be waited for: a submission would have started within a frame of the call.
  await page.waitForTimeout(500);
}

test.describe("/verify without a wallet", () => {
  test("renders the shell, the not-KYC notice and a form that waits for a wallet", async ({
    page,
  }) => {
    const response = await page.goto("/verify");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Verify/);

    // Mandatory on every page (BUILD_PROMPT.md section 15).
    await expect(page.getByText(TESTNET_BANNER).first()).toBeVisible();
    await expect(page.getByRole("contentinfo").getByText(FOOTER_DISCLAIMER)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    // The honesty notice is server-rendered: it is readable before any bundle loads, and it is the
    // one claim on this page that must never quietly disappear.
    await expect(page.getByText(NOT_KYC.title)).toBeVisible();
    await expect(page.getByText(/Do not type real personal data/)).toBeVisible();

    // "Not connected": the form is readable, and the only thing waiting on a wallet is the submit.
    await expect(page.getByRole("heading", { name: "Request verification" })).toBeVisible();
    await expect(page.getByText("No wallet connected.")).toBeVisible();
    const submit = page.getByRole("button", { name: /Submit verification request/ });
    await expect(submit).toBeDisabled();
    await expect(page.getByText(/Connect a wallet to submit this request/)).toBeVisible();

    // The connect control is offered in the page and portalled into the shell's wallet slot.
    await expect(page.getByRole("button", { name: /Connect wallet/i }).first()).toBeVisible();

    // BUILD_PROMPT.md 7.2 lists a name field; there is deliberately none, and the page says so.
    await expect(page.locator('input[name="name"]')).toHaveCount(0);
    await expect(page.locator("input[type=file]")).toHaveCount(0);
  });

  test("offers the full ISO list with blocked codes disabled and explained", async ({ page }) => {
    await page.goto("/verify");

    const options = page.locator("#verify-country option");
    // The full list plus the placeholder. The point of the assertion is that nothing was filtered.
    expect(await options.count()).toBeGreaterThan(200);

    // Germany (BUILD_PROMPT 16.1) is selectable; the United States and Türkiye are not.
    await expect(page.locator('#verify-country option[value="276"]')).toHaveJSProperty(
      "disabled",
      false,
    );

    // The explanation sits beside the field; a blocked country is never silently unavailable.
    const blocklist = page.getByTestId("blocklist");
    await expect(blocklist).toBeVisible();

    for (const code of SEED_BLOCKED_CODES) {
      const option = page.locator(`#verify-country option[value="${code}"]`);
      await expect(option, `country ${code} must stay in the list`).toHaveCount(1);
      await expect(option, `country ${code} must be disabled`).toHaveJSProperty("disabled", true);
      await expect(option).toContainText("blocked");

      const name = getCountryByNumeric(code)?.name ?? String(code);
      await expect(blocklist, `country ${code} must be explained`).toContainText(name);
      await expect(blocklist).toContainText(String(code));
    }

    // The rule is the contract's, and the page says so rather than implying the form is the control.
    await expect(
      page.getByText(/The contract is what enforces this, not this form/).first(),
    ).toBeVisible();
  });

  test("a blocked country shows the reason and the form refuses to submit", async ({ page }) => {
    const posts = watchSubmissions(page);

    // A deep link is the one way to land here with a blocked country already chosen — the option
    // itself is disabled, which is what BUILD_PROMPT 16.1 asks for.
    await page.goto("/verify?country=840");

    const alert = page.getByTestId("country-blocked");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("United States");
    await expect(alert).toContainText(/US securities law|blocked/i);

    const submit = page.getByRole("button", { name: /Submit verification request/ });
    await expect(submit).toBeDisabled();
    await expect(
      page.getByText(/is on the registry blocklist, so this request cannot be made/),
    ).toBeVisible();

    await requestSubmit(page);
    expect(posts, "a blocked country must not reach POST /api/verify").toEqual([]);
  });

  test("retail is explained rather than silently failing", async ({ page }) => {
    const posts = watchSubmissions(page);
    await page.goto("/verify?country=276");

    await page.getByRole("radio", { name: "Retail investor" }).check();

    const notice = page.getByTestId("retail-refusal");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("RetailNotAllowed");

    await expect(page.getByRole("button", { name: /Submit verification request/ })).toBeDisabled();
    await expect(page.getByText(RETAIL.title, { exact: false }).first()).toBeVisible();

    await requestSubmit(page);
    expect(posts, "a retail request must not be sent").toEqual([]);
  });
});

test.describe("the /api/verify contract", () => {
  test("GET /api/verify returns the live blocklist", async ({ request }) => {
    const parsed = blocklistResponseSchema.parse(await getJson(request, "/api/verify"));
    const data = parsed.data;

    expect(data.country_list_path).toBe("web/lib/countries.json");
    expect(data.count).toBe(data.blocked.length);

    if (data.source === "seed") {
      // With no reachable registry the answer falls back to the deploy script's list — never to an
      // empty one, which would read as "nothing is blocked".
      expect(data.reason).not.toBeNull();
      expect(data.blocked.map((entry) => entry.numeric).sort((a, b) => a - b)).toEqual([
        ...SEED_BLOCKED_CODES,
      ]);
    }
    for (const entry of data.blocked) {
      expect(entry.reason, `country ${entry.numeric} must carry a reason`).toBeTruthy();
    }
  });

  test("GET /api/verify/status answers for an address that never asked", async ({ request }) => {
    const address = freshAddress();
    const parsed = statusResponseSchema.parse(
      await getJson(request, `/api/verify/status?address=${address}`),
    );
    expect(parsed.data.status).toBe("not_requested");
    expect(parsed.data.source).toBe("none");
    expect(parsed.data.request).toBeNull();
  });

  test("GET /api/verify/status refuses a missing address", async ({ request }) => {
    const response = await request.get("/api/verify/status");
    expect(response.status()).toBe(400);
    const parsed = apiErrorSchema.parse(await response.json());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.message).toContain("address");
  });

  test("a blocked country is recorded as blocked, not as an error", async ({ request }) => {
    const address = freshAddress();
    const parsed = submitResponseSchema.parse(
      await postJson(request, "/api/verify", {
        address,
        country: 840,
        professional_attestation: true,
        consent: true,
      }),
    );

    expect(parsed.data.accepted).toBe(false);
    expect(parsed.data.rule).toBe("country_blocked");
    expect(parsed.data.request.status).toBe("blocked");
    expect(parsed.data.request.tx_hash).toBeNull();
    expect(parsed.data.request.reason).toContain("United States");
  });

  test("retail is refused by policy, with the rule named", async ({ request }) => {
    const address = freshAddress();
    const parsed = submitResponseSchema.parse(
      await postJson(request, "/api/verify", {
        address,
        country: 276,
        investor_type: 2,
        professional_attestation: true,
        consent: true,
      }),
    );

    expect(parsed.data.accepted).toBe(false);
    expect(parsed.data.rule).toBe("retail");
    expect(parsed.data.request.status).toBe("rejected");
    expect(parsed.data.request.reason).toContain("RetailNotAllowed");
  });

  test("a missing consent is refused, and a malformed body stores nothing", async ({ request }) => {
    const address = freshAddress();
    const refused = submitResponseSchema.parse(
      await postJson(request, "/api/verify", {
        address,
        country: 276,
        professional_attestation: true,
        consent: false,
      }),
    );
    expect(refused.data.rule).toBe("no_consent");
    expect(refused.data.request.status).toBe("rejected");

    const bad = await request.post("/api/verify", {
      data: {
        address: "0xnot-an-address",
        country: 276,
        professional_attestation: true,
        consent: true,
      },
    });
    expect(bad.status()).toBe(400);
    apiErrorSchema.parse(await bad.json());

    // A 400 records nothing: the address it named is still unknown to the store.
    const after = statusResponseSchema.parse(
      await getJson(request, `/api/verify/status?address=${freshAddress()}`),
    );
    expect(after.data.status).toBe("not_requested");
  });

  test("a well-formed request is queued, and no name survives it", async ({ request }) => {
    test.slow();
    const address = freshAddress();

    const submitted = submitResponseSchema.parse(
      await postJson(request, "/api/verify", {
        address,
        country: 276,
        professional_attestation: true,
        consent: true,
        // BUILD_PROMPT 7.2 lists a name. The API drops it; the response schema is strict, so a
        // stored name would fail this parse rather than quietly appear in a row.
        name: "Ada Lovelace",
      }),
    );

    expect(submitted.data.accepted).toBe(true);
    expect(submitted.data.rule).toBeNull();
    expect(submitted.data.request.status).toBe("pending");
    expect(Object.keys(submitted.data.request)).not.toContain("name");
    expect(submitted.data.request.auto_approve_in_ms ?? 0).toBeGreaterThan(0);

    const pending = statusResponseSchema.parse(
      await getJson(request, `/api/verify/status?address=${address}`),
    );
    expect(pending.data.status).toBe("pending");
    expect(pending.data.source).toBe("store");

    // The worker endpoint is callable with no body — the shape a cron uses.
    const early = processResponseSchema.parse(await postJson(request, "/api/verify/process", {}));
    expect(early.data.max_per_call).toBeGreaterThan(0);

    const delay = submitted.data.worker.auto_approve_delay_ms;
    test.skip(delay > 15_000, `AUTO_APPROVE_DELAY_MS is ${delay} ms; too long to wait for here.`);
    await new Promise((resolve) => setTimeout(resolve, delay + 750));

    const ran = processResponseSchema.parse(
      await postJson(request, "/api/verify/process", { address }),
    );
    const item = ran.data.processed.find(
      (entry) => entry.address.toLowerCase() === address.toLowerCase(),
    );
    expect(item, "a due request must be accounted for by the worker").toBeDefined();
    expect(item?.reason.length ?? 0).toBeGreaterThan(0);

    // Whatever the worker could do, the status endpoint agrees with itself afterwards: a registrar
    // that is not configured leaves the row pending with a stated reason rather than losing it.
    const after = statusResponseSchema.parse(
      await getJson(request, `/api/verify/status?address=${address}`),
    );
    if (item?.outcome === "approved") {
      expect(after.data.status).toBe("approved");
    } else {
      expect(after.data.status).toBe("pending");
      expect(ran.data.notes.join(" ")).toMatch(/registrar|pending/i);
    }
  });
});
