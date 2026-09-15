"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";

interface CopyButtonProps {
  /** The exact text put on the clipboard. */
  value: string;
  /** What is being copied, for the accessible name: "curl for GET /api/nav". */
  label: string;
}

/**
 * The only client component on `/developers`.
 *
 * It exists because "copyable" means a control, not a paragraph telling someone to select the
 * text. It is a leaf: the page and every other component here are server components, so this adds
 * one small chunk and nothing else — in particular it imports nothing from `lib/wagmi.ts` or
 * `components/wallet/`, which is what keeps the public pages' Lighthouse performance where it is
 * (PLAN.md D63).
 *
 * `navigator.clipboard` is unavailable on an insecure origin and can be refused by permission
 * policy, so a failure says so rather than showing a tick that lied. The result is announced
 * politely: someone who cannot see the icon change still hears whether the copy worked.
 */
export function CopyButton({ value, label }: CopyButtonProps) {
  const [state, setState] = React.useState<"idle" | "copied" | "failed">("idle");

  React.useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => {
      setState("idle");
    }, 2_000);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void copy()}
        aria-label={state === "copied" ? `${label} copied` : `Copy ${label}`}
      >
        {state === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {state === "copied" ? "Copied" : "Copy"}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {state === "copied" ? `${label} copied to the clipboard.` : null}
        {state === "failed"
          ? `${label} could not be copied — this browser refused clipboard access. Select the text instead.`
          : null}
      </span>
    </>
  );
}
