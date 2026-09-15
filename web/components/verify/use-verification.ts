"use client";

/**
 * The state of one wallet's verification, and everything that moves it forward.
 *
 * The flow the API defines (PLAN.md D8) is: submit, wait out `AUTO_APPROVE_DELAY_MS`, call the
 * worker, then poll the status endpoint until the registry answers. This hook runs exactly that,
 * and its whole design goal is that no step can leave the page with nothing to say:
 *
 *   - **The countdown is server time, not browser time.** Every status response recomputes
 *     `auto_approve_in_ms` from the stored `created_at`, so each poll re-anchors the deadline and a
 *     clock that is minutes out cannot make the page wait forever or fire early.
 *   - **A worker failure is a state, not an end.** 401 (the deployment keeps the worker behind a
 *     secret), 429, a network drop, or a registrar with no key configured all leave the request
 *     stored and pending; the hook records why, keeps polling, and offers the call again.
 *   - **Polling stops.** Twenty attempts, three seconds apart. After that the page says it is still
 *     pending and hands over a button, rather than hammering an endpoint into a tab nobody is
 *     watching.
 *   - **The chain outranks the store.** That is decided by `/api/verify/status`, not here; this
 *     hook renders whatever `status` and `source` it is told.
 */

import * as React from "react";

import type { VerifyScreen } from "@/components/verify/copy";
import {
  explainWorkerFailure,
  fetchStatus,
  runWorker,
  submitRequest,
  type ApiFailure,
  type ProcessData,
  type StatusData,
  type SubmitBody,
  type SubmitData,
} from "@/components/verify/api";

/** How often the status endpoint is asked once the request is due. */
const POLL_INTERVAL_MS = 3_000;
/** Cap on automatic polls; a minute of waiting is enough before handing control back. */
const MAX_POLLS = 20;
/** Countdown repaint rate. Fast enough to look live, slow enough to be free. */
const TICK_MS = 500;

export type WorkerPhase = "idle" | "running" | "done" | "deferred" | "failed";

export interface WorkerReport {
  phase: WorkerPhase;
  /** One sentence naming what happened and who finishes the job. `null` while idle. */
  note: string | null;
  /** Anything the worker itself added — the registrar being unconfigured, the storage caveat. */
  notes: string[];
  /** The `addVerified` hash, as soon as the worker reports one. */
  txHash: string | null;
  /**
   * True when calling again could plausibly change the answer — the row was not due yet, or another
   * invocation held it. False when the reason is structural (no registrar configured), where a loop
   * would only burn the endpoint's rate limit.
   */
  autoRetry: boolean;
}

export interface VerificationState {
  screen: VerifyScreen;
  status: StatusData | null;
  /** The last `POST /api/verify` payload, for its `next_step`, `rule` and notes. */
  submission: SubmitData | null;
  loadFailure: ApiFailure | null;
  submitFailure: ApiFailure | null;
  isSubmitting: boolean;
  isRefreshing: boolean;
  /** Milliseconds until the registrar may act. 0 once it may. */
  remainingMs: number;
  worker: WorkerReport;
  /** True once the automatic polling budget is spent and the person is back in control. */
  pollingExhausted: boolean;
  submit: (body: SubmitBody) => Promise<void>;
  refresh: () => void;
  retryWorker: () => void;
  /** Back to the form after a refusal, to correct an answer and submit again. */
  startOver: () => void;
}

const IDLE_WORKER: WorkerReport = {
  phase: "idle",
  note: null,
  notes: [],
  txHash: null,
  autoRetry: false,
};

/** How many times one page will call the worker for one request before it stops asking. */
const MAX_WORKER_RUNS = 3;

export function useVerification(address: string | undefined): VerificationState {
  const [status, setStatus] = React.useState<StatusData | null>(null);
  const [submission, setSubmission] = React.useState<SubmitData | null>(null);
  const [loadFailure, setLoadFailure] = React.useState<ApiFailure | null>(null);
  const [submitFailure, setSubmitFailure] = React.useState<ApiFailure | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [worker, setWorker] = React.useState<WorkerReport>(IDLE_WORKER);
  const [polls, setPolls] = React.useState(0);
  const [workerRuns, setWorkerRuns] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());

  /**
   * When the registrar may act, in browser time. Re-anchored on every response rather than counted
   * down locally, so the countdown tracks the server's view of its own delay.
   */
  const [dueAt, setDueAt] = React.useState<number | null>(null);

  const applyStatus = React.useCallback((data: StatusData) => {
    setStatus(data);
    const request = data.request;
    setDueAt(
      request && request.status === "pending" && request.auto_approve_in_ms !== null
        ? Date.now() + request.auto_approve_in_ms
        : null,
    );
  }, []);

  // ------------------------------------------------------------------ load, and reload on change

  const load = React.useCallback(
    async (target: string, signal?: AbortSignal) => {
      setIsRefreshing(true);
      const result = await fetchStatus(target, signal);
      if (signal?.aborted) return;
      setIsRefreshing(false);
      if (result.ok) {
        setLoadFailure(null);
        applyStatus(result.data);
      } else {
        setLoadFailure(result.failure);
      }
    },
    [applyStatus],
  );

  React.useEffect(() => {
    // A new wallet is a new question. Nothing about the previous one survives, including a
    // half-finished countdown: showing one wallet's pending request under another's address would
    // be the worst kind of wrong.
    setStatus(null);
    setSubmission(null);
    setLoadFailure(null);
    setSubmitFailure(null);
    setEditing(false);
    setWorker(IDLE_WORKER);
    setPolls(0);
    setWorkerRuns(0);
    setDueAt(null);

    if (!address) return;
    const controller = new AbortController();
    void load(address, controller.signal);
    return () => controller.abort();
  }, [address, load]);

  // ------------------------------------------------------------------ the countdown

  const isPending = status?.status === "pending";
  const remainingMs = dueAt === null ? 0 : Math.max(0, dueAt - now);
  const isDue = isPending && remainingMs <= 0;

  React.useEffect(() => {
    if (!isPending || dueAt === null) return;
    if (dueAt - Date.now() <= 0) {
      setNow(Date.now());
      return;
    }
    const timer = window.setInterval(() => {
      const next = Date.now();
      setNow(next);
      // Once the delay is spent there is nothing left to count: stop rather than repainting a
      // zero every half second for as long as the tab is open.
      if (next >= dueAt) window.clearInterval(timer);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [isPending, dueAt]);

  // ------------------------------------------------------------------ the worker

  const callWorker = React.useCallback(
    async (target: string) => {
      setWorker({ phase: "running", note: null, notes: [], txHash: null, autoRetry: false });
      setWorkerRuns((count) => count + 1);
      const result = await runWorker(target);

      if (!result.ok) {
        setWorker({
          phase: "failed",
          note: explainWorkerFailure(result.failure),
          notes: result.failure.hint ? [result.failure.hint] : [],
          txHash: null,
          // A 429 clears by itself; a 401 needs an operator, and asking again will not help.
          autoRetry: result.failure.status === 429 || result.failure.status === 0,
        });
        return;
      }

      setWorker(describeRun(result.data, target));
      // Whatever it did, the status endpoint is the record. Ask it rather than trusting the
      // worker's own summary of what it thinks it changed.
      void load(target);
    },
    [load],
  );

  React.useEffect(() => {
    if (!address || !isDue || worker.phase !== "idle") return;
    if (workerRuns >= MAX_WORKER_RUNS) return;
    void callWorker(address);
  }, [address, isDue, worker.phase, workerRuns, callWorker]);

  /**
   * Re-arm the worker when it answered "nothing to do" while the row is, by the server's own
   * reckoning, still pending and due. The usual cause is the countdown firing a moment early —
   * `auto_approve_in_ms` is measured before the response crosses the network — and without this the
   * page would sit and poll a request nobody is going to advance. Bounded by `MAX_WORKER_RUNS`.
   */
  React.useEffect(() => {
    if (!address || !isPending || !isDue) return;
    if (worker.phase !== "deferred" && worker.phase !== "failed") return;
    if (!worker.autoRetry || workerRuns >= MAX_WORKER_RUNS) return;
    const timer = window.setTimeout(() => setWorker(IDLE_WORKER), POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [address, isPending, isDue, worker, workerRuns]);

  // ------------------------------------------------------------------ polling

  React.useEffect(() => {
    if (!address || !isPending || !isDue) return;
    if (worker.phase === "idle" || worker.phase === "running") return;
    if (polls >= MAX_POLLS) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void load(address, controller.signal).then(() => {
        if (!controller.signal.aborted) setPolls((count) => count + 1);
      });
    }, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [address, isPending, isDue, worker.phase, polls, load]);

  // ------------------------------------------------------------------ actions

  const submit = React.useCallback(
    async (body: SubmitBody) => {
      setIsSubmitting(true);
      setSubmitFailure(null);
      const result = await submitRequest(body);
      setIsSubmitting(false);

      if (!result.ok) {
        setSubmitFailure(result.failure);
        return;
      }

      const data = result.data;
      setSubmission(data);
      setEditing(false);
      setWorker(IDLE_WORKER);
      setPolls(0);
      setLoadFailure(null);
      applyStatus({
        address: data.request.address,
        status: data.request.status,
        source: "store",
        request: data.request,
        chain: data.chain,
        storage: data.storage,
        worker: data.worker,
        notes: data.notes,
      });
    },
    [applyStatus],
  );

  const refresh = React.useCallback(() => {
    if (!address) return;
    setPolls(0);
    void load(address);
  }, [address, load]);

  const retryWorker = React.useCallback(() => {
    setPolls(0);
    setWorkerRuns(0); // an explicit click is a person deciding; the automatic budget starts over
    setWorker(IDLE_WORKER); // re-arms the effect above, which runs it again
  }, []);

  const startOver = React.useCallback(() => {
    setEditing(true);
    setSubmitFailure(null);
  }, []);

  const screen = pickScreen({ address, status, loadFailure, editing });

  return {
    screen,
    status,
    submission,
    loadFailure,
    submitFailure,
    isSubmitting,
    isRefreshing,
    remainingMs,
    worker,
    pollingExhausted: polls >= MAX_POLLS,
    submit,
    refresh,
    retryWorker,
    startOver,
  };
}

/** Turn one `POST /api/verify/process` response into what it means for this address. */
function describeRun(data: ProcessData, address: string): WorkerReport {
  const item = data.processed.find(
    (entry) => entry.address.toLowerCase() === address.toLowerCase(),
  );

  if (!item) {
    return {
      phase: "deferred",
      note: "The worker had nothing to do for this address: it is not due yet, or another call is already handling it. This page will ask again shortly.",
      notes: data.notes,
      txHash: null,
      autoRetry: true,
    };
  }

  if (item.outcome === "approved") {
    return { phase: "done", note: null, notes: data.notes, txHash: item.tx_hash, autoRetry: false };
  }

  if (item.outcome === "blocked" || item.outcome === "rejected") {
    // The worker re-checks the rules immediately before signing, so a country blocked since
    // submission is refused here rather than on chain. The reason is the server's own sentence.
    return {
      phase: "done",
      note: item.reason,
      notes: data.notes,
      txHash: item.tx_hash,
      autoRetry: false,
    };
  }

  return {
    phase: "deferred",
    note: `The registrar did not send a transaction: ${item.reason}`,
    notes: data.notes,
    txHash: item.tx_hash,
    // "skipped" means another invocation holds the claim and will finish it; "deferred" means the
    // registrar itself is unavailable, which no amount of asking again fixes.
    autoRetry: false,
  };
}

function pickScreen(input: {
  address: string | undefined;
  status: StatusData | null;
  loadFailure: ApiFailure | null;
  editing: boolean;
}): VerifyScreen {
  if (!input.address) return "not-connected";
  if (input.status === null) return "loading";
  if (input.status.status === "pending") return "pending";
  if (input.status.status === "approved") return "approved";
  // A refusal can be corrected — a mistyped country, an unticked box — so the form is reachable
  // again on request. Nothing is hidden: the refusal panel stays until it is dismissed.
  if (input.editing) return "form";
  if (input.status.status === "blocked") return "blocked";
  if (input.status.status === "rejected") return "rejected";
  return "form";
}
