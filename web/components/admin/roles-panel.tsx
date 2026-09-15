"use client";

/**
 * Which of the five roles this wallet holds, and what each action needs.
 *
 * BUILD_PROMPT 7.2 gates the console on on-chain roles. The gate has to answer two questions and
 * they pull in opposite directions: *what can I do here*, and *what would I need in order to do the
 * rest*. A console that only answers the first shows somebody an empty page; one that only answers
 * the second shows everybody a wall of disabled buttons. So this panel answers both — the roles
 * held, then a table of every action against the role it needs — and says, in as many words, that
 * none of it is protecting anything.
 */

import * as React from "react";
import { Check, Minus, X } from "lucide-react";

import { GATE_IS_NOT_A_BOUNDARY, PUBLIC_PAGE_NOTE } from "@/components/admin/copy";
import {
  ADMIN_ACTIONS,
  ROLES,
  anyRoleUnread,
  getRole,
  heldRoles,
  holdsNothing,
  permissionFor,
  type RoleHoldings,
} from "@/components/admin/roles";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ACTIVE_CHAIN } from "@/lib/chains";
import { cn } from "@/lib/utils";

export interface RolesPanelProps {
  holdings: RoleHoldings;
  /** The connected address, or `null`. */
  account: string | null;
  /** True while the chain has not answered for at least one role. */
  reading: boolean;
  /** Set when the contracts could not be reached at all. */
  unavailable: string | null;
  className?: string;
}

export function RolesPanel({
  holdings,
  account,
  reading,
  unavailable,
  className,
}: RolesPanelProps) {
  const held = heldRoles(holdings);
  const nothing = account !== null && holdsNothing(holdings);
  const pending = account !== null && anyRoleUnread(holdings);

  return (
    <Card data-testid="roles-panel" className={className}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle as="h2">Roles</CardTitle>
          <Badge tone="neutral">{ACTIVE_CHAIN.label}</Badge>
        </div>
        <CardDescription>
          Read with <span className="addr">hasRole</span> from the deployed{" "}
          <span className="addr">HBToken</span> and <span className="addr">IdentityRegistry</span>.
          They are separate AccessControl instances, so the two admin roles are two different
          grants.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {unavailable ? (
          <p className="border-warning-surface bg-warning-surface text-ink rounded-md border p-3 text-sm leading-relaxed">
            {unavailable}
          </p>
        ) : null}

        {account === null ? (
          <p className="text-muted text-sm leading-relaxed" data-testid="roles-no-wallet">
            No wallet is connected, so no role has been read. Every action below is listed with the
            role it needs and the call it sends; the forms and the encoded calls work without a
            wallet, and only signing needs one.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-muted text-sm">
              Connected as <span className="addr text-ink">{account}</span>
            </p>
            {reading || pending ? (
              <p className="text-muted text-sm">Reading roles from the chain&hellip;</p>
            ) : held.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {held.map((role) => (
                  <li key={role.id}>
                    <StatusBadge tone="success">
                      {role.label} &mdash; {role.constant} on {role.contract}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            ) : nothing ? (
              <p className="text-muted text-sm leading-relaxed" data-testid="roles-none-held">
                This wallet holds none of the five roles, so the contracts would refuse every write
                on this page with AccessControlUnauthorizedAccount. The table below says which role
                each action needs. Nothing here is hidden from you; it is simply not yours to send.
              </p>
            ) : null}
          </div>
        )}

        <Table aria-label="Admin actions and the role each one needs">
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              <TableHead>Call</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>This wallet</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ADMIN_ACTIONS.map((action) => {
              const role = action.role === null ? null : getRole(action.role);
              const permission = permissionFor(action, holdings);
              const state =
                account === null
                  ? { icon: Minus, label: "No wallet", tone: "text-muted" as const }
                  : permission === "unknown"
                    ? { icon: Minus, label: "Checking", tone: "text-muted" as const }
                    : permission === "allowed"
                      ? { icon: Check, label: "Can send", tone: "text-success" as const }
                      : { icon: X, label: "Cannot send", tone: "text-danger" as const };
              const Icon = state.icon;

              return (
                <TableRow key={action.id}>
                  <TableCell>
                    {action.label}
                    {action.destructive ? (
                      <>
                        {" "}
                        <Badge tone="danger">typed confirmation</Badge>
                      </>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <span className="addr text-xs">{action.call}</span>
                  </TableCell>
                  <TableCell>
                    {role === null ? (
                      <span className="text-muted text-xs">
                        none &mdash; the server&rsquo;s registrar key signs
                      </span>
                    ) : (
                      <span className="addr text-xs">
                        {role.constant}
                        <span className="text-muted"> on {role.contract}</span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className={cn("inline-flex items-center gap-1.5 text-xs", state.tone)}>
                      <Icon aria-hidden="true" className="size-3.5" />
                      {state.label}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <div className="border-border bg-surface-sunken rounded-md border p-3">
          <p className="text-ink text-xs font-semibold">This gate protects nothing</p>
          <p className="text-muted mt-1 text-xs leading-relaxed">{GATE_IS_NOT_A_BOUNDARY}</p>
          <p className="text-muted mt-2 text-xs leading-relaxed">{PUBLIC_PAGE_NOTE}</p>
        </div>

        <details className="text-xs">
          <summary className="text-accent-ink cursor-pointer underline underline-offset-4">
            What each role grants
          </summary>
          <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
            {ROLES.map((role) => (
              <React.Fragment key={role.id}>
                <dt className="addr text-muted">
                  {role.constant} ({role.contract})
                </dt>
                <dd className="text-ink">{role.grants}</dd>
              </React.Fragment>
            ))}
          </dl>
        </details>
      </CardContent>
    </Card>
  );
}
