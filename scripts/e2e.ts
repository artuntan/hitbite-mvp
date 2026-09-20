import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeEventLog,
  erc20Abi,
  parseUnits,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hBTokenAbi, identityRegistryAbi } from "../packages/config/abi.ts";
import {
  accountFor,
  context,
  readDeployment,
  transact,
  json,
  safeError,
} from "./runtime.ts";
import { smoke } from "./smoke.ts";

type Evidence = {
  name: string;
  feature: string;
  status: "pass" | "fail";
  detail: string;
  hash?: Hex;
  block?: string;
  events?: string[];
};
const evidence: Evidence[] = [];
const started = new Date().toISOString();
const baseUrl = process.env.E2E_BASE_URL || "http://localhost:3000";
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const ctx = await context();
const d = readDeployment(ctx.name);
const token = { address: d.addresses.HBToken, abi: hBTokenAbi } as const;
const registry = {
  address: d.addresses.IdentityRegistry,
  abi: identityRegistryAbi,
} as const;
const a = accountFor("E2E_WALLET_A_PRIVATE_KEY"),
  b = accountFor("E2E_WALLET_B_PRIVATE_KEY");
const issuer = accountFor("ISSUER_PRIVATE_KEY"),
  registrar = accountFor("REGISTRAR_PRIVATE_KEY");
const subscription = parseUnits(process.env.E2E_SUBSCRIBE_USDC || "1", 6),
  coupon = parseUnits(process.env.E2E_COUPON_USDC || "0.2", 6);
let pausedByRunner = false;
let ciUrl = "";
function receiptEvidence(receipt: TransactionReceipt) {
  assert.equal(receipt.status, "success");
  const events: string[] = [];
  for (const log of receipt.logs)
    for (const abi of [hBTokenAbi, identityRegistryAbi, erc20Abi])
      try {
        events.push(
          decodeEventLog({ abi, topics: log.topics, data: log.data }).eventName,
        );
        break;
      } catch {}
  return {
    hash: receipt.transactionHash,
    block: receipt.blockNumber.toString(),
    events: [...new Set(events)],
  };
}
async function step(
  name: string,
  feature: string,
  fn: () => Promise<{ detail?: string; receipt?: TransactionReceipt } | void>,
) {
  try {
    const result = await fn();
    evidence.push({
      name,
      feature,
      status: "pass",
      detail: result?.detail || "Confirmed",
      ...(result?.receipt ? receiptEvidence(result.receipt) : {}),
    });
    console.log("PASS", name);
  } catch (e) {
    evidence.push({
      name,
      feature,
      status: "fail",
      detail: safeError(e).slice(0, 1200),
    });
    throw e;
  }
}
function eventArgs(receipt: TransactionReceipt, eventName: string) {
  for (const log of receipt.logs)
    try {
      const event = decodeEventLog({
        abi: hBTokenAbi,
        topics: log.topics,
        data: log.data,
      });
      if (event.eventName === eventName)
        return event.args as Record<string, unknown>;
    } catch {}
  throw new Error("Expected event missing: " + eventName);
}
async function rejects(
  abi: Abi,
  address: Address,
  functionName: string,
  args: readonly unknown[],
  account: Address,
  expected: string,
) {
  let found = false;
  try {
    await ctx.client.simulateContract({
      address,
      abi,
      functionName,
      args,
      account,
    });
  } catch (e) {
    const revert =
      e instanceof BaseError
        ? e.walk((cause) => cause instanceof ContractFunctionRevertedError)
        : undefined;
    if (revert instanceof ContractFunctionRevertedError) {
      assert.equal(revert.data?.errorName, expected);
      found = true;
    } else throw e;
  }
  assert.equal(found, true, "Expected " + expected + " revert");
}
async function api(body: unknown) {
  const response = await fetch(new URL("/api/verify", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: new URL(baseUrl).origin,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
try {
  await step(
    "NAV, trust anchor and four live routes",
    "NAV / transparency",
    async () => {
      const result = await smoke(baseUrl);
      return {
        detail:
          result.checks.join("; ") + `; NAV ${result.navUnits} micro-USDC.`,
      };
    },
  );
  await step(
    "Browser flow and client-side verification evidence",
    "Web app",
    async () => {
      const ui = JSON.parse(readFileSync(".context/ui-evidence.json", "utf8"));
      assert.equal(ui.baseUrl, baseUrl);
      assert.equal(ui.chainId, ctx.chain.id);
      assert.equal(ui.pageErrors.length, 0);
      assert(
        ui.results.length >= 6 &&
          ui.results.every((r: { passed: boolean }) => r.passed),
      );
      assert(
        Date.now() - Date.parse(ui.timestamp) < 24 * 3600_000,
        "Refresh browser evidence.",
      );
      mkdirSync("deployments/evidence", { recursive: true });
      writeFileSync("deployments/evidence/ui.json", json(ui));
      return {
        detail: `Automated browser test at ${ui.timestamp}; wallet ${ui.wallet}. This is not founder acceptance.`,
      };
    },
  );
  await step("CI checks for the source commit", "CI", async () => {
    const runs = JSON.parse(
      execFileSync(
        "gh",
        [
          "run",
          "list",
          "--workflow",
          "ci.yml",
          "--commit",
          sourceCommit,
          "--limit",
          "10",
          "--json",
          "databaseId,conclusion,status,url,headSha",
        ],
        { encoding: "utf8" },
      ),
    );
    const run = runs.find(
      (r: { status: string; conclusion: string; headSha: string }) =>
        r.status === "completed" &&
        r.conclusion === "success" &&
        r.headSha === sourceCommit,
    );
    assert(run, "No green CI run exists for the exact source commit.");
    ciUrl = run.url;
    return { detail: ciUrl };
  });
  await step(
    "Fresh independent wallets and funded testnet",
    "Contracts",
    async () => {
      assert.equal(ctx.name, "arc-testnet");
      assert.notEqual(a.address, b.address);
      assert(subscription > 0n && subscription <= 5_000_000n);
      assert(coupon > 0n && coupon <= 1_000_000n);
      assert.equal(
        await ctx.client.readContract({ ...token, functionName: "paused" }),
        false,
        "Token must start unpaused.",
      );
      for (const account of [a, b]) {
        assert.equal(
          await ctx.client.readContract({
            ...registry,
            functionName: "countryOf",
            args: [account.address],
          }),
          0,
          "Use two fresh test wallets; existing registry records cannot self-register.",
        );
        const balance = await ctx.client.readContract({
          address: d.addresses.USDC,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account.address],
        });
        assert(
          balance > subscription + 200_000n,
          "Fund each wallet with USDC and gas headroom.",
        );
      }
      return {
        detail: `Fresh wallets ${a.address} and ${b.address}; chain ${ctx.chain.id}.`,
      };
    },
  );
  await step(
    "US and Türkiye are blocked in API and contract",
    "Verify",
    async () => {
      for (const country of [840, 792]) {
        const result = await api({
          action: "challenge",
          address: a.address,
          name: "E2E simulated applicant",
          country,
          professional: true,
        });
        assert.equal(result.status, 403);
        assert.match(result.body.error, /Not available to residents/);
        await rejects(
          identityRegistryAbi,
          d.addresses.IdentityRegistry,
          "addVerified",
          [a.address, country],
          registrar.address,
          "BlockedCountry",
        );
      }
    },
  );
  for (const [name, account, country] of [
    ["A", a, 826],
    ["B", b, 250],
  ] as const) {
    await step(
      `Wallet ${name}: signed simulated verification`,
      "Verify",
      async () => {
        const challenge = await api({
          action: "challenge",
          address: account.address,
          name: `E2E simulated applicant ${name}`,
          country,
          professional: true,
        });
        assert.equal(challenge.status, 200);
        const signature = await account.signMessage({
          message: challenge.body.message,
        });
        const premature = await api({
          action: "complete",
          ticket: challenge.body.ticket,
          signature,
        });
        assert.equal(premature.status, 400);
        assert.match(premature.body.error, /still pending/);
        await new Promise((resolve) => setTimeout(resolve, 10_100));
        const completed = await api({
          action: "complete",
          ticket: challenge.body.ticket,
          signature,
        });
        assert.equal(completed.status, 200, completed.body.error);
        assert.equal(completed.body.verified, true);
        const receipt = await ctx.client.getTransactionReceipt({
          hash: completed.body.transactionHash,
        });
        assert.equal(
          await ctx.client.readContract({
            ...registry,
            functionName: "isVerified",
            args: [account.address],
          }),
          true,
        );
        assert.equal(
          await ctx.client.readContract({
            ...registry,
            functionName: "countryOf",
            args: [account.address],
          }),
          country,
        );
        return {
          receipt,
          detail:
            "Wallet signature checked; early completion rejected; ten-second review enforced; registrar receipt confirmed.",
        };
      },
    );
    const variable = `E2E_WALLET_${name}_PRIVATE_KEY`;
    await step(
      `Wallet ${name}: approve exact USDC subscription`,
      "Subscribe",
      async () => ({
        receipt: await transact(
          ctx,
          variable,
          d.addresses.USDC,
          erc20Abi,
          "approve",
          [d.addresses.HBToken, subscription],
        ),
      }),
    );
    await step(
      `Wallet ${name}: subscribe with 6-decimal USDC`,
      "Subscribe",
      async () => {
        const receipt = await transact(
          ctx,
          variable,
          d.addresses.HBToken,
          hBTokenAbi,
          "subscribe",
          [subscription],
        );
        const args = eventArgs(receipt, "Subscribed");
        assert.equal(args.usdcIn, subscription);
        assert.equal(
          args.tokensOut,
          (subscription * 10n ** 18n) / (args.nav as bigint),
        );
        assert.equal(
          await ctx.client.readContract({
            ...token,
            functionName: "balanceOf",
            args: [account.address],
          }),
          args.tokensOut,
        );
        return {
          receipt,
          detail: `Minted ${(args.tokensOut as bigint).toString()} token base units; exact decimals verified.`,
        };
      },
    );
  }
  await step(
    "Unverified wallet cannot receive hbTRS",
    "Contracts",
    async () => {
      const fresh = privateKeyToAccount(generatePrivateKey());
      await rejects(
        hBTokenAbi,
        d.addresses.HBToken,
        "transfer",
        [fresh.address, 1n],
        a.address,
        "NotVerified",
      );
    },
  );
  await step("Issuer approves coupon funding", "Admin", async () => ({
    receipt: await transact(
      ctx,
      "ISSUER_PRIVATE_KEY",
      d.addresses.USDC,
      erc20Abi,
      "approve",
      [d.addresses.HBToken, coupon],
    ),
  }));
  await step(
    "Issuer distributes a funded coupon",
    "Hold / coupons",
    async () => {
      const receipt = await transact(
        ctx,
        "ISSUER_PRIVATE_KEY",
        d.addresses.HBToken,
        hBTokenAbi,
        "distributeCoupon",
        [coupon],
      );
      assert.equal(eventArgs(receipt, "CouponDistributed").usdcAmount, coupon);
      return { receipt };
    },
  );
  for (const [name, account, variable] of [
    ["A", a, "E2E_WALLET_A_PRIVATE_KEY"],
    ["B", b, "E2E_WALLET_B_PRIVATE_KEY"],
  ] as const) {
    await step(
      `Wallet ${name}: claim accrued coupon`,
      "Hold / coupons",
      async () => {
        const accrued = await ctx.client.readContract({
          ...token,
          functionName: "accruedCoupon",
          args: [account.address],
        });
        assert(accrued > 0n);
        const receipt = await transact(
          ctx,
          variable,
          d.addresses.HBToken,
          hBTokenAbi,
          "claimCoupon",
        );
        assert.equal(eventArgs(receipt, "CouponClaimed").usdcAmount, accrued);
        assert.equal(
          await ctx.client.readContract({
            ...token,
            functionName: "accruedCoupon",
            args: [account.address],
          }),
          0n,
        );
        return { receipt, detail: `Claimed ${accrued} micro-USDC.` };
      },
    );
    await step(
      `Wallet ${name}: redeem full token balance`,
      "Redeem",
      async () => {
        const balance = await ctx.client.readContract({
          ...token,
          functionName: "balanceOf",
          args: [account.address],
        });
        const receipt = await transact(
          ctx,
          variable,
          d.addresses.HBToken,
          hBTokenAbi,
          "redeem",
          [balance],
        );
        const args = eventArgs(receipt, "Redeemed");
        assert.equal(args.tokensIn, balance);
        assert.equal(
          args.usdcOut,
          (balance * (args.nav as bigint)) / 10n ** 18n,
        );
        assert.equal(
          await ctx.client.readContract({
            ...token,
            functionName: "balanceOf",
            args: [account.address],
          }),
          0n,
        );
        return {
          receipt,
          detail: `Burned all tokens; redemption output ${(args.usdcOut as bigint).toString()} micro-USDC.`,
        };
      },
    );
  }
  await step("Issuer pauses token", "Admin", async () => {
    const receipt = await transact(
      ctx,
      "ISSUER_PRIVATE_KEY",
      d.addresses.HBToken,
      hBTokenAbi,
      "pause",
    );
    pausedByRunner = true;
    return { receipt };
  });
  await step("Pause blocks subscription", "Contracts", async () => {
    await rejects(
      hBTokenAbi,
      d.addresses.HBToken,
      "subscribe",
      [subscription],
      a.address,
      "EnforcedPause",
    );
  });
  await step("Issuer restores unpaused token", "Admin", async () => {
    const receipt = await transact(
      ctx,
      "ISSUER_PRIVATE_KEY",
      d.addresses.HBToken,
      hBTokenAbi,
      "unpause",
    );
    pausedByRunner = false;
    return { receipt };
  });
} catch (e) {
  console.error(safeError(e));
  process.exitCode = 1;
} finally {
  if (pausedByRunner)
    try {
      const receipt = await transact(
        ctx,
        "ISSUER_PRIVATE_KEY",
        d.addresses.HBToken,
        hBTokenAbi,
        "unpause",
      );
      evidence.push({
        name: "Cleanup: unpause after failure",
        feature: "Admin",
        status: "pass",
        detail: "Restored safe testnet operation.",
        ...receiptEvidence(receipt),
      });
    } catch {
      evidence.push({
        name: "Cleanup unpause failed",
        feature: "Admin",
        status: "fail",
        detail: "An issuer must unpause the token.",
      });
      process.exitCode = 1;
    }
  const features = [
    "Contracts",
    "Verify",
    "Subscribe",
    "Hold / coupons",
    "Redeem",
    "Admin",
    "NAV / transparency",
    "Web app",
    "CI",
  ];
  const url = ctx.chain.blockExplorers?.default.url || "";
  const overall =
    evidence.some((e) => e.status === "fail") ||
    features.some((f) => !evidence.some((e) => e.feature === f));
  const clean = (text: string) =>
    text.replaceAll("|", "/").replaceAll("\n", " ").replace(/\s+/g, " ");
  const matrix = features
    .map((feature) => {
      const rows = evidence.filter((e) => e.feature === feature);
      return `| ${feature} | ${!rows.length ? "⚠️ Not run" : rows.some((r) => r.status === "fail") ? "❌ Failed" : "✅ Passed"} | ${rows.filter((r) => r.status === "pass").length} checks |`;
    })
    .join("\n");
  const transactions = evidence
    .map(
      (e) =>
        `| ${clean(e.name)} | ${e.status === "pass" ? "✅" : "❌"} | ${e.hash ? `[${e.hash}](${url}/tx/${e.hash}) · block ${e.block}` : clean(e.detail)} | ${e.events?.join(", ") || "—"} |`,
    )
    .join("\n");
  const status = `# Generated live testnet status\n\nGenerated only by \`pnpm e2e\`. Started ${started}; finished ${new Date().toISOString()}.\n\nApp: [${new URL(baseUrl).host}](${baseUrl}) · Chain: ${ctx.chain.id} · [Source commit](https://github.com/artuntan/hitbite-mvp/commit/${sourceCommit})${ciUrl ? ` · [CI](${ciUrl})` : ""}\n\n${overall ? "The automated Core gate is incomplete; see failed or unrun checks." : "All automated Core checks passed against the live Arc deployment."}\n\n| Feature | Result | Evidence |\n|---|---|---|\n${matrix}\n\n## Live run\n\nWallet A: \`${a.address}\`  \nWallet B: \`${b.address}\`  \nIssuer: \`${issuer.address}\`\n\n| Check | Result | Receipt / observation | Events |\n|---|---|---|---|\n${transactions}\n\n## Acceptance and limits\n\n- ⚠️ Founder acceptance remains unconfirmed: an automated wallet bridge is not a claim that the founder personally completed the flow.\n- This run covers the selected Arc deployment. Base Sepolia deployment, monthly coupon automation and WalletConnect QR pairing are not claimed. Injected browser wallets are supported.\n- Portfolio and prices are simulated. Quotes carry forward until manually revised; attestation authenticates a historical simulated snapshot, not real custody.\n- The simulated registrar uses signed review tickets and on-chain eligibility records; production KYC and distributed abuse prevention require the licensed partner.\n- Tests transact with real testnet USDC; transaction fees mean wallet cash differences include gas. Event amounts and token balances are checked separately.\n`;
  writeFileSync("STATUS.md", status);
  mkdirSync("deployments/evidence", { recursive: true });
  writeFileSync(
    "deployments/evidence/e2e.json",
    json({
      started,
      finished: new Date().toISOString(),
      baseUrl,
      chainId: ctx.chain.id,
      sourceCommit,
      ciUrl,
      walletA: a.address,
      walletB: b.address,
      automatedCorePassed: !overall,
      founderAcceptance: "unconfirmed",
      evidence,
    }),
  );
  console.log("Generated STATUS.md and public receipt evidence.");
}
