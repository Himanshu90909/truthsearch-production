import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Records every ledger write instead of touching a database.
const written: any[] = [];
vi.mock("../db", async (orig) => ({ ...(await orig<typeof import("../db")>()), recordUsage: async (e: any) => { written.push(e); } }));

describe("callSynthesisLLM -> usage ledger", () => {
  const saved = { ...process.env }; const realFetch = globalThis.fetch;
  beforeEach(() => { written.length = 0; process.env.HF_API_KEY = "hf_test_token"; for (const k of ["GEMINI_API_KEY", "XAI_API_KEY", "GROQ_API_KEY"]) delete process.env[k]; });
  afterEach(() => { globalThis.fetch = realFetch; process.env = { ...saved }; });

  it("records the failed first model and the successful fallback with the caller's user and session", async () => {
    globalThis.fetch = (async (_u: any, init: any) => {
      const body = JSON.parse(init.body);
      if (body.model === "Qwen/Qwen3.8-27B") return new Response("boom", { status: 503 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "answer" } }], usage: { prompt_tokens: 42, completion_tokens: 7 } }), { status: 200 });
    }) as any;
    const { callSynthesisLLM } = await import("../research");
    const { runWithContext } = await import("../platform/context");
    const r = await runWithContext({ userId: 17, sessionId: 99, requestId: "req-abc" }, () => callSynthesisLLM({ messages: [{ role: "user", content: "code question" }] }, "code"));
    expect(r.choices[0].message.content).toBe("answer");
    expect(written).toHaveLength(2);
    expect(written[0]).toMatchObject({ userId: 17, sessionId: 99, requestId: "req-abc", model: "Qwen/Qwen3.8-27B", status: "error" });
    expect(written[0].error).toMatch(/503/);
    expect(written[1]).toMatchObject({ userId: 17, sessionId: 99, status: "ok", promptTokens: 42, completionTokens: 7, tokensEstimated: false });
    expect(written[1].latencyMs).toBeGreaterThanOrEqual(0);
  });
  it("records cost as unknown (null), never zero, when no price is configured", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }), { status: 200 })) as any;
    const { callSynthesisLLM } = await import("../research");
    await callSynthesisLLM({ messages: [{ role: "user", content: "hello there" }] });
    expect(written.at(-1).costUsd).toBeNull();
  });
  it("throws one readable error naming every failed model when all fail", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 500 })) as any;
    const { callSynthesisLLM } = await import("../research");
    await expect(callSynthesisLLM({ messages: [{ role: "user", content: "hello there" }] })).rejects.toThrow(/All synthesis providers failed/);
    expect(written.length).toBeGreaterThanOrEqual(2); expect(written.every((w) => w.status === "error")).toBe(true);
  });
});
