"use client";

/**
 * The toast surface for transaction progress.
 *
 * Mounted by `WalletProviders`, so it only exists on pages that opted into the wallet. The public
 * pages never render it and never pay for sonner.
 *
 * Toasts are a *second* channel, never the only one: every transaction also renders its state
 * inline through `TxStatus`, because a toast that has already dismissed itself is no use to
 * somebody who looked away, and `role="status"` announcements are easy to miss.
 */

import * as React from "react";
import { useTheme } from "next-themes";
import { Toaster as SonnerToaster } from "sonner";

export function WalletToaster() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  // next-themes cannot know the resolved theme until the client runs; rendering "system" first and
  // the real value after mount keeps the server and client markup identical.
  React.useEffect(() => setMounted(true), []);
  const theme =
    mounted && (resolvedTheme === "dark" || resolvedTheme === "light") ? resolvedTheme : "system";

  return (
    <SonnerToaster
      theme={theme}
      position="bottom-right"
      closeButton
      // Pending transactions can outlast any sensible timeout, so the duration is generous and the
      // close button is always there. `useTx` replaces each toast by id rather than stacking them.
      duration={8000}
      visibleToasts={3}
      toastOptions={{
        classNames: {
          toast:
            "group border-border bg-surface text-ink shadow-overlay rounded-lg border p-4 text-sm font-sans",
          title: "text-ink text-sm font-semibold",
          description: "text-muted text-sm",
          actionButton:
            "bg-accent text-accent-on rounded-md px-2.5 py-1 text-xs font-medium hover:bg-accent-ink",
          closeButton: "border-border bg-surface text-muted hover:text-ink",
          icon: "text-muted",
          success: "border-success-surface",
          error: "border-danger-surface",
          loading: "border-accent-surface",
        },
      }}
    />
  );
}
