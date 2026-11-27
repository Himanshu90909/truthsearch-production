// Provider-independent model orchestration (spec section B).
//
// An adapter only knows how to send one request to one model. The orchestrator owns everything else:
//   * an overall DEADLINE for the whole call (serverless functions have a hard time limit),
//   * a per-attempt timeout that never exceeds the time left,
//   * retries with backoff only for transient errors, and only if they fit before the deadline,
//   * fallback across models/providers in priority order (sequential), or a race (parallel, optional),
//   * per-provider circuit breaking so a dead provider is skipped instead of retried on every request,
//   * a usage record (tokens, latency, cost, status) for EVERY attempt, including failures.
//
// Everything is injectable (adapter, clock, sleep, recorder) so the behaviour is tested without network calls.

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | unknown[] };
export type ModelTarget = { provider: string; model: string; timeoutMs?: number; maxOutputTokens?: number };
export type AdapterResult = { content: string; promptTokens?: number; completionTokens?: number; finishReason?: string | null; raw?: unknown };
export type Adapter = (target: ModelTarget, messages: ChatMessage[], signal: AbortSignal) => Promise<AdapterResult>;

export class ProviderError extends Error {
  constructor(message: string, readonly status?: number, readonly transient = false) { super(message); this.name = "ProviderError"; }
}

export type AttemptRecord = {
  provider: string; model: string; attempt: number; status: "ok" | "error" | "timeout" | "skipped";
  latencyMs: number; promptTokens?: number; completionTokens?: number; tokensEstimated: boolean; error?: string;
};
export type Recorder = (r: AttemptRecord) => void | Promise<void>;

export type OrchestratorOptions = {
  deadlineMs: number;               // whole call, all retries and fallbacks included
  perAttemptTimeoutMs?: number;     // default for targets without their own timeout
  retryDelaysMs?: number[];         // backoff for transient errors; skipped when it would overrun the deadline
  parallel?: number;                // >1 races the first N targets and returns the first good answer
  minUsefulMs?: number;             // do not start an attempt with less time than this left
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  record?: Recorder;
  breaker?: CircuitBreaker;
};

export type OrchestratorResult = { content: string; target: ModelTarget; attempts: AttemptRecord[]; finishReason?: string | null; promptTokens?: number; completionTokens?: number };

// ---- circuit breaker -------------------------------------------------------
export class CircuitBreaker {
  private state = new Map<string, { failures: number; openUntil: number }>();
  constructor(private threshold = 3, private coolDownMs = 5 * 60_000, private now: () => number = Date.now) {}
  isOpen(provider: string): boolean { const s = this.state.get(provider); return !!s && s.openUntil > this.now(); }
  success(provider: string) { this.state.delete(provider); }
  failure(provider: string) {
    const s = this.state.get(provider) ?? { failures: 0, openUntil: 0 };
    s.failures += 1; if (s.failures >= this.threshold) { s.openUntil = this.now() + this.coolDownMs; s.failures = 0; }
    this.state.set(provider, s);
  }
  snapshot() { return Array.from(this.state.entries()).map(([provider, s]) => ({ provider, consecutiveFailures: s.failures, open: s.openUntil > this.now(), openUntil: s.openUntil || null })); }
}

export const estimateTokens = (text: string) => Math.ceil((text || "").length / 4);
const messagesText = (m: ChatMessage[]) => m.map((x) => (typeof x.content === "string" ? x.content : JSON.stringify(x.content))).join("\n");

function isTransient(e: unknown): boolean {
  if (e instanceof ProviderError) return e.transient;
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /timeout|timed out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed/i.test(msg);
}

async function attemptOnce(adapter: Adapter, target: ModelTarget, messages: ChatMessage[], timeoutMs: number, now: () => number): Promise<{ ok: true; result: AdapterResult; latencyMs: number } | { ok: false; error: unknown; timedOut: boolean; latencyMs: number }> {
  const started = now(); const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined; let didTimeOut = false;
  // Aborting the signal makes a well-behaved adapter reject with its own "aborted" error, which can beat our timeout
  // rejection in the race. Remember that WE aborted, so the attempt is recorded as a timeout either way.
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { didTimeOut = true; ctrl.abort(); reject(new ProviderError(`timed out after ${timeoutMs} ms`, undefined, true)); }, timeoutMs); });
  try {
    const result = await Promise.race([adapter(target, messages, ctrl.signal), timeout]);
    if (!result || !String(result.content ?? "").trim()) throw new ProviderError("empty answer", undefined, false);
    return { ok: true, result, latencyMs: now() - started };
  } catch (error) {
    const err = didTimeOut && !(error instanceof ProviderError && /timed out/.test(error.message)) ? new ProviderError(`timed out after ${timeoutMs} ms`, undefined, true) : error;
    return { ok: false, error: err, timedOut: didTimeOut, latencyMs: now() - started };
  } finally { if (timer) clearTimeout(timer); }
}

/** Try one target with retries inside the remaining time. */
async function runTarget(adapter: Adapter, target: ModelTarget, messages: ChatMessage[], opts: Required<Pick<OrchestratorOptions, "now" | "sleep">> & OrchestratorOptions, deadlineAt: number, attempts: AttemptRecord[]): Promise<OrchestratorResult | null> {
  const delays = opts.retryDelaysMs ?? [1000, 3000];
  const minUseful = opts.minUsefulMs ?? 3000;
  const promptEstimate = estimateTokens(messagesText(messages));
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const left = deadlineAt - opts.now();
    if (left < minUseful) { const rec: AttemptRecord = { provider: target.provider, model: target.model, attempt, status: "skipped", latencyMs: 0, tokensEstimated: true, error: "not enough time left before the deadline" }; attempts.push(rec); await opts.record?.(rec); return null; }
    const timeoutMs = Math.min(target.timeoutMs ?? opts.perAttemptTimeoutMs ?? 45_000, left);
    const r = await attemptOnce(adapter, target, messages, timeoutMs, opts.now);
    if (r.ok) {
      const estimated = r.result.promptTokens == null || r.result.completionTokens == null;
      const rec: AttemptRecord = { provider: target.provider, model: target.model, attempt, status: "ok", latencyMs: r.latencyMs, promptTokens: r.result.promptTokens ?? promptEstimate, completionTokens: r.result.completionTokens ?? estimateTokens(r.result.content), tokensEstimated: estimated };
      attempts.push(rec); await opts.record?.(rec); opts.breaker?.success(target.provider);
      return { content: r.result.content, target, attempts, finishReason: r.result.finishReason, promptTokens: rec.promptTokens, completionTokens: rec.completionTokens };
    }
    const msg = r.error instanceof Error ? r.error.message : String(r.error);
    const rec: AttemptRecord = { provider: target.provider, model: target.model, attempt, status: r.timedOut ? "timeout" : "error", latencyMs: r.latencyMs, promptTokens: promptEstimate, completionTokens: 0, tokensEstimated: true, error: msg.slice(0, 200) };
    attempts.push(rec); await opts.record?.(rec);
    const canRetry = isTransient(r.error) && attempt < delays.length && deadlineAt - opts.now() - delays[attempt] >= minUseful;
    if (!canRetry) { opts.breaker?.failure(target.provider); return null; }
    await opts.sleep(delays[attempt]);
  }
  opts.breaker?.failure(target.provider);
  return null;
}

export async function orchestrate(adapter: Adapter, targets: ModelTarget[], messages: ChatMessage[], options: OrchestratorOptions): Promise<OrchestratorResult> {
  const opts = { now: Date.now, sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), ...options };
  const deadlineAt = opts.now() + options.deadlineMs;
  const attempts: AttemptRecord[] = [];
  const live = targets.filter((t) => !opts.breaker?.isOpen(t.provider));
  for (const t of targets) if (!live.includes(t)) { const rec: AttemptRecord = { provider: t.provider, model: t.model, attempt: 0, status: "skipped", latencyMs: 0, tokensEstimated: true, error: "provider circuit open after repeated failures" }; attempts.push(rec); await opts.record?.(rec); }
  if (!live.length) throw new OrchestrationError("Every configured model provider is temporarily disabled after repeated failures.", attempts);

  const width = Math.max(1, Math.min(options.parallel ?? 1, live.length));
  if (width > 1) {
    // Race the first `width` targets; the rest stay as sequential fallbacks.
    const racers = live.slice(0, width).map((t) => runTarget(adapter, t, messages, opts, deadlineAt, attempts).then((r) => (r ? r : Promise.reject(new Error("failed")))));
    try { const winner = await Promise.any(racers); return { ...winner, attempts }; } catch { /* all racers failed: fall through */ }
    for (const t of live.slice(width)) { const r = await runTarget(adapter, t, messages, opts, deadlineAt, attempts); if (r) return { ...r, attempts }; }
  } else {
    for (const t of live) { const r = await runTarget(adapter, t, messages, opts, deadlineAt, attempts); if (r) return { ...r, attempts }; }
  }
  throw new OrchestrationError(`All ${live.length} model target(s) failed within ${options.deadlineMs} ms.`, attempts);
}

export class OrchestrationError extends Error {
  constructor(message: string, readonly attempts: AttemptRecord[]) { super(`${message} ${attempts.filter((a) => a.error).map((a) => `${a.provider}/${a.model}: ${a.error}`).slice(0, 6).join("; ")}`); this.name = "OrchestrationError"; }
}
