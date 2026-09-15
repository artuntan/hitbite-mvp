/**
 * preflight — bring the deployment to the state BUILD_PROMPT section 9 starts from, and refuse to
 * go on if anything about it is wrong.
 *
 * This is what makes the run idempotent (PLAN.md D11). The eight steps quote exact amounts —
 * 1,000 and 500 USDC subscribed at NAV 1.000000, a 12.00 USDC coupon splitting 8.00/4.00 — and
 * those integers are only exact from a known starting state. Rather than weaken the assertions on
 * a second run, the preflight puts the chain back where the first run found it and says, line by
 * line, what it had to undo:
 *
 *   - any coupon the demo wallets left unclaimed is claimed (otherwise step 5's claim would pay
 *     the old accrual as well as the new one);
 *   - any hbTRS they still hold is redeemed at the NAV then in force, so they start flat;
 *   - the on-chain NAV is put back to the opening 1.000000, which is exactly what `make seed`
 *     does with `SEED_NAV` — by the oracle when the 5% rail allows it, by the admin with `force`
 *     when repeated runs inside one 24 h window have walked the rail anchor too far (PLAN.md D27).
 *
 * On a freshly deployed chain every one of those is a no-op and the report says so.
 */

import { formatUnits, hb as fmtHb, usdc as fmtUsdc, type Snapshot } from "../report.ts";
import { confirm, snapshot, submit, type DemoContext } from "../context.ts";
import { ConfigError, type Actor } from "../config.ts";
import { MAX_BPS, OPENING_NAV, RAIL_WINDOW_SECONDS, STEP4_NAV, TOKEN_SCALE } from "../spec.ts";

/** The rail state the preflight reasons about, read in one pass. */
type RailState = {
  readonly nav: bigint;
  readonly anchor: bigint;
  readonly windowStart: bigint;
  readonly maxBps: bigint;
  readonly now: bigint;
};

/** What the preflight decided to do about the opening NAV. */
type NavPlan = {
  readonly action: "skip" | "oracle" | "force";
  readonly reason: string;
};

/** |a - b| * 10_000 <= a * maxBps — the same comparison `HBToken.setNAV` makes. */
function insideRail(target: bigint, anchor: bigint, maxBps: bigint): boolean {
  const delta = target > anchor ? target - anchor : anchor - target;
  return delta * MAX_BPS <= anchor * maxBps;
}

/**
 * Decides how to restore the opening NAV.
 *
 * The rail is measured against `railAnchorNav`, the NAV at the start of the current 24 h window,
 * and `distributeCoupon` lowers that anchor by the per-token coupon it pays (PLAN.md D26/D27). Run
 * the demo often enough inside one window and the anchor drifts below the point where the oracle
 * can still publish step 4's 1.0043 — so the preflight checks step 4's move here, before anything
 * has been sent, and asks the admin to re-anchor the window instead of failing half-way through.
 */
export function planOpeningNav(state: RailState): NavPlan {
  const rolls = state.now >= state.windowStart + RAIL_WINDOW_SECONDS;
  const anchor = rolls ? state.nav : state.anchor;
  const needsReset = state.nav !== OPENING_NAV;
  const resetFits = !needsReset || insideRail(OPENING_NAV, anchor, state.maxBps);
  const step4Fits = insideRail(STEP4_NAV, anchor, state.maxBps);

  if (resetFits && step4Fits) {
    if (!needsReset) {
      return {
        action: "skip",
        reason: `on-chain NAV is already the opening ${fmtUsdc(OPENING_NAV)} USDC`,
      };
    }
    return {
      action: "oracle",
      reason: `NAV was ${fmtUsdc(state.nav)} from an earlier run; the oracle can move it back inside the rail`,
    };
  }
  return {
    action: "force",
    reason:
      `the rail anchor is ${fmtUsdc(anchor)} USDC, so a non-forced move to ` +
      `${fmtUsdc(step4Fits ? OPENING_NAV : STEP4_NAV)} USDC would exceed the ${state.maxBps} bp rail; ` +
      "the admin re-anchors the window (PLAN.md D5/D27)",
  };
}

/** Runs the preflight and returns the snapshot the report calls "before". */
export async function preflight(ctx: DemoContext): Promise<Snapshot> {
  const { recorder } = ctx;
  recorder.startStep("preflight", "check the deployment and restore the documented starting state");

  await checkWiring(ctx);
  await checkRoles(ctx);
  await checkGas(ctx);
  await checkWalletC(ctx);
  await settleDemoWallets(ctx);
  await restoreOpeningNav(ctx);

  const before = await snapshot(ctx);
  recorder.check(
    "P5",
    "on-chain NAV is the opening 1.000000 USDC before step 1",
    OPENING_NAV,
    before.nav,
    (value) => `\`${value}\` (${fmtUsdc(value)} USDC)`,
  );
  recorder.check(
    "P6",
    "no hbTRS is outstanding: both demo wallets start flat and nobody else holds any",
    0n,
    before.totalSupply,
    (value) => (value === 0n ? "`0`" : `\`${value}\` (${fmtHb(value)} hbTRS)`),
  );
  recorder.endStep();
  return before;
}

// --------------------------------------------------------------------------------- checks

/** The deployment record and the deployed bytecode must agree about which contracts these are. */
async function checkWiring(ctx: DemoContext): Promise<void> {
  const { recorder, config } = ctx;
  const [registry, usdcAddress, symbol, paused] = await Promise.all([
    ctx.publicClient.readContract({ ...ctx.token, functionName: "registry" }),
    ctx.publicClient.readContract({ ...ctx.token, functionName: "usdc" }),
    ctx.publicClient.readContract({ ...ctx.token, functionName: "symbol" }),
    ctx.publicClient.readContract({ ...ctx.token, functionName: "paused" }),
  ]);

  recorder.check(
    "P1",
    "HBToken points at the IdentityRegistry in the deployment record",
    config.deployment.addresses.IdentityRegistry.toLowerCase(),
    registry.toLowerCase(),
    (value) => `\`${value}\``,
  );
  recorder.check(
    "P2",
    "HBToken points at the MockUSDC in the deployment record",
    config.deployment.addresses.MockUSDC.toLowerCase(),
    usdcAddress.toLowerCase(),
    (value) => `\`${value}\``,
  );
  recorder.check("P3", "the token is hbTRS", "hbTRS", symbol, (value) => `\`${value}\``);

  if (paused) {
    throw new ConfigError(
      "the token is paused",
      "Every transfer, subscription, redemption and distribution is blocked while paused (PLAN.md D3). " +
        "Unpause from the admin console, or with the issuer key, before running the demo.",
    );
  }
  recorder.note(
    `contracts read from \`contracts/deployments/${config.chainName}.json\`: ` +
      `HBToken \`${config.deployment.addresses.HBToken}\`, ` +
      `IdentityRegistry \`${config.deployment.addresses.IdentityRegistry}\`, ` +
      `MockUSDC \`${config.deployment.addresses.MockUSDC}\`.`,
  );
}

/** Each role key must actually hold its role, checked before the first transaction rather than after. */
async function checkRoles(ctx: DemoContext): Promise<void> {
  const { actors } = ctx.config;
  const [registrarRole, issuerRole, oracleRole] = await Promise.all([
    ctx.publicClient.readContract({ ...ctx.registry, functionName: "REGISTRAR_ROLE" }),
    ctx.publicClient.readContract({ ...ctx.token, functionName: "ISSUER_ROLE" }),
    ctx.publicClient.readContract({ ...ctx.token, functionName: "ORACLE_ROLE" }),
  ]);
  const [hasRegistrar, hasIssuer, hasOracle] = await Promise.all([
    ctx.publicClient.readContract({
      ...ctx.registry,
      functionName: "hasRole",
      args: [registrarRole, actors.registrar.address],
    }),
    ctx.publicClient.readContract({
      ...ctx.token,
      functionName: "hasRole",
      args: [issuerRole, actors.issuer.address],
    }),
    ctx.publicClient.readContract({
      ...ctx.token,
      functionName: "hasRole",
      args: [oracleRole, actors.oracle.address],
    }),
  ]);

  const missing: string[] = [];
  if (!hasRegistrar)
    missing.push(
      `${actors.registrar.address} does not hold REGISTRAR_ROLE (${actors.registrar.source})`,
    );
  if (!hasIssuer)
    missing.push(`${actors.issuer.address} does not hold ISSUER_ROLE (${actors.issuer.source})`);
  if (!hasOracle)
    missing.push(`${actors.oracle.address} does not hold ORACLE_ROLE (${actors.oracle.source})`);
  if (missing.length > 0) {
    throw new ConfigError(
      `the configured signers are missing roles:\n  ${missing.join("\n  ")}`,
      "Set the matching *_PRIVATE_KEY, or re-deploy with the matching *_ADDRESS (see .env.example).",
    );
  }

  const addresses = [actors.walletA, actors.walletB, actors.walletC].map((actor) =>
    actor.address.toLowerCase(),
  );
  if (new Set(addresses).size !== addresses.length) {
    throw new ConfigError(
      "demo wallets A, B and C must be three different addresses",
      "They stand for three different investors; the transfer and blocklist steps are meaningless otherwise.",
    );
  }
  ctx.recorder.note(
    "registrar, issuer and oracle keys hold the roles they need; wallets A, B and C are distinct.",
  );
}

/** Wallet C never signs anything, so only the five signing actors need gas. */
async function checkGas(ctx: DemoContext): Promise<void> {
  const { actors } = ctx.config;
  const senders: Actor[] = [
    actors.walletA,
    actors.walletB,
    actors.registrar,
    actors.issuer,
    actors.oracle,
  ];
  const balances = await Promise.all(
    senders.map((actor) => ctx.publicClient.getBalance({ address: actor.address })),
  );
  const broke = senders.filter((_, index) => (balances[index] ?? 0n) === 0n);
  if (broke.length > 0) {
    throw new ConfigError(
      `no native balance for gas: ${broke.map((actor) => `${actor.label} (${actor.address})`).join(", ")}`,
      "Fund them on the testnet first. Wallet C needs no gas: it never sends a transaction in this demo.",
    );
  }
  ctx.recorder.note(
    "gas checked for the five signing accounts; wallet C holds no native balance because it never signs " +
      "— it only ever appears as a rejected counterparty.",
  );
}

/** The blocklist steps are only meaningful while wallet C cannot hold the token. */
async function checkWalletC(ctx: DemoContext): Promise<void> {
  const canHold = await ctx.publicClient.readContract({
    ...ctx.registry,
    functionName: "canHold",
    args: [ctx.config.actors.walletC.address],
  });
  ctx.recorder.check(
    "P4",
    "wallet C cannot hold hbTRS before the run",
    false,
    canHold,
    (value) => `\`${value}\``,
  );
}

// --------------------------------------------------------------------------------- restoration

/** Claims and redeems whatever an earlier run left on the demo wallets, so both start flat. */
async function settleDemoWallets(ctx: DemoContext): Promise<void> {
  const { recorder } = ctx;
  const wallets = [ctx.config.actors.walletA, ctx.config.actors.walletB];

  const [supply, ...held] = await Promise.all([
    ctx.publicClient.readContract({ ...ctx.token, functionName: "totalSupply" }),
    ...wallets.map((actor) =>
      ctx.publicClient.readContract({
        ...ctx.token,
        functionName: "balanceOf",
        args: [actor.address],
      }),
    ),
  ]);
  const byOthers = supply - held.reduce((total, balance) => total + balance, 0n);
  if (byOthers > 0n) {
    throw new ConfigError(
      `${formatUnits(byOthers, 18, 2)} hbTRS are held by wallets other than the demo wallets`,
      "Step 5 asserts an exact 8.00/4.00 split of a 12.00 USDC coupon, which only holds when A and B are " +
        "the only holders. Point the demo at a deployment of its own (`make deploy CHAIN=...`).",
    );
  }

  let restored = false;
  for (const [index, actor] of wallets.entries()) {
    const pending = await ctx.publicClient.readContract({
      ...ctx.token,
      functionName: "pendingCoupon",
      args: [actor.address],
    });
    if (pending > 0n) {
      restored = true;
      const { request } = await ctx.publicClient.simulateContract({
        ...ctx.token,
        functionName: "claimCoupon",
        account: actor.account,
      });
      const hash = await submit(ctx, request);
      await confirm(
        ctx,
        `${actor.label}: claimCoupon()`,
        hash,
        actor.address,
        `${fmtUsdc(pending)} USDC left unclaimed by an earlier run`,
      );
    }

    const balance = held[index] ?? 0n;
    if (balance > 0n) {
      restored = true;
      const [preview, available] = await Promise.all([
        ctx.publicClient.readContract({
          ...ctx.token,
          functionName: "previewRedeem",
          args: [balance],
        }),
        ctx.publicClient.readContract({ ...ctx.token, functionName: "availableLiquidity" }),
      ]);
      if (preview > available) {
        throw new ConfigError(
          `${actor.label} holds ${formatUnits(balance, 18, 2)} hbTRS but the vault can only pay ${fmtUsdc(available)} USDC`,
          "The runner returns the demo wallets to cash before it starts. Redeem or top the vault up by hand first.",
        );
      }
      const { request } = await ctx.publicClient.simulateContract({
        ...ctx.token,
        functionName: "redeem",
        args: [balance],
        account: actor.account,
      });
      const hash = await submit(ctx, request);
      await confirm(
        ctx,
        `${actor.label}: redeem(${formatUnits(balance, 18, 2)} hbTRS)`,
        hash,
        actor.address,
        `position left by an earlier run, returned to cash at the NAV then in force (${fmtUsdc(preview)} USDC)`,
      );
    }

    if (pending === 0n && balance === 0n) {
      recorder.skip(`${actor.label} holds no hbTRS and no unclaimed coupon — nothing to restore.`);
    }
  }

  if (!restored) recorder.note("nothing to undo: this is the first run against this deployment.");
}

/** Puts the on-chain NAV back to 1.000000 USDC, the value `make seed` opens a deployment at. */
async function restoreOpeningNav(ctx: DemoContext): Promise<void> {
  const { recorder, config } = ctx;
  const [nav, anchor, windowStart, maxBps, block] = await Promise.all([
    ctx.publicClient.readContract({ ...ctx.token, functionName: "nav" }),
    ctx.publicClient.readContract({ ...ctx.token, functionName: "railAnchorNav" }),
    ctx.publicClient.readContract({ ...ctx.token, functionName: "railWindowStart" }),
    ctx.publicClient.readContract({ ...ctx.token, functionName: "maxNavMoveBps" }),
    ctx.publicClient.getBlock(),
  ]);

  const plan = planOpeningNav({ nav, anchor, windowStart, maxBps, now: block.timestamp });

  if (plan.action === "skip") {
    recorder.skip(`opening NAV: ${plan.reason}.`);
    return;
  }

  const forced = plan.action === "force";
  const signer = forced ? config.actors.admin : config.actors.oracle;
  if (signer === undefined) {
    throw new ConfigError(
      "the oracle rail needs re-anchoring but no admin key is configured",
      `${plan.reason}. Set DEPLOYER_PRIVATE_KEY (DEFAULT_ADMIN_ROLE), or wait until the 24 h rail window ` +
        `rolls at ${new Date(Number(windowStart + RAIL_WINDOW_SECONDS) * 1000).toISOString()}.`,
    );
  }
  if (forced) {
    const adminRole = await ctx.publicClient.readContract({
      ...ctx.token,
      functionName: "DEFAULT_ADMIN_ROLE",
    });
    const isAdmin = await ctx.publicClient.readContract({
      ...ctx.token,
      functionName: "hasRole",
      args: [adminRole, signer.address],
    });
    if (!isAdmin) {
      throw new ConfigError(
        `${signer.address} does not hold DEFAULT_ADMIN_ROLE, which re-anchoring the rail needs`,
        `${plan.reason}. Set DEPLOYER_PRIVATE_KEY to the admin key, or wait for the rail window to roll.`,
      );
    }
  }

  // reportedAUM follows the engine's convention (PLAN.md D19): NAV x totalSupply, floored like the chain.
  const supply = await ctx.publicClient.readContract({ ...ctx.token, functionName: "totalSupply" });
  const reportedAum = (OPENING_NAV * supply) / TOKEN_SCALE;

  const { request } = await ctx.publicClient.simulateContract({
    ...ctx.token,
    functionName: "setNAV",
    args: [OPENING_NAV, reportedAum, forced],
    account: signer.account,
  });
  const hash = await submit(ctx, request);
  await confirm(
    ctx,
    `${signer.label}: setNAV(${fmtUsdc(OPENING_NAV)}, ${fmtUsdc(reportedAum)}, force=${forced})`,
    hash,
    signer.address,
    plan.reason,
  );
}
