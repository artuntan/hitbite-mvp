import { Database } from "lucide-react";

import { EmptyState } from "@/components/states/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface StatsEmptyProps {
  /** The reason the indexer gave, rendered as it was written. */
  reason: string;
  /** Extra sentence for the case where the node is behind the deploy block. */
  detail?: string;
  chainLabel: string;
}

/** What each step fills in. Commands are the repository's own, from the root `Makefile`. */
const STEPS: readonly { command: string; text: string }[] = [
  {
    command: "make deploy CHAIN=…",
    text: "Deploys HBToken, IdentityRegistry and MockUSDC and records the deploy block the scan starts from.",
  },
  {
    command: "pnpm sync:contracts",
    text: "Writes the addresses and ABIs into web/lib/generated/, which is how this app learns where to look.",
  },
  {
    command: "make seed",
    text: "Verifies the two demo wallets, funds them from the MockUSDC faucet and sets the opening NAV. Subscriptions, redemptions and coupons follow from /subscribe and the admin actions, and each one lands here as an event.",
  },
];

/**
 * The honest rendering of an empty page.
 *
 * Everything `/stats` reports is folded from contract logs. With no deployment
 * on the configured chain — or with an RPC that will not answer — there is
 * nothing to fold, and a page of zeros would be a set of claims rather than a
 * set of measurements. So the figures are absent, the reason is quoted, and what
 * would fill them is written out as the three commands that do it.
 */
export function StatsEmpty({ reason, detail, chainLabel }: StatsEmptyProps) {
  return (
    <Card data-testid="stats-empty">
      <CardHeader>
        <CardTitle as="h3" className="text-lg">
          Nothing to count yet
        </CardTitle>
        <CardDescription>
          Holders, supply, distributions, the NAV series and the subscription and redemption history
          are all folded from {chainLabel} contract logs. None of them has a value until there are
          logs to fold.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <EmptyState
          icon={Database}
          title="No events have been indexed"
          description={
            <span className="flex flex-col gap-2">
              <span data-testid="stats-empty-reason">{reason}</span>
              {detail ? <span>{detail}</span> : null}
            </span>
          }
        />

        <div className="flex flex-col gap-3">
          <h4 className="text-ink text-sm font-semibold">What would fill this page</h4>
          <ol className="flex flex-col gap-3">
            {STEPS.map((step, index) => (
              <li key={step.command} className="flex gap-3 text-sm">
                <span
                  aria-hidden="true"
                  className="bg-surface-sunken text-muted num mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-medium"
                >
                  {index + 1}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <code className="addr text-ink text-xs font-medium">{step.command}</code>
                  <span className="text-muted text-xs leading-relaxed">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <p className="text-muted border-border border-t pt-4 text-xs leading-relaxed">
          No figure on this page is shown as zero while there is nothing to count. A zero here would
          be a claim about the chain — that nobody holds the token, that nothing has been
          distributed — and this page has made no such measurement.
        </p>
      </CardContent>
    </Card>
  );
}
