import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ACTIVE_CHAIN_ID,
  deployedChainIds,
  getChainConfig,
  getDeployment,
  type DeploymentRecord,
  type SupportedChainId,
} from "@/lib/chains";
import { formatUnixSeconds } from "@/lib/format";
import { CONTRACT_NAMES } from "@/lib/generated/abis";

import { AddressLink, TxLink } from "./address-link";
import type { ChainFacts } from "./chain-facts";

/**
 * Deployed addresses, the deploy block and the transactions that created them.
 *
 * Read from `lib/generated/addresses.ts`, which is written by `pnpm sync:contracts` from
 * `contracts/deployments/*.json` — so what is shown is what was actually deployed, not a constant
 * someone typed. Today that is the local Anvil deployment only, and this card says so instead of
 * displaying plausible-looking Base Sepolia addresses that nobody could resolve.
 */

const CONTRACT_BLURBS: Record<(typeof CONTRACT_NAMES)[number], string> = {
  HBToken: "The hbTRS token: NAV, subscriptions, redemptions, coupon distribution, transfer rules.",
  IdentityRegistry: "The whitelist: who may hold, their country and investor type.",
  MockUSDC: "Test-network USDC stand-in with a rate-limited faucet. Worthless by construction.",
};

function DeploymentTable({
  chainId,
  deployment,
}: {
  chainId: SupportedChainId;
  deployment: DeploymentRecord;
}) {
  const config = getChainConfig(chainId);
  return (
    <div className="flex flex-col gap-3">
      <Table aria-label={`Contract addresses on ${config.label}`}>
        <TableCaption>
          Chain <span className="num">{chainId}</span> · deploy block{" "}
          <span className="num">{deployment.deployBlock}</span> · recorded{" "}
          {formatUnixSeconds(deployment.timestamp)}.
          {config.explorerUrl === null
            ? " This network has no block explorer, so the addresses are shown as plain text."
            : null}
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Contract</TableHead>
            <TableHead>Address</TableHead>
            <TableHead>Deployment transaction</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {CONTRACT_NAMES.map((name) => (
            <TableRow key={name}>
              <TableCell>
                <div className="flex min-w-[12rem] flex-col gap-1">
                  <span className="text-ink font-medium">{name}</span>
                  <span className="text-muted text-xs">{CONTRACT_BLURBS[name]}</span>
                </div>
              </TableCell>
              <TableCell>
                <AddressLink value={deployment.addresses[name]} chainId={chainId} />
              </TableCell>
              <TableCell>
                <TxLink value={deployment.txHashes[name]} chainId={chainId} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ContractsPanel({ chain }: { chain: ChainFacts }) {
  const activeDeployment = getDeployment(ACTIVE_CHAIN_ID);
  const otherChainIds = deployedChainIds().filter((id) => id !== ACTIVE_CHAIN_ID);

  return (
    <section aria-labelledby="contracts-heading" data-testid="contracts">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle as="h2" id="contracts-heading" className="text-lg">
              Contracts and deployment
            </CardTitle>
            <Badge tone="neutral">{chain.label}</Badge>
          </div>
          <CardDescription>
            Generated from <span className="addr">contracts/deployments/</span> at build time by{" "}
            <span className="addr">pnpm sync:contracts</span>. Testnets only — no mainnet deployment
            exists, and the chain list this app will accept is fixed at Base Sepolia and a local
            Anvil.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          {activeDeployment ? (
            <>
              {chain.status === "unreachable" ? (
                <Alert tone="warning">
                  <AlertTitle>These addresses could not be reached just now.</AlertTitle>
                  <AlertDescription>{chain.reason}</AlertDescription>
                </Alert>
              ) : null}
              {chain.status === "ok" && chain.paused ? (
                <Alert tone="warning">
                  <AlertTitle>The token is paused.</AlertTitle>
                  <AlertDescription>
                    Transfers, subscriptions and redemptions are blocked at the contract until an
                    administrator unpauses it.
                  </AlertDescription>
                </Alert>
              ) : null}
              <DeploymentTable chainId={ACTIVE_CHAIN_ID} deployment={activeDeployment} />
            </>
          ) : (
            <Alert tone="warning">
              <AlertTitle>Nothing is deployed on {chain.label} yet.</AlertTitle>
              <AlertDescription>
                {chain.status === "no-deployment"
                  ? chain.reason
                  : `No deployment is recorded for ${chain.label}.`}{" "}
                Rather than print placeholder addresses, this card shows only deployments that
                actually happened.
              </AlertDescription>
            </Alert>
          )}

          {otherChainIds.length > 0 ? (
            <div className="flex flex-col gap-6">
              {otherChainIds.map((chainId) => {
                const deployment = getDeployment(chainId);
                if (!deployment) return null;
                const config = getChainConfig(chainId);
                return (
                  <div key={chainId} className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <h3 className="text-ink text-sm font-semibold">
                        Also recorded: {config.label}
                      </h3>
                      <p className="text-muted max-w-3xl text-xs leading-relaxed">
                        {config.key === "anvil"
                          ? "A local Foundry node. These are the deterministic addresses Anvil assigns on a fresh chain, reachable only on the machine that ran the deployment — they are listed for completeness, not as something you can look up."
                          : "Recorded in the repository but not the network this app is currently pointed at."}
                      </p>
                    </div>
                    <DeploymentTable chainId={chainId} deployment={deployment} />
                  </div>
                );
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
