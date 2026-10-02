// RAG layer for attached documents (resume analyser and general document Q&A).
//
// Architecture:
//   document text -> section-aware chunking -> hybrid retrieval
//   (BM25 lexical + local dense embeddings, fused with Reciprocal Rank Fusion)
//   -> top chunks are injected into the answer model's context / quoted in
//   extractive mode, each labeled with its resume section so answers stay
//   traceable to the part of the document they came from.

import { denseRank } from "./ml";

export type Chunk = { id: number; text: string; section: string; start: number };
export type RetrievedChunk = Chunk & { score: number; lexical: number; dense: number };

const RESUME_SECTION_HEAD = /^(professional\s+summary|summary|objective|profile|experience|work\s+experience|professional\s+experience|employment|education|academic|skills|technical\s+skills|core\s+skills|projects|certifications|achievements|awards|publications|interests|languages|volunteer|leadership|activities)\b/i;

export function isResumeLike(text: string): boolean {
  const hits = ["experience", "education", "skills", "summary", "projects"].filter((k) => new RegExp(`\\b${k}`, "i").test(text)).length;
  return hits >= 3 && /(university|college|b\.?tech|bachelor|b\.?e\.?|master|intern|engineer|developer|analyst)/i.test(text);
}

// Section-aware chunking: resume/document section headers keep their content
// together; long sections fall back to paragraph-aligned sliding windows with
// 15% overlap so sentences are not cut mid-claim.
export function chunkDocument(text: string, maxChars = 900): Chunk[] {
  const clean = text.replace(/\r/g, "").trim();
  if (!clean) return [];
  const sections: Array<{ header: string; body: string[] }> = [];
  let current = { header: "Header", body: [] as string[] };
  for (const line of clean.split("\n")) {
    const t = line.trim();
    const isHeader = t && t.length <= 60 && RESUME_SECTION_HEAD.test(t) && !/[.!?]$/.test(t);
    if (isHeader) {
      if (current.body.join("").trim()) sections.push(current);
      current = { header: t, body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.body.join("").trim()) sections.push(current);

  const chunks: Chunk[] = [];
  let id = 0;
  for (const s of sections) {
    const body = s.body.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!body) continue;
    if (body.length <= maxChars) {
      chunks.push({ id: id++, text: body, section: s.header, start: 0 });
      continue;
    }
    let offset = 0;
    while (offset < body.length && chunks.length < 300) {
      let end = Math.min(body.length, offset + maxChars);
      if (end < body.length) {
        const paraBreak = body.lastIndexOf("\n\n", end);
        if (paraBreak > offset + maxChars * 0.5) end = paraBreak;
        else {
          const lineBreak = body.lastIndexOf("\n", end);
          if (lineBreak > offset + maxChars * 0.5) end = lineBreak;
        }
      }
      const piece = body.slice(offset, end).trim();
      if (piece) chunks.push({ id: id++, text: piece, section: s.header, start: offset });
      const next = end - Math.floor(maxChars * 0.15);
      offset = next <= offset ? end : next;
    }
  }
  return chunks;
}

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/\W+/).filter(Boolean);
}

// Okapi BM25 over the chunk set (self-contained so this module has no import cycle).
export function bm25Scores(query: string, docs: string[], k1 = 1.5, b = 0.75): number[] {
  const queryTerms = Array.from(new Set(tokenize(query)));
  const tokenized = docs.map(tokenize);
  const docLens = tokenized.map((d) => d.length || 1);
  const avgLen = docLens.reduce((sum, len) => sum + len, 0) / (docLens.length || 1);
  const docCount = tokenized.length || 1;
  const idf = new Map<string, number>();
  for (const term of queryTerms) {
    const docsWithTerm = tokenized.filter((d) => d.includes(term)).length;
    idf.set(term, Math.log(1 + (docCount - docsWithTerm + 0.5) / (docsWithTerm + 0.5)));
  }
  return tokenized.map((doc, i) =>
    queryTerms.reduce((score, term) => {
      const tf = doc.filter((t) => t === term).length;
      if (!tf) return score;
      const norm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * docLens[i]) / avgLen));
      return score + (idf.get(term) || 0) * norm;
    }, 0),
  );
}

// Reciprocal Rank Fusion — merges lexical and dense rankings without needing
// comparable score scales.
export function rrf(lists: number[][], k = 60): number[] {
  const n = lists[0]?.length || 0;
  const fused = new Array(n).fill(0);
  for (const list of lists) {
    list
      .map((score, i) => ({ score, i }))
      .sort((a, b) => b.score - a.score)
      .forEach((entry, rank) => {
        fused[entry.i] += 1 / (k + rank + 1);
      });
  }
  return fused;
}

// Hybrid retrieval. Dense embeddings come from the platform's local
// transformer model (or DENSE_RETRIEVER_URL when set); any failure degrades
// gracefully to BM25-only.
export async function retrieveChunks(question: string, chunks: Chunk[], topK = 6): Promise<RetrievedChunk[]> {
  if (!chunks.length) return [];
  const texts = chunks.map((c) => c.text);
  const lexical = bm25Scores(question, texts);
  let dense = new Array(chunks.length).fill(0);
  try {
    const remote = await denseRank(question, texts);
    if (Array.isArray(remote) && remote.length === chunks.length) dense = remote;
  } catch {
    // dense embeddings are an accelerator, not a dependency
  }
  const fused = rrf([lexical, dense]);
  return chunks
    .map((c, i) => ({ ...c, score: fused[i], lexical: lexical[i], dense: dense[i] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, topK));
}

// Analysis-style questions ("analyse my resume") benefit from broader context
// than point questions ("what is his GPA") — widen topK for them.
export function wantsBroadContext(question: string): boolean {
  return /analy[sz]e|review|feedback|improve|evaluat|rate|assess|overall|summar(?:ise|ize)|strengths|weakness|gaps|ats|cover\s*letter/i.test(question);
}
