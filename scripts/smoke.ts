import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { erc20Abi } from "viem";
import { hBTokenAbi, identityRegistryAbi } from "../packages/config/abi.ts";
import {
  verifyAttestation,
  type Attestation,
} from "../app/src/lib/attestation.ts";
import { context, readDeployment, json, safeError } from "./runtime.ts";
export async function smoke(
  baseUrl = process.env.E2E_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000",
) {
  const ctx = await context();
  const d = readDeployment(ctx.name);
  const token = { address: d.addresses.HBToken, abi: hBTokenAbi } as const;
  for (const address of Object.values(d.addresses)) {
    const code = await ctx.client.getCode({ address });
    if (!code || code === "0x")
      throw new Error("A configured contract has no code.");
  }
  const [nav, updatedAt, supply, liquidity, decimals, asset] =
    await Promise.all([
      ctx.client.readContract({ ...token, functionName: "navPerToken" }),
      ctx.client.readContract({ ...token, functionName: "navUpdatedAt" }),
      ctx.client.readContract({ ...token, functionName: "totalSupply" }),
      ctx.client.readContract({ ...token, functionName: "availableLiquidity" }),
      ctx.client.readContract({
        address: d.addresses.USDC,
        abi: erc20Abi,
        functionName: "decimals",
      }),
      ctx.client.readContract({ ...token, functionName: "settlementAsset" }),
    ]);
  if (decimals !== 6 || asset.toLowerCase() !== d.addresses.USDC.toLowerCase())
    throw new Error("Settlement asset/decimals mismatch.");
  if (
    BigInt(Math.floor(Date.now() / 1000)) - updatedAt >
    BigInt(Number(process.env.NAV_MAX_AGE_HOURS || 30) * 3600)
  )
    throw new Error("On-chain NAV is stale.");
  const local = JSON.parse(readFileSync("app/public/data/nav.json", "utf8"));
  const response = await fetch(new URL("/data/nav.json", baseUrl));
  if (!response.ok) throw new Error("Live NAV JSON unavailable.");
  const published = await response.json();
  if (
    local.nav_units !== nav.toString() ||
    published.nav_units !== nav.toString()
  )
    throw new Error("Local, published and on-chain NAV differ.");
  if (
    Date.now() - Date.parse(published.timestamp) >
    Number(process.env.NAV_MAX_AGE_HOURS || 30) * 3600_000
  )
    throw new Error("Published NAV snapshot is stale.");
  const attestation = (await (
    await fetch(new URL("/data/attestation.json", baseUrl))
  ).json()) as Attestation;
  await verifyAttestation(
    attestation,
    process.env.NEXT_PUBLIC_ATTESTOR_ADDRESS,
    ctx.chain.id,
    d.addresses.HBToken,
    published.nav_units,
  );
  for (const country of [840, 792])
    if (
      !(await ctx.client.readContract({
        address: d.addresses.IdentityRegistry,
        abi: identityRegistryAbi,
        functionName: "isCountryBlocked",
        args: [country],
      }))
    )
      throw new Error("Required country block is disabled.");
  for (const route of ["/", "/app", "/transparency", "/admin"]) {
    const page = await fetch(new URL(route, baseUrl));
    if (
      !page.ok ||
      !(await page.text()).includes(
        "Testnet. Simulated portfolio. Not an offer of securities.",
      )
    )
      throw new Error("A product route is unavailable: " + route);
  }
  return {
    timestamp: new Date().toISOString(),
    chainId: ctx.chain.id,
    baseUrl,
    navUnits: nav.toString(),
    supply: supply.toString(),
    availableLiquidity: liquidity.toString(),
    navTimestamp: new Date(Number(updatedAt) * 1000).toISOString(),
    checks: [
      "RPC chain allowlist",
      "deployed contract code",
      "6-decimal settlement asset",
      "fresh matching NAV",
      "attestation trust anchor",
      "US/TR blocklist",
      "all four product routes",
    ],
    readOnly: true,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(json(await smoke()));
  } catch (e) {
    console.error(safeError(e));
    process.exitCode = 1;
  }
}
