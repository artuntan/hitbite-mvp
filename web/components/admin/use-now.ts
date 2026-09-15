"use client";

/**
 * The browser's clock, in unix seconds, or `null` until the component has mounted.
 *
 * `null` is not a placeholder for "now": a server render has no meaningful clock to compare a rail
 * window against, and guessing one would make the first client paint disagree with the server's
 * HTML. Everything that depends on the time therefore renders as "not checked yet" for one frame
 * and then resolves, rather than rendering a wrong answer confidently.
 */

import * as React from "react";

export function useNowSeconds(intervalMs = 15_000): bigint | null {
  const [now, setNow] = React.useState<bigint | null>(null);

  React.useEffect(() => {
    const tick = () => setNow(BigInt(Math.floor(Date.now() / 1000)));
    tick();
    const timer = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

/** The same clock in milliseconds, for a countdown that has to tick every second. */
export function useNowMs(intervalMs = 1_000): number | null {
  const [now, setNow] = React.useState<number | null>(null);

  React.useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
