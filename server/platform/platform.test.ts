import { describe, expect, it } from "vitest";
import { MemoryRateLimitStore, callerKey, checkRateLimit, hourlyLimitFor } from "./ratelimit";
import { estimateCostUsd, evaluateBudget, readBudgetPolicy } from "./budget";
import { maskSecret, sanitizeMeta } from "./audit";
import { safeEqual } from "./admin-token";

describe("rate limiting", () => {
  it("allows up to the limit then blocks with a retry time", async () => {
    const store = new MemoryRateLimitStore(); const now = 1_000_000_000_000;
    for (let i = 0; i < 3; i++) expect((await checkRateLimit(store, "ip:1", 3, 3_600_000, now)).allowed).toBe(true);
    const blocked = await checkRateLimit(store, "ip:1", 3, 3_600_000, now);
    expect(blocked.allowed).toBe(false); expect(blocked.remaining).toBe(0); expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });
  it("keeps separate counters per caller and resets in the next window", async () => {
    const store = new MemoryRateLimitStore(); const now = 1_000_000_000_000;
    await checkRateLimit(store, "user:1", 1, 3_600_000, now);
    expect((await checkRateLimit(store, "user:2", 1, 3_600_000, now)).allowed).toBe(true);
    expect((await checkRateLimit(store, "user:1", 1, 3_600_000, now)).allowed).toBe(false);
    expect((await checkRateLimit(store, "user:1", 1, 3_600_000, now + 3_600_000)).allowed).toBe(true);
  });
  it("rejects an invalid limit instead of silently allowing everything", async () => {
    await expect(checkRateLimit(new MemoryRateLimitStore(), "k", 0, 1000)).rejects.toThrow();
  });
  it("gives signed-in users more than anonymous visitors", () => {
    expect(hourlyLimitFor(null)).toBeLessThan(hourlyLimitFor({ role: "user" }));
    expect(hourlyLimitFor({ role: "user" })).toBeLessThan(hourlyLimitFor({ role: "admin" }));
  });
  it("uses the first forwarded address only", () => {
    expect(callerKey(null, "1.2.3.4, 9.9.9.9")).toBe("ip:1.2.3.4");
    expect(callerKey({ id: 7 }, "1.2.3.4")).toBe("user:7");
    expect(callerKey(null, undefined)).toBe("ip:unknown");
  });
});

describe("budget", () => {
  it("returns null cost for an unpriced model instead of 0", () => {
    expect(estimateCostUsd("x/unknown", { promptTokens: 1000, completionTokens: 1000 })).toBeNull();
  });
  it("computes cost from a configured price", () => {
    const prices = { "p/m": { inputPerMTok: 2, outputPerMTok: 10, source: "test", verifiedOn: "2026-01-01" } };
    expect(estimateCostUsd("p/m", { promptTokens: 500_000, completionTokens: 100_000 }, prices)).toBeCloseTo(2.0, 6);
  });
  it("blocks a user over their daily token budget", () => {
    const policy = readBudgetPolicy({ BUDGET_DAILY_TOKENS_PER_USER: "1000" });
    expect(evaluateBudget(policy, { userTokens: 999, globalTokens: 0, globalUsd: 0 }).allowed).toBe(true);
    const d = evaluateBudget(policy, { userTokens: 1000, globalTokens: 0, globalUsd: 0 });
    expect(d.allowed).toBe(false); expect(d.reason).toBe("user_tokens");
  });
  it("blocks when the global USD ceiling is reached", () => {
    const policy = readBudgetPolicy({ BUDGET_DAILY_USD_GLOBAL: "5" });
    expect(evaluateBudget(policy, { userTokens: 0, globalTokens: 0, globalUsd: 5 }).reason).toBe("global_usd");
  });
  it("falls back to defaults on junk configuration", () => {
    expect(readBudgetPolicy({ BUDGET_DAILY_TOKENS_PER_USER: "abc" }).dailyTokensPerUser).toBe(400_000);
  });
});

describe("audit sanitising", () => {
  it("redacts secret-looking keys and values", () => {
    const out = sanitizeMeta({ apiKey: "abc", note: "token sk-abcdefghijklmnopqrstuv end", nested: { password: "x", ok: 1 } }) as any;
    expect(out.apiKey).toBe("[redacted]"); expect(out.note).not.toContain("sk-abcdefghijklmnop"); expect(out.nested.password).toBe("[redacted]"); expect(out.nested.ok).toBe(1);
  });
  it("redacts a Google style key embedded in text", () => {
    expect(JSON.stringify(sanitizeMeta({ msg: "failed with AIzaSyA1234567890abcdefghijk done" }))).not.toContain("AIzaSyA1234567890");
  });
  it("masks credentials and never returns the full secret", () => {
    const masked = maskSecret("nvapi-abcdefghijklmnop12");
    expect(masked).not.toContain("abcdefghijklmnop"); expect(masked.startsWith("nva")).toBe(true);
    expect(maskSecret(undefined)).toBe("not set"); expect(maskSecret("short")).toBe("••••");
  });
});

describe("constant-time compare", () => {
  it("matches equal strings and rejects different ones including different lengths", () => {
    expect(safeEqual("secret", "secret")).toBe(true); expect(safeEqual("secret", "secreT")).toBe(false); expect(safeEqual("a", "abc")).toBe(false);
  });
});
