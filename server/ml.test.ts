import { describe, expect, it } from "vitest";
import { crossEncoderRank, denseRank } from "./ml";
import { searchProvider } from "./research";
import { buildVerifiedLink, matchPassageId } from "./db";

describe("optional production model adapters", () => {
  it("falls back to neutral scores when model services are not configured", async () => {
    delete process.env.DENSE_RETRIEVER_URL; delete process.env.RERANKER_URL;
    await expect(denseRank("q", ["a", "b"])).resolves.toEqual([0, 0]);
    await expect(crossEncoderRank("q", ["a", "b"])).resolves.toEqual([0, 0]);
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
