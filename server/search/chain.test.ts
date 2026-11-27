import { describe, expect, it } from "vitest";
import { keyBelongsTo, webSearchChain } from "./chain";

describe("web search chain", () => {
  it("falls back to keyless DuckDuckGo only when no key is configured", () => { expect(webSearchChain({})).toEqual(["duckDuckGo"]); });
  it("prefers a configured Tavily key over DuckDuckGo without any extra flag", () => {
    expect(webSearchChain({ TAVILY_API_KEY: "tvly-abc123456789" })).toEqual(["tavily", "duckDuckGo"]);
  });
  it("orders tavily, brave, duckduckgo when all are configured", () => {
    expect(webSearchChain({ TAVILY_API_KEY: "tvly-abc123456789", BRAVE_SEARCH_API_KEY: "BSAabcdefghijkl" })).toEqual(["tavily", "brave", "duckDuckGo"]);
  });
  it("honours SEARCH_PROVIDER only when that provider is usable", () => {
    const env = { TAVILY_API_KEY: "tvly-abc123456789", BRAVE_SEARCH_API_KEY: "BSAabcdefghijkl" };
    expect(webSearchChain({ ...env, SEARCH_PROVIDER: "brave" })[0]).toBe("brave");
    expect(webSearchChain({ TAVILY_API_KEY: "tvly-abc123456789", SEARCH_PROVIDER: "brave" })[0]).toBe("tavily");
  });
  it("never sends a Tavily key to Brave when it was saved under BRAVE_API_KEY (the exact mistake seen in testing)", () => {
    const chain = webSearchChain({ BRAVE_API_KEY: "tvly-abc123456789" });
    expect(chain).not.toContain("brave"); expect(chain).toEqual(["duckDuckGo"]);
  });
  it("and never sends a Brave key to Tavily", () => {
    expect(webSearchChain({ TAVILY_API_KEY: "BSAabcdefghijklmnop" })).toEqual(["duckDuckGo"]);
  });
  it("recognises key formats without ever echoing them", () => {
    expect(keyBelongsTo("tvly-xyz")).toBe("tavily"); expect(keyBelongsTo("BSAabcdefghijkl")).toBe("brave"); expect(keyBelongsTo("whatever")).toBe("unknown"); expect(keyBelongsTo(undefined)).toBe("unknown");
  });
});

describe("searchProvider refuses to send a mis-saved key to the wrong provider", () => {
  it("does not use a Tavily-shaped BRAVE_API_KEY for Brave", async () => {
    const { searchProvider } = await import("../research");
    const saved = { a: process.env.BRAVE_SEARCH_API_KEY, b: process.env.BRAVE_API_KEY };
    delete process.env.BRAVE_SEARCH_API_KEY; process.env.BRAVE_API_KEY = "tvly-not-a-brave-key-123456";
    const realFetch = globalThis.fetch; let called = false; globalThis.fetch = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
    try { await expect(searchProvider("brave", "test query")).rejects.toThrow("BRAVE_SEARCH_API_KEY"); expect(called).toBe(false); }
    finally { globalThis.fetch = realFetch; if (saved.a) process.env.BRAVE_SEARCH_API_KEY = saved.a; if (saved.b) process.env.BRAVE_API_KEY = saved.b; else delete process.env.BRAVE_API_KEY; }
  });
});

import { resolveProviderKey } from "./chain";
describe("swapped keys (the exact situation seen in testing)", () => {
  const FC = "fc-0123456789abcdef0123456789abcdef"; const TV = "tvly-dev-abcdefghij0123456789";
  it("a Firecrawl key saved as TAVILY_API_KEY is never offered to Tavily, but Firecrawl can still use it", () => {
    const env = { TAVILY_API_KEY: FC };
    expect(webSearchChain(env)).not.toContain("tavily");
    expect(resolveProviderKey(env, "tavily")).toBeUndefined();
  });
  it("a Tavily key saved as BRAVE_API_KEY is never offered to Brave", () => {
    expect(webSearchChain({ BRAVE_API_KEY: TV })).not.toContain("brave"); expect(resolveProviderKey({ BRAVE_API_KEY: TV }, "brave")).toBeUndefined();
  });
  it("correctly named keys give tavily, firecrawl, then duckduckgo", () => {
    expect(webSearchChain({ TAVILY_API_KEY: TV, FIRECRAWL_API_KEY: FC })).toEqual(["tavily", "firecrawl", "duckDuckGo"]);
  });
  it("keyBelongsTo recognises all three formats", () => {
    expect(keyBelongsTo(FC)).toBe("firecrawl"); expect(keyBelongsTo(TV)).toBe("tavily"); expect(keyBelongsTo("BSAabcdefghijkl")).toBe("brave");
  });
  it("searchProvider('tavily') makes no network call with a Firecrawl-shaped key", async () => {
    const { searchProvider } = await import("../research");
    const saved = process.env.TAVILY_API_KEY; process.env.TAVILY_API_KEY = FC;
    const real = globalThis.fetch; let called = false; globalThis.fetch = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
    try { await expect(searchProvider("tavily", "test query")).rejects.toThrow(/another provider|not configured/); expect(called).toBe(false); }
    finally { globalThis.fetch = real; if (saved) process.env.TAVILY_API_KEY = saved; else delete process.env.TAVILY_API_KEY; }
  });
  it("searchProvider('firecrawl') parses data.web results", async () => {
    const { searchProvider } = await import("../research");
    const saved = process.env.FIRECRAWL_API_KEY; process.env.FIRECRAWL_API_KEY = FC;
    const real = globalThis.fetch; globalThis.fetch = (async () => new Response(JSON.stringify({ success: true, data: { web: [{ url: "https://news.microsoft.com/a", title: "Satya Nadella", description: "CEO of Microsoft" }] } }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try { const hits = await searchProvider("firecrawl", "x y z query"); expect(hits).toHaveLength(1); expect(hits[0]).toMatchObject({ url: "https://news.microsoft.com/a", title: "Satya Nadella", provider: "firecrawl" }); }
    finally { globalThis.fetch = real; if (saved) process.env.FIRECRAWL_API_KEY = saved; else delete process.env.FIRECRAWL_API_KEY; }
  });
});
