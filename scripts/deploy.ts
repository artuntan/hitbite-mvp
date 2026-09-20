import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { erc20Abi, type Address, type Hex } from "viem";
import { ARC_USDC_ADDRESS } from "../packages/config/chains.ts";
import { accountFor, context, fees, json, safeError } from "./runtime.ts";

try {
  const { values } = parseArgs({ options: { chain: { type: "string" }, "dry-run": { type: "boolean" } } });
  const ctx = await context(values.chain);
  const target = `deployments/${ctx.name}.json`;
  if (existsSync(target) && !values["dry-run"]) throw new Error("Deployment already exists. Review it before deploying new contracts.");
  const deployer = accountFor("DEPLOYER_PRIVATE_KEY");
  const roles = {
    admin: (process.env.ADMIN_ADDRESS || deployer.address) as Address,
    issuer: (process.env.ISSUER_ADDRESS || deployer.address) as Address,
    oracle: (process.env.ORACLE_ADDRESS || deployer.address) as Address,
    registrar: (process.env.REGISTRAR_ADDRESS || deployer.address) as Address,
  };
  if (ctx.name === "arc-testnet") {
    const decimals = await ctx.client.readContract({ address: ARC_USDC_ADDRESS, abi: erc20Abi, functionName: "decimals" });
    if (decimals !== 6) throw new Error("Arc settlement decimals mismatch.");
  }
  const fee = await fees(ctx);
  const args = ["script", "script/Deploy.s.sol:Deploy", "--rpc-url", ctx.rpcUrl, "--slow", "--with-gas-price", fee.maxFeePerGas.toString(), "--priority-gas-price", fee.maxPriorityFeePerGas.toString()];
  if (!values["dry-run"]) args.push("--broadcast");
  const result = spawnSync("forge", args, { cwd: "contracts", encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  mkdirSync(".context", { recursive: true });
  writeFileSync(".context/deploy.log", safeError((result.stdout || "") + (result.stderr || "")));
  if (result.status !== 0) throw new Error("Foundry deployment failed. See redacted .context/deploy.log.");
  if (values["dry-run"]) {
    console.log(`Deployment simulation passed on ${ctx.name}; no transactions sent.`);
  } else {
    const broadcast = JSON.parse(readFileSync(`contracts/broadcast/Deploy.s.sol/${ctx.chain.id}/run-latest.json`, "utf8"));
    const addresses: Record<string, Address> = {};
    const transactions: Record<string, Hex> = {};
    let blockNumber = 0n;
    for (const tx of broadcast.transactions) {
      if (tx.transactionType !== "CREATE") continue;
      const receipt = await ctx.client.getTransactionReceipt({ hash: tx.hash });
      if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Deployment receipt is not successful.");
      const code = await ctx.client.getCode({ address: receipt.contractAddress });
      if (!code || code === "0x") throw new Error("Deployed code is missing.");
      const name = tx.contractName === "MockUSDC" ? "USDC" : tx.contractName;
      addresses[name] = receipt.contractAddress;
      transactions[name] = receipt.transactionHash;
      if (receipt.blockNumber > blockNumber) blockNumber = receipt.blockNumber;
    }
    if (ctx.name === "arc-testnet") addresses.USDC = ARC_USDC_ADDRESS;
    if (!addresses.HBToken || !addresses.IdentityRegistry || !addresses.USDC) throw new Error("Incomplete deployment receipts.");
    const block = await ctx.client.getBlock({ blockNumber });
    mkdirSync("deployments", { recursive: true });
    writeFileSync(target, json({ status: "confirmed", chainId: ctx.chain.id, addresses, blockNumber: Number(blockNumber), deployer: deployer.address, timestamp: new Date(Number(block.timestamp) * 1000).toISOString(), roles, transactions, vaultFunding: [], explorer: ctx.chain.blockExplorers?.default.url ?? null }));
    console.log(`Confirmed deployment saved to ${target}.`);
    console.log(json(addresses));
  }
} catch (error) {
  console.error(safeError(error));
  process.exitCode = 1;
}
