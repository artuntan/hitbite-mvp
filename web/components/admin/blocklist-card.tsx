"use client";

/**
 * The country blocklist editor.
 *
 * `IdentityRegistry.setCountryBlocked(country, blocked)` is two arguments and one storage slot. The
 * card exists for the consequence, which is the part nobody expects: **blocking a country does not
 * delete the records that already name it**. Those addresses stay verified; `canHold` simply
 * becomes false for all of them, so they can no longer receive a transfer or subscribe — while they
 * can still redeem and still claim coupons, because the token deliberately does not check `canHold`
 * on the way out (PLAN.md D4). Nothing is trapped; receiving is what stops. That sentence is on the
 * card, not in a document nobody opens.
 *
 * Every state shown here is an `eth_call` against the deployed registry (PLAN.md D57), never the
 * seeded list in `countries.json`. The seeded codes are shown with their **live** state beside them
 * for the same reason: an operator who has just unblocked one needs to see that it is unblocked.
 */

import * as React from "react";
import type { Address } from "viem";
import { useReadContract } from "wagmi";

import { encodeCall, type EncodeResult } from "@/components/admin/calldata";
import { ActionCard, RuleNote } from "@/components/admin/action-card";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import {
  BLOCKLIST_EXISTING_HOLDERS,
  BLOCKLIST_INTRO,
  BLOCKLIST_RANGE_NOTE,
} from "@/components/admin/copy";
import { AdminField, AdminSelect } from "@/components/admin/fields";
import { getAction, permissionFor, type RoleHoldings } from "@/components/admin/roles";
import type { AdminChainState } from "@/components/admin/use-admin-chain";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTx } from "@/components/wallet/use-tx";
import {
  COUNTRIES_BY_NAME,
  COUNTRY_LIST_SOURCE,
  SEED_BLOCKED_COUNTRIES,
  getCountryByNumeric,
} from "@/lib/countries";
import { identityRegistryAbi } from "@/lib/generated/abis";
import { REQUIRED_CHAIN_ID } from "@/lib/wagmi";

export interface BlocklistCardProps {
  chain: AdminChainState;
  holdings: RoleHoldings;
  walletConnected: boolean;
  canSign: boolean;
}

export function BlocklistCard({ chain, holdings, walletConnected, canSign }: BlocklistCardProps) {
  const action = getAction("blocklist");
  const permission = permissionFor(action, holdings);
  const registry = chain.addresses?.registry ?? null;

  const [code, setCode] = React.useState<number | null>(null);
  /** `null` means "follow the chain": the intent is the opposite of whatever is stored. */
  const [override, setOverride] = React.useState<boolean | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  const current = useReadContract({
    address: chain.addresses?.registry,
    abi: identityRegistryAbi,
    functionName: "isCountryBlocked",
    args: code === null ? undefined : [code],
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled: code !== null && registry !== null },
  });

  const tx = useTx({
    action: "Blocklist update",
    contract: "IdentityRegistry",
    successTitle: "Blocklist updated",
    onConfirmed: () => {
      setConfirming(false);
      setOverride(null);
      void current.refetch();
    },
  });

  const country = code === null ? null : getCountryByNumeric(code);
  const currentBlocked = current.data ?? null;
  const intendBlocked = override ?? (currentBlocked === null ? true : !currentBlocked);
  const noChange = currentBlocked !== null && currentBlocked === intendBlocked;
  const phrase = intendBlocked && code !== null ? `BLOCK ${code}` : null;

  const encoded: EncodeResult | null =
    code === null
      ? null
      : encodeCall({
          contract: "IdentityRegistry",
          address: registry,
          abi: identityRegistryAbi,
          functionName: "setCountryBlocked",
          args: [
            { value: code, display: country?.name ?? `country ${code}` },
            {
              value: intendBlocked,
              display: intendBlocked
                ? "blocked — addresses registered here cannot be verified or hold hbTRS"
                : "not blocked",
            },
          ],
        });

  /**
   * Where the write goes. `null` when this network has no recorded deployment: the calldata above
   * is still real, but there is nowhere to send it, so nothing can be signed.
   */
  const to = encoded?.ok ? encoded.call.address : null;

  const ready = canSign && permission === "allowed" && to !== null && !tx.isBusy;

  return (
    <>
      <ActionCard
        id="blocklist"
        action={action}
        permission={permission}
        walletConnected={walletConnected}
        title="Country blocklist"
        description={BLOCKLIST_INTRO}
        encoded={encoded}
        tx={tx}
        confirmPhrase={phrase ?? (code === null ? "BLOCK <numeric code>" : null)}
        footer={
          <>
            <Button
              variant={intendBlocked ? "danger" : "primary"}
              disabled={!ready}
              onClick={() => setConfirming(true)}
            >
              {intendBlocked ? "Block this country" : "Unblock this country"}
            </Button>
            {noChange ? (
              <span className="text-muted text-xs">
                The registry already holds this value. The call succeeds and re-emits
                CountryBlockStatusChanged; it changes nothing.
              </span>
            ) : null}
          </>
        }
      >
        <AdminField
          id="admin-country"
          label="Country"
          hint={`All ${COUNTRIES_BY_NAME.length} ISO 3166-1 codes, from ${COUNTRY_LIST_SOURCE}. The registry stores this number and nothing else about a holder's location.`}
          control={(props) => (
            <AdminSelect
              {...props}
              value={code === null ? "" : String(code)}
              onChange={(event) => {
                const next = event.target.value;
                setCode(next === "" ? null : Number(next));
                setOverride(null);
              }}
            >
              <option value="">Select a country</option>
              {COUNTRIES_BY_NAME.map((entry) => (
                <option key={entry.numeric} value={entry.numeric}>
                  {entry.name} ({entry.numeric})
                </option>
              ))}
            </AdminSelect>
          )}
        />

        {code !== null ? (
          <div className="border-border bg-surface-sunken flex flex-col gap-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-ink text-sm font-medium">
                {country?.name ?? `Country ${code}`}{" "}
                <span className="num text-muted">({code})</span>
              </span>
              <StatusBadge
                tone={currentBlocked === null ? "neutral" : currentBlocked ? "danger" : "success"}
              >
                {current.isLoading
                  ? "Reading the registry…"
                  : currentBlocked === null
                    ? "The registry did not answer"
                    : currentBlocked
                      ? "Blocked on chain"
                      : "Not blocked on chain"}
              </StatusBadge>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant={intendBlocked ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={intendBlocked}
                onClick={() => setOverride(true)}
              >
                Set to blocked
              </Button>
              <Button
                variant={intendBlocked ? "ghost" : "secondary"}
                size="sm"
                aria-pressed={!intendBlocked}
                onClick={() => setOverride(false)}
              >
                Set to not blocked
              </Button>
            </div>
          </div>
        ) : null}

        <RuleNote tone="warning" title="Blocking does not delete anything">
          {BLOCKLIST_EXISTING_HOLDERS}
        </RuleNote>

        <RuleNote>{BLOCKLIST_RANGE_NOTE}</RuleNote>

        <div className="border-border bg-surface rounded-md border p-3">
          <p className="text-ink text-xs font-semibold">
            Codes this deployment was seeded with, as the registry holds them now
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {SEED_BLOCKED_COUNTRIES.map((entry) => (
              <SeedCodeRow
                key={entry.numeric}
                code={entry.numeric}
                name={entry.name}
                registry={registry}
              />
            ))}
          </ul>
          <p className="text-muted mt-2 text-xs leading-relaxed">
            Read from the chain, one <span className="addr">isCountryBlocked</span> call each, not
            from the committed seed list. The admin can change any of them, and this row will say
            so.
          </p>
        </div>
      </ActionCard>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={intendBlocked ? "Block a country" : "Unblock a country"}
        description={
          intendBlocked
            ? "This changes who may hold the token, including people who already do."
            : "This lets addresses registered to this country be verified and hold the token again."
        }
        tone={intendBlocked ? "danger" : "warning"}
        // Blocking is destructive: it revokes an existing holder's ability to receive. Unblocking
        // restores, so it confirms with the button alone rather than a typed phrase.
        phrase={phrase}
        confirmLabel={intendBlocked ? "Block it" : "Unblock it"}
        encoded={encoded}
        busy={tx.isBusy}
        consequences={
          intendBlocked
            ? [
                <>
                  <span className="addr">addVerified</span> reverts CountryBlocked for{" "}
                  {country?.name ?? `country ${code}`} from the next block, so no new address
                  registered there can be verified.
                </>,
                <>
                  Addresses already verified there keep their record but{" "}
                  <span className="addr">canHold</span> becomes false: they can no longer receive a
                  transfer or subscribe.
                </>,
                "They can still redeem and still claim coupons. Nothing is trapped.",
              ]
            : [
                <>
                  <span className="addr">addVerified</span> stops reverting for{" "}
                  {country?.name ?? `country ${code}`}, so new addresses there can be verified.
                </>,
                <>
                  Addresses already verified there regain <span className="addr">canHold</span> and
                  can receive and subscribe again, with no further transaction.
                </>,
              ]
        }
        onConfirm={() => {
          if (to === null || code === null) return;
          void tx.send({
            address: to,
            abi: identityRegistryAbi,
            functionName: "setCountryBlocked",
            args: [code, intendBlocked],
          });
        }}
      />
    </>
  );
}

/**
 * One seeded code with its live state. A component rather than a loop body so each read gets its
 * own hook: the list is fixed at build time, but the rule is the rule.
 */
function SeedCodeRow({
  code,
  name,
  registry,
}: {
  code: number;
  name: string;
  registry: Address | null;
}) {
  const blocked = useReadContract({
    address: registry ?? undefined,
    abi: identityRegistryAbi,
    functionName: "isCountryBlocked",
    args: [code],
    chainId: REQUIRED_CHAIN_ID,
    query: { enabled: registry !== null },
  });

  return (
    <li className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-ink">
        {name} <span className="num text-muted">({code})</span>
      </span>
      <StatusBadge
        tone={blocked.data === undefined ? "neutral" : blocked.data ? "danger" : "warning"}
      >
        {registry === null
          ? "No registry deployed"
          : blocked.isLoading
            ? "Reading…"
            : blocked.data === undefined
              ? "The registry did not answer"
              : blocked.data
                ? "Blocked on chain"
                : "Not blocked on chain"}
      </StatusBadge>
    </li>
  );
}
