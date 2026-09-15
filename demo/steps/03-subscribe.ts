/**
 * Step 3 — wallet A subscribes 1,000 USDC and wallet B subscribes 500 USDC, both at NAV 1.000000.
 *
 * `subscribe` mints `usdcAmount * 1e18 / nav`, so at the opening NAV the two wallets end the step
 * holding exactly 1,000 and 500 hbTRS: the 2:1 position that step 5 divides a coupon over. The
 * runner checks the contract's own `previewSubscribe` against the same integer first — the number
 * the web app shows an investor before they sign has to be the number they get.
 */

import { confirm, submit, tokenBalance, usdcBalance, type DemoContext } from "../context.ts";
import { hb as fmtHb, usdc as fmtUsdc } from "../report.ts";
import {
  EXPECTED_SUPPLY_AT_DISTRIBUTION,
  EXPECTED_TOKENS_A,
  EXPECTED_TOKENS_B,
  SUBSCRIPTION_A,
  SUBSCRIPTION_B,
} from "../spec.ts";
import type { Actor } from "../config.ts";

const showUsdc = (value: bigint): string => `\`${value}\` (${fmtUsdc(value)} USDC)`;
const showTokens = (value: bigint): string => `\`${value}\` (${fmtHb(value)} hbTRS)`;

export async function stepSubscribe(ctx: DemoContext): Promise<void> {
  const { recorder, config } = ctx;
  recorder.startStep("3", "wallet A subscribes 1,000 USDC; wallet B subscribes 500 USDC");

  await subscribe(ctx, config.actors.walletA, SUBSCRIPTION_A, EXPECTED_TOKENS_A, [
    "A7",
    "A8",
    "A9",
  ]);
  await subscribe(ctx, config.actors.walletB, SUBSCRIPTION_B, EXPECTED_TOKENS_B, [
    "A10",
    "A11",
    "A12",
  ]);

  const supply = await ctx.publicClient.readContract({ ...ctx.token, functionName: "totalSupply" });
  recorder.check(
    "A13",
    "total supply is the 1,500 hbTRS the coupon will be divided over",
    EXPECTED_SUPPLY_AT_DISTRIBUTION,
    supply,
    showTokens,
  );
  recorder.endStep();
}

async function subscribe(
  ctx: DemoContext,
  actor: Actor,
  amount: bigint,
  expectedTokens: bigint,
  [previewId, tokensId, cashId]: [string, string, string],
): Promise<void> {
  const { recorder } = ctx;

  const allowance = await ctx.publicClient.readContract({
    ...ctx.usdc,
    functionName: "allowance",
    args: [actor.address, ctx.token.address],
  });
  if (allowance < amount) {
    const { request } = await ctx.publicClient.simulateContract({
      ...ctx.usdc,
      functionName: "approve",
      args: [ctx.token.address, amount],
      account: actor.account,
    });
    const hash = await submit(ctx, request);
    await confirm(
      ctx,
      `${actor.label}: approve(HBToken, ${fmtUsdc(amount)} USDC)`,
      hash,
      actor.address,
      "subscribing spends the allowance, so each run approves exactly what it is about to subscribe",
    );
  } else {
    recorder.skip(
      `${actor.label} has already approved at least ${fmtUsdc(amount)} USDC to HBToken.`,
    );
  }

  const [usdcBefore, tokensBefore, preview] = await Promise.all([
    usdcBalance(ctx, actor.address),
    tokenBalance(ctx, actor.address),
    ctx.publicClient.readContract({
      ...ctx.token,
      functionName: "previewSubscribe",
      args: [amount],
    }),
  ]);
  recorder.check(
    previewId,
    `previewSubscribe(${fmtUsdc(amount)} USDC) is ${fmtHb(expectedTokens)} hbTRS at NAV 1.000000`,
    expectedTokens,
    preview,
    showTokens,
  );

  const { request, result } = await ctx.publicClient.simulateContract({
    ...ctx.token,
    functionName: "subscribe",
    args: [amount],
    account: actor.account,
  });
  const hash = await submit(ctx, request);
  await confirm(ctx, `${actor.label}: subscribe(${fmtUsdc(amount)} USDC)`, hash, actor.address);

  if (result !== expectedTokens) {
    throw new Error(
      `subscribe() returned ${result} hbTRS where ${expectedTokens} was expected: the preview, the return ` +
        "value and the minted balance must all agree",
    );
  }

  const [usdcAfter, tokensAfter] = await Promise.all([
    usdcBalance(ctx, actor.address),
    tokenBalance(ctx, actor.address),
  ]);
  recorder.check(
    tokensId,
    `${actor.label} is minted exactly ${fmtHb(expectedTokens)} hbTRS, the amount subscribe() returned`,
    expectedTokens,
    tokensAfter - tokensBefore,
    showTokens,
  );
  recorder.check(
    cashId,
    `${actor.label} pays exactly ${fmtUsdc(amount)} USDC`,
    amount,
    usdcBefore - usdcAfter,
    showUsdc,
  );
}
