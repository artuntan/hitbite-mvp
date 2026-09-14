"use client";

import * as React from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * "Verify signature in browser" — the only interactive element on the transparency page, and the
 * only client component it loads.
 *
 * Three independent checks, each reported on its own line so a partial failure is legible:
 *
 *  1. **Signer.** `verifyMessage` recovers the address that produced the signature over the
 *     published message and compares it with the published attestor address. The message is
 *     verified exactly as published (PLAN.md D33) — `signature.message` is the canonical JSON
 *     string that was signed, so nothing is re-serialised here and there is no way for this page
 *     and the signer to disagree about bytes. viem hashes the UTF-8 bytes with the EIP-191 prefix,
 *     which matters: the payload contains `Türkiye` and an em dash, so byte length and character
 *     length differ.
 *  2. **Public key.** The published SEC1 uncompressed key is reduced to an address and compared
 *     with the same attestor address, which is what makes the published key meaningful rather
 *     than decorative.
 *  3. **Digest.** SHA-256 of the message against the published digest, via WebCrypto. Reported as
 *     skipped, never as passed, when `crypto.subtle` is unavailable (a page served over plain
 *     HTTP from a non-local host).
 *
 * All of it runs in the tab. Nothing is sent anywhere.
 */

type CheckStatus = "pass" | "fail" | "skipped";

interface CheckResult {
  readonly id: string;
  readonly label: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

export interface VerifySignatureButtonProps {
  /** `signature.message` — the exact canonical JSON that was signed. */
  message: string;
  /** 65-byte secp256k1 signature, 0x-prefixed. */
  signature: string;
  attestorAddress: string;
  /** SEC1 uncompressed public key, `0x04…`. */
  attestorPublicKey: string;
  /** `0x`-prefixed SHA-256 of the signed message. */
  messageSha256: string;
}

async function sha256Hex(message: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(message));
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function runChecks(props: VerifySignatureButtonProps): Promise<CheckResult[]> {
  const { message, signature, attestorAddress, attestorPublicKey, messageSha256 } = props;
  const results: CheckResult[] = [];

  // viem's secp256k1 recovery is ~20 kB that this page has no use for until the button is
  // pressed, so it is fetched on the click rather than shipped with the route. The public pages
  // have a Lighthouse budget to keep (BUILD_PROMPT 7.1) and most readers never press it.
  const [
    { getAddress, isAddress, isAddressEqual, isHex, recoverMessageAddress, verifyMessage },
    { publicKeyToAddress },
  ] = await Promise.all([import("viem"), import("viem/utils")]);

  // 1 — the signer.
  if (!isHex(signature) || !isAddress(attestorAddress, { strict: false })) {
    results.push({
      id: "signer",
      label: "Signature recovers the published attestor address",
      status: "fail",
      detail:
        "The published signature or attestor address is not well-formed hex, so no recovery was attempted.",
    });
  } else {
    const expected = getAddress(attestorAddress);
    const recovered = await recoverMessageAddress({ message, signature });
    const ok = await verifyMessage({ address: expected, message, signature });
    results.push({
      id: "signer",
      label: "Signature recovers the published attestor address",
      status: ok ? "pass" : "fail",
      detail: ok
        ? `Recovered ${recovered}, which is the published attestor address.`
        : `Recovered ${recovered}, but the document claims ${expected}.`,
    });
  }

  // 2 — the published public key.
  try {
    if (!isHex(attestorPublicKey) || !isAddress(attestorAddress, { strict: false })) {
      throw new Error("not well-formed hex");
    }
    const derived = publicKeyToAddress(attestorPublicKey);
    const ok = isAddressEqual(derived, getAddress(attestorAddress));
    results.push({
      id: "public-key",
      label: "Published public key belongs to that address",
      status: ok ? "pass" : "fail",
      detail: ok
        ? `The SEC1 uncompressed key reduces to ${derived}.`
        : `The SEC1 uncompressed key reduces to ${derived}, not to the published address.`,
    });
  } catch {
    results.push({
      id: "public-key",
      label: "Published public key belongs to that address",
      status: "fail",
      detail: "The published public key could not be parsed as a SEC1 uncompressed key.",
    });
  }

  // 3 — the digest of what was signed.
  const digest = await sha256Hex(message);
  if (digest === null) {
    results.push({
      id: "digest",
      label: "SHA-256 of the signed message matches the published digest",
      status: "skipped",
      detail:
        "WebCrypto is not available in this browsing context, so the digest was not recomputed. The two checks above do not depend on it.",
    });
  } else {
    const ok = digest === messageSha256.toLowerCase();
    results.push({
      id: "digest",
      label: "SHA-256 of the signed message matches the published digest",
      status: ok ? "pass" : "fail",
      detail: ok
        ? `Recomputed ${digest} over the ${new TextEncoder().encode(message).length} bytes shown below.`
        : `Recomputed ${digest}, but the document publishes ${messageSha256}.`,
    });
  }

  return results;
}

const badgeByStatus: Record<CheckStatus, React.ReactElement> = {
  pass: <StatusBadge tone="success">Pass</StatusBadge>,
  fail: <StatusBadge tone="danger">Fail</StatusBadge>,
  skipped: <StatusBadge tone="neutral">Skipped</StatusBadge>,
};

export function VerifySignatureButton(props: VerifySignatureButtonProps) {
  const [running, setRunning] = React.useState(false);
  const [results, setResults] = React.useState<CheckResult[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function onVerify() {
    setRunning(true);
    setError(null);
    setResults(null);
    try {
      setResults(await runChecks(props));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  }

  const failed = results?.some((result) => result.status === "fail") ?? false;
  const verified = results !== null && !failed;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={onVerify} disabled={running}>
          {running ? "Verifying…" : "Verify signature in browser"}
        </Button>
        <p className="text-muted text-xs">Runs in this tab with viem. Nothing is sent anywhere.</p>
      </div>

      {error !== null ? (
        <Alert tone="danger">
          <AlertTitle>Verification could not run.</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {results !== null ? (
        <Alert tone={verified ? "success" : "danger"}>
          <AlertTitle>
            {verified ? "Signature verified in your browser." : "This signature does not verify."}
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-2 flex flex-col gap-3">
              {results.map((result) => (
                <li key={result.id} className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    {badgeByStatus[result.status]}
                    <span className="text-ink text-sm">{result.label}</span>
                  </span>
                  <span className="addr text-muted text-xs">{result.detail}</span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
