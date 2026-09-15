"use client";

/**
 * The encoded call, shown before anything is signed (BUILD_PROMPT 7.2).
 *
 * A wallet popup shows a destination and a blob of hex. The only way an operator can tell that the
 * blob is the transaction they meant is to have seen the selector and the arguments written out
 * beside the form that produced them — so this panel prints the function signature, every argument
 * in both the encoded units and the human ones, the 4-byte selector and the 32-byte words, and
 * offers the whole calldata for copying into `cast` or an explorer.
 *
 * It re-renders as the form is typed, including while the form is incomplete: "this cannot be
 * encoded yet, because …" is more useful than an empty box.
 */

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { calldataLayout, type EncodeResult } from "@/components/admin/calldata";
import { ENCODED_CALL_NOTE } from "@/components/admin/copy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface EncodedCallPanelProps {
  encoded: EncodeResult | null;
  /** Heading level inside the card. */
  as?: "h3" | "h4";
  className?: string;
  /** Distinguishes the two panels on a page from each other for a screen reader. */
  labelSuffix?: string;
}

export function EncodedCallPanel({
  encoded,
  as: Heading = "h4",
  className,
  labelSuffix,
}: EncodedCallPanelProps) {
  const title = labelSuffix ? `Encoded call — ${labelSuffix}` : "Encoded call";

  if (encoded === null || !encoded.ok) {
    return (
      <div
        data-testid="encoded-call"
        className={cn(
          "border-border bg-surface-sunken flex flex-col gap-2 rounded-lg border p-4",
          className,
        )}
      >
        <Heading className="text-ink text-sm font-semibold">{title}</Heading>
        <p className="text-muted text-xs leading-relaxed">
          {encoded === null
            ? "Nothing to encode yet. Fill the form above and the exact calldata appears here, before your wallet is asked for anything."
            : encoded.reason}
        </p>
      </div>
    );
  }

  const call = encoded.call;
  const layout = calldataLayout(call.data);

  return (
    <div
      data-testid="encoded-call"
      className={cn(
        "border-border bg-surface-sunken flex flex-col gap-3 rounded-lg border p-4",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Heading className="text-ink text-sm font-semibold">{title}</Heading>
        <Badge tone="neutral">{call.contract}</Badge>
        <CopyButton value={call.data} label="Copy calldata" />
      </div>

      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
        <dt className="text-muted">To</dt>
        <dd className={call.address === null ? "text-warning" : "addr text-ink"}>
          {call.address ??
            "no deployment is recorded for this network, so there is nowhere to send this"}
        </dd>
        <dt className="text-muted">Function</dt>
        <dd className="addr text-ink">{call.signature}</dd>
        <dt className="text-muted">Selector</dt>
        <dd className="addr text-ink">{call.selector}</dd>
        <dt className="text-muted">Value</dt>
        <dd className="num text-ink">{call.value.toString()} wei</dd>
      </dl>

      {call.arguments.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {call.arguments.map((argument) => (
            <li key={argument.name} className="text-xs">
              <span className="addr text-muted">
                {argument.type} {argument.name}
              </span>{" "}
              <span className="num text-ink">= {argument.value}</span>
              {argument.display ? (
                <span className="text-muted"> &mdash; {argument.display}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div>
        <p className="text-muted mb-1 text-xs">Calldata</p>
        <pre className="addr text-ink bg-surface border-border overflow-x-auto rounded border p-2 text-[11px] leading-relaxed">
          <code>
            {layout.selector}
            {layout.words.map((word) => `\n${word}`).join("")}
          </code>
        </pre>
      </div>

      <p className="text-muted text-xs leading-relaxed">{ENCODED_CALL_NOTE}</p>
    </div>
  );
}

/**
 * Copy to clipboard, with the failure handled rather than assumed away: an insecure origin or a
 * denied permission leaves the value selectable in the block above, which is the fallback anyway.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      variant="ghost"
      size="sm"
      className="ml-auto"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setFailed(false);
            setCopied(true);
          })
          .catch(() => setFailed(true));
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span>{failed ? "Select it above" : copied ? "Copied" : label}</span>
    </Button>
  );
}
