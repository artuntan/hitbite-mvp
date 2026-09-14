/**
 * sync-contracts — generate `web/lib/generated/{abis,addresses}.ts` from the Foundry build.
 *
 * Inputs (both live outside `web/`, which is why the output is committed):
 *   - `contracts/out/<Name>.sol/<Name>.json`   forge build artefacts, for the ABIs
 *   - `contracts/deployments/<network>.json`   written by `script/Deploy.s.sol` (PLAN.md D45)
 *
 * Run it from `web/` with `pnpm sync:contracts` after `forge build` whenever a contract's
 * interface changes or a new deployment lands, and commit the result. Vercel's build root is
 * `web/` and cannot run `forge`, so the generated files are part of the source tree, not a
 * build artefact.
 *
 * The script refuses to write anything it cannot fully verify: a missing `contracts/out`, an
 * artefact without an ABI, a malformed address, or a deployment on a chain that is not one of
 * the two testnets this project is allowed to touch (BUILD_PROMPT.md section 2). Emitting an
 * empty-but-type-checking file would move the failure to runtime, in the browser, on a page a
 * reviewer is looking at.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import * as prettier from "prettier";

// --------------------------------------------------------------------------- configuration

/** Contracts whose ABI the web app needs, in the order they are written to `abis.ts`. */
const CONTRACTS = ["HBToken", "IdentityRegistry", "MockUSDC"] as const;
type ContractName = (typeof CONTRACTS)[number];

/**
 * The only chain ids this repository may reference. Kept in lockstep with `web/lib/chains.ts`
 * and `contracts/script/Config.s.sol`; a deployment file for anything else is a hard error here
 * rather than a surprise in `lib/chains.ts` at type-check time.
 */
const ALLOWED_CHAINS = {
  31337: "anvil",
  84532: "base-sepolia",
} as const satisfies Record<number, string>;
type AllowedChainId = keyof typeof ALLOWED_CHAINS;

/** `hbTokenAbi`, `identityRegistryAbi`, `mockUsdcAbi` — the identifiers the app imports. */
const ABI_EXPORT_NAMES = {
  HBToken: "hbTokenAbi",
  IdentityRegistry: "identityRegistryAbi",
  MockUSDC: "mockUsdcAbi",
} as const satisfies Record<ContractName, string>;

const WEB_DIR = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(WEB_DIR, "..");
const OUT_DIR = path.join(REPO_ROOT, "contracts", "out");
const DEPLOYMENTS_DIR = path.join(REPO_ROOT, "contracts", "deployments");
const GENERATED_DIR = path.join(WEB_DIR, "lib", "generated");

// --------------------------------------------------------------------------- failure

class SyncError extends Error {
  readonly hint: string;

  constructor(message: string, hint: string) {
    super(message);
    this.name = "SyncError";
    this.hint = hint;
  }
}

function rel(absolute: string): string {
  return path.relative(REPO_ROOT, absolute) || ".";
}

// --------------------------------------------------------------------------- small validators

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(file: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (cause) {
    throw new SyncError(
      `cannot read ${rel(file)}: ${(cause as Error).message}`,
      "Check the path and file permissions.",
    );
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (cause) {
    throw new SyncError(
      `${rel(file)} is not valid JSON: ${(cause as Error).message}`,
      "Re-run `forge build` (or `make deploy`) to regenerate it.",
    );
  }
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

function requireAddress(value: unknown, where: string): string {
  if (typeof value !== "string" || !ADDRESS_RE.test(value)) {
    throw new SyncError(
      `${where} is not a 20-byte hex address: ${JSON.stringify(value)}`,
      "Re-run the deploy script; `deployments/<network>.json` is written by script/Deploy.s.sol.",
    );
  }
  return value;
}

function requireTxHash(value: unknown, where: string): string {
  if (typeof value !== "string" || !TX_HASH_RE.test(value)) {
    throw new SyncError(
      `${where} is not a 32-byte hex transaction hash: ${JSON.stringify(value)}`,
      "Re-run `make deploy` — it passes --slow and re-checks every hash with `cast receipt` (PLAN.md D45).",
    );
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new SyncError(
      `${where} is not a non-negative integer: ${JSON.stringify(value)}`,
      "Re-run the deploy script.",
    );
  }
  return value;
}

// --------------------------------------------------------------------------- ABIs

interface LoadedAbi {
  readonly name: ContractName;
  readonly abi: readonly unknown[];
  readonly source: string;
  readonly functions: number;
  readonly events: number;
  readonly errors: number;
}

function assertForgeOutExists(): void {
  if (!existsSync(OUT_DIR) || !statSync(OUT_DIR).isDirectory()) {
    throw new SyncError(
      `no Foundry build output at ${rel(OUT_DIR)}`,
      [
        "Build the contracts first, then re-run this script:",
        "",
        "  cd contracts && forge build",
        "  cd ../web   && pnpm sync:contracts",
        "",
        "(`make build-contracts` from the repository root does the same thing.)",
      ].join("\n"),
    );
  }
}

function loadAbi(name: ContractName): LoadedAbi {
  const artefact = path.join(OUT_DIR, `${name}.sol`, `${name}.json`);
  if (!existsSync(artefact)) {
    throw new SyncError(
      `no build artefact for ${name} at ${rel(artefact)}`,
      `Run \`forge build\` in contracts/. If ${name}.sol was renamed or moved, update CONTRACTS in ${rel(
        path.join(WEB_DIR, "scripts", "sync-contracts.ts"),
      )}.`,
    );
  }

  const parsed = readJson(artefact);
  if (!isRecord(parsed) || !Array.isArray(parsed.abi)) {
    throw new SyncError(
      `${rel(artefact)} has no "abi" array`,
      "Delete contracts/out and re-run `forge build`; a truncated artefact is usually an interrupted build.",
    );
  }
  const abi = parsed.abi as readonly unknown[];
  if (abi.length === 0) {
    throw new SyncError(
      `${rel(artefact)} has an empty ABI`,
      `${name} compiled to nothing callable. Check contracts/src/${name}.sol.`,
    );
  }

  const count = (type: string): number =>
    abi.filter((entry) => isRecord(entry) && entry.type === type).length;

  return {
    name,
    abi,
    source: rel(artefact),
    functions: count("function"),
    events: count("event"),
    errors: count("error"),
  };
}

// --------------------------------------------------------------------------- deployments

interface LoadedDeployment {
  readonly chainId: AllowedChainId;
  readonly network: string;
  readonly deployBlock: number;
  readonly timestamp: number;
  readonly addresses: Record<ContractName, string>;
  readonly txHashes: Record<ContractName, string>;
  readonly source: string;
}

function loadDeployment(file: string): LoadedDeployment {
  const parsed = readJson(file);
  if (!isRecord(parsed)) {
    throw new SyncError(`${rel(file)} is not a JSON object`, "Re-run the deploy script.");
  }

  const chainId = requireNonNegativeInteger(parsed.chainId, `${rel(file)} .chainId`);
  if (!(chainId in ALLOWED_CHAINS)) {
    throw new SyncError(
      `${rel(file)} targets chain ${chainId}, which is not a permitted testnet`,
      [
        `Allowed: ${Object.entries(ALLOWED_CHAINS)
          .map(([id, network]) => `${id} (${network})`)
          .join(", ")}.`,
        "This project is testnet-only (BUILD_PROMPT.md section 2). Delete the file or fix the deployment.",
      ].join(" "),
    );
  }
  const allowedChainId = chainId as AllowedChainId;
  const network = ALLOWED_CHAINS[allowedChainId];

  const expectedFile = `${network}.json`;
  if (path.basename(file) !== expectedFile) {
    throw new SyncError(
      `${rel(file)} declares chain ${chainId} (${network}) but is not named ${expectedFile}`,
      "One deployment file per network, named after the network, so the file name never lies about its contents.",
    );
  }

  if (!isRecord(parsed.addresses)) {
    throw new SyncError(`${rel(file)} has no "addresses" object`, "Re-run the deploy script.");
  }
  if (!isRecord(parsed.txHashes)) {
    throw new SyncError(`${rel(file)} has no "txHashes" object`, "Re-run the deploy script.");
  }

  const addresses = {} as Record<ContractName, string>;
  const txHashes = {} as Record<ContractName, string>;
  for (const name of CONTRACTS) {
    addresses[name] = requireAddress(parsed.addresses[name], `${rel(file)} .addresses.${name}`);
    txHashes[name] = requireTxHash(parsed.txHashes[name], `${rel(file)} .txHashes.${name}`);
  }

  return {
    chainId: allowedChainId,
    network,
    deployBlock: requireNonNegativeInteger(parsed.deployBlock, `${rel(file)} .deployBlock`),
    timestamp: requireNonNegativeInteger(parsed.timestamp, `${rel(file)} .timestamp`),
    addresses,
    txHashes,
    source: rel(file),
  };
}

function loadDeployments(): LoadedDeployment[] {
  if (!existsSync(DEPLOYMENTS_DIR)) return [];
  const files = readdirSync(DEPLOYMENTS_DIR)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => path.join(DEPLOYMENTS_DIR, entry));
  return files.map(loadDeployment).sort((a, b) => a.chainId - b.chainId);
}

// --------------------------------------------------------------------------- emit

const BANNER = [
  "// GENERATED FILE — DO NOT EDIT.",
  "// Written by web/scripts/sync-contracts.ts; re-run `pnpm sync:contracts` from web/ after `forge build`.",
  "// Committed on purpose: the Vercel build root is web/ and cannot run forge.",
].join("\n");

function abisSource(abis: readonly LoadedAbi[]): string {
  const lines: string[] = [
    BANNER,
    `// Source: ${abis.map((a) => a.source).join(", ")}`,
    "",
    "/** Contracts the web app talks to. Deployment addresses live in ./addresses.ts. */",
    `export const CONTRACT_NAMES = ${JSON.stringify(CONTRACTS)} as const;`,
    "",
    "export type ContractName = (typeof CONTRACT_NAMES)[number];",
    "",
  ];

  for (const loaded of abis) {
    const exportName = ABI_EXPORT_NAMES[loaded.name];
    lines.push(
      `/** ABI of \`${loaded.name}\` — ${loaded.functions} functions, ${loaded.events} events, ${loaded.errors} custom errors. */`,
      `export const ${exportName} = ${JSON.stringify(loaded.abi)} as const;`,
      "",
    );
  }

  lines.push(
    "/** Every ABI by contract name, for generic lookups. */",
    "export const abis = {",
    ...abis.map((loaded) => `  ${loaded.name}: ${ABI_EXPORT_NAMES[loaded.name]},`),
    "} as const;",
    "",
  );

  return lines.join("\n");
}

function addressesSource(deployments: readonly LoadedDeployment[]): string {
  const sources =
    deployments.length > 0
      ? deployments.map((d) => d.source).join(", ")
      : "(no deployment files found)";

  const entries = deployments.map((d) =>
    [
      `  /** ${d.network} — recorded ${new Date(d.timestamp * 1000).toISOString()}. */`,
      `  ${d.chainId}: {`,
      `    chainId: ${d.chainId},`,
      `    network: ${JSON.stringify(d.network)},`,
      `    deployBlock: ${d.deployBlock},`,
      `    timestamp: ${d.timestamp},`,
      `    addresses: {`,
      ...CONTRACTS.map((name) => `      ${name}: ${JSON.stringify(d.addresses[name])},`),
      `    },`,
      `    txHashes: {`,
      // Creation tx hashes are public chain data, not secrets. The trailing marker tells
      // scripts/check-secrets.sh so, since its bare-32-byte-hex rule cannot tell a tx hash
      // from a private key by shape alone.
      ...CONTRACTS.map(
        (name) => `      ${name}: ${JSON.stringify(d.txHashes[name])}, // allow-secret`,
      ),
      `    },`,
      `  },`,
    ].join("\n"),
  );

  return [
    BANNER,
    `// Source: ${sources}`,
    "",
    "/**",
    " * Deployments keyed by chain id. `deployBlock` is carried through because the event indexer",
    " * (PLAN.md D10) scans from it rather than from genesis.",
    " *",
    " * Only testnet chain ids can appear here: sync-contracts.ts rejects anything else, and",
    " * `lib/chains.ts` re-checks this object against the `SupportedChainId` union, so a mainnet",
    " * deployment file fails the build twice over.",
    " */",
    "export const deployments = {",
    ...entries,
    "} as const;",
    "",
    "/** Chain ids that actually have a recorded deployment (`never` when none do). */",
    "export type DeployedChainId = keyof typeof deployments;",
    "",
  ].join("\n");
}

async function writeFormatted(file: string, source: string): Promise<void> {
  const options = await prettier.resolveConfig(file);
  const formatted = await prettier.format(source, { ...options, filepath: file });
  writeFileSync(file, formatted, "utf8");
}

// --------------------------------------------------------------------------- main

async function main(): Promise<void> {
  assertForgeOutExists();

  const abis = CONTRACTS.map(loadAbi);
  const deployments = loadDeployments();

  await writeFormatted(path.join(GENERATED_DIR, "abis.ts"), abisSource(abis));
  await writeFormatted(path.join(GENERATED_DIR, "addresses.ts"), addressesSource(deployments));

  console.log(`sync-contracts: wrote ${rel(path.join(GENERATED_DIR, "abis.ts"))}`);
  for (const loaded of abis) {
    console.log(
      `  ${loaded.name.padEnd(17)} ${loaded.functions} fn / ${loaded.events} ev / ${loaded.errors} err  (${loaded.source})`,
    );
  }
  console.log(`sync-contracts: wrote ${rel(path.join(GENERATED_DIR, "addresses.ts"))}`);
  if (deployments.length === 0) {
    console.log(
      "  no deployments found — contracts/deployments/ is empty. " +
        "Run `make deploy` (CHAIN=anvil or CHAIN=base-sepolia) to record one.",
    );
  } else {
    for (const d of deployments) {
      console.log(
        `  ${d.network.padEnd(17)} chain ${d.chainId}, deployBlock ${d.deployBlock}  (${d.source})`,
      );
    }
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof SyncError) {
    console.error(`\nsync-contracts failed: ${error.message}\n\n${error.hint}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
