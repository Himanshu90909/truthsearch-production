// Fixed-window rate limiter with a pluggable store.
//
// Why a store interface: the previous limiter used a process-local Map, so on a serverless host every instance had
// its own counters and limits silently reset. Production uses PostgresRateLimitStore (shared by all instances);
// tests and local dev use MemoryRateLimitStore. The limiter itself holds no state, so behaviour is identical.

export type RateDecision = { allowed: boolean; limit: number; remaining: number; resetAt: number; retryAfterSec: number };

export interface RateLimitStore {
  /** Atomically add 1 to the counter for (key, window) and return the new count. */
  increment(key: string, windowStart: number, windowMs: number): Promise<number>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private counts = new Map<string, number>();
  async increment(key: string, windowStart: number): Promise<number> {
    const k = `${key}:${windowStart}`;
    const next = (this.counts.get(k) ?? 0) + 1;
    this.counts.set(k, next);
    if (this.counts.size > 10_000) { // drop old windows so the map cannot grow without bound
      for (const existing of Array.from(this.counts.keys())) if (!existing.endsWith(`:${windowStart}`)) this.counts.delete(existing);
    }
    return next;
  }
}

export async function checkRateLimit(store: RateLimitStore, key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateDecision> {
  if (!Number.isFinite(limit) || limit < 1) throw new Error("limit must be a positive number");
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;
  const count = await store.increment(key, windowStart, windowMs);
  const allowed = count <= limit;
  return { allowed, limit, remaining: Math.max(0, limit - count), resetAt, retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000)) };
}

/** Quota tiers. Signed-in users get more than anonymous visitors; admins are limited too (they just get a higher ceiling). */
export function hourlyLimitFor(user: { role?: string } | null): number {
  if (!user) return 8;
  return user.role === "admin" ? 200 : 40;
}

/** A stable key for the caller. Never trust a client-supplied header beyond the first forwarded hop. */
export function callerKey(user: { id: number } | null, forwardedFor: unknown): string {
  if (user) return `user:${user.id}`;
  const ip = typeof forwardedFor === "string" ? forwardedFor.split(",")[0].trim().slice(0, 64) : "";
  return `ip:${ip || "unknown"}`;
}
