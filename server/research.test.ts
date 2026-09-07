import { describe, expect, it } from "vitest";
import { bm25Like, canonicalizeUrl, classifyIntent, classifySource, detectContradictions, makeQueries, queryContentRelevance, rankEvidence, reciprocalRankFusion, scoreSource, verifyEvidence } from "./research";

describe("research primitives", () => {
  it("canonicalizes tracking parameters and fragments", () => {
    expect(canonicalizeUrl("https://example.com/a/?utm_source=x#part")).toBe("https://example.com/a");
  });
  it("creates bounded, non-duplicate search plans", () => {
    const queries = makeQueries("How do retrieval systems reduce hallucinations?", true);
    expect(queries.length).toBeLessThanOrEqual(8);
    expect(new Set(queries).size).toBe(queries.length);
  });
  it("scores academic sources above generic web sources", () => {
    const academic = { title: "Paper", url: "https://doi.org/x", snippet: "", provider: "semanticScholar" as const };
    const web = { title: "Page", url: "https://example.com", snippet: "", provider: "wikipedia" as const };
    expect(scoreSource(academic, "doi.org")).toBeGreaterThan(scoreSource(web, "example.com"));
    expect(classifySource("doi.org", "semanticScholar")).toBe("Academic Paper");
  });
  it("boosts source score when the fetched content is actually relevant to the query", () => {
    const hit = { title: "t", url: "https://example.com", snippet: "", provider: "wikipedia" as const };
    expect(scoreSource(hit, "example.com", 5)).toBeGreaterThan(scoreSource(hit, "example.com", 0));
  });
  it("scores query-relevant content higher than off-topic content, catching morphological variants", () => {
    const relevant = queryContentRelevance(
      "Why do LLMs hallucinate?",
      "Large language models (LLMs) sometimes hallucinate facts because they predict the most likely next token rather than verifying truth."
    );
    const irrelevant = queryContentRelevance(
      "Why do LLMs hallucinate?",
      "Witch's milk is a fluid that can be secreted from the breast tissue of newborn human infants of either sex."
    );
    expect(relevant).toBeGreaterThan(irrelevant);
    expect(irrelevant).toBeLessThan(2);
  });
  it("uses fused ordering in the production evidence ranking function", () => {
    const items = [
      { claim: "a", quote: "A sufficiently long quote for evidence one.", url: "https://a.example", title: "A", supportScore: 70, qualityScore: 70, sourceId: 0 },
      { claim: "b", quote: "A sufficiently long quote for evidence two.", url: "https://b.example", title: "B", supportScore: 70, qualityScore: 70, sourceId: 1 },
    ];
    expect(rankEvidence(items, [0.1, 0.9], [0.1, 0.9])[0]?.title).toBe("B");
  });
  it("verifies exact retrieved passages before citation", () => {
    const sources = [{ title: "A", url: "https://example.com/a", canonicalUrl: "https://example.com/a", domain: "example.com", snippet: "", provider: "wikipedia" as const, sourceType: "Web Source", qualityScore: 80, content: "The exact passage is present in this source and is long enough to verify.", passages: [] }];
    const good = { claim: "The claim", quote: "The exact passage is present in this source and is long enough to verify.", url: "https://example.com/a", title: "A", supportScore: 80, qualityScore: 80, sourceId: 0 };
    const bad = { ...good, quote: "This fabricated quote is not in the source." };
    expect(verifyEvidence([good, bad], sources)).toEqual([good]);
  });
  it("detects mixed supportive and limiting language", () => {
    const result = detectContradictions([
      { claim: "x", quote: "The method improves recall and provides a benefit.", url: "https://a.example", title: "A", supportScore: 80, qualityScore: 80, sourceId: 0 },
      { claim: "x", quote: "The study found no significant improvement and noted a limitation.", url: "https://b.example", title: "B", supportScore: 70, qualityScore: 80, sourceId: 1 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.description).toContain("mixed");
  });
  it("produces real BM25 lexical scores (rare/matching terms rank above unrelated text) and reciprocal rank fusion values", () => {
    const [relevantScore, unrelatedScore] = bm25Like("retrieval evidence", ["retrieval improves evidence quality for search systems", "totally unrelated text about gardening tools"]);
    expect(relevantScore).toBeGreaterThan(unrelatedScore);
    expect(unrelatedScore).toBe(0);
    expect(reciprocalRankFusion([[0, 1], [0, 2]])[0]).toBeGreaterThan(reciprocalRankFusion([[0, 1], [0, 2]])[1]);
  });
});

import { providerRegistry, providerStatuses, providersForIntent } from "./providers/registry";

describe("knowledge provider registry", () => {
  it("routes programming and dataset intents to appropriate public providers", () => {
    expect(classifyIntent("How does PostgreSQL indexing work?")).toBe("programming");
    expect(providersForIntent("programming")).toContain("github");
    expect(providersForIntent("dataset")).toContain("worldBank");
    expect(providersForIntent("education")).toContain("openLibrary");
    expect(providersForIntent("academic_research")).toContain("wikidata");
  });

  it("exposes configured and not-configured provider states without fake credentials", () => {
    const statuses = providerStatuses();
    expect(statuses.some((status) => status.name === "github" && status.enabled)).toBe(true);
    const dataGov = statuses.find((status) => status.name === "dataGov");
    expect(dataGov).toBeDefined();
    if (!process.env.DATA_GOV_API_KEY) expect(dataGov?.enabled).toBe(false);
    expect(providerRegistry.get("openLibrary")?.category).toBe("books");
    expect(statuses.find((status) => status.name === "youtube")?.enabled).toBe(false);
  });
});

describe("synthesis provider resolution", () => {
  it("uses the managed built-in LLM when no custom endpoint is configured", async () => {
    const before = { ...process.env };
    delete process.env.LLM_BASE_URL; delete process.env.LLM_API_KEY; delete process.env.LLM_MODEL;
    delete process.env.HF_API_KEY; delete process.env.HF_MODEL;
    const { resolveSynthesisProvider } = await import("./research");
    expect(resolveSynthesisProvider()).toEqual({ kind: "managed" });
    process.env = before;
  });
  it("routes to a custom OpenAI-compatible endpoint when LLM_BASE_URL/LLM_API_KEY/LLM_MODEL are set", async () => {
    const before = { ...process.env };
    process.env.LLM_BASE_URL = "https://router.huggingface.co/v1";
    process.env.LLM_API_KEY = "hf_test_token";
    process.env.LLM_MODEL = "meta-models/Muse-Glimmer-30B";
    const { resolveSynthesisProvider } = await import("./research");
    expect(resolveSynthesisProvider()).toEqual({ kind: "custom", baseUrl: "https://router.huggingface.co/v1", apiKey: "hf_test_token", model: "meta-models/Muse-Glimmer-30B" });
    process.env = before;
  });
  it("treats HF_API_KEY as an alias implying the Hugging Face inference router", async () => {
    const before = { ...process.env };
    delete process.env.LLM_BASE_URL; delete process.env.LLM_API_KEY; delete process.env.LLM_MODEL;
    process.env.HF_API_KEY = "hf_alias_token";
    process.env.HF_MODEL = "meta-models/Muse-Glimmer-30B";
    const { resolveSynthesisProvider } = await import("./research");
    expect(resolveSynthesisProvider()).toEqual({ kind: "custom", baseUrl: "https://router.huggingface.co/v1", apiKey: "hf_alias_token", model: "meta-models/Muse-Glimmer-30B" });
    process.env = before;
  });
  it("never silently fabricates: incomplete custom config falls back to managed, and a missing managed key fails explicitly at call time", async () => {
    const before = { ...process.env };
    process.env.LLM_BASE_URL = "https://example.invalid/v1";
    delete process.env.LLM_API_KEY; delete process.env.LLM_MODEL;
    delete process.env.HF_API_KEY; delete process.env.HF_MODEL;
    const { resolveSynthesisProvider, callSynthesisLLM } = await import("./research");
    expect(resolveSynthesisProvider()).toEqual({ kind: "managed" });
    await expect(callSynthesisLLM({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/not configured|OPENAI_API_KEY/);
    process.env = before;
  });
});
