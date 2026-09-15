import * as React from "react";

import { cn } from "@/lib/utils";

import { CopyButton } from "./copy-button";

interface CodeBlockProps {
  /** The exact text shown and copied. Never reformatted: what is on screen is what runs. */
  code: string;
  /** What this block is, for the header and for the copy button's accessible name. */
  label: string;
  /** One line under the block saying what running it prints. */
  caption?: React.ReactNode;
  className?: string;
}

/**
 * A code sample with a copy control.
 *
 * A `<figure>` rather than a bare `<pre>`: the caption belongs to the sample, and a screen reader
 * should read the two together. `tabIndex={0}` on the scroll container is deliberate — a region
 * that scrolls has to be reachable by keyboard, or a long `curl` line is unreachable without a
 * mouse.
 */
export function CodeBlock({ code, label, caption, className }: CodeBlockProps) {
  return (
    <figure className={cn("border-border bg-surface-sunken rounded-md border", className)}>
      <figcaption className="border-border flex items-center justify-between gap-3 border-b px-3 py-1.5">
        <span className="text-muted text-xs font-medium tracking-wide uppercase">{label}</span>
        <CopyButton value={code} label={label} />
      </figcaption>
      <pre
        tabIndex={0}
        role="region"
        aria-label={label}
        className="focus-visible:outline-ring overflow-x-auto px-3 py-3 text-xs leading-relaxed focus-visible:outline-2 focus-visible:-outline-offset-2"
      >
        <code className="addr text-ink">{code}</code>
      </pre>
      {caption ? <p className="text-muted px-3 pb-3 text-xs">{caption}</p> : null}
    </figure>
  );
}
