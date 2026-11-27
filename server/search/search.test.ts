import { describe, expect, it } from "vitest";
import { classifyPublisher, credibilityScore, dedupeSources, freshnessFactor, rankScore } from "./ranking";
import { searchWithFallback } from "./fallback";
import { CircuitBreaker } from "../models/orchestrator";

describe("publisher classification", () => {
  it("matches registrable domains exactly, so look-alikes do not inherit trust (old regex matched substrings)", () => {
    expect(classifyPublisher("https://www.bbc.co.uk/news/x")).toBe("major_news");
    expect(classifyPublisher("https://notbbc-news.com/a")).toBe("unknown");
    expect(classifyPublisher("https://bbc.com.evil.example/a")).toBe("unknown");
    expect(classifyPublisher("https://reuters.com.fake-site.net")).toBe("unknown");
  });
  it("recognises government, academic, international and reference sources, including India", () => {
    expect(classifyPublisher("https://www.pib.gov.in/x")).toBe("government");
    expect(classifyPublisher("https://data.gov/x")).toBe("government");
    expect(classifyPublisher("https://cs.stanford.edu/p")).toBe("academic_publisher");
    expect(classifyPublisher("https://www.who.int/x")).toBe("international_org");
    expect(classifyPublisher("https://en.wikipedia.org/wiki/X")).toBe("reference");
    expect(classifyPublisher("https://nature.com/articles/1")).toBe("academic_publisher");
  });
  it("marks social platforms, blogs and population-clock aggregators as low trust", () => {
    for (const u of ["https://www.linkedin.com/posts/x", "https://someone.medium.com/p", "https://livehumans.net/india"]) expect(credibilityScore(u).score).toBeLessThan(45);
  });
  it("orders publishers sensibly", () => {
    const s = (u: string) => credibilityScore(u).score;
    expect(s("https://nih.gov/x")).toBeGreaterThan(s("https://en.wikipedia.org/x"));
    expect(s("https://reuters.com/x")).toBeGreaterThan(s("https://random-blog.example/x"));
    expect(s("https://random-blog.example/x")).toBeGreaterThan(s("https://www.linkedin.com/x"));
  });
  it("relevance and metadata add a little but never exceed 95", () => {
    expect(credibilityScore("https://nih.gov/x", { hasAuthor: true, hasDate: true, relevance: 5 }).score).toBeLessThanOrEqual(95);
    expect(credibilityScore("https://x.example/a", { relevance: 5 }).score).toBeGreaterThan(credibilityScore("https://x.example/a", { relevance: 0 }).score);
  });
});

describe("freshness", () => {
  const now = new Date("2026-11-27T00:00:00Z");
  it("does not penalise old sources for timeless questions", () => { expect(freshnessFactor("2012-01-01", false, now)).toBe(1); });
  it("prefers recent sources for time-sensitive questions", () => {
    expect(freshnessFactor("2026-10-01", true, now)).toBe(1);
    expect(freshnessFactor("2026-03-01", true, now)).toBeGreaterThan(freshnessFactor("2024-03-01", true, now));
    expect(freshnessFactor("2015-01-01", true, now)).toBe(0.55);
  });
  it("treats an unknown or invalid date as mild caution rather than inventing one", () => {
    expect(freshnessFactor(null, true, now)).toBe(0.8); expect(freshnessFactor("garbage", true, now)).toBe(0.8);
  });
  it("a fresh mid-trust source can outrank a stale high-trust one only for time-sensitive questions", () => {
    const stale = rankScore(82, "2018-01-01", true, now), fresh = rankScore(60, "2026-11-01", true, now);
    expect(fresh).toBeGreaterThan(stale);
    expect(rankScore(82, "2018-01-01", false, now)).toBeGreaterThan(rankScore(60, "2026-11-01", false, now));
  });
});

describe("source de-duplication", () => {
  const rank = (x: { url: string }) => (x.url.includes("reuters") ? 90 : 50);
  it("drops the same URL with tracking parameters", () => {
    const canon = (u: string) => { const x = new URL(u); x.search = ""; return x.toString(); };
    const { kept, dropped } = dedupeSources([{ url: "https://a.com/p?utm_source=x", title: "Alpha story" }, { url: "https://a.com/p", title: "Alpha story" }], rank, canon);
    expect(kept).toHaveLength(1); expect(dropped[0].reason).toBe("same URL");
  });
  it("collapses a syndicated story to the highest-ranked copy and says so", () => {
    const title = "India's population estimated at 1.48 billion according to new United Nations revision";
    const { kept, dropped } = dedupeSources([{ url: "https://smallsite.net/a", title }, { url: "https://reuters.com/world/x", title }, { url: "https://other.org/b", title: title + "!" }], rank);
    expect(kept).toHaveLength(1); expect(kept[0].url).toContain("reuters"); expect(dropped).toHaveLength(2);
    expect(dropped[0].reason).toMatch(/syndicated/);
  });
  it("collapses near-identical text even when headlines differ", () => {
    const body = "The committee reviewed the quarterly figures and concluded that regional output rose sharply while imports declined across most sectors this year";
    const { kept } = dedupeSources([{ url: "https://one.com/a", title: "Output rises", snippet: body }, { url: "https://two.com/b", title: "Regional growth", snippet: body }], () => 50);
    expect(kept).toHaveLength(1);
  });
  it("keeps genuinely different stories and short generic titles", () => {
    const { kept } = dedupeSources([{ url: "https://a.com/1", title: "Population of India" }, { url: "https://b.com/2", title: "Population of India" }, { url: "https://c.com/3", title: "Heat wave hits northern states, officials issue health advisory today" }], () => 50);
    expect(kept).toHaveLength(3);                 // two short identical titles are NOT merged (too little evidence they are the same article)
  });
  it("two copies on the SAME domain with the same title are not treated as syndication", () => {
    const t = "Detailed regional economic outlook for the coming fiscal year published by the ministry";
    expect(dedupeSources([{ url: "https://a.com/en", title: t }, { url: "https://a.com/hi", title: t }], () => 50).kept).toHaveLength(2);
  });
});

describe("search provider fallback", () => {
  const ok = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://x/${i}` }));
  it("returns the first provider that yields results", async () => {
    const r = await searchWithFallback(async (p) => (p === "a" ? ok(3) : ok(9)), ["a", "b"], "q");
    expect(r.provider).toBe("a"); expect(r.hits).toHaveLength(3); expect(r.attempts).toHaveLength(1);
  });
  it("falls through a failing provider and an empty one, reporting every attempt", async () => {
    const r = await searchWithFallback(async (p) => { if (p === "a") throw new Error("HTTP 429"); if (p === "b") return []; return ok(2); }, ["a", "b", "c"], "q");
    expect(r.provider).toBe("c");
    expect(r.attempts.map((a) => `${a.provider}:${a.ok ? "ok" : "fail"}:${a.count}`)).toEqual(["a:fail:0", "b:ok:0", "c:ok:2"]);
    expect(r.attempts[0].error).toMatch(/429/);
  });
  it("times out a hung provider and moves on", async () => {
    const r = await searchWithFallback((p, _q, signal) => (p === "slow" ? new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")))) : Promise.resolve(ok(1))), ["slow", "fast"], "q", { perProviderTimeoutMs: 40 });
    expect(r.provider).toBe("fast"); expect(r.attempts[0].error).toMatch(/timed out/);
  });
  it("returns an honest empty result when everything fails (never fabricates hits)", async () => {
    const r = await searchWithFallback(async () => { throw new Error("down"); }, ["a", "b"], "q");
    expect(r.hits).toEqual([]); expect(r.provider).toBeNull(); expect(r.attempts.every((a) => !a.ok)).toBe(true);
  });
  it("skips a provider whose circuit is open", async () => {
    const breaker = new CircuitBreaker(1, 60_000); breaker.failure("a");
    const seen: string[] = [];
    const r = await searchWithFallback(async (p) => { seen.push(p); return ok(1); }, ["a", "b"], "q", { breaker });
    expect(seen).toEqual(["b"]); expect(r.attempts[0]).toMatchObject({ provider: "a", skipped: true });
  });
  it("can require a minimum number of hits before accepting a provider", async () => {
    const r = await searchWithFallback(async (p) => (p === "a" ? ok(1) : ok(5)), ["a", "b"], "q", { minHits: 3 });
    expect(r.provider).toBe("b");
  });
});
