"use client";

/**
 * The five states BUILD_PROMPT.md 7.2 asks for, assembled.
 *
 *   not connected   the form is readable and fillable; only the submit button waits for a wallet
 *   not verified    the form, with the address filled in from the wallet
 *   pending         the countdown, the worker call and the poll, each visible and each recoverable
 *   verified        what the registry now holds, and what it does not mean
 *   blocked         the reason, and the only correction worth making
 *
 * `rejected` is a sixth the API can answer with — retail, or a missing declaration — and it shares
 * the refusal panel with `blocked`, because the two differ in what can be done rather than in shape.
 *
 * The form stays on screen while disconnected on purpose. Hiding it until a wallet appears would
 * mean nobody could read the country rules or the storage note without connecting first, and those
 * are exactly the things somebody should be able to read before deciding to connect at all.
 */

import * as React from "react";

import { ErrorState } from "@/components/states/error-state";
import { LoadingSkeleton } from "@/components/states/loading-skeleton";
import {
  ConnectPrompt,
  WrongNetworkAlert,
  useNetworkStatus,
} from "@/components/wallet/network-guard";
import { useWalletControls } from "@/components/wallet/connect-button";
import { ApprovedPanel, PendingPanel, RefusedPanel } from "@/components/verify/status-panels";
import { useBlocklist } from "@/components/verify/use-blocklist";
import { useVerification } from "@/components/verify/use-verification";
import { VerifyForm } from "@/components/verify/verify-form";

export function VerifyFlow() {
  const network = useNetworkStatus();
  const { address } = useWalletControls();
  const blocklist = useBlocklist();
  const verification = useVerification(address);

  return (
    <div className="flex flex-col gap-6">
      {network.status === "disconnected" ? <ConnectPrompt purpose="to have it verified" /> : null}

      {network.status === "wrong-network" ? (
        <div className="flex flex-col gap-2">
          <WrongNetworkAlert network={network} />
          <p className="text-muted text-sm leading-relaxed">
            Verification itself does not need the switch: you sign nothing here, and the registrar
            writes to {network.requiredChainLabel} whatever network your wallet is on. You will need
            to be on {network.requiredChainLabel} before you can subscribe.
          </p>
        </div>
      ) : null}

      <Screen verification={verification} blocklist={blocklist} address={address} />
    </div>
  );
}

function Screen({
  verification,
  blocklist,
  address,
}: {
  verification: ReturnType<typeof useVerification>;
  blocklist: ReturnType<typeof useBlocklist>;
  address: string | undefined;
}) {
  const { screen, status, submission } = verification;

  if (screen === "loading") {
    if (verification.loadFailure) {
      return (
        <ErrorState
          title="Could not read this wallet's status"
          description={
            <>
              <p>{verification.loadFailure.message}</p>
              {verification.loadFailure.hint ? (
                <p className="mt-1">{verification.loadFailure.hint}</p>
              ) : null}
              <p className="mt-1">
                Nothing is lost: the status endpoint only reads, and a stored request or a registry
                record is still there.
              </p>
            </>
          }
          onRetry={verification.refresh}
          retryLabel="Check again"
        />
      );
    }
    return (
      <LoadingSkeleton variant="card" label="Checking whether this wallet is already verified" />
    );
  }

  if (screen === "pending" && status) {
    return (
      <PendingPanel
        status={status}
        submission={submission}
        remainingMs={verification.remainingMs}
        worker={verification.worker}
        pollingExhausted={verification.pollingExhausted}
        isRefreshing={verification.isRefreshing}
        onRetryWorker={verification.retryWorker}
        onRefresh={verification.refresh}
      />
    );
  }

  if (screen === "approved" && status) {
    return <ApprovedPanel status={status} submission={submission} />;
  }

  if ((screen === "blocked" || screen === "rejected") && status) {
    return (
      <RefusedPanel status={status} submission={submission} onStartOver={verification.startOver} />
    );
  }

  return (
    <VerifyForm
      address={address}
      blocklist={blocklist}
      isSubmitting={verification.isSubmitting}
      submitFailure={verification.submitFailure}
      onSubmit={(body) => void verification.submit(body)}
    />
  );
}
