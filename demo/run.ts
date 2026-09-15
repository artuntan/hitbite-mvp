/**
 * run — the HitBite end-to-end demo (BUILD_PROMPT.md section 9, PLAN.md D11).
 *
 * Eight steps against a live testnet, each one asserted: verify two wallets and be refused for a
 * third, fund them, subscribe 1,000 and 500 USDC, publish a NAV, distribute a 12.00 USDC coupon
 * and prove the 2:1 split, transfer between holders and be refused to a non-holder, redeem at the
 * quoted price, and write `demo/REPORT.md`.
 *
 *   CHAIN=anvil|base-sepolia pnpm demo        # or `make demo CHAIN=...`
 *
 * Two properties matter more than the happy path.
 *
 * **It is honest about failure.** An assertion that does not hold stops the run, prints what was
 * expected against what the chain said, writes the report with the failure in it, and exits
 * non-zero. A demo that can only produce a green report is not evidence of anything.
 *
 * **It is re-runnable.** Everything already satisfied is skipped and reported as skipped, and the
 * preflight returns the demo wallets and the NAV to the documented starting state, so the second
 * run asserts the same exact integers as the first.
 */

import path from "node:path";
import { BaseError } from "viem";
import { ConfigError, loadConfig } from "./config.ts";
import { createContext, snapshot, type DemoContext } from "./context.ts";
import { AssertionFailed, Recorder } from "./report.ts";
import { preflight } from "./steps/preflight.ts";
import { stepVerify } from "./steps/01-verify.ts";
import { stepFaucet } from "./steps/02-faucet.ts";
import { stepSubscribe } from "./steps/03-subscribe.ts";
import { stepSetNav } from "./steps/04-nav.ts";
import { stepCoupon } from "./steps/05-coupon.ts";
import { stepTransfer } from "./steps/06-transfer.ts";
import { stepRedeem } from "./steps/07-redeem.ts";

/** Steps 1 to 7, in the order BUILD_PROMPT section 9 lists them. */
const STEPS: ReadonlyArray<(ctx: DemoContext) => Promise<void>> = [
  stepVerify,
  stepFaucet,
  stepSubscribe,
  stepSetNav,
  stepCoupon,
  stepTransfer,
  stepRedeem,
];

/** Turns any thrown value into the two lines the report and the terminal both show. */
function explain(error: unknown): { message: string; hint: string | undefined } {
  if (error instanceof ConfigError) return { message: error.message, hint: error.hint };
  if (error instanceof AssertionFailed) {
    return {
      message: error.message,
      hint: `Assertion ${error.assertion.id} is the one to look at in the table below.`,
    };
  }
  if (error instanceof BaseError) {
    return { message: error.shortMessage, hint: error.details ?? error.metaMessages?.join(" ") };
  }
  if (error instanceof Error) return { message: error.message, hint: undefined };
  return { message: String(error), hint: undefined };
}

async function main(): Promise<void> {
  const recorder = new Recorder();
  let reportFile = path.join(import.meta.dirname, "REPORT.md");

  try {
    const config = loadConfig();
    reportFile = config.reportFile;
    recorder.configure(config);
    process.stdout.write(
      `HitBite demo — chain ${config.chainName} (id ${config.chainId}) via ${config.rpcHost}\n` +
        `  HBToken ${config.deployment.addresses.HBToken}\n`,
    );

    const ctx = await createContext(config, recorder);
    recorder.snapshotBefore(await preflight(ctx));
    for (const step of STEPS) await step(ctx);

    recorder.startStep("8", "record every hash, balance, assertion and timing in demo/REPORT.md");
    recorder.snapshotAfter(await snapshot(ctx));
    recorder.note(
      `written to \`demo/REPORT.md\` (${recorder.assertionCount} assertions, all passing).`,
    );
    recorder.endStep();
  } catch (error) {
    const { message, hint } = explain(error);
    recorder.fail(message, hint);
    process.stdout.write(`\nFAILED: ${message}\n${hint === undefined ? "" : `  ${hint}\n`}`);
  } finally {
    recorder.write(reportFile);
    process.stdout.write(
      `\n${recorder.passed ? "demo passed" : "demo FAILED"} in ${(recorder.totalMs / 1000).toFixed(2)} s — ` +
        `report written to ${reportFile}\n`,
    );
    process.exitCode = recorder.passed ? 0 : 1;
  }
}

await main();
