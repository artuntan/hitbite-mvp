"use client";

/**
 * `/admin` — the operator console (BUILD_PROMPT 7.2).
 *
 * Every action is one card with the same four parts: the rule in words, the form, the encoded call,
 * and the transaction's own state. The console decides only two things itself.
 *
 * **What to show.** A wallet that holds at least one role gets the actions it can send in the
 * flow, and the rest folded into a disclosure that names the role each needs — the console is for
 * doing work, and a screenful of buttons you cannot press is not work. A wallet that holds nothing,
 * or no wallet at all, gets everything expanded instead: at that point the page's whole value is
 * explaining what the roles are, and collapsing it would leave a reviewer with nothing to read.
 *
 * **That none of this is protection.** The contracts are the boundary. This page says so at the top,
 * in the roles panel, and it is true of the read side too: `/admin` is public, because everything it
 * shows is either on chain already or about to be.
 */

import * as React from "react";
import { useAccount } from "wagmi";

import { BlocklistCard } from "@/components/admin/blocklist-card";
import { CONSOLE_INTRO, SIMULATION_NOTE } from "@/components/admin/copy";
import { DistributeCard } from "@/components/admin/distribute-card";
import { NavCard } from "@/components/admin/nav-card";
import { PauseCard } from "@/components/admin/pause-card";
import { QueueCard } from "@/components/admin/queue-card";
import { RolesPanel } from "@/components/admin/roles-panel";
import { getAction, heldRoles, permissionFor, type ActionId } from "@/components/admin/roles";
import { SupplyCard } from "@/components/admin/supply-card";
import { useAdminChainState } from "@/components/admin/use-admin-chain";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  ConnectPrompt,
  WrongNetworkAlert,
  useNetworkStatus,
} from "@/components/wallet/network-guard";
import { ACTIVE_CHAIN } from "@/lib/chains";

export function AdminConsole() {
  const network = useNetworkStatus();
  const { address } = useAccount();
  const chain = useAdminChainState(address);

  const walletConnected = network.status === "ready" || network.status === "wrong-network";
  const canSign = network.isReady;
  const holdings = chain.roles;

  const allows = React.useCallback(
    (...ids: readonly ActionId[]) =>
      ids.some((id) => permissionFor(getAction(id), holdings) === "allowed"),
    [holdings],
  );

  const holdsSomething = heldRoles(holdings).length > 0;

  const cards: { key: string; allowed: boolean; node: React.ReactNode }[] = [
    {
      key: "nav",
      allowed: allows("set-nav", "force-nav"),
      node: (
        <NavCard
          chain={chain}
          holdings={holdings}
          walletConnected={walletConnected}
          canSign={canSign}
        />
      ),
    },
    {
      key: "distribute",
      allowed: allows("distribute"),
      node: (
        <DistributeCard
          chain={chain}
          holdings={holdings}
          walletConnected={walletConnected}
          canSign={canSign}
        />
      ),
    },
    {
      key: "pause",
      allowed: allows("pause", "unpause"),
      node: (
        <PauseCard
          chain={chain}
          holdings={holdings}
          walletConnected={walletConnected}
          canSign={canSign}
        />
      ),
    },
    {
      key: "blocklist",
      allowed: allows("blocklist"),
      node: (
        <BlocklistCard
          chain={chain}
          holdings={holdings}
          walletConnected={walletConnected}
          canSign={canSign}
        />
      ),
    },
    {
      key: "mint",
      allowed: allows("mint"),
      node: (
        <SupplyCard
          mode="mint"
          chain={chain}
          holdings={holdings}
          walletConnected={walletConnected}
          canSign={canSign}
        />
      ),
    },
    {
      key: "burn",
      allowed: allows("burn"),
      node: (
        <SupplyCard
          mode="burn"
          chain={chain}
          holdings={holdings}
          walletConnected={walletConnected}
          canSign={canSign}
        />
      ),
    },
  ];

  // Everything is mounted either way — the disclosure only changes where a card sits, so the hooks
  // inside it keep their order and a card does not lose its transaction state when a role arrives.
  const inFlow = holdsSomething ? cards.filter((card) => card.allowed) : cards;
  const folded = holdsSomething ? cards.filter((card) => !card.allowed) : [];

  return (
    <div className="flex flex-col gap-8">
      {network.status === "disconnected" ? (
        <ConnectPrompt purpose="to sign an admin action" />
      ) : null}
      {network.status === "wrong-network" ? <WrongNetworkAlert network={network} /> : null}

      <Alert tone="info">
        <AlertTitle>Operator console</AlertTitle>
        <AlertDescription>
          <p>{CONSOLE_INTRO}</p>
          <p className="mt-2">{SIMULATION_NOTE}</p>
        </AlertDescription>
      </Alert>

      <RolesPanel
        holdings={holdings}
        account={address ?? null}
        reading={chain.reads === "loading"}
        unavailable={chain.reason}
      />

      <ContractsPanel chain={chain} />

      <section className="flex flex-col gap-6" aria-label="Verification queue">
        <QueueCard chain={chain} holdings={holdings} canSign={canSign} />
      </section>

      <section className="flex flex-col gap-6" aria-label="Contract actions">
        {inFlow.map((card) => (
          <React.Fragment key={card.key}>{card.node}</React.Fragment>
        ))}
      </section>

      {folded.length > 0 ? (
        <details className="border-border bg-surface rounded-lg border p-5">
          <summary className="text-accent-ink cursor-pointer text-sm font-medium underline underline-offset-4">
            {folded.length} action{folded.length === 1 ? "" : "s"} this wallet cannot send
          </summary>
          <p className="text-muted mt-2 text-sm leading-relaxed">
            Each one is here in full, with the role it needs and the call it makes. The forms and
            the encoded calls work; only the signature is out of reach.
          </p>
          <div className="mt-4 flex flex-col gap-6">
            {folded.map((card) => (
              <React.Fragment key={card.key}>{card.node}</React.Fragment>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

/** The addresses every card on this page writes to, so they can be checked against a deployment. */
function ContractsPanel({ chain }: { chain: ReturnType<typeof useAdminChainState> }) {
  return (
    <div className="border-border bg-surface-sunken rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-ink text-sm font-semibold">Contracts</h2>
        <Badge tone="neutral">{ACTIVE_CHAIN.label}</Badge>
      </div>
      {chain.addresses === null ? (
        <p className="text-muted mt-2 text-sm leading-relaxed">
          None recorded for this network. Every form below still encodes its calldata, and nothing
          below can be sent.
        </p>
      ) : (
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">HBToken</dt>
          <dd className="addr text-ink">{chain.addresses.token}</dd>
          <dt className="text-muted">IdentityRegistry</dt>
          <dd className="addr text-ink">{chain.addresses.registry}</dd>
          <dt className="text-muted">MockUSDC</dt>
          <dd className="addr text-ink">{chain.addresses.usdc}</dd>
        </dl>
      )}
    </div>
  );
}
