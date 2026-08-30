import { describe, expect, it } from "vitest";
import { bm25Like, canonicalizeUrl, classifySource, detectContradictions, makeQueries, reciprocalRankFusion, scoreSource } from "./research";

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
  it("detects mixed supportive and limiting language", () => {
    const result = detectContradictions([
      { claim: "x", quote: "The method improves recall and provides a benefit.", url: "https://a.example", title: "A", supportScore: 80, qualityScore: 80, sourceId: 0 },
      { claim: "x", quote: "The study found no significant improvement and noted a limitation.", url: "https://b.example", title: "B", supportScore: 70, qualityScore: 80, sourceId: 1 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.description).toContain("mixed");
  });
  it("produces lexical scores and reciprocal rank fusion values", () => {
    expect(bm25Like("retrieval evidence", ["retrieval improves evidence", "unrelated text"])).toEqual([2, 0]);
    expect(reciprocalRankFusion([[0, 1], [0, 2]])[0]).toBeGreaterThan(reciprocalRankFusion([[0, 1], [0, 2]])[1]);
  });
});
