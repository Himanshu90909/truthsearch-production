import { describe, expect, it, vi } from "vitest";
import {
  bm25Scores,
  chunkDocument,
  isResumeLike,
  retrieveChunks,
  rrf,
  wantsBroadContext,
} from "./rag";
import { extractiveFallbackAnswer } from "./research";

const RESUME = `Himanshu Suthar
Data Science Student, Lovely Professional University
himanshu@example.com | linkedin.com/in/himanshu

Professional Summary
Data science student specializing in machine learning pipelines, RAG systems, and
production AI deployment. Built multi-agent systems with CrewAI and n8n.

Skills
Python, C++, Java, React.js, Node.js, SQL, Docker, AWS SageMaker, CrewAI, n8n,
Retrieval-Augmented Generation, LangChain, pandas, scikit-learn

Experience
AI Engineer Intern at Noso Labs
- Built multi-agent workflow automations for field operations businesses.
- Shipped a RAG pipeline with citation-grounded answers across 10k documents.

Projects
TruthSearch — an evidence-first AI answer engine with hybrid BM25 + dense retrieval.

Education
B.Tech Data Science, Lovely Professional University, 2028`;

const NOT_RESUME = `The quick brown fox jumps over the lazy dog. This is a general essay about
weather patterns and mountain climbing. It mentions university only in passing to
say nothing about experience or skills at all in this text.`;

describe("RAG chunking", () => {
  it("chunks a resume by section with header labels", () => {
    const chunks = chunkDocument(RESUME);
    expect(chunks.length).toBeGreaterThan(3);
    const sections = chunks.map((c) => c.section);
    expect(sections).toContain("Skills");
    expect(sections).toContain("Experience");
    expect(sections).toContain("Professional Summary");
    const skills = chunks.find((c) => c.section === "Skills");
    expect(skills?.text).toContain("Python");
  });

  it("windows long sections with overlap instead of cutting mid-line", () => {
    const long = "Projects\n" + Array.from({ length: 40 }, (_, i) => `Project number ${i} about distributed systems and latency budgets and sharding.`).join("\n");
    const chunks = chunkDocument(long, 400);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(400);
      expect(c.section).toBe("Projects");
    }
  });

  it("returns [] for empty input", () => {
    expect(chunkDocument("   ")).toEqual([]);
  });
});

describe("resume detection", () => {
  it("detects resume-like documents", () => {
    expect(isResumeLike(RESUME)).toBe(true);
    expect(isResumeLike(NOT_RESUME)).toBe(false);
  });

  it("widens retrieval for analysis-style questions", () => {
    expect(wantsBroadContext("analyse my resume and find missing keywords")).toBe(true);
    expect(wantsBroadContext("what is his gpa")).toBe(false);
  });
});

describe("hybrid retrieval", () => {
  it("retrieves the chunk that answers the question (RRF over BM25 + dense)", async () => {
    const chunks = chunkDocument(RESUME);
    const retrieved = await retrieveChunks("which internship did he do and at what company", chunks, 3);
    expect(retrieved.length).toBeGreaterThan(0);
    expect(retrieved.some((c) => /Noso Labs/.test(c.text))).toBe(true);
    expect(retrieved[0].score).toBeGreaterThan(0);
  });

  it("bm25 ranks distinctive terms higher and rrf fuses lists sanely", () => {
    const scores = bm25Scores("docker and aws", ["python python python", "docker aws kubernetes", "essays about weather"]);
    expect(scores[1]).toBeGreaterThan(scores[0]);
    expect(scores[1]).toBeGreaterThan(scores[2]);
    // doc 2 is rank-2 in list one and rank-1 in list two -> wins the fusion
    const fused = rrf([[0.9, 0.1, 0.5], [0.1, 0.2, 0.9]]);
    expect(fused[2]).toBeGreaterThan(fused[0]);
    expect(fused[0]).toBeGreaterThan(fused[1]);
  });

  it("degrades to BM25-only when dense embeddings fail", async () => {
    const chunks = chunkDocument(RESUME);
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("embeddings offline");
    }));
    const retrieved = await retrieveChunks("skills and technologies listed", chunks, 3);
    vi.stubGlobal("fetch", originalFetch);
    expect(retrieved.some((c) => c.section === "Skills")).toBe(true);
  });
});

describe("extractive resume answers use RAG chunks", () => {
  it("quotes labeled sections retrieved from the resume", async () => {
    const chunks = chunkDocument(RESUME);
    const retrieved = await retrieveChunks("what experience does he have", chunks, 3);
    const answer = extractiveFallbackAnswer("what experience does he have", [], [], "quick", { contextText: RESUME, docChunks: retrieved });
    expect(answer).toContain("## From your resume (RAG retrieval)");
    expect(answer).toContain("[Experience]");
    expect(answer).toContain("Noso Labs");
    expect(answer).toContain("no [n] citations");
  });
});
