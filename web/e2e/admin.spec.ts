import { randomBytes } from "node:crypto";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { GATE_IS_NOT_A_BOUNDARY, PAUSE_CLAIM_WARNING } from "../components/admin/copy";
import { ADMIN_ACTIONS, ROLES } from "../components/admin/roles";
import { adminRejectMessage } from "../components/admin/queue";
import { ACTIVE_CHAIN, hasDeployment } from "../lib/chains";
import { FOOTER_DISCLAIMER, TESTNET_BANNER, TOKEN } from "../lib/copy";
import { apiErrorSchema } from "../lib/schemas";

/**
 * `/admin` (BUILD_PROMPT.md 7.2), without a wallet.
 *
 * **No wallet is faked.** Injecting an EIP-1193 stub would test the stub: the signature paths are
 * covered by `lib/tx.test.ts` and by the hand-run flow against a local chain recorded in
 * `PROGRESS.md`. What is worth asserting from a browser is everything a person sees *before* they
 * connect one — which, on this page, is most of what it is for:
 *
 *  - it renders, with the mandatory testnet chrome and no console errors;
 *  - it explains the roles: every action against the role and the contract that defines it, and
 *    the plain statement that the gate is a convenience rather than a boundary;
 *  - the encoded call is on screen for every action, before anything is signed, including on a
 *    network with no recorded deployment;
 *  - the typed-confirmation requirement is stated on every destructive action;
 *  - the rules that are easy to get wrong — what a pause stops, what blocking a country does to
 *    existing holders, that NAV falls at distribution — are on the page rather than in a document.
 *
 * The queue's security boundary is asserted against the real endpoint: a rejection without a valid
 * signature from a REGISTRAR_ROLE holder is refused, and the refusal is a sentence.
 *
 * Runs against a production build: `playwright.config.ts` starts `pnpm start`, so `pnpm build` must
 * come first.
 */

/** Whether the chain this build points at has a recorded deployment. */
const DEPLOYED = hasDeployment();

function collectPageProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

function freshAddress(): string {
  return `0x${randomBytes(20).toString("hex")}`;
}

/** 65 bytes of nothing. Shaped like a signature, recovers to nobody who holds a role. */
function bogusSignature(): string {
  return `0x${randomBytes(65).toString("hex")}`;
}

async function getJson(request: APIRequestContext, url: string, expected = 200) {
  const response = await request.get(url);
  expect(response.status(), `${url} should answer ${expected}`).toBe(expected);
  expect(response.headers()["cache-control"], `${url} must not be cached`).toContain("no-store");
  return (await response.json()) as unknown;
}

test.describe("/admin without a wallet", () => {
  test("renders, with the testnet chrome and no console errors", async ({ page }) => {
    const problems = collectPageProblems(page);

    const response = await page.goto("/admin");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Admin/);

    await expect(page.getByText(TESTNET_BANNER)).toBeVisible();
    await expect(page.getByText(FOOTER_DISCLAIMER)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Admin console", level: 1 })).toBeVisible();

    // The page says, in as many words, that hiding a button is not a security control.
    await expect(page.getByText(GATE_IS_NOT_A_BOUNDARY).first()).toBeVisible();

    expect(problems, "the page must render without console errors").toEqual([]);
  });

  test("explains every role and which action needs it", async ({ page }) => {
    await page.goto("/admin");

    const panel = page.getByTestId("roles-panel");
    await expect(panel).toBeVisible();

    // No wallet is a state with an explanation, not an empty panel.
    await expect(page.getByTestId("roles-no-wallet")).toBeVisible();

    // Every action is listed with the call it sends and the role that gates it.
    for (const action of ADMIN_ACTIONS) {
      await expect(panel.getByText(action.label).first()).toBeVisible();
      await expect(panel.getByText(action.call, { exact: true }).first()).toBeVisible();
    }

    // The five roles, and the fact that the two admin roles are two different grants.
    const constants = new Set(ROLES.map((role) => role.constant));
    for (const constant of constants) {
      await expect(panel.getByText(constant, { exact: false }).first()).toBeVisible();
    }
    await expect(panel.getByText(/HBToken/).first()).toBeVisible();
    await expect(panel.getByText(/IdentityRegistry/).first()).toBeVisible();
  });

  test("shows the encoded call for every action before anything is signed", async ({ page }) => {
    await page.goto("/admin");

    const panels = page.getByTestId("encoded-call");
    // One per action card. The count is not pinned to a number so adding an action does not break
    // this test for the wrong reason.
    expect(await panels.count()).toBeGreaterThanOrEqual(6);

    // Pause takes no arguments, so its calldata is complete the moment the page loads — which makes
    // it the one panel that can be checked exactly, with or without a deployment.
    const pauseCard = page.getByTestId("action-pause");
    await expect(pauseCard).toBeVisible();
    const pausePanel = pauseCard.getByTestId("encoded-call");
    await expect(pausePanel.getByText("pause()", { exact: true })).toBeVisible();
    // `cast sig "pause()"`.
    await expect(pausePanel.getByText("0x8456cb59", { exact: true }).first()).toBeVisible();

    if (DEPLOYED) {
      await expect(pausePanel.getByText(/^0x[0-9a-fA-F]{40}$/)).toBeVisible();
    } else {
      // A network with no deployment still gets the calldata; what it does not get is a destination,
      // and the panel says so rather than showing an empty row.
      await expect(pausePanel.getByText(/no deployment is recorded/)).toBeVisible();
    }
  });

  test("states the typed-confirmation requirement on every destructive action", async ({
    page,
  }) => {
    await page.goto("/admin");

    const notes = page.getByTestId("typed-confirmation");
    expect(await notes.count()).toBeGreaterThanOrEqual(4);

    for (const phrase of ["PAUSE", "MINT", "BURN", "DISTRIBUTE"]) {
      await expect(
        page.getByTestId("typed-confirmation").filter({ hasText: phrase }).first(),
      ).toBeVisible();
    }

    // Forcing a NAV is the most serious thing here, and the phrase is named on the page whether or
    // not the box is ticked.
    await expect(page.getByText(/type\s+FORCE NAV/).first()).toBeVisible();
  });

  test("carries the rules that are easy to get wrong", async ({ page }) => {
    await page.goto("/admin");

    // A pause stops coupon claims. This is the sentence an operator must read before clicking.
    await expect(page.getByText(PAUSE_CLAIM_WARNING)).toBeVisible();
    await expect(
      page
        .getByTestId("action-pause")
        .getByText(/claimCoupon/)
        .first(),
    ).toBeVisible();

    // Blocking a country does not delete records; it flips canHold.
    const blocklist = page.getByTestId("action-blocklist");
    await expect(blocklist.getByText(/does not delete/i).first()).toBeVisible();
    await expect(blocklist.getByText(/canHold/).first()).toBeVisible();

    // NAV falls by the per-token amount at distribution.
    await expect(
      page
        .getByTestId("action-distribute")
        .getByText(/NAV falls by the per-token amount/)
        .first(),
    ).toBeVisible();

    // Minting creates no USDC and the ratio falls immediately.
    await expect(
      page
        .getByTestId("action-mint")
        .getByText(/creates tokens and no USDC/i)
        .first(),
    ).toBeVisible();
  });

  test("encodes what is typed into a form, argument by argument", async ({ page }) => {
    await page.goto("/admin");

    const burn = page.getByTestId("action-burn");
    const holder = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    await burn.getByLabel("Holder").fill(holder);
    await burn.getByLabel("Amount").fill("1.0");

    const panel = burn.getByTestId("encoded-call");
    await expect(panel.getByText("burn(address,uint256)", { exact: true })).toBeVisible();
    // `cast sig "burn(address,uint256)"`.
    await expect(panel.getByText("0x9dc29fac", { exact: true }).first()).toBeVisible();
    // The 18-decimal integer the contract will store, beside the human amount.
    await expect(panel.getByText("= 1000000000000000000")).toBeVisible();
    await expect(panel.getByText(new RegExp(holder, "i")).first()).toBeVisible();
  });

  test("names the token and the network it operates", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByText(ACTIVE_CHAIN.label).first()).toBeVisible();
    await expect(page.getByText(new RegExp(TOKEN.symbol)).first()).toBeVisible();
  });

  test("renders the verification queue, or says why it cannot", async ({ page }) => {
    await page.goto("/admin");

    const card = page.getByTestId("queue-card");
    await expect(card).toBeVisible();
    await expect(card.getByText(/POST \/api\/verify\/process/).first()).toBeVisible();

    // Either the queue loaded (empty or not) or it reported a failure. All three are states with a
    // sentence; none of them is a blank panel.
    await expect(
      card
        .getByTestId("queue-empty")
        .or(card.getByRole("region", { name: "Pending verification requests" }))
        .or(card.getByText(/The queue could not be read/)),
    ).toBeVisible();
  });
});

test.describe("the admin queue endpoint", () => {
  test("serves the pending queue with its own limitations stated", async ({ request }) => {
    const body = (await getJson(request, "/admin/api/queue")) as {
      ok: boolean;
      data: {
        pending: unknown[];
        counts: Record<string, number>;
        notes: string[];
        worker: { endpoint: string };
        limit: number;
      };
    };

    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data.pending)).toBe(true);
    expect(body.data.limit).toBeGreaterThan(0);
    expect(body.data.worker.endpoint).toBe("/api/verify/process");
    expect(Object.keys(body.data.counts).sort()).toEqual([
      "approved",
      "blocked",
      "pending",
      "rejected",
    ]);
    // It says what it holds about people, because the answer is "almost nothing" and that is worth
    // being explicit about.
    expect(body.data.notes.join(" ")).toMatch(/no name and no other personal data/i);
  });

  test("refuses a rejection that is not signed by a REGISTRAR_ROLE holder", async ({ request }) => {
    const response = await request.post("/admin/api/queue", {
      data: {
        address: freshAddress(),
        reason: "A reason long enough to pass the length check.",
        issued_at: new Date().toISOString(),
        signer: freshAddress(),
        signature: bogusSignature(),
      },
    });

    // 401 when the signature does not recover, 503 when the registry cannot be asked at all. Both
    // are refusals; neither writes anything.
    expect([401, 503]).toContain(response.status());
    const parsed = apiErrorSchema.parse(await response.json());
    expect(parsed.error.message.length).toBeGreaterThan(0);
    expect(parsed.error.hint.length).toBeGreaterThan(0);
  });

  test("refuses a malformed rejection before it looks at any signature", async ({ request }) => {
    const missingFields = await request.post("/admin/api/queue", { data: { address: "0x1" } });
    expect(missingFields.status()).toBe(400);
    apiErrorSchema.parse(await missingFields.json());

    const emptyReason = await request.post("/admin/api/queue", {
      data: {
        address: freshAddress(),
        reason: "  ",
        issued_at: new Date().toISOString(),
        signer: freshAddress(),
        signature: bogusSignature(),
      },
    });
    expect(emptyReason.status()).toBe(400);
    const parsed = apiErrorSchema.parse(await emptyReason.json());
    expect(parsed.error.message).toMatch(/reason/);
  });

  test("refuses a signed authorisation that has expired", async ({ request }) => {
    const response = await request.post("/admin/api/queue", {
      data: {
        address: freshAddress(),
        reason: "A reason long enough to pass the length check.",
        issued_at: new Date(Date.now() - 3_600_000).toISOString(),
        signer: freshAddress(),
        signature: bogusSignature(),
      },
    });
    expect(response.status()).toBe(401);
    const parsed = apiErrorSchema.parse(await response.json());
    expect(parsed.error.message).toMatch(/older than/);
  });
});

test.describe("the signed rejection message", () => {
  test("is the same string on both sides, and names everything the server acts on", () => {
    // The browser builds it and the server rebuilds it to verify the signature, so a difference of
    // one space here is a signature that never verifies and an error nobody can diagnose.
    const auth = {
      address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      reason: "Duplicate request.",
      chainId: 84532,
      registry: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
      issuedAt: "2026-09-15T06:00:00.000Z",
    };
    const message = adminRejectMessage(auth);

    expect(message).toContain(auth.address);
    expect(message).toContain(auth.reason);
    expect(message).toContain("Chain id: 84532");
    expect(message).toContain(auth.registry);
    expect(message).toContain(auth.issuedAt);
    expect(message).toContain("sends no transaction");
  });
});
