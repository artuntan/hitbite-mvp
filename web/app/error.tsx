"use client";

import Link from "next/link";

import { Container } from "@/components/layout/container";
import { ErrorState } from "@/components/states/error-state";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary. `reset` re-renders the segment, which is the
 * cheapest real recovery; the link out is the fallback when it keeps failing.
 * The raw message is never rendered — only Next's digest, which is safe to show.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Container width="prose" className="py-16">
      <ErrorState
        title="This page could not be rendered"
        description="The data behind this page failed to load. Nothing on this testnet demonstration is affected by the failure."
        onRetry={reset}
        detail={error.digest}
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/">Back to the overview</Link>
          </Button>
        }
      />
    </Container>
  );
}
