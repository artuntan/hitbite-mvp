import { ExternalLink } from "lucide-react";

import { explorerAddressUrl, explorerTxUrl, type SupportedChainId } from "@/lib/chains";
import { cn } from "@/lib/utils";

interface ChainRefProps {
  /** Full 0x value. Never truncated here: this page exists so a reader can copy it. */
  value: string;
  chainId: SupportedChainId;
  className?: string;
}

/**
 * An address or transaction hash, linked to the block explorer when the chain has one.
 *
 * Anvil has no explorer, so `explorerAddressUrl` returns `null` and the value renders as plain
 * monospace text. A link that goes nowhere is worse than no link (BUILD_PROMPT 16.5).
 */
function ChainRef({ value, href, className }: ChainRefProps & { href: string | null }) {
  if (!href) {
    return (
      <span
        className={cn("addr text-ink text-xs", className)}
        title="No block explorer for this network"
      >
        {value}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        "addr text-accent-ink inline-flex items-baseline gap-1 text-xs underline underline-offset-4 hover:no-underline",
        className,
      )}
    >
      {value}
      <ExternalLink aria-hidden="true" className="size-3 shrink-0 self-center" />
      <span className="sr-only"> (opens the block explorer in a new tab)</span>
    </a>
  );
}

export function AddressLink({ value, chainId, className }: ChainRefProps) {
  return (
    <ChainRef
      value={value}
      chainId={chainId}
      href={explorerAddressUrl(value, chainId)}
      className={className}
    />
  );
}

export function TxLink({ value, chainId, className }: ChainRefProps) {
  return (
    <ChainRef
      value={value}
      chainId={chainId}
      href={explorerTxUrl(value, chainId)}
      className={className}
    />
  );
}
