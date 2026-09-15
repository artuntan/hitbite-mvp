/**
 * report — the run's ledger, and the Markdown proof artefact written from it.
 *
 * `demo/REPORT.md` is the artefact a reviewer reads instead of trusting a green tick: every
 * transaction hash, the balances before and after, every assertion with its expected and actual
 * value as exact base-unit integers, and how long each step took. It is written on *every* run,
 * including a failed one — a demo that only produces a report when it passes proves nothing.
 *
 * Nothing secret reaches this file. Addresses and transaction hashes are public chain data; the
 * endpoint is reduced to its host by `endpointHost` because a provider URL can carry an API key;
 * private keys never leave `config.ts`.
 */

import { writeFileSync } from "node:fs";
import type { Address, Hash } from "viem";
import type { Actor, DemoConfig } from "./config.ts";

// --------------------------------------------------------------------------------- model

/** A transaction the runner sent, successful or deliberately reverting. */
export type TxRecord = {
  readonly label: string;
  readonly hash: Hash;
  readonly from: Address;
  readonly status: "success" | "reverted";
  readonly gasUsed: bigint;
  readonly blockNumber: bigint;
  readonly note?: string;
};

/** Something the step did that was not a transaction: a skip, a read, an explanation. */
export type NoteRecord = {
  readonly kind: "skip" | "note";
  readonly text: string;
};

/** One assertion: what was claimed, what was expected, what the chain actually said. */
export type Assertion = {
  readonly id: string;
  readonly step: string;
  readonly claim: string;
  readonly expected: string;
  readonly actual: string;
  readonly passed: boolean;
};

/** One of the eight steps, or the preflight that precedes them. */
export type StepRecord = {
  readonly key: string;
  readonly title: string;
  readonly txs: TxRecord[];
  readonly notes: NoteRecord[];
  durationMs: number;
  status: "passed" | "failed" | "skipped";
};

/** The chain state the report tabulates before and after the run. */
export type Snapshot = {
  readonly nav: bigint;
  readonly totalSupply: bigint;
  readonly vaultUsdc: bigint;
  readonly couponReserve: bigint;
  readonly availableLiquidity: bigint;
  readonly distributionCount: bigint;
  readonly tokenA: bigint;
  readonly tokenB: bigint;
  readonly tokenC: bigint;
  readonly usdcA: bigint;
  readonly usdcB: bigint;
  readonly usdcC: bigint;
  readonly pendingA: bigint;
  readonly pendingB: bigint;
};

/** Thrown when an assertion fails; the run stops and the report is written with the failure. */
export class AssertionFailed extends Error {
  readonly assertion: Assertion;

  constructor(assertion: Assertion) {
    super(
      `assertion ${assertion.id} failed: ${assertion.claim} (expected ${assertion.expected}, got ${assertion.actual})`,
    );
    this.name = "AssertionFailed";
    this.assertion = assertion;
  }
}

// --------------------------------------------------------------------------------- formatting

/** `1234567n` at 6 decimals -> `"1.234567"`, with thousands separators on the integer part. */
export function formatUnits(value: bigint, decimals: number, minFractionDigits = decimals): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  let fraction = decimals === 0 ? "" : digits.slice(digits.length - decimals);
  while (fraction.length > minFractionDigits && fraction.endsWith("0")) {
    fraction = fraction.slice(0, -1);
  }
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction === "" ? "" : `.${fraction}`}`;
}

/** USDC and NAV amounts: always six decimals, so `12.000000` and `199.260000` line up. */
export const usdc = (value: bigint): string => formatUnits(value, 6);

/** hbTRS amounts: eighteen decimals, trailing zeros trimmed to two so tables stay readable. */
export const hb = (value: bigint): string => formatUnits(value, 18, 2);

/** An exact base-unit integer next to its human reading, which is what an assertion compares. */
export const exact = (value: bigint, unit: "usdc" | "hb" | "raw"): string => {
  if (unit === "raw") return `\`${value.toString()}\``;
  const human = unit === "usdc" ? `${usdc(value)} USDC` : `${hb(value)} hbTRS`;
  return `\`${value.toString()}\` (${human})`;
};

const shortAddress = (address: Address): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

// --------------------------------------------------------------------------------- recorder

/** Collects everything the run did, then renders it. One instance per run. */
export class Recorder {
  readonly startedAt = new Date();
  private readonly startedAtMs = performance.now();
  private config: DemoConfig | undefined;
  private readonly steps: StepRecord[] = [];
  private readonly assertions: Assertion[] = [];
  private current: StepRecord | undefined;
  private currentStartedAtMs = 0;
  private before: Snapshot | undefined;
  private after: Snapshot | undefined;
  private failure: { readonly message: string; readonly hint: string | undefined } | undefined;

  configure(config: DemoConfig): void {
    this.config = config;
  }

  snapshotBefore(snapshot: Snapshot): void {
    this.before = snapshot;
  }

  snapshotAfter(snapshot: Snapshot): void {
    this.after = snapshot;
  }

  /** Opens a step; the previous one must have been closed by {@link endStep}. */
  startStep(key: string, title: string): void {
    const step: StepRecord = { key, title, txs: [], notes: [], durationMs: 0, status: "passed" };
    this.steps.push(step);
    this.current = step;
    this.currentStartedAtMs = performance.now();
    process.stdout.write(`\n${key === "preflight" ? "preflight" : `step ${key}`}  ${title}\n`);
  }

  endStep(): void {
    if (this.current === undefined) return;
    this.current.durationMs = performance.now() - this.currentStartedAtMs;
    this.current = undefined;
  }

  private step(): StepRecord {
    if (this.current === undefined) throw new Error("no step is open");
    return this.current;
  }

  tx(record: TxRecord): void {
    this.step().txs.push(record);
    const gas = record.gasUsed.toString();
    process.stdout.write(
      `  tx    ${record.label} -> ${record.status} (gas ${gas}, block ${record.blockNumber}) ${record.hash}\n`,
    );
  }

  /** Records something the run deliberately did not do, and why. Idempotency shows up here. */
  skip(text: string): void {
    this.step().notes.push({ kind: "skip", text });
    process.stdout.write(`  skip  ${text}\n`);
  }

  note(text: string): void {
    this.step().notes.push({ kind: "note", text });
    process.stdout.write(`  note  ${text}\n`);
  }

  /**
   * Records an assertion and throws {@link AssertionFailed} when it does not hold. Comparison is
   * strict equality on a primitive — bigint against bigint, never a tolerance.
   */
  check<T extends bigint | boolean | number | string>(
    id: string,
    claim: string,
    expected: T,
    actual: T,
    show: (value: T) => string = (value) => `\`${String(value)}\``,
  ): void {
    this.record(id, claim, show(expected), show(actual), expected === actual);
  }

  /** Records a lower bound, e.g. "the wallet holds at least what it is about to spend". */
  checkAtLeast(
    id: string,
    claim: string,
    minimum: bigint,
    actual: bigint,
    show: (value: bigint) => string,
  ): void {
    this.record(id, claim, `>= ${show(minimum)}`, show(actual), actual >= minimum);
  }

  /** Records an upper bound, e.g. "the NAV move stays inside the rail". */
  checkAtMost(
    id: string,
    claim: string,
    limit: bigint,
    actual: bigint,
    show: (value: bigint) => string,
  ): void {
    this.record(id, claim, `<= ${show(limit)}`, show(actual), actual <= limit);
  }

  private record(
    id: string,
    claim: string,
    expected: string,
    actual: string,
    passed: boolean,
  ): void {
    const assertion: Assertion = {
      id,
      step: this.current?.key ?? "-",
      claim,
      expected,
      actual,
      passed,
    };
    this.assertions.push(assertion);
    process.stdout.write(`  ${passed ? "pass" : "FAIL"}  ${id}  ${claim}\n`);
    if (!passed) {
      if (this.current !== undefined) this.current.status = "failed";
      throw new AssertionFailed(assertion);
    }
  }

  /** Records the failure that stopped the run. The report is written either way. */
  fail(message: string, hint?: string): void {
    this.failure = { message, hint };
    if (this.current !== undefined) {
      this.current.status = "failed";
      this.current.durationMs = performance.now() - this.currentStartedAtMs;
      this.current = undefined;
    }
  }

  get passed(): boolean {
    return this.failure === undefined && this.assertions.every((assertion) => assertion.passed);
  }

  get totalMs(): number {
    return performance.now() - this.startedAtMs;
  }

  get assertionCount(): number {
    return this.assertions.length;
  }

  /** Renders the Markdown report and writes it to `demo/REPORT.md`. */
  write(file: string): void {
    writeFileSync(file, this.render(), "utf8");
  }

  // ------------------------------------------------------------------------------- rendering

  private render(): string {
    const out: string[] = [];
    const config = this.config;

    out.push("# HitBite demo run report");
    out.push("");
    out.push(
      config === undefined
        ? "_Testnet demonstration. Simulated portfolio and attestation. Not an offer of securities._"
        : `_Testnet demonstration on ${chainLabel(config)}. Simulated portfolio and attestation. Not an offer of securities._`,
    );
    out.push("");
    out.push(
      "Generated by `make demo` (`demo/run.ts`), which runs the eight-step scenario in " +
        "BUILD_PROMPT.md section 9 against a live chain and asserts the outcome of every step. " +
        "This file is overwritten by each run, including a failing one.",
    );
    out.push("");
    out.push(`**Result: ${this.passed ? "PASSED" : "FAILED"}** — ${this.summaryLine()}`);
    out.push("");

    out.push(...this.renderRunTable(config));
    if (this.failure !== undefined) out.push(...this.renderFailure());
    if (config !== undefined)
      out.push(...this.renderContracts(config), ...this.renderParticipants(config));
    out.push(...this.renderSteps());
    out.push(...this.renderBalances());
    out.push(...this.renderAssertions());
    out.push(...this.renderTiming());
    out.push(...this.renderReproduce(config));

    return `${out.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
  }

  private summaryLine(): string {
    const passedCount = this.assertions.filter((assertion) => assertion.passed).length;
    const txCount = this.steps.reduce((total, step) => total + step.txs.length, 0);
    return (
      `${passedCount}/${this.assertions.length} assertions passed, ` +
      `${txCount} transaction${txCount === 1 ? "" : "s"} sent, ` +
      `${(this.totalMs / 1000).toFixed(2)} s total.`
    );
  }

  private renderRunTable(config: DemoConfig | undefined): string[] {
    const rows = [
      ["Started (UTC)", this.startedAt.toISOString()],
      [
        "Chain",
        config === undefined
          ? "(not resolved)"
          : `${config.chainName} (chain id ${config.chainId})`,
      ],
      [
        "Endpoint",
        config === undefined
          ? "(not resolved)"
          : `\`${config.rpcHost}\` (host only; a URL can carry a key)`,
      ],
      ["Runner", "`demo/run.ts` — TypeScript + viem via tsx (PLAN.md D11)"],
      ["Total duration", `${(this.totalMs / 1000).toFixed(2)} s`],
      [
        "Assertions",
        `${this.assertions.filter((a) => a.passed).length} passed / ${this.assertions.length} total`,
      ],
    ];
    return ["## Run", "", "| | |", "| --- | --- |", ...rows.map(([k, v]) => `| ${k} | ${v} |`), ""];
  }

  private renderFailure(): string[] {
    const failure = this.failure;
    if (failure === undefined) return [];
    const sent = this.steps.reduce((total, step) => total + step.txs.length, 0);
    return [
      "## Failure",
      "",
      sent === 0
        ? "The run stopped before it sent anything: nothing below happened on chain."
        : "The run stopped here. Every transaction listed below had already been mined.",
      "",
      "```",
      failure.message,
      ...(failure.hint === undefined ? [] : ["", failure.hint]),
      "```",
      "",
    ];
  }

  private renderContracts(config: DemoConfig): string[] {
    const { addresses } = config.deployment;
    const rows = (["HBToken", "IdentityRegistry", "MockUSDC"] as const).map((name) => {
      const address = addresses[name];
      return `| ${name} | ${this.link(config, "address", address)} |`;
    });
    return [
      "## Contracts",
      "",
      `Read from \`contracts/deployments/${config.chainName}.json\`, deploy block ${config.deployment.deployBlock}.`,
      "",
      "| Contract | Address |",
      "| --- | --- |",
      ...rows,
      "",
    ];
  }

  private renderParticipants(config: DemoConfig): string[] {
    const { actors } = config;
    const rows: Array<[Actor, string]> = [
      [actors.walletA, "investor, country 784 (United Arab Emirates), professional"],
      [actors.walletB, "investor, country 276 (Germany), professional"],
      [actors.walletC, "investor, country 840 (United States) — blocked, never verified"],
      [actors.registrar, "REGISTRAR_ROLE on IdentityRegistry"],
      [actors.issuer, "ISSUER_ROLE on HBToken"],
      [actors.oracle, "ORACLE_ROLE on HBToken"],
    ];
    return [
      "## Participants",
      "",
      "| Actor | Address | Role | Signer |",
      "| --- | --- | --- | --- |",
      ...rows.map(
        ([actor, role]) =>
          `| ${actor.label} | ${this.link(config, "address", actor.address)} | ${role} | ${actor.source} |`,
      ),
      "",
      rows.some(([actor]) => actor.signer === "anvil-unlocked")
        ? "No private key is read from, or written to, any file: the keys named above come from the " +
          "environment, and the Anvil accounts are used unlocked over `eth_sendTransaction`, so the " +
          "runner never holds their keys at all."
        : "No private key is read from, or written to, any file: each signer above names the " +
          "environment variable its key came from, and nothing else about it is recorded.",
      "",
    ];
  }

  private renderSteps(): string[] {
    const out: string[] = ["## Steps", ""];
    for (const step of this.steps) {
      const heading = step.key === "preflight" ? "Preflight" : `Step ${step.key}`;
      out.push(`### ${heading} — ${step.title}`, "");
      for (const note of step.notes) {
        out.push(`- ${note.kind === "skip" ? "**skipped:** " : ""}${note.text}`);
      }
      if (step.notes.length > 0) out.push("");
      if (step.txs.length > 0) {
        out.push(
          "| Transaction | From | Result | Gas | Block | Hash |",
          "| --- | --- | --- | --- | --- | --- |",
        );
        for (const tx of step.txs) {
          const label = tx.note === undefined ? tx.label : `${tx.label}<br>_${tx.note}_`;
          out.push(
            `| ${label} | ${shortAddress(tx.from)} | ${tx.status} | ${tx.gasUsed} | ${tx.blockNumber} | ` +
              `${this.link(this.config, "tx", tx.hash)} |`,
          );
        }
        out.push("");
      }
      const stepAssertions = this.assertions.filter((assertion) => assertion.step === step.key);
      if (stepAssertions.length > 0) {
        out.push(
          `Assertions: ${stepAssertions.map((a) => `${a.id} ${a.passed ? "passed" : "**FAILED**"}`).join(", ")}.`,
          "",
        );
      }
      out.push(`_${(step.durationMs / 1000).toFixed(2)} s._`, "");
    }
    return out;
  }

  private renderBalances(): string[] {
    const before = this.before;
    const after = this.after;
    if (before === undefined || after === undefined) return [];
    type Row = [string, (snapshot: Snapshot) => bigint, (value: bigint) => string];
    const rows: Row[] = [
      ["NAV per hbTRS (USDC)", (s) => s.nav, usdc],
      ["Total supply (hbTRS)", (s) => s.totalSupply, hb],
      ["Vault USDC", (s) => s.vaultUsdc, usdc],
      ["Coupon reserve (USDC)", (s) => s.couponReserve, usdc],
      ["Available liquidity (USDC)", (s) => s.availableLiquidity, usdc],
      ["Distributions to date", (s) => s.distributionCount, (v) => v.toString()],
      ["Wallet A hbTRS", (s) => s.tokenA, hb],
      ["Wallet A USDC", (s) => s.usdcA, usdc],
      ["Wallet A pending coupon (USDC)", (s) => s.pendingA, usdc],
      ["Wallet B hbTRS", (s) => s.tokenB, hb],
      ["Wallet B USDC", (s) => s.usdcB, usdc],
      ["Wallet B pending coupon (USDC)", (s) => s.pendingB, usdc],
      ["Wallet C hbTRS", (s) => s.tokenC, hb],
      ["Wallet C USDC", (s) => s.usdcC, usdc],
    ];
    return [
      "## Balances",
      "",
      "`before` is the state after the preflight and immediately before step 1; `after` is the " +
        "state once step 7 has settled.",
      "",
      "| | Before | After | Change |",
      "| --- | ---: | ---: | ---: |",
      ...rows.map(([label, read, format]) => {
        const from = read(before);
        const to = read(after);
        const delta = to - from;
        const sign = delta > 0n ? "+" : "";
        return `| ${label} | ${format(from)} | ${format(to)} | ${delta === 0n ? "0" : `${sign}${format(delta)}`} |`;
      }),
      "",
    ];
  }

  private renderAssertions(): string[] {
    if (this.assertions.length === 0) return [];
    return [
      "## Assertions",
      "",
      "Every comparison is exact integer equality in base units — no tolerances.",
      "",
      "| # | Step | Assertion | Expected | Actual | Result |",
      "| --- | --- | --- | --- | --- | --- |",
      ...this.assertions.map(
        (a) =>
          `| ${a.id} | ${a.step} | ${a.claim} | ${a.expected} | ${a.actual} | ${a.passed ? "passed" : "**FAILED**"} |`,
      ),
      "",
    ];
  }

  private renderTiming(): string[] {
    if (this.steps.length === 0) return [];
    return [
      "## Timing",
      "",
      "| Step | What | Seconds |",
      "| --- | --- | ---: |",
      ...this.steps.map((s) => `| ${s.key} | ${s.title} | ${(s.durationMs / 1000).toFixed(2)} |`),
      `| | **total** | **${(this.totalMs / 1000).toFixed(2)}** |`,
      "",
    ];
  }

  private renderReproduce(config: DemoConfig | undefined): string[] {
    const chain = config?.chainName ?? "anvil";
    return [
      "## Reproduce",
      "",
      "```sh",
      "make anvil              # terminal 1: a local node",
      "make deploy-local       # terminal 2: deploy and record the addresses",
      `make demo CHAIN=${chain}   # run this scenario and rewrite demo/REPORT.md`,
      "```",
      "",
      "The run is idempotent: a second run against the same deployment skips the work that is " +
        "already done (see the preflight and step notes above) and asserts the same numbers.",
      "",
      "---",
      "",
      "This is a technical demonstration on a public test network. Portfolio data, prices and " +
        "attestations are simulated or illustrative and are labelled as such. Nothing here is an " +
        "offer, solicitation or recommendation to buy any security. HitBite is not a licensed " +
        "financial institution.",
    ];
  }

  private link(config: DemoConfig | undefined, kind: "tx" | "address", value: string): string {
    const base = config?.explorerUrl;
    if (base === undefined) return `\`${value}\``;
    return `[\`${value}\`](${base}/${kind}/${value})`;
  }
}

/** "Base Sepolia" / "a local Anvil node", for the banner line. */
function chainLabel(config: DemoConfig): string {
  return config.chainName === "base-sepolia" ? "Base Sepolia" : "a local Anvil node";
}
