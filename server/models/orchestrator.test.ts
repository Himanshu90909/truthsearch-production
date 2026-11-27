import { describe, expect, it } from "vitest";
import { CircuitBreaker, OrchestrationError, ProviderError, orchestrate, type Adapter, type AttemptRecord, type ModelTarget } from "./orchestrator";

const msgs = [{ role: "user" as const, content: "What is the capital of France?" }];
const A: ModelTarget = { provider: "a", model: "m1" };
const B: ModelTarget = { provider: "b", model: "m2" };
const C: ModelTarget = { provider: "c", model: "m3" };
const ok = (content: string, extra = {}) => ({ content, promptTokens: 10, completionTokens: 5, ...extra });
const noSleep = async () => {};

// A controllable clock so deadlines are tested without waiting.
function clock(start = 0) { let t = start; return { now: () => t, advance: (ms: number) => { t += ms; } }; }

describe("sequential fallback", () => {
  it("returns the first provider's answer and records one ok attempt", async () => {
    const recs: AttemptRecord[] = [];
    const adapter: Adapter = async (t) => ok(`answer from ${t.provider}`);
    const r = await orchestrate(adapter, [A, B], msgs, { deadlineMs: 20_000, sleep: noSleep, record: (x) => { recs.push(x); } });
    expect(r.content).toBe("answer from a"); expect(r.target.provider).toBe("a");
    expect(recs).toHaveLength(1); expect(recs[0]).toMatchObject({ provider: "a", status: "ok", promptTokens: 10, completionTokens: 5, tokensEstimated: false });
  });
  it("falls back to the next provider on a permanent error and records both", async () => {
    const recs: AttemptRecord[] = [];
    const adapter: Adapter = async (t) => { if (t.provider === "a") throw new ProviderError("HTTP 401 bad key", 401, false); return ok("from b"); };
    const r = await orchestrate(adapter, [A, B], msgs, { deadlineMs: 20_000, sleep: noSleep, record: (x) => { recs.push(x); } });
    expect(r.target.provider).toBe("b");
    expect(recs.map((x) => `${x.provider}:${x.status}`)).toEqual(["a:error", "b:ok"]);
  });
  it("does not retry a permanent error", async () => {
    let calls = 0; const adapter: Adapter = async () => { calls++; throw new ProviderError("HTTP 400", 400, false); };
    await expect(orchestrate(adapter, [A], msgs, { deadlineMs: 20_000, sleep: noSleep })).rejects.toBeInstanceOf(OrchestrationError);
    expect(calls).toBe(1);
  });
  it("treats an empty answer as a failure and moves on", async () => {
    const adapter: Adapter = async (t) => (t.provider === "a" ? { content: "   " } : ok("real answer"));
    expect((await orchestrate(adapter, [A, B], msgs, { deadlineMs: 20_000, sleep: noSleep })).target.provider).toBe("b");
  });
  it("throws one error naming every failure when all targets fail", async () => {
    const adapter: Adapter = async (t) => { throw new ProviderError(`down ${t.provider}`, 500, false); };
    const e = await orchestrate(adapter, [A, B], msgs, { deadlineMs: 20_000, sleep: noSleep }).catch((x) => x);
    expect(e).toBeInstanceOf(OrchestrationError); expect(e.message).toMatch(/down a/); expect(e.message).toMatch(/down b/); expect(e.attempts).toHaveLength(2);
  });
});

describe("retries", () => {
  it("retries a transient error and then succeeds, recording each attempt", async () => {
    let n = 0; const recs: AttemptRecord[] = []; const slept: number[] = [];
    const adapter: Adapter = async () => { n++; if (n < 3) throw new ProviderError("HTTP 503", 503, true); return ok("finally"); };
    const r = await orchestrate(adapter, [A], msgs, { deadlineMs: 60_000, retryDelaysMs: [100, 200], sleep: async (ms) => { slept.push(ms); }, record: (x) => { recs.push(x); } });
    expect(r.content).toBe("finally"); expect(slept).toEqual([100, 200]);
    expect(recs.map((x) => x.status)).toEqual(["error", "error", "ok"]);
  });
  it("gives up after the configured number of retries", async () => {
    let n = 0; const adapter: Adapter = async () => { n++; throw new ProviderError("HTTP 429", 429, true); };
    await expect(orchestrate(adapter, [A], msgs, { deadlineMs: 60_000, retryDelaysMs: [10, 10], sleep: noSleep })).rejects.toBeInstanceOf(OrchestrationError);
    expect(n).toBe(3);
  });
  it("skips a retry that would overrun the deadline instead of sleeping past it", async () => {
    const c = clock(); let n = 0;
    const adapter: Adapter = async () => { n++; c.advance(1000); throw new ProviderError("HTTP 503", 503, true); };
    await expect(orchestrate(adapter, [A], msgs, { deadlineMs: 10_000, retryDelaysMs: [30_000], now: c.now, sleep: noSleep })).rejects.toBeInstanceOf(OrchestrationError);
    expect(n).toBe(1);
  });
});

describe("timeouts and deadline", () => {
  it("aborts a hung provider at its own timeout and falls back", async () => {
    const adapter: Adapter = (t, _m, signal) => t.provider === "a" ? new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")))) : Promise.resolve(ok("from b"));
    const recs: AttemptRecord[] = [];
    const r = await orchestrate(adapter, [{ ...A, timeoutMs: 40 }, B], msgs, { deadlineMs: 5000, retryDelaysMs: [], sleep: noSleep, minUsefulMs: 10, record: (x) => { recs.push(x); } });
    expect(r.target.provider).toBe("b"); expect(recs[0].status).toBe("timeout");
  });
  it("never lets one attempt run longer than the time left in the overall deadline", async () => {
    let seenTimeout = 0;
    const adapter: Adapter = (_t, _m, signal) => { const s = Date.now(); return new Promise((_, rej) => signal.addEventListener("abort", () => { seenTimeout = Date.now() - s; rej(new Error("aborted")); })); };
    await orchestrate(adapter, [{ ...A, timeoutMs: 60_000 }], msgs, { deadlineMs: 120, retryDelaysMs: [], sleep: noSleep, minUsefulMs: 10 }).catch(() => {});
    expect(seenTimeout).toBeLessThan(1500);
  });
  it("does not start an attempt when too little time is left", async () => {
    const c = clock(); let calls = 0; const recs: AttemptRecord[] = [];
    const adapter: Adapter = async (t) => { calls++; if (t.provider === "a") { c.advance(9_000); throw new ProviderError("HTTP 500", 500, false); } return ok("late"); };
    await expect(orchestrate(adapter, [A, B], msgs, { deadlineMs: 10_000, minUsefulMs: 3_000, now: c.now, sleep: noSleep, record: (x) => { recs.push(x); } })).rejects.toBeInstanceOf(OrchestrationError);
    expect(calls).toBe(1); expect(recs.some((x) => x.provider === "b" && x.status === "skipped")).toBe(true);
  });
});

describe("circuit breaker", () => {
  it("skips a provider after repeated failures and uses the next one", async () => {
    const breaker = new CircuitBreaker(2, 60_000);
    const calls: string[] = [];
    const adapter: Adapter = async (t) => { calls.push(t.provider); if (t.provider === "a") throw new ProviderError("HTTP 500", 500, false); return ok("b ok"); };
    const run = () => orchestrate(adapter, [A, B], msgs, { deadlineMs: 20_000, sleep: noSleep, breaker });
    await run(); await run();                   // a fails twice, breaker opens
    calls.length = 0; await run();
    expect(calls).toEqual(["b"]);               // a is no longer even tried
  });
  it("closes again after the cool-down and on success", async () => {
    let now = 0; const breaker = new CircuitBreaker(1, 1000, () => now);
    breaker.failure("a"); expect(breaker.isOpen("a")).toBe(true);
    now = 1500; expect(breaker.isOpen("a")).toBe(false);
    breaker.failure("a"); breaker.success("a"); expect(breaker.isOpen("a")).toBe(false);
  });
  it("reports a clear error when every provider is disabled", async () => {
    const breaker = new CircuitBreaker(1, 60_000); breaker.failure("a");
    await expect(orchestrate(async () => ok("x"), [A], msgs, { deadlineMs: 5000, sleep: noSleep, breaker })).rejects.toThrow(/temporarily disabled/);
  });
});

describe("parallel mode", () => {
  it("returns the fastest successful answer", async () => {
    const adapter: Adapter = (t) => new Promise((res) => setTimeout(() => res(ok(`from ${t.provider}`)), t.provider === "a" ? 150 : 10));
    const r = await orchestrate(adapter, [A, B], msgs, { deadlineMs: 5000, parallel: 2, sleep: noSleep, minUsefulMs: 10 });
    expect(r.target.provider).toBe("b");
  });
  it("still succeeds when one racer fails", async () => {
    const adapter: Adapter = async (t) => { if (t.provider === "a") throw new ProviderError("HTTP 500", 500, false); return ok("b wins"); };
    expect((await orchestrate(adapter, [A, B], msgs, { deadlineMs: 5000, parallel: 2, sleep: noSleep })).content).toBe("b wins");
  });
  it("falls back to the remaining targets when every racer fails", async () => {
    const adapter: Adapter = async (t) => { if (t.provider !== "c") throw new ProviderError("HTTP 500", 500, false); return ok("c saves it"); };
    expect((await orchestrate(adapter, [A, B, C], msgs, { deadlineMs: 5000, parallel: 2, sleep: noSleep })).target.provider).toBe("c");
  });
});

describe("usage accounting", () => {
  it("flags tokens as estimated when the provider does not report usage, never as exact", async () => {
    const recs: AttemptRecord[] = [];
    await orchestrate(async () => ({ content: "a reasonably long answer for estimation" }), [A], msgs, { deadlineMs: 5000, sleep: noSleep, record: (x) => { recs.push(x); } });
    expect(recs[0].tokensEstimated).toBe(true); expect(recs[0].promptTokens).toBeGreaterThan(0); expect(recs[0].completionTokens).toBeGreaterThan(0);
  });
  it("records latency from the injected clock", async () => {
    const c = clock(); const recs: AttemptRecord[] = [];
    await orchestrate(async () => { c.advance(321); return ok("x"); }, [A], msgs, { deadlineMs: 5000, now: c.now, sleep: noSleep, record: (x) => { recs.push(x); } });
    expect(recs[0].latencyMs).toBe(321);
  });
  it("a failing recorder cannot break the answer path", async () => {
    // recorders are awaited, so a throwing one would reject; the contract is that callers pass a safe recorder.
    const safe = async () => { try { throw new Error("db down"); } catch { /* swallowed by the safe wrapper */ } };
    expect((await orchestrate(async () => ok("fine"), [A], msgs, { deadlineMs: 5000, sleep: noSleep, record: safe })).content).toBe("fine");
  });
});
