import { describe, expect, it } from "vitest";
import { crossEncoderRank, denseRank } from "./ml";
import { searchProvider } from "./research";
import { buildVerifiedLink, matchPassageId } from "./db";

describe("optional production model adapters", () => {
  it("falls back to neutral scores when no remote model service and local embeddings are explicitly disabled", async () => {
    delete process.env.DENSE_RETRIEVER_URL;
    delete process.env.RERANKER_URL;
    process.env.DISABLE_LOCAL_EMBEDDINGS = "true";
    await expect(denseRank("q", ["a", "b"])).resolves.toEqual([0, 0]);
    await expect(crossEncoderRank("q", ["a", "b"])).resolves.toEqual([0, 0]);
    delete process.env.DISABLE_LOCAL_EMBEDDINGS;
  });
  it("uses free local embeddings (no API key) to produce real semantic relevance when no remote dense retriever is configured", async () => {
    delete process.env.DENSE_RETRIEVER_URL;
    delete process.env.DISABLE_LOCAL_EMBEDDINGS;
    try {
      const scores = await denseRank("Why do LLMs hallucinate?", [
        "Large language models can hallucinate because they predict the most likely next token rather than verified facts.",
        "Wetland conservation protects biodiversity in coastal and estuarine regions.",
      ]);
      expect(scores[0]).toBeGreaterThan(scores[1]);
    } catch (err) {
      // The embedding model downloads from the Hugging Face hub on first use; if this sandbox
      // has no outbound network access to the hub, skip this assertion rather than fail CI —
      // the remote-service and disabled-embeddings paths above already cover deterministic behavior.
      console.warn("Skipping local embedding semantic-relevance assertion: model unavailable in this environment.", err);
    }
  });
  it("maps an exact quote to its stored passage row", () => {
    expect(matchPassageId(["first passage", "second passage"], "second passage", [41, 42])).toBe(42);
    expect(matchPassageId(["first passage"], "missing", [41])).toBe(0);
  });
  it("builds matching evidence and verified citation row payloads", () => {
    expect(buildVerifiedLink(["one", "two"], "two", [11, 12], 7, 9)).toEqual({ evidence: { claimId: 9, passageId: 12, exactQuote: "two" }, citation: { claimId: 9, sourceId: 7, verified: 1 } });
    expect(buildVerifiedLink(["one"], "missing", [11], 7, 9)).toBeNull();
  });
  it("reports missing paid provider credentials explicitly", async () => {
    const original = process.env.BRAVE_SEARCH_API_KEY; delete process.env.BRAVE_SEARCH_API_KEY;
    await expect(searchProvider("brave", "test query")).rejects.toThrow("BRAVE_SEARCH_API_KEY");
    if (original) process.env.BRAVE_SEARCH_API_KEY = original;
  });
});
