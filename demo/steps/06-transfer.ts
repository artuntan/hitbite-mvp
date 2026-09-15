/**
 * Step 6 — wallet A transfers 100 hbTRS to wallet B, then tries the same transfer to wallet C and
 * is refused by the token itself.
 *
 * `HBToken._update` asks the registry `canHold(from)` and `canHold(to)` on every transfer, so the
 * whitelist is enforced on chain rather than in the interface: wallet C is not verified, the
 * transfer reverts `NotEligible(C)`, and the runner records the reverted transaction as the
 * evidence. A transfer also settles both sides' coupon accrual before balances move, which is why
 * the 100 hbTRS leaving wallet A after the distribution costs neither wallet any of the coupon
 * they already claimed in step 5.
 */

import { encodeFunctionData } from "viem";
import { confirm, expectRevert, submit, tokenBalance, type DemoContext } from "../context.ts";
import { hb as fmtHb } from "../report.ts";
import { TRANSFER_TOKENS } from "../spec.ts";

const showTokens = (value: bigint): string => `\`${value}\` (${fmtHb(value)} hbTRS)`;

export async function stepTransfer(ctx: DemoContext): Promise<void> {
  const { recorder, config } = ctx;
  recorder.startStep(
    "6",
    "wallet A transfers 100 hbTRS to B (allowed) and to C (rejected on chain)",
  );

  const { walletA, walletB, walletC } = config.actors;
  const [beforeA, beforeB] = await Promise.all([
    tokenBalance(ctx, walletA.address),
    tokenBalance(ctx, walletB.address),
  ]);

  const { request } = await ctx.publicClient.simulateContract({
    ...ctx.token,
    functionName: "transfer",
    args: [walletB.address, TRANSFER_TOKENS],
    account: walletA.account,
  });
  const hash = await submit(ctx, request);
  await confirm(
    ctx,
    `wallet A: transfer(wallet B, ${fmtHb(TRANSFER_TOKENS)} hbTRS)`,
    hash,
    walletA.address,
  );

  const [afterA, afterB] = await Promise.all([
    tokenBalance(ctx, walletA.address),
    tokenBalance(ctx, walletB.address),
  ]);
  recorder.check(
    "A24",
    "wallet A sends exactly 100 hbTRS",
    TRANSFER_TOKENS,
    beforeA - afterA,
    showTokens,
  );
  recorder.check(
    "A25",
    "wallet B receives exactly 100 hbTRS",
    TRANSFER_TOKENS,
    afterB - beforeB,
    showTokens,
  );

  const revert = await expectRevert(ctx, {
    label: `wallet A: transfer(wallet C, ${fmtHb(TRANSFER_TOKENS)} hbTRS)`,
    actor: walletA,
    to: ctx.token.address,
    data: encodeFunctionData({
      abi: ctx.token.abi,
      functionName: "transfer",
      args: [walletC.address, TRANSFER_TOKENS],
    }),
    simulate: () =>
      ctx.publicClient.simulateContract({
        ...ctx.token,
        functionName: "transfer",
        args: [walletC.address, TRANSFER_TOKENS],
        account: walletA.account,
      }),
  });
  recorder.check(
    "A26",
    "transferring to unverified wallet C reverts on chain, naming the account",
    `NotEligible(${walletC.address})`,
    revert.signature,
    (value) => `\`${value}\``,
  );
  const heldByC = await tokenBalance(ctx, walletC.address);
  recorder.check("A27", "wallet C holds no hbTRS", 0n, heldByC, showTokens);
  recorder.endStep();
}
