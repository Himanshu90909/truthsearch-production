// Search provider fallback (spec section C): try providers in priority order, move on when one fails or returns
// nothing, and report exactly which ones were tried. A circuit breaker keeps a broken provider from slowing every query.

import { CircuitBreaker } from "../models/orchestrator";

export type SearchFn<H> = (provider: string, query: string, signal: AbortSignal) => Promise<H[]>;
export type SearchAttempt = { provider: string; ok: boolean; count: number; ms: number; error?: string; skipped?: boolean };
export type FallbackResult<H> = { hits: H[]; provider: string | null; attempts: SearchAttempt[] };

export async function searchWithFallback<H>(search: SearchFn<H>, providers: string[], query: string, opts: { perProviderTimeoutMs?: number; minHits?: number; breaker?: CircuitBreaker; now?: () => number } = {}): Promise<FallbackResult<H>> {
  const now = opts.now ?? Date.now; const minHits = opts.minHits ?? 1; const attempts: SearchAttempt[] = [];
  for (const provider of providers) {
    if (opts.breaker?.isOpen(provider)) { attempts.push({ provider, ok: false, count: 0, ms: 0, skipped: true, error: "circuit open after repeated failures" }); continue; }
    const started = now(); const ctrl = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let timedOut = false;
    const limit = opts.perProviderTimeoutMs ?? 12_000;
    try {
      // Remember that WE aborted: a well-behaved search function rejects with its own "aborted" error, which can win the race.
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => { timedOut = true; ctrl.abort(); rej(new Error(`timed out after ${limit} ms`)); }, limit); });
      const hits = await Promise.race([search(provider, query, ctrl.signal), timeout]);
      attempts.push({ provider, ok: true, count: hits.length, ms: now() - started });
      if (hits.length >= minHits) { opts.breaker?.success(provider); return { hits, provider, attempts }; }
      // an empty result is not a failure of the provider, but we still try the next one
    } catch (e) {
      opts.breaker?.failure(provider);
      attempts.push({ provider, ok: false, count: 0, ms: now() - started, error: (timedOut ? `timed out after ${limit} ms` : e instanceof Error ? e.message : String(e)).slice(0, 160) });
    } finally { if (timer) clearTimeout(timer); }
  }
  return { hits: [], provider: null, attempts };
}
