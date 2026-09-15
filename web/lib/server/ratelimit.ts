/**
 * A fixed-window rate limiter, in memory, for the worker endpoint.
 *
 * **Per instance, and that is stated rather than hidden.** On Vercel each serverless instance has
 * its own map, so the real ceiling is this limit times the number of live instances. That is worth
 * having anyway: it turns "hammer the endpoint" into "hammer it a bounded number of times per
 * instance", and it costs nothing. The protections that actually matter are elsewhere and do not
 * depend on counting — `POST /api/verify/process` can only advance requests that were already
 * submitted, that are already past their delay, and that the registry itself is willing to accept.
 *
 * Pure except for the map: `now` is a parameter, so the tests do not sleep.
 */

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly windowMs: number;
  /** Calls left in the current window, after this one. */
  readonly remaining: number;
  /** Milliseconds until the window resets. `0` when the call was allowed. */
  readonly retryAfterMs: number;
}

export interface RateLimiter {
  take(key: string, now: number): RateLimitDecision;
  /** Forget everything. Tests use it; nothing else should need to. */
  reset(): void;
}

export interface RateLimiterOptions {
  readonly limit: number;
  readonly windowMs: number;
  /**
   * Maximum distinct keys held. An attacker rotating `x-forwarded-for` must not be able to grow
   * this map without bound, so the oldest window is evicted once the cap is reached.
   */
  readonly maxKeys?: number;
}

interface Window {
  start: number;
  count: number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { limit, windowMs, maxKeys = 1_000 } = options;
  const windows = new Map<string, Window>();

  function evictIfNeeded(now: number): void {
    if (windows.size < maxKeys) return;
    for (const [key, window] of windows) {
      if (now - window.start >= windowMs) windows.delete(key);
    }
    while (windows.size >= maxKeys) {
      const oldest = windows.keys().next();
      if (oldest.done) break;
      windows.delete(oldest.value);
    }
  }

  return {
    take(key: string, now: number): RateLimitDecision {
      const existing = windows.get(key);
      const window =
        existing && now - existing.start < windowMs ? existing : { start: now, count: 0 };

      if (window !== existing) {
        evictIfNeeded(now);
        windows.set(key, window);
      }

      const elapsed = now - window.start;
      if (window.count >= limit) {
        return {
          allowed: false,
          limit,
          windowMs,
          remaining: 0,
          retryAfterMs: Math.max(0, windowMs - elapsed),
        };
      }

      window.count += 1;
      return {
        allowed: true,
        limit,
        windowMs,
        remaining: Math.max(0, limit - window.count),
        retryAfterMs: 0,
      };
    },
    reset(): void {
      windows.clear();
    },
  };
}
