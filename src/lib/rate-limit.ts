export type RateLimitPolicy = { limit: number; windowMs: number };
export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

type Window = { count: number; resetAt: number };

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(private readonly options: { now?: () => number; maxEntries?: number } = {}) {}

  consume(key: string, policy: RateLimitPolicy): RateLimitResult {
    const now = (this.options.now ?? Date.now)();
    const maxEntries = this.options.maxEntries ?? 10_000;
    let current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      if (!current && this.windows.size >= maxEntries) {
        for (const [candidate, value] of this.windows) {
          if (value.resetAt <= now || this.windows.size >= maxEntries) this.windows.delete(candidate);
          if (this.windows.size < maxEntries) break;
        }
      }
      current = { count: 0, resetAt: now + policy.windowMs };
      this.windows.set(key, current);
    }
    if (current.count >= policy.limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
    }
    current.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, policy.limit - current.count),
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }
}
