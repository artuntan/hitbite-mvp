/**
 * Step 4 — the oracle publishes NAV 1.0043, a +43 bp move that sits inside the 500 bp rail.
 *
 * `setNAV(newNav, newReportedAUM, force=false)` is ORACLE_ROLE and is measured against
 * `railAnchorNav`, the NAV at the start of the current 24 h window, so a sequence of small moves
 * cannot compound past the daily limit (PLAN.md D27). `reportedAUM` follows the engine's
 * convention, NAV x totalSupply floored to USDC units (PLAN.md D19), which is what
 * `nav-engine push` would send.
 */

import { confirm, submit, type DemoContext } from "../context.ts";
import { usdc as fmtUsdc } from "../report.ts";
import { MAX_BPS, STEP4_NAV, TOKEN_SCALE } from "../spec.ts";

export async function stepSetNav(ctx: DemoContext): Promise<void> {
  const { recorder, config } = ctx;
  recorder.startStep("4", "oracle sets NAV to 1.0043 USDC per hbTRS");

  const oracle = config.actors.oracle;
  const [navBefore, anchor, maxBps, supply] = await Promise.all([
    ctx.publicClient.readContract({ ...ctx.token, functionName: "nav" }),
    ctx.publicClient.readContract({ ...ctx.token, functionName: "railAnchorNav" }),
    ctx.publicClient.readContract({ ...ctx.token, functionName: "maxNavMoveBps" }),
    ctx.publicClient.readContract({ ...ctx.token, functionName: "totalSupply" }),
  ]);

  const delta = STEP4_NAV > anchor ? STEP4_NAV - anchor : anchor - STEP4_NAV;
  const moveBps = (delta * MAX_BPS) / anchor;
  const reportedAum = (STEP4_NAV * supply) / TOKEN_SCALE;

  const { request } = await ctx.publicClient.simulateContract({
    ...ctx.token,
    functionName: "setNAV",
    args: [STEP4_NAV, reportedAum, false],
    account: oracle.account,
  });
  const hash = await submit(ctx, request);
  await confirm(
    ctx,
    `oracle: setNAV(${fmtUsdc(STEP4_NAV)}, reportedAUM ${fmtUsdc(reportedAum)}, force=false)`,
    hash,
    oracle.address,
    `from ${fmtUsdc(navBefore)}; rail anchor ${fmtUsdc(anchor)}`,
  );

  const nav = await ctx.publicClient.readContract({ ...ctx.token, functionName: "nav" });
  recorder.check(
    "A14",
    "on-chain NAV is 1.004300 USDC per hbTRS",
    STEP4_NAV,
    nav,
    (value) => `\`${value}\` (${fmtUsdc(value)} USDC)`,
  );
  recorder.checkAtMost(
    "A15",
    "the oracle's move to 1.0043 stays inside the rail, published without `force`",
    maxBps,
    moveBps,
    (value) => `${value} bp`,
  );
  recorder.endStep();
}
