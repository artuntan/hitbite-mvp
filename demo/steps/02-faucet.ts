/**
 * Step 2 — the MockUSDC faucet funds wallets A and B.
 *
 * Idempotent by top-up: each wallet is brought to exactly what it is about to subscribe, and a
 * wallet that already holds enough is skipped. `MockUSDC` caps the faucet at 10,000 USDC per
 * address per fixed 24 h window (PLAN.md D14), so the runner asks `faucetRemaining` first and
 * fails with that number rather than letting the call revert.
 */

import { ConfigError, type Actor } from "../config.ts";
import { confirm, submit, usdcBalance, type DemoContext } from "../context.ts";
import { usdc as fmtUsdc } from "../report.ts";
import { SUBSCRIPTION_A, SUBSCRIPTION_B } from "../spec.ts";

export async function stepFaucet(ctx: DemoContext): Promise<void> {
  const { recorder, config } = ctx;
  recorder.startStep("2", "faucet funds wallets A and B with test USDC");

  await fund(ctx, config.actors.walletA, SUBSCRIPTION_A, "A5");
  await fund(ctx, config.actors.walletB, SUBSCRIPTION_B, "A6");

  recorder.endStep();
}

/** Tops `actor` up to `needed` test USDC, within whatever the faucet window still allows. */
async function fund(
  ctx: DemoContext,
  actor: Actor,
  needed: bigint,
  assertionId: string,
): Promise<void> {
  const balance = await usdcBalance(ctx, actor.address);

  if (balance >= needed) {
    ctx.recorder.skip(
      `${actor.label} already holds ${fmtUsdc(balance)} USDC, at least the ${fmtUsdc(needed)} USDC it ` +
        "subscribes in step 3 — faucet not called.",
    );
  } else {
    const wanted = needed - balance;
    const remaining = await ctx.publicClient.readContract({
      ...ctx.usdc,
      functionName: "faucetRemaining",
      args: [actor.address],
    });
    if (remaining < wanted) {
      throw new ConfigError(
        `the faucet can only mint ${fmtUsdc(remaining)} more USDC to ${actor.label} in this 24 h window, ` +
          `but it needs ${fmtUsdc(wanted)}`,
        "MockUSDC caps the faucet per address per window (PLAN.md D14). Wait for the window to roll, or send " +
          "test USDC to the wallet from another address.",
      );
    }
    const { request } = await ctx.publicClient.simulateContract({
      ...ctx.usdc,
      functionName: "faucet",
      args: [actor.address, wanted],
      account: actor.account,
    });
    const hash = await submit(ctx, request);
    await confirm(
      ctx,
      `${actor.label}: faucet(${fmtUsdc(wanted)} USDC)`,
      hash,
      actor.address,
      balance === 0n ? undefined : `top-up: it already held ${fmtUsdc(balance)} USDC`,
    );
  }

  const after = await usdcBalance(ctx, actor.address);
  ctx.recorder.checkAtLeast(
    assertionId,
    `${actor.label} holds at least the ${fmtUsdc(needed)} USDC it subscribes in step 3`,
    needed,
    after,
    (value) => `\`${value}\` (${fmtUsdc(value)} USDC)`,
  );
}
