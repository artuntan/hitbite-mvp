import * as React from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ACTIVE_CHAIN, getDeployment } from "@/lib/chains";
import { TOKEN } from "@/lib/copy";

import { CodeBlock } from "./code-block";

/**
 * The two on-chain reads BUILD_PROMPT section 8 asks for: `nav()` and `canHold()`.
 *
 * The client setup, the chain and the addresses are rendered from `lib/chains.ts` and from the
 * committed deployment record, so the snippet names the chain this deployment actually talks to
 * rather than whichever one was current when someone wrote the page. Where no deployment has been
 * recorded for the active chain, the addresses stay as named constants and the card says where to
 * find them — an address invented to make a snippet look complete is the one thing a code sample
 * must never contain.
 */
export function ContractReads() {
  const deployment = getDeployment(ACTIVE_CHAIN.id);
  const token = deployment?.addresses.HBToken ?? null;
  const registry = deployment?.addresses.IdentityRegistry ?? null;

  const clientSetup =
    ACTIVE_CHAIN.key === "base-sepolia"
      ? [
          'import { createPublicClient, http } from "viem";',
          'import { baseSepolia } from "viem/chains";',
          "",
          "const client = createPublicClient({ chain: baseSepolia, transport: http() });",
        ].join("\n")
      : [
          'import { createPublicClient, http } from "viem";',
          "",
          `// ${ACTIVE_CHAIN.label} has no entry in viem/chains; point the transport at its RPC.`,
          `const client = createPublicClient({ transport: http("${ACTIVE_CHAIN.defaultRpcUrl}") });`,
        ].join("\n");

  const addresses = [
    `// chain ${ACTIVE_CHAIN.id.toString()} — ${ACTIVE_CHAIN.label}. Testnet only.`,
    `// Addresses and the deploy block: contracts/deployments/${ACTIVE_CHAIN.key}.json`,
    `const HB_TOKEN = "${token ?? "0x… // HBToken"}" as const;`,
    `const IDENTITY_REGISTRY = "${registry ?? "0x… // IdentityRegistry"}" as const;`,
  ].join("\n");

  const navSnippet = [
    'import { hbTokenAbi } from "./abis"; // contracts/out/HBToken.sol/HBToken.json',
    "",
    "const nav = await client.readContract({",
    "  address: HB_TOKEN,",
    "  abi: hbTokenAbi,",
    '  functionName: "nav",',
    "}); // 1003061n  ->  1.003061 USDC per token, six decimals",
    "",
    "// Keep it an integer. Value a position with integer arithmetic and format at the edge:",
    "const balance = await client.readContract({",
    "  address: HB_TOKEN,",
    "  abi: hbTokenAbi,",
    '  functionName: "balanceOf",',
    "  args: [account],",
    "});",
    `const valueUsdc = (balance * nav) / 10n ** ${TOKEN.decimals.toString()}n; // 6 decimals`,
  ].join("\n");

  const canHoldSnippet = [
    'import { identityRegistryAbi } from "./abis"; // contracts/out/IdentityRegistry.sol/…',
    "",
    "const eligible = await client.readContract({",
    "  address: IDENTITY_REGISTRY,",
    "  abi: identityRegistryAbi,",
    '  functionName: "canHold",',
    "  args: [vaultAddress],",
    "}); // false until that exact address is verified",
  ].join("\n");

  return (
    <Card id="contract-reads" className="scroll-mt-20" data-testid="contract-reads">
      <CardHeader>
        <CardTitle as="h3">Reading the contracts directly</CardTitle>
        <CardDescription>
          The chain is the authoritative source for both the price and the eligibility rule. The API
          mirrors them; it does not replace them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <CodeBlock
          code={clientSetup}
          label="viem client"
          caption={`Reads only — no key, no signer. ${ACTIVE_CHAIN.label} (chain ${ACTIVE_CHAIN.id.toString()}).`}
        />
        <CodeBlock
          code={addresses}
          label="Addresses"
          caption={
            deployment
              ? `From contracts/deployments/${ACTIVE_CHAIN.key}.json, deploy block ${deployment.deployBlock.toString()}. Start any log scan there rather than at genesis.`
              : `No deployment has been recorded for ${ACTIVE_CHAIN.label} yet, so the addresses above are placeholders. Take the real ones from contracts/deployments/${ACTIVE_CHAIN.key}.json once it exists.`
          }
        />

        <section className="flex flex-col gap-2">
          <h4 className="text-ink text-sm font-semibold">
            <code className="addr">nav()</code> — the price, as a six-decimal integer
          </h4>
          <p className="text-muted text-sm leading-relaxed">
            NAV is an integer in USDC units, six decimals, per one whole token. It opens at{" "}
            <code className="addr text-ink">1000000</code>, meaning 1.00. Do not divide it into a
            float: every layer of this system keeps it an integer, which is why the engine, the
            chain and <code className="addr text-ink">/api/nav</code> agree to the last digit.
          </p>
          <CodeBlock
            code={navSnippet}
            label="nav() with viem"
            caption="The same integer /api/nav publishes as nav.usdc_6dec. Compare the two before you trust anything downstream."
          />
        </section>

        <section className="flex flex-col gap-2">
          <h4 className="text-ink text-sm font-semibold">
            <code className="addr">canHold()</code> — may this address receive the token?
          </h4>
          <p className="text-muted text-sm leading-relaxed">
            {TOKEN.symbol} is whitelisted at the token level: an address with no registry entry, or
            one whose country is blocked, cannot receive it, and the check runs inside the contract
            on every mint and every transfer. For an integrator that has one specific consequence —{" "}
            <strong className="text-ink font-semibold">
              the wallet that actually holds the tokens must be verified
            </strong>
            . Verifying your users does nothing for a transfer into an omnibus or vault address they
            do not control.
          </p>
          <CodeBlock
            code={canHoldSnippet}
            label="canHold() with viem"
            caption="Call it before you attempt a transfer. A transfer to an ineligible address reverts with NotEligible(address), which is clear but costs gas and reads as a failure to your users."
          />
          <p className="text-muted text-sm leading-relaxed">
            Receiving is restricted; exiting is not. Redemption and coupon claims do not check the
            sender, so an address that loses its verification can still get its money out and a
            vault is never trapped by a registry change.
          </p>
        </section>
      </CardContent>
    </Card>
  );
}
