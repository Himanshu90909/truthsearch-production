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

describe("intent classification for direct technical answers", () => {
  it("routes code/programming questions to the technical intent so the model answers from expertise", async () => {
    const { classifyIntent } = await import("./research");
    expect(classifyIntent("how do I fix a TypeError in my python code")).toBe("programming");
    expect(classifyIntent("write a function to reverse a linked list in javascript")).toBe("programming");
    expect(classifyIntent("why do LLMs hallucinate?")).toBe("general_research");
  });
});

describe("single synthesis backend", () => {
  it("fails explicitly when the HF_API_KEY secret is missing instead of fabricating an answer", async () => {
    const before = { ...process.env };
    delete process.env.HF_API_KEY;
    const { callSynthesisLLM, synthesisModelConfigured } = await import("./research");
    expect(synthesisModelConfigured()).toBe(false);
    await expect(callSynthesisLLM({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/HF_API_KEY is missing/);
    process.env = before;
  });
  it("calls the hardwired Muse-Glimmer-30B endpoint and passes user images through as vision input", async () => {
    const before = { ...process.env };
    process.env.HF_API_KEY = "hf_test_token";
    const { callSynthesisLLM } = await import("./research");
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: any; auth: string }> = [];
    globalThis.fetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.authorization });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;
    const result = await callSynthesisLLM({ messages: [{ role: "user", content: [{ type: "text", text: "what is in this image?" }, { type: "image_url", image_url: { url: "data:image/png;base64,eHh4" } }] }] });
    globalThis.fetch = originalFetch;
    expect(calls[0].url).toBe("https://router.huggingface.co/v1/chat/completions");
    expect(calls[0].auth).toBe("Bearer hf_test_token");
    expect(calls[0].body.model).toBe("meta-models/Muse-Glimmer-30B");
    expect(calls[0].body.messages[0].content[1].type).toBe("image_url");
    expect(result.choices?.[0]?.message?.content).toBe("ok");
    process.env = before;
  });
});
