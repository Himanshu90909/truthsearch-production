import { describe, expect, it } from "vitest";
import { keyBelongsTo, webSearchChain } from "./chain";

// Mirrors the logic in serverless/entry.ts so the warning wording and the chain stay in sync.
const expected = { TAVILY_API_KEY: "tavily", FIRECRAWL_API_KEY: "firecrawl", BRAVE_SEARCH_API_KEY: "brave", BRAVE_API_KEY: "brave" } as const;
const warnings = (env: Record<string, string | undefined>) => (Object.keys(expected) as Array<keyof typeof expected>).filter((n) => env[n] && keyBelongsTo(env[n]) !== "unknown" && keyBelongsTo(env[n]) !== expected[n]).map((n) => `${n} holds a ${keyBelongsTo(env[n])} key`);

describe("search diagnostics", () => {
  it("flags swapped keys by variable name and reports only provider names", () => {
    const env = { TAVILY_API_KEY: "fc-0123456789abcdef0123456789abcdef", BRAVE_API_KEY: "tvly-dev-abcdefghij0123456789" };
    expect(warnings(env)).toEqual(["TAVILY_API_KEY holds a firecrawl key", "BRAVE_API_KEY holds a tavily key"]);
    expect(JSON.stringify(warnings(env))).not.toMatch(/0123456789abcdef|abcdefghij0123/);
    expect(webSearchChain(env)).toEqual(["duckDuckGo"]);
  });
  it("no warnings when keys are correctly named", () => {
    expect(warnings({ TAVILY_API_KEY: "tvly-dev-abcdefghij0123456789", FIRECRAWL_API_KEY: "fc-0123456789abcdef0123456789abcdef" })).toEqual([]);
  });
});
