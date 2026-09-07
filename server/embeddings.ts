// Free, local, no-API-key semantic embeddings using Transformers.js (ONNX runtime).
// Model weights download once from the Hugging Face hub on first use and are cached
// in memory for the life of the process — no external service, no API key required.
//
// This exists specifically to give denseRank() in ml.ts a real semantic signal when
// no paid DENSE_RETRIEVER_URL is configured, instead of silently returning zero vectors.

type Extractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean }
) => Promise<{ tolist: () => number[][] } | number[][]>;

let extractorPromise: Promise<Extractor> | null = null;

async function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = import("@huggingface/transformers").then(({ pipeline }) =>
      pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2") as unknown as Promise<Extractor>
    );
  }
  return extractorPromise;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return typeof (output as any).tolist === "function" ? (output as any).tolist() : (output as number[][]);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom ? dot / denom : 0;
}
