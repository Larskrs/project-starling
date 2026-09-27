/**
 * Sliding-window in-memory rate limiter. Dependency-free so it can be used
 * from routes and socket handlers alike; callers decide how to reject.
 *
 *   const loginLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
 *   if (!loginLimiter.check(`${ip}:${email}`)) throw new ApiError(429, ...);
 *
 * Single-process only — behind a load balancer each instance enforces its own
 * window, which still bounds abuse per node.
 */
export interface RateLimiter {
  /** Records a hit for `key`; returns false when the window is exhausted. */
  check(key: string): boolean;
}

export function createRateLimiter({ windowMs, max }: { windowMs: number; max: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  let lastPrune = Date.now();

  function prune(now: number) {
    for (const [key, times] of hits) {
      const alive = times.filter(t => now - t < windowMs);
      if (alive.length === 0) hits.delete(key);
      else hits.set(key, alive);
    }
    lastPrune = now;
  }

  return {
    check(key: string): boolean {
      const now = Date.now();
      if (now - lastPrune > windowMs * 4) prune(now);

      const alive = (hits.get(key) ?? []).filter(t => now - t < windowMs);
      if (alive.length >= max) {
        hits.set(key, alive);
        return false;
      }
      alive.push(now);
      hits.set(key, alive);
      return true;
    },
  };
}
