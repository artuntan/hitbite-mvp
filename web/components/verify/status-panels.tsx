"use client";

/**
 * The four states a submitted request can be in, and the details panel they share.
 *
 * Each one answers the same two questions: what happened, and what this person does next. A screen
 * that can only be left by reloading the page is the bug this file exists to prevent — so pending
 * keeps a worker call and a status check, a refusal keeps a way back to the form, and approval says
 * what the registry now holds and what could still take it away.
 */

import * as React from "react";
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";

import { NAV_ITEMS, PLANNED_ROUTES } from "@/components/layout/nav-items";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TxExplorerLink } from "@/components/wallet/tx-status";
import type { StatusData, SubmitData } from "@/components/verify/api";
import {
  ON_CHAIN_IS_THE_RULE,
  RULE_TITLES,
  SIMULATED_REGISTRAR,
  STATUS_PRESENTATION,
  WHAT_IS_STORED,
} from "@/components/verify/copy";
import type { WorkerReport } from "@/components/verify/use-verification";
import { formatDateTimeUtc } from "@/lib/format";
import { txExplorerLink } from "@/lib/tx";
import { cn } from "@/lib/utils";

/** `/subscribe` is linked only once the shell lists it, so this can never point at a 404 (D49). */
const SUBSCRIBE = NAV_ITEMS.find((item) => item.href === "/subscribe");
const SUBSCRIBE_PHASE =
  PLANNED_ROUTES.find((route) => route.href === "/subscribe")?.phase ?? "a later phase";

function seconds(ms: number): string {
  return `${Math.ceil(ms / 1000)} s`;
}

/** The configured delay, in whichever unit reads as a duration rather than as a constant. */
function describeDelay(ms: number): string {
  return ms >= 1_000 ? `${Math.round(ms / 1_000)} s` : `${ms} ms`;
}

// --------------------------------------------------------------------------- shared details

export function RequestDetails({
  status,
  submission,
}: {
  status: StatusData;
  submission: SubmitData | null;
}) {
  const request = status.request;
  const rows: Array<{ label: string; value: string; mono?: boolean }> = [];

  rows.push({ label: "Address", value: status.address, mono: true });
  if (request) {
    rows.push({
      label: "Country",
      value: `${request.country_name ?? "Unknown"} (${request.country})`,
    });
    rows.push({
      label: "Investor type",
      value: `${request.investor_type_label} (${request.investor_type})`,
    });
    rows.push({ label: "Submitted", value: formatDateTimeUtc(request.submitted_at) });
    if (request.decided_at) {
      rows.push({ label: "Decided", value: formatDateTimeUtc(request.decided_at) });
    }
    if (request.attempts > 0) {
      rows.push({ label: "Registrar attempts", value: String(request.attempts) });
    }
  }
  rows.push({
    label: "Answer from",
    value:
      status.source === "chain"
        ? "the registry on chain"
        : status.source === "store"
          ? "the stored request"
          : "neither: no request and no registry record",
  });

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        {rows.map((row) => (
          <React.Fragment key={row.label}>
            <dt className="text-muted">{row.label}</dt>
            <dd className={cn("text-ink min-w-0 break-words", row.mono && "addr")}>{row.value}</dd>
          </React.Fragment>
        ))}
      </dl>

      {request?.tx_hash ? (
        <TxExplorerLink link={txExplorerLink(request.tx_hash)} hash={request.tx_hash} />
      ) : null}

      <details className="text-sm">
        <summary className="text-accent-ink cursor-pointer underline underline-offset-4">
          What the API said
        </summary>
        <div className="text-muted mt-2 flex flex-col gap-2 text-xs leading-relaxed">
          {submission ? <p>{submission.next_step}</p> : null}
          {status.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
          <p>
            Storage: {status.storage.display}. {status.storage.note}
          </p>
          <p>
            Registrar: {status.worker.registrar.status}
            {status.worker.registrar.address ? (
              <>
                {" "}
                at <span className="addr">{status.worker.registrar.address}</span>
              </>
            ) : null}
            {status.worker.registrar.reason ? <> — {status.worker.registrar.reason}</> : null}.
            Auto-approval delay {status.worker.auto_approve_delay_ms} ms.
          </p>
        </div>
      </details>
    </div>
  );
}

// --------------------------------------------------------------------------- pending

type StepTone = "waiting" | "active" | "done" | "problem";

const STEP_ICON: Record<StepTone, typeof CircleDashed> = {
  waiting: CircleDashed,
  active: LoaderCircle,
  done: CircleCheck,
  problem: CircleAlert,
};

const STEP_ICON_CLASS: Record<StepTone, string> = {
  waiting: "text-muted",
  active: "text-accent-ink motion-safe:animate-spin",
  done: "text-success",
  problem: "text-danger",
};

function Step({
  tone,
  title,
  children,
}: {
  tone: StepTone;
  title: string;
  children?: React.ReactNode;
}) {
  const Icon = STEP_ICON[tone];
  return (
    <li className="border-border bg-surface flex items-start gap-3 rounded-lg border p-4">
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", STEP_ICON_CLASS[tone])} />
      <div className="min-w-0 flex-1">
        <p className="text-ink text-sm font-medium">{title}</p>
        {children ? <div className="text-muted mt-1 text-sm">{children}</div> : null}
      </div>
    </li>
  );
}

export interface PendingPanelProps {
  status: StatusData;
  submission: SubmitData | null;
  remainingMs: number;
  worker: WorkerReport;
  pollingExhausted: boolean;
  isRefreshing: boolean;
  onRetryWorker: () => void;
  onRefresh: () => void;
}

export function PendingPanel({
  status,
  submission,
  remainingMs,
  worker,
  pollingExhausted,
  isRefreshing,
  onRetryWorker,
  onRefresh,
}: PendingPanelProps) {
  const counting = remainingMs > 0;
  const workerTone: StepTone =
    worker.phase === "running"
      ? "active"
      : worker.phase === "done"
        ? "done"
        : worker.phase === "idle"
          ? "waiting"
          : "problem";

  /** One sentence, changing only at a phase boundary, so a screen reader is told once. */
  const announcement = counting
    ? "The request is recorded and waiting out the registrar delay."
    : worker.phase === "running"
      ? "The registrar worker is running."
      : worker.phase === "done"
        ? "The registrar has acted; waiting for the registry to confirm."
        : worker.phase === "idle"
          ? "The request is due and the worker is about to be called."
          : "The registrar did not finish. The request is still pending.";

  return (
    <Card data-testid="state-pending">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle as="h2">Waiting for the registrar</CardTitle>
          <StatusBadge tone={STATUS_PRESENTATION.pending.tone}>
            {STATUS_PRESENTATION.pending.label}
          </StatusBadge>
        </div>
        <CardDescription>{SIMULATED_REGISTRAR.short}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>

        <ol className="flex flex-col gap-3">
          <Step tone="done" title="Request recorded">
            {status.request
              ? `Stored at ${formatDateTimeUtc(status.request.submitted_at)}.`
              : "Stored."}
          </Step>

          <Step tone={counting ? "active" : "done"} title="Simulated registrar delay">
            {counting ? (
              <span>
                <span className="num text-ink" data-testid="countdown">
                  {seconds(remainingMs)}
                </span>{" "}
                left of the {describeDelay(status.worker.auto_approve_delay_ms)} delay. It exists so
                the state is visible; it is not a review.
              </span>
            ) : (
              "Elapsed."
            )}
          </Step>

          <Step tone={workerTone} title="Registrar calls addVerified">
            {worker.phase === "idle" ? (
              counting ? (
                "Runs as soon as the delay is up."
              ) : (
                "Starting."
              )
            ) : worker.phase === "running" ? (
              "POST /api/verify/process is running."
            ) : worker.note ? (
              <div className="flex flex-col gap-2">
                <p>{worker.note}</p>
                {worker.phase !== "done" ? (
                  <div>
                    <Button variant="secondary" size="sm" onClick={onRetryWorker}>
                      <RefreshCw aria-hidden="true" />
                      Call the registrar again
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              "The registrar sent the transaction."
            )}
            {worker.txHash ? (
              <div className="mt-2">
                <TxExplorerLink link={txExplorerLink(worker.txHash)} hash={worker.txHash} />
              </div>
            ) : null}
          </Step>

          <Step tone={pollingExhausted ? "problem" : "waiting"} title="Registry confirms">
            {pollingExhausted
              ? "This page has stopped checking automatically. The request is still pending; check again below."
              : "GET /api/verify/status is polled until the registry answers. The chain is the record, not this page."}
          </Step>
        </ol>

        {worker.notes.length > 0 ? (
          <Alert tone="info">
            <AlertTitle>From the worker</AlertTitle>
            <AlertDescription>
              {worker.notes.map((note) => (
                <p key={note} className="[&:not(:first-child)]:mt-1">
                  {note}
                </p>
              ))}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onRefresh} disabled={isRefreshing}>
            <RefreshCw aria-hidden="true" />
            {isRefreshing ? "Checking…" : "Check again"}
          </Button>
        </div>

        <RequestDetails status={status} submission={submission} />
      </CardContent>
    </Card>
  );
}

// --------------------------------------------------------------------------- approved

export function ApprovedPanel({
  status,
  submission,
}: {
  status: StatusData;
  submission: SubmitData | null;
}) {
  const chain = status.chain;
  return (
    <Card data-testid="state-approved">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle as="h2">This wallet is verified</CardTitle>
          <StatusBadge tone={STATUS_PRESENTATION.approved.tone}>
            {STATUS_PRESENTATION.approved.label}
          </StatusBadge>
        </div>
        <CardDescription>
          IdentityRegistry holds a record for this address, so HBToken will let it receive hbTRS.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {chain.status === "ok" ? (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted">Registry</dt>
            <dd className="addr text-ink min-w-0 break-words">{chain.registry_address}</dd>
            <dt className="text-muted">Network</dt>
            <dd className="text-ink">
              {chain.network} ({chain.chain_id})
            </dd>
            <dt className="text-muted">Country on the record</dt>
            <dd className="text-ink">
              {chain.country_name ?? "Unknown"} ({chain.country})
            </dd>
            <dt className="text-muted">Can hold hbTRS</dt>
            <dd className="text-ink">{chain.can_hold ? "Yes" : "No"}</dd>
            {chain.verified_at ? (
              <>
                <dt className="text-muted">Verified at</dt>
                <dd className="text-ink">{formatDateTimeUtc(chain.verified_at)}</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <Alert tone="warning">
            <AlertTitle>The registry could not be read from here</AlertTitle>
            <AlertDescription>
              {chain.reason} This status comes from the stored request. The registry is the record,
              so treat this as what the server believes rather than as confirmation.
            </AlertDescription>
          </Alert>
        )}

        {status.source === "chain" && status.request === null ? (
          <p className="text-muted text-sm leading-relaxed">
            There is no stored request for this address — the registry was written to by the demo
            script, an admin, or a server instance whose file store has since been discarded. The
            registry is what counts, and it says verified.
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          <p className="text-ink text-sm font-medium">What this does not mean</p>
          <ul className="text-muted flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed">
            <li>Nobody checked who you are. {SIMULATED_REGISTRAR.short}</li>
            <li>
              An admin can call removeVerified at any time, and blocking your country later flips
              canHold to false without deleting the record (COMPLIANCE_RULES.md section 1).
            </li>
            <li>{WHAT_IS_STORED.chain[0]}</li>
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {SUBSCRIBE ? (
            <Button variant="primary" size="md" asChild>
              <Link href={SUBSCRIBE.href}>
                Subscribe in test USDC
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <p className="text-muted text-sm">
              Subscription lands in {SUBSCRIBE_PHASE}; it is not linked until the route exists.
            </p>
          )}
        </div>

        <RequestDetails status={status} submission={submission} />
      </CardContent>
    </Card>
  );
}

// --------------------------------------------------------------------------- refused

export interface RefusedPanelProps {
  status: StatusData;
  submission: SubmitData | null;
  onStartOver: () => void;
}

/** `blocked` and `rejected` share a shape and differ in what can be done about them. */
export function RefusedPanel({ status, submission, onStartOver }: RefusedPanelProps) {
  const isBlocked = status.status === "blocked";
  const presentation = isBlocked ? STATUS_PRESENTATION.blocked : STATUS_PRESENTATION.rejected;
  const rule = submission?.rule ?? null;
  // The badge already says "Country blocked" / "Refused"; the heading has to add something, so it
  // names the rule when the submission response identified one and states the outcome otherwise.
  const fallbackTitle = isBlocked ? "This country cannot be verified" : "This request was refused";
  const title = rule ? (RULE_TITLES[rule] ?? fallbackTitle) : fallbackTitle;
  const reason = status.request?.reason ?? null;

  return (
    <Card data-testid={isBlocked ? "state-blocked" : "state-rejected"}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle as="h2">{title}</CardTitle>
          <StatusBadge tone={presentation.tone}>{presentation.label}</StatusBadge>
        </div>
        <CardDescription>
          Nothing was sent on chain, and nothing will be while the request stands as it is.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {reason ? <p className="text-ink text-sm leading-relaxed">{reason}</p> : null}

        <Alert tone={isBlocked ? "danger" : "warning"}>
          <AlertTitle>{isBlocked ? "What happens next" : "How to fix it"}</AlertTitle>
          <AlertDescription>
            {isBlocked ? (
              <p>
                A blocked country is final for that country: addVerified reverts CountryBlocked, so
                no wallet registered to it can be verified or hold hbTRS. If the wrong country was
                picked, correct it and submit again — that is the only thing worth retrying here.
              </p>
            ) : (
              <p>
                Correct what the reason names and submit again. The stored request is overwritten,
                not duplicated.
              </p>
            )}
            <p className="mt-2">{ON_CHAIN_IS_THE_RULE}</p>
          </AlertDescription>
        </Alert>

        <div>
          <Button variant="secondary" size="md" onClick={onStartOver}>
            <RotateCcw aria-hidden="true" />
            {isBlocked ? "Correct the country" : "Change my answers"}
          </Button>
        </div>

        <RequestDetails status={status} submission={submission} />
      </CardContent>
    </Card>
  );
}
