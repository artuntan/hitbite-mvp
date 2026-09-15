/**
 * Step 1 — the registrar verifies wallet A (784, United Arab Emirates) and wallet B (276,
 * Germany) as professional investors, then tries wallet C (840, United States) and is refused.
 *
 * The third attempt is the interesting one. `IdentityRegistry` is deployed with 840 and 792 on its
 * country blocklist (US securities law; the product is not offered to Turkish residents in phase
 * one), so `addVerified` reverts `CountryBlocked(840)` — in the registrar's own transaction, not
 * in a form validator. The runner expects that revert, decodes it, sends the transaction so the
 * chain holds the evidence, and records it as a passing assertion.
 */

import { encodeFunctionData } from "viem";
import { confirm, expectRevert, submit, type DemoContext } from "../context.ts";
import { COUNTRY_A, COUNTRY_B, COUNTRY_C, INVESTOR_PROFESSIONAL } from "../spec.ts";
import type { Actor } from "../config.ts";

/** `verified, country 784, investor type 1` — one readable string per identity record. */
function describe(identity: { verified: boolean; country: number; investorType: number }): string {
  return identity.verified
    ? `verified, country ${identity.country}, investor type ${identity.investorType}`
    : "not verified";
}

export async function stepVerify(ctx: DemoContext): Promise<void> {
  const { recorder, config } = ctx;
  recorder.startStep("1", "registrar verifies wallets A and B; wallet C (840) is refused on chain");

  await verify(ctx, config.actors.walletA, COUNTRY_A, "A1");
  await verify(ctx, config.actors.walletB, COUNTRY_B, "A2");

  const walletC = config.actors.walletC;
  const registrar = config.actors.registrar;
  const revert = await expectRevert(ctx, {
    label: `registrar: addVerified(wallet C, ${COUNTRY_C}, professional)`,
    actor: registrar,
    to: ctx.registry.address,
    data: encodeFunctionData({
      abi: ctx.registry.abi,
      functionName: "addVerified",
      args: [walletC.address, COUNTRY_C, INVESTOR_PROFESSIONAL],
    }),
    simulate: () =>
      ctx.publicClient.simulateContract({
        ...ctx.registry,
        functionName: "addVerified",
        args: [walletC.address, COUNTRY_C, INVESTOR_PROFESSIONAL],
        account: registrar.account,
      }),
  });

  recorder.check(
    "A3",
    `verifying wallet C (country ${COUNTRY_C}) reverts on chain`,
    `CountryBlocked(${COUNTRY_C})`,
    revert.signature,
    (value) => `\`${value}\``,
  );
  const stillUnverified = await ctx.publicClient.readContract({
    ...ctx.registry,
    functionName: "isVerified",
    args: [walletC.address],
  });
  recorder.check(
    "A4",
    "wallet C is still not verified",
    false,
    stillUnverified,
    (value) => `\`${value}\``,
  );
  recorder.endStep();
}

/** Verifies `actor` for `country`, or reports that the registry already says so (idempotency). */
async function verify(
  ctx: DemoContext,
  actor: Actor,
  country: number,
  assertionId: string,
): Promise<void> {
  const registrar = ctx.config.actors.registrar;
  const before = await ctx.publicClient.readContract({
    ...ctx.registry,
    functionName: "identityOf",
    args: [actor.address],
  });

  if (
    before.verified &&
    before.country === country &&
    before.investorType === INVESTOR_PROFESSIONAL
  ) {
    ctx.recorder.skip(
      `${actor.label} is already ${describe(before)} in the registry — \`addVerified\` not sent again.`,
    );
  } else {
    const { request } = await ctx.publicClient.simulateContract({
      ...ctx.registry,
      functionName: "addVerified",
      args: [actor.address, country, INVESTOR_PROFESSIONAL],
      account: registrar.account,
    });
    const hash = await submit(ctx, request);
    await confirm(
      ctx,
      `registrar: addVerified(${actor.label}, ${country}, professional)`,
      hash,
      registrar.address,
    );
  }

  const [identity, canHold] = await Promise.all([
    ctx.publicClient.readContract({
      ...ctx.registry,
      functionName: "identityOf",
      args: [actor.address],
    }),
    ctx.publicClient.readContract({
      ...ctx.registry,
      functionName: "canHold",
      args: [actor.address],
    }),
  ]);
  ctx.recorder.check(
    assertionId,
    `${actor.label} is verified as a professional investor in country ${country}, and can hold hbTRS`,
    `verified, country ${country}, investor type ${INVESTOR_PROFESSIONAL}, canHold true`,
    `${describe(identity)}, canHold ${canHold}`,
    (value) => `\`${value}\``,
  );
}
