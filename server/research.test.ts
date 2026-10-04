import { describe, expect, it } from "vitest";
import { bm25Like, canonicalizeUrl, classifyIntent, classifySource, detectContradictions, makeQueries, needsExternalEvidence, queryContentRelevance, rankEvidence, reciprocalRankFusion, scoreSource, verifyEvidence } from "./research";

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

describe("intelligent tool router", () => {
  it("answers knowledge questions directly and searches time-sensitive ones", () => {
    // Direct answers — no web search needed (master prompt §3/§5)
    expect(needsExternalEvidence("What is a linked list? Explain with an example.", "quick")).toBe(false);
    expect(needsExternalEvidence("Explain binary search like I am a beginner", "quick")).toBe(false);
    expect(needsExternalEvidence("Write Java code for merge sort", "quick")).toBe(false);
    expect(needsExternalEvidence("Explain this Java code and find the bug", "quick")).toBe(false);
    expect(needsExternalEvidence("Solve this LeetCode problem from the screenshot", "quick")).toBe(false);
    // Web research required
    expect(needsExternalEvidence("What is the latest React version?", "quick")).toBe(true);
    expect(needsExternalEvidence("What happened in AI this week?", "quick")).toBe(true);
    expect(needsExternalEvidence("Compare AWS Lambda and Google Cloud Run", "quick")).toBe(true);
    expect(needsExternalEvidence("Search the web for the current Bitcoin price", "quick")).toBe(true);
    expect(needsExternalEvidence("What is the latest release of Node.js?", "quick")).toBe(true);
    // Research modes always run the evidence pipeline
    expect(needsExternalEvidence("What is a linked list?", "deep")).toBe(true);
    expect(needsExternalEvidence("What is a linked list?", "academic")).toBe(true);
    expect(needsExternalEvidence("Is this claim true?", "verify")).toBe(true);
  });
});

describe("single synthesis backend", () => {
  it("fails explicitly when no synthesis provider key is configured instead of fabricating an answer", async () => {
    const before = { ...process.env };
    delete process.env.HF_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.GROQ_API_KEY;
    const { callSynthesisLLM, synthesisModelConfigured } = await import("./research");
    expect(synthesisModelConfigured()).toBe(false);
    await expect(callSynthesisLLM({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/No answer was generated/);
    process.env = before;
  });
  it("adds the keyless Pollinations provider on production builds (zero-card answers) and honors the opt-out", async () => {
    const before = { ...process.env };
    const savedNodeEnv = process.env.NODE_ENV;
    const savedOptOut = process.env.POLLINATIONS_SYNTHESIS;
    delete process.env.HF_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.POLLINATIONS_SYNTHESIS;
    process.env.NODE_ENV = "production";
    const { synthesisModelConfigured, synthesisProviders } = await import("./research");
    expect(synthesisModelConfigured()).toBe(true);
    const keyless = synthesisProviders().find((p: { name: string }) => p.name === "pollinations");
    expect(keyless).toBeTruthy();
    expect(keyless.models.vision).toHaveLength(0); // anonymous tier rejects image inputs
    expect(keyless.models.general).toContain("openai");
    process.env.POLLINATIONS_SYNTHESIS = "false";
    expect(synthesisModelConfigured()).toBe(false);
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    if (savedOptOut === undefined) delete process.env.POLLINATIONS_SYNTHESIS; else process.env.POLLINATIONS_SYNTHESIS = savedOptOut;
    process.env = before;
    if (savedNodeEnv !== undefined) process.env.NODE_ENV = savedNodeEnv;
  });
  it("cascades to the fallback model when Qwen3.8-27B fails, by question kind", async () => {
    const before = { ...process.env };
    process.env.HF_API_KEY = "hf_test_token";
    delete process.env.GEMINI_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.GROQ_API_KEY;
    const { callSynthesisLLM } = await import("./research");
    const originalFetch = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      seen.push(body.model);
      if (body.model === "Qwen/Qwen3.8-27B") return new Response("boom", { status: 503 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    }) as any;
    const result = await callSynthesisLLM({ messages: [{ role: "user", content: "code question" }] }, "code");
    globalThis.fetch = originalFetch;
    expect(seen).toEqual(["Qwen/Qwen3.8-27B", "deepseek-ai/DeepSeek-V4-Flash-0731"]);
    expect(result.choices?.[0]?.message?.content).toBe("ok");
    process.env = before;
  });
  it("calls the hardwired vision model and passes user images through as vision input", async () => {
    const before = { ...process.env };
    process.env.HF_API_KEY = "hf_test_token";
    delete process.env.GEMINI_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.GROQ_API_KEY;
    const { callSynthesisLLM } = await import("./research");
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: any; auth: string }> = [];
    globalThis.fetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.authorization });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;
    const result = await callSynthesisLLM({ messages: [{ role: "user", content: [{ type: "text", text: "what is in this image?" }, { type: "image_url", image_url: { url: "data:image/png;base64,eHh4" } }] }] }, "vision");
    globalThis.fetch = originalFetch;
    expect(calls[0].url).toBe("https://router.huggingface.co/v1/chat/completions");
    expect(calls[0].auth).toBe("Bearer hf_test_token");
    expect(calls[0].body.model).toBe("Qwen/Qwen3.8-27B");
    expect(calls[0].body.messages[0].content[1].type).toBe("image_url");
    expect(result.choices?.[0]?.message?.content).toBe("ok");
    process.env = before;
  });
});

describe("research modes (SaaS upgrade slice)", () => {
  it("builds mode-specific query plans without fabricating templates beyond the cap", async () => {
    const { buildModeQueries } = await import("./research");
    const q = "Are retrieval-augmented models more factual than plain LLMs?";
    const quick = buildModeQueries(q, "quick");
    const deep = buildModeQueries(q, "deep");
    const academic = buildModeQueries(q, "academic");
    const verify = buildModeQueries(q, "verify");
    expect(quick.length).toBeLessThan(deep.length);
    expect(verify.some((x) => x.includes("is it true"))).toBe(true);
    expect(academic.some((x) => /systematic review|empirical study/.test(x))).toBe(true);
  });
  it("classifies claim statuses: verified, partial, and conflicting", async () => {
    const { classifyClaimStatuses } = await import("./research");
    const evidence = [
      { claim: "a", quote: "quote-a", url: "https://a.example", title: "A", supportScore: 88, qualityScore: 70, sourceId: 0 },
      { claim: "b", quote: "quote-b", url: "https://b.example", title: "B", supportScore: 61, qualityScore: 40, sourceId: 1 },
      { claim: "c", quote: "quote-c", url: "https://c.example", title: "C", supportScore: 90, qualityScore: 80, sourceId: 2 },
    ];
    const conflicts = [{ description: "mixed", supporting: [evidence[0]], contradicting: [evidence[2]] }];
    const statuses = classifyClaimStatuses(evidence, conflicts);
    expect(statuses).toEqual(["conflicting", "partial", "conflicting"]);
    expect(classifyClaimStatuses(evidence, [])).toEqual(["verified", "partial", "verified"]);
  });
});

describe("extractive fallback (no-card mode)", () => {
  it("composes a cited digest from passages when no synthesis model is configured", async () => {
    const { extractiveFallbackAnswer, synthesisModelConfigured } = await import("./research");
    expect(synthesisModelConfigured()).toBe(false);
    const evidence = [
      { claim: "rag", quote: "Retrieval-augmented generation grounds answers in retrieved documents.", url: "https://a.example/rag", title: "A: RAG guide", supportScore: 90, qualityScore: 80, sourceId: 0 },
      { claim: "index", quote: "A vector index retrieves the most relevant passages per query.", url: "https://b.example/vec", title: "B: Vector search", supportScore: 85, qualityScore: 75, sourceId: 1 },
      { claim: "limit", quote: "RAG reduces hallucination but depends on index quality.", url: "https://c.example/limits", title: "C: RAG limits", supportScore: 70, qualityScore: 60, sourceId: 2 },
    ];
    const answer = extractiveFallbackAnswer("What is retrieval augmented generation?", evidence, [], "quick");
    expect(answer).toContain("Extractive answer");
    expect(answer).toContain("[1]");
    expect(answer).toContain("## Direct answer");
    expect(answer).toContain("## Limitations");
    // Every sentence must come from retrieved passages — no model knowledge.
    expect(answer).not.toContain("model knowledge:");
  });

  it("quotes attached documents so no-card deployments can answer document questions", async () => {
    const { extractiveFallbackAnswer } = await import("./research");
    const doc = "The Eiffel Tower is 330 metres tall and was completed in 1889.\n\nGustave Eiffel's company designed the tower for the 1889 World's Fair.\n\nParis receives millions of visitors every year who come to see it.";
    const answer = extractiveFallbackAnswer("how tall is the eiffel tower", [], [], "quick", { contextText: doc });
    expect(answer).toContain("## From your document");
    expect(answer).toContain("330 metres");
    expect(answer).toContain("not web sources");
    expect(answer).not.toContain("[1]");
  });

  it("surfaces an honest note when images are attached without a vision model", async () => {
    const { extractiveFallbackAnswer } = await import("./research");
    const evidence = [{ claim: "x", quote: "quote-x", url: "https://x.example", title: "X", supportScore: 88, qualityScore: 70, sourceId: 0 }];
    const answer = extractiveFallbackAnswer("what is this", evidence, [], "quick", { imageAnalysisNote: "No vision model is configured on this deployment." });
    expect(answer).toContain("## Attached images");
    expect(answer).toContain("No vision model is configured");
  });

  it("includes vision-model analysis of attached images in the extractive answer", async () => {
    const { extractiveFallbackAnswer } = await import("./research");
    const evidence = [{ claim: "x", quote: "quote-x", url: "https://x.example", title: "X", supportScore: 88, qualityScore: 70, sourceId: 0 }];
    const answer = extractiveFallbackAnswer("what is this", evidence, [], "quick", { imageAnalysisText: "Image 1: A circuit diagram of a rectifier.\nText detected in the image: AC IN" });
    expect(answer).toContain("## Attached image analysis");
    expect(answer).toContain("rectifier");
    expect(answer).toContain("image evidence, not web citations");
  });

  it("references conflicts when sources disagree", async () => {
    const { extractiveFallbackAnswer } = await import("./research");
    const evidence = [
      { claim: "x", quote: "quote-x", url: "https://x.example", title: "X", supportScore: 88, qualityScore: 70, sourceId: 0 },
    ];
    const conflicts = [{ description: "sources disagree on scope", supporting: [evidence[0]], contradicting: [] }];
    const answer = extractiveFallbackAnswer("is x true?", evidence, conflicts, "verify");
    expect(answer).toContain("sources disagree on scope");
  });
});
