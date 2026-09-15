/**
 * Step 7 — wallet B redeems 200 hbTRS and receives exactly what `previewRedeem` quoted.
 *
 * The price is `tokenAmount * nav / 1e18` at the NAV *step 5 left behind* — 0.996300, not the
 * 1.004300 step 4 published — because `distributeCoupon` took the per-token coupon out of the NAV
 * (PLAN.md D26). 200 hbTRS therefore settle at 199.260000 USDC. `redeem` pays from
 * `availableLiquidity()`, which excludes the coupon reserve owed to holders, so a redemption can
 * never spend coupon money (PLAN.md D6).
 */

import { confirm, submit, tokenBalance, usdcBalance, type DemoContext } from "../context.ts";
import { hb as fmtHb, usdc as fmtUsdc } from "../report.ts";
import { EXPECTED_REDEEM_USDC, REDEEM_TOKENS } from "../spec.ts";

const showUsdc = (value: bigint): string => `\`${value}\` (${fmtUsdc(value)} USDC)`;
const showTokens = (value: bigint): string => `\`${value}\` (${fmtHb(value)} hbTRS)`;

export async function stepRedeem(ctx: DemoContext): Promise<void> {
  const { recorder, config } = ctx;
  recorder.startStep("7", "wallet B redeems 200 hbTRS at the post-distribution NAV");

  const walletB = config.actors.walletB;
  const [preview, nav, available, usdcBefore, tokensBefore, supplyBefore] = await Promise.all([
    ctx.publicClient.readContract({
      ...ctx.token,
      functionName: "previewRedeem",
      args: [REDEEM_TOKENS],
    }),
    ctx.publicClient.readContract({ ...ctx.token, functionName: "nav" }),
    ctx.publicClient.readContract({ ...ctx.token, functionName: "availableLiquidity" }),
    usdcBalance(ctx, walletB.address),
    tokenBalance(ctx, walletB.address),
    ctx.publicClient.readContract({ ...ctx.token, functionName: "totalSupply" }),
  ]);

  recorder.note(
    `priced at the NAV the distribution left behind, ${fmtUsdc(nav)} USDC; the vault can pay ` +
      `${fmtUsdc(available)} USDC without touching the coupon reserve.`,
  );
  recorder.check(
    "A28",
    "previewRedeem(200 hbTRS) quotes 199.260000 USDC at the post-distribution NAV",
    EXPECTED_REDEEM_USDC,
    preview,
    showUsdc,
  );

  const { request, result } = await ctx.publicClient.simulateContract({
    ...ctx.token,
    functionName: "redeem",
    args: [REDEEM_TOKENS],
    account: walletB.account,
  });
  const hash = await submit(ctx, request);
  await confirm(ctx, `wallet B: redeem(${fmtHb(REDEEM_TOKENS)} hbTRS)`, hash, walletB.address);

  const [usdcAfter, tokensAfter, supplyAfter] = await Promise.all([
    usdcBalance(ctx, walletB.address),
    tokenBalance(ctx, walletB.address),
    ctx.publicClient.readContract({ ...ctx.token, functionName: "totalSupply" }),
  ]);

  recorder.check(
    "A29",
    "the USDC wallet B receives equals previewRedeem exactly",
    preview,
    usdcAfter - usdcBefore,
    showUsdc,
  );
  recorder.check("A30", "redeem() returns the quoted amount", preview, result, showUsdc);
  recorder.check(
    "A31",
    "wallet B burns exactly 200 hbTRS",
    REDEEM_TOKENS,
    tokensBefore - tokensAfter,
    showTokens,
  );
  recorder.check(
    "A32",
    "total supply falls by exactly 200 hbTRS",
    REDEEM_TOKENS,
    supplyBefore - supplyAfter,
    showTokens,
  );
  recorder.endStep();
}
