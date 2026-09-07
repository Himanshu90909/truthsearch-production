// Transformers.js is loaded lazily through a computed specifier so bundlers
// tracing static imports for serverless builds (Vercel) cannot pull the
// multi-hundred-MB ONNX runtime into the function bundle. Locally and in
// Docker the import resolves normally and semantic ranking works fully.
type EmbedModule = typeof import("./embeddings");
let embedModule: EmbedModule | null = null;
async function getEmbedModule(): Promise<EmbedModule> {
  if (!embedModule) {
    const specifier = ["./embeddings"].join("");
    embedModule = (await import(/* webpackIgnore: true */ specifier)) as EmbedModule;
  }
  return embedModule;
}

export type RankedPassage = { text: string; lexicalScore: number; denseScore?: number; rerankScore?: number };

export async function denseRank(query: string, passages: string[]): Promise<number[]> {
  const endpoint = process.env.DENSE_RETRIEVER_URL;
  if (endpoint) {
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, passages }), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Dense retriever unavailable: HTTP ${response.status}`);
    const data = (await response.json()) as { scores?: number[] };
    if (!Array.isArray(data.scores) || data.scores.length !== passages.length) throw new Error("Dense retriever returned an invalid score vector.");
    return data.scores;
  }
  if (!passages.length) return [];
  // No paid dense retriever configured: fall back to a free, local, no-API-key semantic
  // embedding model (Transformers.js) instead of silently returning zero vectors. This is
  // what actually gives the app real semantic relevance signal in the no-card deployment.
  if (process.env.DISABLE_LOCAL_EMBEDDINGS === "true") return passages.map(() => 0);
  try {
    const { embedTexts, cosineSimilarity } = await getEmbedModule();
    const [queryEmbedding, ...passageEmbeddings] = await embedTexts([query, ...passages]);
    return passageEmbeddings.map((embedding) => cosineSimilarity(queryEmbedding, embedding));
  } catch {
    return passages.map(() => 0);
  }
}

export async function crossEncoderRank(query: string, passages: string[]): Promise<number[]> {
  const endpoint = process.env.RERANKER_URL;
  if (!endpoint) return passages.map(() => 0);
  const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, passages }), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Cross-encoder reranker unavailable: HTTP ${response.status}`);
  const data = (await response.json()) as { scores?: number[] };
  if (!Array.isArray(data.scores) || data.scores.length !== passages.length) throw new Error("Cross-encoder returned an invalid score vector.");
  return data.scores;
}
