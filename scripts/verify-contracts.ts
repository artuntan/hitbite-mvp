import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { context, json, readDeployment, safeError } from "./runtime.ts";

try {
  const { values } = parseArgs({ options: { chain: { type: "string" } } });
  const ctx = await context(values.chain);
  const deployment = readDeployment(ctx.name);
  if (ctx.name !== "arc-testnet")
    throw new Error(
      "This verifier targets Arc Testnet; fallback verification is configured separately.",
    );
  const roles = deployment.roles;
  const constructors = {
    IdentityRegistry: encodeAbiParameters(
      parseAbiParameters("address,address"),
      [roles.admin, roles.registrar],
    ),
    HBToken: encodeAbiParameters(
      parseAbiParameters("address,address,address,address,address,uint256"),
      [
        deployment.addresses.IdentityRegistry,
        deployment.addresses.USDC,
        roles.admin,
        roles.issuer,
        roles.oracle,
        1_000_000n,
      ],
    ),
  };
  deployment.verification = {};
  mkdirSync("deployments/verification", { recursive: true });
  for (const name of ["IdentityRegistry", "HBToken"] as const) {
    const base = [
      "verify-contract",
      deployment.addresses[name],
      `src/${name}.sol:${name}`,
      "--chain-id",
      "5042002",
      "--constructor-args",
      constructors[name],
    ];
    const input = spawnSync("forge", [...base, "--show-standard-json-input"], {
      cwd: "contracts",
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    if (input.status !== 0)
      throw new Error(`Cannot produce verification input for ${name}.`);
    const parsed = JSON.parse(input.stdout);
    writeFileSync(`deployments/verification/${name}.input.json`, json(parsed));
    const artifact = JSON.parse(
      readFileSync(`contracts/out/${name}.sol/${name}.json`, "utf8"),
    );
    writeFileSync(
      `deployments/verification/${name}.metadata.json`,
      json({
        compiler: "0.8.26",
        constructorArguments: constructors[name],
        address: deployment.addresses[name],
        chainId: ctx.chain.id,
        metadata: artifact.metadata,
      }),
    );
    const result = spawnSync(
      "forge",
      [
        ...base,
        "--verifier",
        "blockscout",
        "--verifier-url",
        "https://explorer.testnet.arc.io/api/",
        "--watch",
      ],
      { cwd: "contracts", encoding: "utf8", timeout: 120_000 },
    );
    const output = safeError((result.stdout || "") + (result.stderr || ""));
    writeFileSync(`.context/verify-${name}.log`, output);
    deployment.verification[name] =
      result.status === 0 ? "verified" : "inputs-published";
    console.log(`${name}: ${deployment.verification[name]}`);
  }
  writeFileSync(`deployments/${ctx.name}.json`, json(deployment));
} catch (error) {
  console.error(safeError(error));
  process.exitCode = 1;
}
