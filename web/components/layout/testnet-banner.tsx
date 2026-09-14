import { AlertTriangle } from "lucide-react";

import { Container } from "@/components/layout/container";

/**
 * Persistent, non-dismissible testnet banner. The wording is fixed by
 * BUILD_PROMPT Section 15 and must not be edited or abbreviated.
 */
export const TESTNET_BANNER_TEXT =
  "Testnet demonstration on Base Sepolia. Simulated portfolio and attestation. Not an offer of securities.";

export function TestnetBanner() {
  return (
    <div className="border-warning/30 bg-warning-surface text-ink border-b">
      <Container className="flex items-start gap-2.5 py-2">
        <AlertTriangle aria-hidden="true" className="text-warning mt-0.5 size-4 shrink-0" />
        <p className="text-xs leading-5 sm:text-sm">
          <span className="sr-only">Notice: </span>
          {TESTNET_BANNER_TEXT}
        </p>
      </Container>
    </div>
  );
}
