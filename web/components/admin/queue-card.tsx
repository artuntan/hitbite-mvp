"use client";

/**
 * The pending verification queue, with approve and reject.
 *
 * **Approve does not call `addVerified`.** It posts the address to `/api/verify/process` — the
 * registrar worker from PLAN.md D8, the same endpoint the `/verify` countdown calls, signed by the
 * same server key. That matters for more than tidiness: the worker re-reads the country against the
 * registry immediately before it signs, refuses retail, notices an address the registry already
 * holds and closes it out without a transaction, and claims the row first so two operators cannot
 * collide on the registrar's nonce (PLAN.md D60, D61). A second implementation in the browser would
 * have none of that, and would drift from it the first time either changed.
 *
 * **Reject is signed.** It closes a request off chain, and unlike everything else on this page there
 * is no contract in the path to refuse the wrong caller — so the operator signs
 * `adminRejectMessage(...)` and the server checks `hasRole(REGISTRAR_ROLE, signer)` against the
 * deployed registry before it writes. The message is shown in full before it is signed, which is the
 * signature equivalent of showing the calldata.
 */

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { useAccount, useSignMessage } from "wagmi";

import { RuleNote } from "@/components/admin/action-card";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import {
  QUEUE_APPROVE_NOTE,
  QUEUE_INTRO,
  QUEUE_NOT_DUE_NOTE,
  QUEUE_PRIVACY_NOTE,
  QUEUE_REJECT_NOTE,
} from "@/components/admin/copy";
import { AdminField, AdminInput } from "@/components/admin/fields";
import {
  adminRejectMessage,
  checkRejectReason,
  describeRejectReasonProblem,
  dueInMs,
  type AdminQueueData,
  type AdminQueueEntry,
} from "@/components/admin/queue";
import {
  fetchAdminQueue,
  rejectRequest,
  runWorker,
  type ApiFailure,
  type ProcessedItem,
} from "@/components/admin/queue-api";
import { getAction, permissionFor, type RoleHoldings } from "@/components/admin/roles";
import { useNowMs } from "@/components/admin/use-now";
import type { AdminChainState } from "@/components/admin/use-admin-chain";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ACTIVE_CHAIN_ID } from "@/lib/chains";
import { formatDateTimeUtc } from "@/lib/format";
import { decodeTxError } from "@/lib/tx";

/**
 * The row a dialog is open for. `issuedAt` is minted when the dialog opens rather than when the
 * signature is requested, so the timestamp inside the message on screen is the timestamp that gets
 * signed and sent — a message that changed between being read and being signed would be a small
 * lie in exactly the place this page cannot afford one.
 */
type Pending = { address: string; kind: "approve" | "reject"; issuedAt: string } | null;

/** The row a request is in flight for. No `issuedAt`: nothing is being signed from this one. */
type Busy = { address: string; kind: "approve" | "reject" } | null;

interface Outcome {
  address: string;
  tone: "success" | "warning" | "danger";
  title: string;
  message: string;
}

export interface QueueCardProps {
  chain: AdminChainState;
  holdings: RoleHoldings;
  canSign: boolean;
}

export function QueueCard({ chain, holdings, canSign }: QueueCardProps) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const nowMs = useNowMs();

  const approveAction = getAction("queue-approve");
  const rejectAction = getAction("queue-reject");
  const canReject = permissionFor(rejectAction, holdings) === "allowed" && canSign;

  const [data, setData] = React.useState<AdminQueueData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [busy, setBusy] = React.useState<Busy>(null);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);

  const [confirming, setConfirming] = React.useState<Pending>(null);
  const [reason, setReason] = React.useState("");

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    const result = await fetchAdminQueue(signal);
    if (signal?.aborted) return;
    setLoading(false);
    if (result.ok) {
      setData(result.data);
      setFailure(null);
    } else {
      setFailure(result.failure);
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const entries = data?.pending ?? [];
  const selected = confirming
    ? (entries.find((entry) => entry.address === confirming.address) ?? null)
    : null;

  const issuedAt = confirming?.issuedAt ?? "";

  const rejectMessage =
    selected && issuedAt !== "" && data?.registry_address
      ? adminRejectMessage({
          address: selected.address,
          reason: reason.trim(),
          chainId: data.chain_id,
          registry: data.registry_address,
          issuedAt,
        })
      : null;

  const reasonProblem = checkRejectReason(reason);

  async function approve(entry: AdminQueueEntry) {
    setBusy({ address: entry.address, kind: "approve" });
    setOutcome(null);
    const result = await runWorker(entry.address);
    setBusy(null);
    setConfirming(null);

    if (!result.ok) {
      setOutcome({
        address: entry.address,
        tone: "danger",
        title: "The worker refused",
        message: `${result.failure.message}${result.failure.hint ? ` ${result.failure.hint}` : ""}`,
      });
      return;
    }

    const item: ProcessedItem | undefined = result.data.processed.find(
      (processed) => processed.address.toLowerCase() === entry.address.toLowerCase(),
    );
    if (!item) {
      setOutcome({
        address: entry.address,
        tone: "warning",
        title: "Nothing was due",
        message: `${QUEUE_NOT_DUE_NOTE} ${result.data.notes[0] ?? ""}`.trim(),
      });
    } else {
      setOutcome({
        address: entry.address,
        tone:
          item.outcome === "approved"
            ? "success"
            : item.outcome === "deferred"
              ? "warning"
              : "danger",
        title: `Worker outcome: ${item.outcome}`,
        message: item.tx_hash ? `${item.reason} Transaction ${item.tx_hash}.` : item.reason,
      });
    }
    await load();
    chain.refresh();
  }

  async function reject(entry: AdminQueueEntry) {
    if (rejectMessage === null || reasonProblem !== null || address === undefined) return;
    setBusy({ address: entry.address, kind: "reject" });
    setOutcome(null);

    let signature: string;
    try {
      signature = await signMessageAsync({ message: rejectMessage });
    } catch (error) {
      const decoded = decodeTxError(error, { action: "The rejection" });
      setBusy(null);
      setOutcome({
        address: entry.address,
        tone: "danger",
        title: decoded.title,
        message: decoded.message,
      });
      return;
    }

    const result = await rejectRequest({
      address: entry.address,
      reason: reason.trim(),
      issued_at: issuedAt,
      signer: address,
      signature,
    });
    setBusy(null);
    setConfirming(null);
    setReason("");

    if (!result.ok) {
      setOutcome({
        address: entry.address,
        tone: "danger",
        title: "The rejection was refused",
        message: `${result.failure.message}${result.failure.hint ? ` ${result.failure.hint}` : ""}`,
      });
      return;
    }
    setOutcome({
      address: entry.address,
      tone: result.data.rejected ? "success" : "warning",
      title: result.data.rejected ? "Request rejected" : "Nothing changed",
      message: result.data.note,
    });
    await load();
  }

  return (
    <>
      <Card id="queue" data-testid="queue-card">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle as="h3">Verification queue</CardTitle>
            {data ? <Badge tone="neutral">{data.counts.pending} pending</Badge> : null}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw aria-hidden="true" />
              {loading ? "Reading…" : "Refresh"}
            </Button>
          </div>
          <CardDescription>{QUEUE_INTRO}</CardDescription>
          <p className="addr text-muted mt-1 text-xs">
            {approveAction.call} &middot; {rejectAction.call}
          </p>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {failure ? (
            <RuleNote tone="danger" title="The queue could not be read">
              <p>{failure.message}</p>
              {failure.hint ? <p className="mt-1">{failure.hint}</p> : null}
            </RuleNote>
          ) : null}

          {outcome ? (
            <div role="status">
              <RuleNote
                tone={
                  outcome.tone === "success"
                    ? "info"
                    : outcome.tone === "warning"
                      ? "warning"
                      : "danger"
                }
                title={outcome.title}
              >
                <p className="addr">{outcome.address}</p>
                <p className="mt-1">{outcome.message}</p>
              </RuleNote>
            </div>
          ) : null}

          {loading && data === null ? (
            <Skeleton className="h-24 w-full" />
          ) : entries.length === 0 ? (
            <p className="text-muted text-sm leading-relaxed" data-testid="queue-empty">
              No verification request is waiting.{" "}
              {data
                ? `${data.counts.approved} approved, ${data.counts.rejected} rejected and ${data.counts.blocked} blocked so far.`
                : ""}{" "}
              Requests arrive from /verify and are auto-approved by the worker after the delay; this
              queue is for the ones an operator wants to decide sooner, or differently.
            </p>
          ) : (
            <Table aria-label="Pending verification requests">
              <TableHeader>
                <TableRow>
                  <TableHead>Address</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Worker</TableHead>
                  <TableHead>Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const waiting = nowMs === null ? null : dueInMs(entry, nowMs);
                  const rowBusy = busy?.address === entry.address;
                  return (
                    <TableRow key={entry.address}>
                      <TableCell>
                        <span className="addr text-xs">{entry.address}</span>
                        {entry.attempts > 0 ? (
                          <p className="text-warning mt-1 text-xs">
                            {entry.attempts} failed attempt{entry.attempts === 1 ? "" : "s"}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {entry.country_name ?? `Country ${entry.country}`}{" "}
                        <span className="num text-muted">({entry.country})</span>
                        <p className="text-muted text-xs">{entry.investor_type_label}</p>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs">{formatDateTimeUtc(entry.submitted_at)}</span>
                      </TableCell>
                      <TableCell>
                        {waiting === null ? (
                          <span className="text-muted text-xs">—</span>
                        ) : waiting === 0 ? (
                          <StatusBadge tone="success">Due now</StatusBadge>
                        ) : (
                          <StatusBadge tone="neutral">
                            Due in {Math.ceil(waiting / 1000)}s
                          </StatusBadge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={rowBusy}
                            onClick={() => {
                              setReason("");
                              setConfirming({
                                address: entry.address,
                                kind: "approve",
                                issuedAt: new Date().toISOString(),
                              });
                            }}
                          >
                            Approve
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={rowBusy || !canReject}
                            onClick={() => {
                              setReason("");
                              setConfirming({
                                address: entry.address,
                                kind: "reject",
                                issuedAt: new Date().toISOString(),
                              });
                            }}
                          >
                            Reject
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {!canReject ? (
            <p className="text-muted text-xs leading-relaxed">
              Rejecting needs a wallet holding REGISTRAR_ROLE on the identity registry, checked by
              the server against the chain. Approving needs nothing from your wallet: the
              server&rsquo;s registrar key signs it.
            </p>
          ) : null}

          <RuleNote title="Approving runs the worker">{QUEUE_APPROVE_NOTE}</RuleNote>
          <RuleNote title="Rejecting is off chain, and is signed">{QUEUE_REJECT_NOTE}</RuleNote>
          <RuleNote>{QUEUE_PRIVACY_NOTE}</RuleNote>

          {data ? (
            <div className="text-muted flex flex-col gap-1 text-xs leading-relaxed">
              <p>
                Read at {formatDateTimeUtc(data.fetched_at)} from {data.storage.display}. Worker
                delay {data.worker.auto_approve_delay_ms} ms
                {data.worker.requires_secret
                  ? "; this deployment protects /api/verify/process with a secret, so approving from the browser will be refused with 401 and the operator's cron does the work."
                  : "."}
              </p>
              {data.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirming?.kind === "approve"}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title="Approve this verification request"
        description="This asks the registrar worker to act on one address now."
        tone="warning"
        phrase={null}
        confirmLabel="Run the worker"
        busy={busy?.kind === "approve"}
        extra={
          selected ? (
            <div className="border-border bg-surface-sunken flex flex-col gap-2 rounded-lg border p-4">
              <p className="text-ink text-sm font-semibold">The request</p>
              <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
                <dt className="text-muted">Address</dt>
                <dd className="addr text-ink">{selected.address}</dd>
                <dt className="text-muted">Country</dt>
                <dd className="text-ink">
                  {selected.country_name ?? "Unknown"} ({selected.country})
                </dd>
                <dt className="text-muted">Investor type</dt>
                <dd className="text-ink">{selected.investor_type_label}</dd>
              </dl>
              <p className="text-ink mt-2 text-sm font-semibold">The call</p>
              <pre className="addr text-ink bg-surface border-border overflow-x-auto rounded border p-2 text-[11px]">
                <code>{`POST /api/verify/process\n{"address":"${selected.address}"}`}</code>
              </pre>
              <p className="text-muted text-xs leading-relaxed">
                No transaction is signed by your wallet. The worker signs{" "}
                <span className="addr">
                  addVerified({selected.address}, {selected.country}, 1)
                </span>{" "}
                with the server&rsquo;s registrar key, after re-checking the country against the
                registry.
              </p>
            </div>
          ) : null
        }
        consequences={[
          "The worker re-reads the country from the registry before signing, so a country blocked since submission is recorded as blocked rather than sent.",
          "An address the registry already holds is closed out with no transaction at all.",
          "Nothing happens if the request is not yet past the auto-approval delay; the response will say so.",
        ]}
        onConfirm={() => {
          if (selected) void approve(selected);
        }}
      />

      <ConfirmDialog
        open={confirming?.kind === "reject"}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title="Reject this verification request"
        description="This closes the request off chain and asks your wallet for a signature, not a transaction."
        tone="danger"
        phrase="REJECT"
        confirmLabel="Sign and reject"
        busy={busy?.kind === "reject"}
        confirmDisabled={reasonProblem !== null || rejectMessage === null}
        extra={
          <div className="flex flex-col gap-4">
            <AdminField
              id="admin-reject-reason"
              label="Reason"
              error={describeRejectReasonProblem(reasonProblem)}
              hint="Stored on the request and shown to the applicant on /verify. It is part of what you sign, so it cannot be changed afterwards without signing again."
              control={(props) => (
                <AdminInput
                  {...props}
                  mono="none"
                  placeholder="Duplicate request from the same operator."
                  value={reason}
                  invalid={reasonProblem !== null}
                  onChange={(event) => setReason(event.target.value)}
                />
              )}
            />

            {rejectMessage ? (
              <div className="border-border bg-surface-sunken flex flex-col gap-2 rounded-lg border p-4">
                <p className="text-ink text-sm font-semibold">The message you will sign</p>
                <pre className="addr text-ink bg-surface border-border overflow-x-auto rounded border p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
                  <code>{rejectMessage}</code>
                </pre>
                <p className="text-muted text-xs leading-relaxed">
                  EIP-191 <span className="addr">personal_sign</span>. The server rebuilds this
                  exact string, recovers your address from the signature, and checks{" "}
                  <span className="addr">hasRole(REGISTRAR_ROLE, you)</span> on the registry on
                  chain {ACTIVE_CHAIN_ID} before it writes anything.
                </p>
              </div>
            ) : (
              <RuleNote tone="warning">
                There is no registry address for this network, so there is no REGISTRAR_ROLE for the
                server to check a signature against and nothing can be rejected here.
              </RuleNote>
            )}
          </div>
        }
        consequences={[
          "The stored request moves from pending to rejected, with your reason on it.",
          "No transaction is sent and the identity registry is not touched: an address it already holds stays verified.",
          "The applicant can submit again from /verify; a resubmission replaces the row.",
        ]}
        onConfirm={() => {
          if (selected) void reject(selected);
        }}
      />
    </>
  );
}
