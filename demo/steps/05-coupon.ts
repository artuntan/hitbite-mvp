/**
 * Step 5 — the issuer distributes a 12.00 USDC coupon and both wallets claim it. This is the
 * assertion the demo exists for.
 *
 * Wallet A holds 1,000 hbTRS and wallet B holds 500 of a 1,500 supply, so the coupon index rises
 * by `12e6 * 1e18 / 1500e18` = 8,000 (0.008000 USDC per token) and the two accruals are exactly
 * 8.000000 and 4.000000 USDC. No holder is iterated; each account settles lazily against the index
 * on its next transfer or claim.
 *
 * `distributeCoupon` also lowers the NAV by that same per-token amount, the way a fund's NAV drops
 * on the ex-distribution date (PLAN.md D26). Without it a wallet could subscribe just before a
 * distribution, claim, and redeem at an unchanged NAV, taking the coupon from existing holders.
 * Step 7's redemption is priced at the NAV this step leaves behind, not the one step 4 published.
 */

import { confirm, submit, usdcBalance, type DemoContext } from "../context.ts";
import { usdc as fmtUsdc } from "../report.ts";
import { ConfigError, type Actor } from "../config.ts";
import {
  COUPON_USDC,
  EXPECTED_COUPON_A,
  EXPECTED_COUPON_B,
  EXPECTED_COUPON_PER_TOKEN,
  EXPECTED_NAV_AFTER_DISTRIBUTION,
} from "../spec.ts";

const showUsdc = (value: bigint): string => `\`${value}\` (${fmtUsdc(value)} USDC)`;

export async function stepCoupon(ctx: DemoContext): Promise<void> {
  const { recorder, config } = ctx;
  recorder.startStep("5", "issuer distributes a 12.00 USDC coupon; A and B claim their 2:1 shares");

  await fundIssuer(ctx);

  const issuer = config.actors.issuer;
  const indexBefore = await ctx.publicClient.readContract({
    ...ctx.token,
    functionName: "couponIndex",
  });

  const { request } = await ctx.publicClient.simulateContract({
    ...ctx.token,
    functionName: "distributeCoupon",
    args: [COUPON_USDC],
    account: issuer.account,
  });
  const hash = await submit(ctx, request);
  await confirm(
    ctx,
    `issuer: distributeCoupon(${fmtUsdc(COUPON_USDC)} USDC)`,
    hash,
    issuer.address,
  );

  const [indexAfter, pendingA, pendingB, nav] = await Promise.all([
    ctx.publicClient.readContract({ ...ctx.token, functionName: "couponIndex" }),
    ctx.publicClient.readContract({
      ...ctx.token,
      functionName: "pendingCoupon",
      args: [config.actors.walletA.address],
    }),
    ctx.publicClient.readContract({
      ...ctx.token,
      functionName: "pendingCoupon",
      args: [config.actors.walletB.address],
    }),
    ctx.publicClient.readContract({ ...ctx.token, functionName: "nav" }),
  ]);

  recorder.check(
    "A16",
    "the coupon index rises by 0.008000 USDC per hbTRS (12.00 over 1,500 tokens)",
    EXPECTED_COUPON_PER_TOKEN,
    indexAfter - indexBefore,
    (value) => `\`${value}\` (${fmtUsdc(value)} USDC per hbTRS)`,
  );
  recorder.check(
    "A17",
    "wallet A accrues exactly 8.000000 USDC",
    EXPECTED_COUPON_A,
    pendingA,
    showUsdc,
  );
  recorder.check(
    "A18",
    "wallet B accrues exactly 4.000000 USDC",
    EXPECTED_COUPON_B,
    pendingB,
    showUsdc,
  );
  recorder.check(
    "A19",
    `wallet A's share is exactly twice wallet B's ${fmtUsdc(pendingB)} USDC — the 2:1 split of the coupon`,
    pendingB * 2n,
    pendingA,
    showUsdc,
  );
  recorder.check(
    "A20",
    "NAV drops by the per-token coupon, to 0.996300 USDC (ex-distribution, PLAN.md D26)",
    EXPECTED_NAV_AFTER_DISTRIBUTION,
    nav,
    showUsdc,
  );

  const claimedA = await claim(ctx, config.actors.walletA, EXPECTED_COUPON_A, "A21");
  const claimedB = await claim(ctx, config.actors.walletB, EXPECTED_COUPON_B, "A22");
  recorder.check(
    "A23",
    "the two claims together are exactly the 12.00 USDC the issuer distributed",
    COUPON_USDC,
    claimedA + claimedB,
    showUsdc,
  );
  recorder.endStep();
}

/** The issuer pays the coupon out of its own USDC; top it up from the faucet and approve exactly 12.00. */
async function fundIssuer(ctx: DemoContext): Promise<void> {
  const issuer = ctx.config.actors.issuer;
  const balance = await usdcBalance(ctx, issuer.address);

  if (balance < COUPON_USDC) {
    const wanted = COUPON_USDC - balance;
    const remaining = await ctx.publicClient.readContract({
      ...ctx.usdc,
      functionName: "faucetRemaining",
      args: [issuer.address],
    });
    if (remaining < wanted) {
      throw new ConfigError(
        `the issuer needs ${fmtUsdc(wanted)} more USDC to pay the coupon, but the faucet allows only ` +
          `${fmtUsdc(remaining)} in this 24 h window`,
        "MockUSDC caps the faucet per address per window (PLAN.md D14). Wait for the window to roll, or send " +
          "test USDC to the issuer from another address.",
      );
    }
    const { request } = await ctx.publicClient.simulateContract({
      ...ctx.usdc,
      functionName: "faucet",
      args: [issuer.address, wanted],
      account: issuer.account,
    });
    const hash = await submit(ctx, request);
    await confirm(
      ctx,
      `issuer: faucet(${fmtUsdc(wanted)} USDC)`,
      hash,
      issuer.address,
      "the coupon is real test USDC pulled from the issuer, not minted by the token",
    );
  } else {
    ctx.recorder.skip(
      `the issuer already holds ${fmtUsdc(balance)} USDC, enough to pay the 12.00 USDC coupon.`,
    );
  }

  const allowance = await ctx.publicClient.readContract({
    ...ctx.usdc,
    functionName: "allowance",
    args: [issuer.address, ctx.token.address],
  });
  if (allowance < COUPON_USDC) {
    const { request } = await ctx.publicClient.simulateContract({
      ...ctx.usdc,
      functionName: "approve",
      args: [ctx.token.address, COUPON_USDC],
      account: issuer.account,
    });
    const hash = await submit(ctx, request);
    await confirm(
      ctx,
      `issuer: approve(HBToken, ${fmtUsdc(COUPON_USDC)} USDC)`,
      hash,
      issuer.address,
    );
  } else {
    ctx.recorder.skip(
      `the issuer has already approved at least ${fmtUsdc(COUPON_USDC)} USDC to HBToken.`,
    );
  }
}

/** Claims for `actor` and proves the USDC that arrived is the exact accrual, not a rounded one. */
async function claim(
  ctx: DemoContext,
  actor: Actor,
  expected: bigint,
  assertionId: string,
): Promise<bigint> {
  const before = await usdcBalance(ctx, actor.address);
  const { request } = await ctx.publicClient.simulateContract({
    ...ctx.token,
    functionName: "claimCoupon",
    account: actor.account,
  });
  const hash = await submit(ctx, request);
  await confirm(ctx, `${actor.label}: claimCoupon()`, hash, actor.address);

  const after = await usdcBalance(ctx, actor.address);
  const received = after - before;
  ctx.recorder.check(
    assertionId,
    `${actor.label} receives exactly ${fmtUsdc(expected)} USDC when it claims`,
    expected,
    received,
    showUsdc,
  );
  return received;
}
