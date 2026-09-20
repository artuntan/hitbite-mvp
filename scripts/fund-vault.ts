import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { erc20Abi, parseUnits } from "viem";
import {
  context,
  json,
  readDeployment,
  safeError,
  transact,
} from "./runtime.ts";

try {
  const { values } = parseArgs({
    options: { amount: { type: "string" }, chain: { type: "string" } },
  });
  if (!values.amount || !/^\d+(\.\d{1,6})?$/.test(values.amount))
    throw new Error("--amount requires a positive USDC decimal amount.");
  const amount = parseUnits(values.amount, 6);
  if (amount <= 0n) throw new Error("Funding amount must be positive.");
  const ctx = await context(values.chain);
  const deployment = readDeployment(ctx.name);
  if (deployment.chainId !== ctx.chain.id)
    throw new Error("Deployment chain mismatch.");
  const receipt = await transact(
    ctx,
    "ISSUER_PRIVATE_KEY",
    deployment.addresses.USDC,
    erc20Abi,
    "transfer",
    [deployment.addresses.HBToken, amount],
  );
  deployment.vaultFunding.push({
    amount: amount.toString(),
    transactionHash: receipt.transactionHash,
    blockNumber: Number(receipt.blockNumber),
  });
  writeFileSync(`deployments/${ctx.name}.json`, json(deployment));
  console.log(
    `Funded vault with ${values.amount} testnet USDC: ${receipt.transactionHash}`,
  );
} catch (error) {
  console.error(safeError(error));
  process.exitCode = 1;
}
