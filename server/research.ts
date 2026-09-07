import { invokeLLM } from "./_core/llm";
import { crossEncoderRank, denseRank } from "./ml";
import { providerRegistry, providersForIntent } from "./providers/registry";

export type ProviderName = "brave" | "tavily" | "semanticScholar" | "crossref" | "openalex" | "europePmc" | "wikipedia" | "arxiv" | "github" | "stackExchange" | "openLibrary" | "wikidata" | "worldBank" | "dataGov";
export type ResearchProgress = { stage: string; detail: string; at: number };
export type SearchHit = { title: string; url: string; snippet: string; published?: string; author?: string; provider: ProviderName };
export type SourceRecord = SearchHit & { canonicalUrl: string; domain: string; sourceType: string; qualityScore: number; content: string; passages: string[]; relevance?: number };
export type EvidenceRecord = { claim: string; quote: string; url: string; title: string; supportScore: number; qualityScore: number; sourceId: number };

const env = (key: string) => process.env[key]?.trim();
const maxQueries = Math.min(Number(env("MAX_SEARCH_QUERIES") || 8), 20);
const maxSources = Math.min(Number(env("MAX_SOURCES") || 24), 50);
const timeoutMs = Math.min(Number(env("RESEARCH_TIMEOUT_MS") || 15000), 30000);

export function canonicalizeUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = "";
  ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid"].forEach((p) => u.searchParams.delete(p));
  return u.toString().replace(/\/$/, "");
}

function assertSafeUrl(raw: string) {
  const u = new URL(raw);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only HTTP(S) sources are permitted.");
  if (u.username || u.password) throw new Error("Credential-bearing URLs are not permitted.");
  const host = u.hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host) || host.endsWith(".local")) throw new Error("Private network URLs are not permitted.");
  if (/^(10|127)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error("Private network URLs are not permitted.");
}

async function requestText(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { const res = await fetch(url, { ...init, signal: controller.signal, headers: { accept: "application/atom+xml,text/plain", ...(init?.headers || {}) } }); if (!res.ok) throw new Error(`Provider returned HTTP ${res.status}`); return await res.text(); } finally { clearTimeout(timer); }
}

async function requestJson(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, headers: { accept: "application/json", ...(init?.headers || {}) } });
    if (!res.ok) throw new Error(`Provider returned HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

export async function searchProvider(provider: ProviderName, query: string): Promise<SearchHit[]> {
  const knowledgeProvider = providerRegistry.get(provider);
  if (knowledgeProvider) {
    const results = await knowledgeProvider.search(query, 10);
    return results.map((result) => ({ title: result.title, url: result.url, snippet: result.snippet, published: result.published, author: result.author, provider }));
  }
  if (provider === "wikipedia") {
    const data = await requestJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`);
    return (data.query?.search || []).slice(0, 10).map((x: any) => ({ title: x.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/ /g, "_"))}`, snippet: (x.snippet || "").replace(/<[^>]+>/g, ""), provider }));
  }
  if (provider === "openalex") {
    const data = await requestJson(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=10&select=title,doi,publication_year,authorships,abstract_inverted_index`);
    return (data.results || []).map((x: any) => ({ title: x.title || "OpenAlex work", url: x.doi || x.id, snippet: x.abstract_inverted_index ? Object.keys(x.abstract_inverted_index).slice(0, 80).join(" ") : "", published: x.publication_year ? String(x.publication_year) : undefined, author: x.authorships?.map((a: any) => a.author?.display_name).filter(Boolean).join(", "), provider }));
  }
  if (provider === "europePmc") {
    const data = await requestJson(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&pageSize=10&resultType=core`);
    return (data.resultList?.result || []).map((x: any) => ({ title: x.title || "Europe PMC article", url: x.fullTextUrlList?.fullTextUrl?.[0]?.url || `https://europepmc.org/article/${x.source}/${x.id}`, snippet: x.abstractText || "", published: x.firstPublicationDate, author: x.authorString, provider }));
  }
  if (provider === "arxiv") {
    const xml = await requestText(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=10`);
    const entries = xml.split("<entry>").slice(1, 11);
    const between = (input: string, start: string, end: string) => { const a = input.indexOf(start); if (a < 0) return ""; const b = input.indexOf(end, a + start.length); return b < 0 ? "" : input.slice(a + start.length, b).replace(/[[:space:]]+/g, " ").trim(); };
    return entries.map((entry) => ({ title: between(entry, "<title>", "</title>") || `arXiv result for ${query}`, url: between(entry, "<id>", "</id>") || `https://arxiv.org/search/?query=${encodeURIComponent(query)}&searchtype=all`, snippet: between(entry, "<summary>", "</summary>"), published: between(entry, "<published>", "</published>"), provider }));
  }
  if (provider === "brave") {
    const key = env("BRAVE_SEARCH_API_KEY");
    if (!key) throw new Error("Brave Search is unavailable: BRAVE_SEARCH_API_KEY is not configured.");
    const data = await requestJson(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`, { headers: { "X-Subscription-Token": key } });
    return (data.web?.results || []).map((x: any) => ({ title: x.title, url: x.url, snippet: x.description || "", published: x.age, provider }));
  }
  if (provider === "tavily") {
    const key = env("TAVILY_API_KEY");
    if (!key) throw new Error("Tavily is unavailable: TAVILY_API_KEY is not configured.");
    const data = await requestJson("https://api.tavily.com/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: key, query, search_depth: "advanced", max_results: 10, include_answer: false }) });
    return (data.results || []).map((x: any) => ({ title: x.title, url: x.url, snippet: x.content || "", published: x.published_date, provider }));
  }
  if (provider === "semanticScholar") {
    const data = await requestJson(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=10&fields=title,url,abstract,year,authors,venue`);
    return (data.data || []).map((x: any) => ({ title: x.title, url: x.url || `https://www.semanticscholar.org/paper/${x.paperId}`, snippet: x.abstract || "", published: x.year ? String(x.year) : undefined, author: x.authors?.map((a: any) => a.name).join(", "), provider }));
  }
  const data = await requestJson(`https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=10&select=title,URL,abstract,published,author`);
  return (data.message?.items || []).map((x: any) => ({ title: x.title?.[0] || "Untitled work", url: x.URL, snippet: (x.abstract || "").replace(/<[^>]+>/g, ""), published: x.published?.["date-parts"]?.[0]?.join("-"), author: x.author?.map((a: any) => `${a.given || ""} ${a.family || ""}`).join(", "), provider }));
}

export function classifySource(domain: string, provider: ProviderName): string {
  if (["semanticScholar", "crossref", "openalex", "europePmc", "arxiv"].includes(provider)) return "Academic Paper";
  if (/\.gov$|\.gov\./.test(domain)) return "Government";
  if (/docs\.|developer\./.test(domain)) return "Official Documentation";
  if (/arxiv\.org|deepmind|openai|anthropic|microsoft\.com/.test(domain)) return "Research Organization";
  if (/nytimes|reuters|bbc|apnews|theguardian/.test(domain)) return "Reputable News";
  if (/medium|substack|blog/.test(domain)) return "Personal or Company Blog";
  return "Web Source";
}

// Stopwords excluded when measuring how much of the question's meaningful vocabulary
// a fetched page actually contains. Kept intentionally small and domain-agnostic.
const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "do", "does", "did", "in", "on", "at", "of",
  "to", "for", "and", "or", "but", "how", "why", "what", "when", "where", "who", "which",
  "this", "that", "these", "those", "with", "from", "by", "as", "be", "it", "its", "can",
  "could", "should", "would", "will", "shall", "not", "no", "there", "their", "than",
]);

// Crude suffix-stripping so "hallucinate" still matches "hallucination"/"hallucinations" in
// page text without pulling in a full stemming library. Only applied to longer words, where
// morphological variation is common; short words are matched exactly.
function stem(term: string): string {
  if (term.length < 6) return term;
  return term.slice(0, Math.max(4, Math.round(term.length * 0.75)));
}

// Real query-to-document relevance signal (0-5), used both to filter out off-topic fetched
// pages entirely and to drive scoreSource. Without this, every result from a given provider
// received an identical flat score regardless of whether it actually discussed the question.
// Wikipedia (and similar wikis) tag suspected-AI-written articles with cleanup banners whose
// own text literally contains words like "LLMs" and "hallucinated" (e.g. "vocab distribution
// typical of 2023-24 LLMs", "may include hallucinated information or fictitious references").
// That boilerplate has nothing to do with the article's topic but will false-positive-match any
// question about AI/LLMs under naive keyword matching, so it's stripped before scoring content.
const BOILERPLATE_PATTERNS = [
  /this article may (?:have been generated|include text generated)[^.]*\./gi,
  /vocab distribution typical of [^)]*\)/gi,
  /learn how and when to remove this message\)?/gi,
  /may include hallucinated information[^.]*\./gi,
  /WP:AISIGNS/gi,
];

function stripBoilerplate(content: string): string {
  return BOILERPLATE_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, " "), content);
}

export function queryContentRelevance(query: string, content: string): number {
  const terms = Array.from(new Set(query.toLowerCase().split(/\W+/).filter((t) => t.length > 2 && !STOPWORDS.has(t))));
  if (!terms.length) return 2.5;
  const lower = stripBoilerplate(content).toLowerCase();
  const matched = terms.filter((term) => lower.includes(stem(term))).length;
  return (matched / terms.length) * 5;
}

export function scoreSource(hit: SearchHit, domain: string, relevance = 0): number {
  let score = 30 + Math.round(Math.min(relevance, 5) * 6);
  if (hit.provider === "semanticScholar" || hit.provider === "crossref" || hit.provider === "arxiv" || hit.provider === "openalex" || hit.provider === "europePmc") score += 20;
  if (/\.gov$|\.edu$|docs\.|developer\./.test(domain)) score += 14;
  if (hit.author) score += 3;
  if (hit.published) score += 2;
  return Math.max(5, Math.min(score, 98));
}

// ---------------------------------------------------------------------------
// Single synthesis backend (like Perplexity: one model, no user-facing choice)
//
// meta-models/Muse-Glimmer-30B is an image-text-to-text model served through
// Hugging Face Inference Providers. It is never trained or hosted here; it is
// called as a remote service with the only required secret being HF_API_KEY.
// User-attached images are passed to it as vision input. If the key is absent
// the call fails explicitly rather than substituting generated content.

// Internal model routing (the user never picks a model — the pipeline picks one):
// trending top HF models served through Inference Providers, with automatic cascade.
const SYNTHESIS_ENDPOINT = "https://router.huggingface.co/v1/chat/completions";
const SYNTHESIS_MODELS: Record<"vision" | "code" | "general", string[]> = {
  vision: ["zai-org/GLM-5.3-Flash", "meta-models/Muse-Glimmer-30B"], // image-text-to-text
  code: ["deepseek-ai/DeepSeek-V4-Flash-0731", "zai-org/GLM-5.3"], // technical/code answers
  general: ["zai-org/GLM-5.3", "deepseek-ai/DeepSeek-V4-Flash-0731"],
};

export function synthesisModelConfigured(): boolean {
  return Boolean(env("HF_API_KEY"));
}

export async function callSynthesisLLM(params: Parameters<typeof invokeLLM>[0], kind: "vision" | "code" | "general" = "general"): Promise<Awaited<ReturnType<typeof invokeLLM>>> {
  const apiKey = env("HF_API_KEY");
  if (!apiKey) throw new Error("Synthesis model is not configured: HF_API_KEY is missing. No answer was generated.");
  const candidates = SYNTHESIS_MODELS[kind];
  const failures: string[] = [];
  for (const model of candidates) {
    try {
      const res = await fetch(SYNTHESIS_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: params.messages, temperature: 0.2 }),
        signal: AbortSignal.timeout(Math.max(timeoutMs, 120000)),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        failures.push(`${model} returned HTTP ${res.status}: ${detail}`);
        continue;
      }
      const data = (await res.json()) as Awaited<ReturnType<typeof invokeLLM>>;
      const rawContent = data.choices?.[0]?.message?.content;
      const content = typeof rawContent === "string" ? rawContent : Array.isArray(rawContent) ? rawContent.map((part) => typeof part === "string" ? part : "text" in part ? part.text : "").join("") : "";
      if (!content.trim()) {
        // Reasoning models can exhaust tokens on hidden reasoning and return null content — cascade instead of answering blank.
        failures.push(`${model} returned an empty answer (reasoning did not complete)`);
        continue;
      }
      return data;
    } catch (error) {
      failures.push(`${model}: ${error instanceof Error ? error.message : "request failed"}`);
    }
  }
  throw new Error(`All synthesis models failed for this ${kind} question (${candidates.join(" -> ")}): ${failures.join("; ")}`);
}

// Summarize page-fetch failures so operators can see WHY sources were dropped
// instead of a silent all-null result (transparency: completed actions only).
function summarizeFetchFailures(failures: string[]): string {
  const counts = new Map<string, number>();
  for (const failure of failures) {
    const reason = failure.replace(/^[^:]+: /, "");
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([reason, count]) => `${count} ${reason}`).join(", ");
}

async function fetchReadable(hit: SearchHit, question: string, failures?: string[]): Promise<SourceRecord | null> {
  try {
    assertSafeUrl(hit.url);
    const canonicalUrl = canonicalizeUrl(hit.url);
    const domain = new URL(canonicalUrl).hostname;
    const res = await fetch(canonicalUrl, { signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "TruthSearch/1.0 (research; contact project owner)" } });
    if (!res.ok) { failures?.push(`${domain}: blocked or error (HTTP ${res.status})`); return null; }
    const type = res.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("text/plain") && !type.includes("application/json")) { failures?.push(`${domain}: unsupported content-type`); return null; }
    const raw = (await res.text()).slice(0, 120000);
    const content = raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, " ").replace(/\s+/g, " ").trim();
    if (content.length < 80) { failures?.push(`${domain}: no readable text`); return null; }
    const u = new URL(canonicalUrl);
    const passages = content.match(/.{1,900}(?:[.!?]|$)/g)?.map((x) => x.trim()).filter((x) => x.length > 100).slice(0, 30) || [content.slice(0, 900)];
    const relevance = queryContentRelevance(question, `${hit.title} ${hit.snippet} ${content}`);
    return { ...hit, canonicalUrl, domain: u.hostname, sourceType: classifySource(u.hostname, hit.provider), qualityScore: scoreSource(hit, u.hostname, relevance), content, passages, relevance };
  } catch (error) { failures?.push(`${new URL(hit.url).hostname}: ${error instanceof Error ? error.name === "TimeoutError" ? "timed out" : error.message.slice(0, 60) : "fetch failed"}`); return null; }
}

export function classifyIntent(question: string): string {
  const q = question.toLowerCase();
  if (/\b(dataset|data source|open data|indicator|statistics)\b/.test(q)) return "dataset";
  if (/\b(book|textbook|reading list|isbn)\b/.test(q)) return "books";
  if (/\b(course|tutorial|learn|beginner|lesson|education)\b/.test(q)) return "education";
  if (/\bpython|javascript|typescript|rust|java|postgres|docker|kubernetes|programming|code|api\b/.test(q)) return "programming";
  if (/\bdocs?|documentation|reference|how does .* work\b/.test(q)) return "documentation";
  if (/\bgovernment|gdp|population|health|economy|country\b/.test(q)) return "government";
  if (/\bpaper|study|research|systematic review|academic\b/.test(q)) return "academic_research";
  return "general_research";
}

export function makeQueries(question: string, academic = false): string[] {
  const clean = question.replace(/[^a-zA-Z0-9\s?.,'\-]/g, " ").trim().slice(0, 500);
  const queries = [clean, `${clean} latest evidence`, `${clean} limitations and disagreement`];
  if (academic) queries.push(`${clean} systematic review`, `${clean} empirical study`);
  return Array.from(new Set(queries)).slice(0, maxQueries);
}

// Real BM25 (Okapi) instead of a flat "does this term appear at all" count. IDF is computed
// over the passage set itself so rare/distinctive query terms carry more weight than common
// ones, and term-frequency saturation + document-length normalization keep long passages from
// automatically outranking short, precise ones.
export function bm25Like(query: string, passages: string[]): number[] {
  const k1 = 1.5;
  const b = 0.75;
  const tokenize = (s: string) => s.toLowerCase().split(/\W+/).filter(Boolean);
  const queryTerms = Array.from(new Set(tokenize(query)));
  const docs = passages.map(tokenize);
  const docLens = docs.map((d) => d.length || 1);
  const avgLen = docLens.reduce((sum, len) => sum + len, 0) / (docLens.length || 1);
  const docCount = docs.length || 1;
  const idf = new Map<string, number>();
  queryTerms.forEach((term) => {
    const docsWithTerm = docs.filter((d) => d.includes(term)).length;
    idf.set(term, Math.log(1 + (docCount - docsWithTerm + 0.5) / (docsWithTerm + 0.5)));
  });
  return docs.map((doc, i) =>
    queryTerms.reduce((score, term) => {
      const termFreq = doc.filter((word) => word === term).length;
      if (!termFreq) return score;
      const numerator = termFreq * (k1 + 1);
      const denominator = termFreq + k1 * (1 - b + (b * docLens[i]) / (avgLen || 1));
      return score + (idf.get(term) || 0) * (numerator / denominator);
    }, 0)
  );
}

export function reciprocalRankFusion(rankings: number[][]): number[] {
  const size = Math.max(...rankings.flat(), -1) + 1;
  const scores = Array.from({ length: size }, () => 0);
  rankings.forEach((ranking) => ranking.forEach((item, rank) => { scores[item] = (scores[item] || 0) + 1 / (60 + rank + 1); }));
  return scores;
}

export function rankEvidence(evidence: EvidenceRecord[], denseScores: number[], rerankScores: number[]) {
  const lexicalOrder = evidence.map((_, i) => i).sort((a, b) => evidence[b].supportScore - evidence[a].supportScore);
  const denseOrder = evidence.map((_, i) => i).sort((a, b) => (denseScores[b] || 0) - (denseScores[a] || 0));
  const rerankOrder = evidence.map((_, i) => i).sort((a, b) => (rerankScores[b] || 0) - (rerankScores[a] || 0));
  const fusedScores = reciprocalRankFusion([lexicalOrder, denseOrder, rerankOrder]);
  return evidence.map((e, i) => ({ ...e, supportScore: e.supportScore + fusedScores[i] * 100 })).sort((a, b) => b.supportScore - a.supportScore);
}

export function verifyEvidence(evidence: EvidenceRecord[], sources: SourceRecord[]) {
  return evidence.filter((item) => { const source = sources[item.sourceId]; if (!source) return false; try { assertSafeUrl(item.url); } catch { return false; } return item.quote.length >= 40 && source.content.includes(item.quote) && item.supportScore >= 56; });
}

export function detectContradictions(evidence: EvidenceRecord[]) {
  const positive = evidence.filter((e) => /\b(improv|reduc|increase|effective|benefit|better|significant positive)\w*/i.test(e.quote) && !/\b(no|not|never|without)\s+(?:significant\s+)?(?:improv|benefit|effect)/i.test(e.quote));
  const negative = evidence.filter((e) => /\b(no significant|not improve|ineffective|limitation|failure|worse|insufficient|uncertain|mixed evidence)\b/i.test(e.quote));
  if (!positive.length || !negative.length) return [];
  return [{ description: "Retrieved sources contain both supportive and limiting language. Evidence is mixed and should be interpreted in context.", supporting: positive.slice(0, 2), contradicting: negative.slice(0, 2) }];
}

export function auditCitationReferences(answer: string, evidenceCount: number) {
  const references = Array.from(answer.matchAll(/\[(\d+)\]/g)).map((match) => Number(match[1]));
  const invalid = references.filter((reference) => reference < 1 || reference > evidenceCount);
  const factualLines = answer.split(/\n+/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && !/^[-*]\s*$/.test(line));
  const citedLines = factualLines.filter((line) => /\[\d+\]/.test(line));
  return {
    references: Array.from(new Set(references)),
    invalidReferences: Array.from(new Set(invalid)),
    citationCoverage: factualLines.length ? citedLines.length / factualLines.length : 0,
  };
}

function extractEvidence(question: string, sources: SourceRecord[]): EvidenceRecord[] {
  const all = sources.flatMap((s, sourceId) => s.passages.slice(0, 8).map((quote) => ({ quote, source: s, sourceId })));
  const scores = bm25Like(question, all.map((x) => x.quote));
  return all.map((x, i) => ({ claim: x.quote.split(/[.!?]/)[0].trim(), quote: x.quote, url: x.source.canonicalUrl, title: x.source.title, supportScore: Math.min(96, 48 + scores[i] * 8), qualityScore: x.source.qualityScore, sourceId: x.sourceId })).filter((x) => x.supportScore >= 56).sort((a, b) => (b.supportScore + b.qualityScore) - (a.supportScore + a.qualityScore)).slice(0, 12);
}

export type UserAttachments = { contextText?: string; imageUrls?: string[] };

export async function conductResearch(question: string, onProgress: (p: ResearchProgress) => void, userAttachments?: UserAttachments) {
  if (question.trim().length < 8 || question.length > 1200) throw new Error("Question must be between 8 and 1,200 characters.");
  const requested = env("SEARCH_PROVIDER");
  const paidEnabled = env("ENABLE_PAID_SEARCH") === "true";
  const primary = (paidEnabled && (requested === "brave" || requested === "tavily") ? requested : "wikipedia") as ProviderName;
  const academic = (env("ACADEMIC_SEARCH_PROVIDER") || "arxiv") as ProviderName;
  const intent = classifyIntent(question);
  const extraProviders = providersForIntent(intent) as ProviderName[];
  onProgress({ stage: "planning", detail: `Bounded research plan created for ${intent.replace("_", " ")} intent`, at: Date.now() });
  const queries = makeQueries(question, true);
  onProgress({ stage: "searching", detail: `Running ${queries.length} live searches across ${primary}, ${academic}, and ${extraProviders.join(", ")}`, at: Date.now() });
  const freeAcademic = [academic, "openalex", "europePmc", "crossref"] as ProviderName[];
  // Only the bare/raw question (queries[0], no generic filler appended) goes to the general-web
  // primary provider — Wikipedia's fuzzy full-text search treats extra filler words as additional
  // OR-matched terms and drifts toward unrelated pages that happen to contain them. Filler-suffixed
  // variants are routed to academic providers instead, where that phrasing is actually meaningful.
  const planned = queries.map((q, i) => ({ q, provider: i === 0 ? primary : i < 6 ? freeAcademic[(i - 1) % freeAcademic.length] : extraProviders[(i - 6) % Math.max(extraProviders.length, 1)] || "wikidata" }));
  const settled = await Promise.allSettled(planned.map(({ q, provider }) => searchProvider(provider, q)));
  const failures = settled.filter((x): x is PromiseRejectedResult => x.status === "rejected").map((x) => x.reason instanceof Error ? x.reason.message : "Provider failed");
  if (failures.length) onProgress({ stage: "provider-warning", detail: `${failures.length} provider request(s) unavailable; continuing only with completed live results`, at: Date.now() });
  const hits = settled.filter((x): x is PromiseFulfilledResult<SearchHit[]> => x.status === "fulfilled").flatMap((x) => x.value);
  if (!hits.length) onProgress({ stage: "provider-warning", detail: `All live providers were unavailable (${failures.join("; ") || "no results"}). The model will answer from its own knowledge, clearly labeled.`, at: Date.now() });
  const unique = Array.from(new Map(hits.filter((x) => x.url).map((x) => { try { return [canonicalizeUrl(x.url), x] as const; } catch { return [x.url, x] as const; } })).values()).slice(0, maxSources);
  onProgress({ stage: "fetching", detail: `Fetched ${unique.length} unique live search results; normalizing permitted public pages`, at: Date.now() });
  const fetchFailures: string[] = [];
  const sources = (await Promise.all(unique.map((hit) => fetchReadable(hit, question, fetchFailures)))).filter(Boolean) as SourceRecord[];
  if (fetchFailures.length) onProgress({ stage: "fetch-warning", detail: `${fetchFailures.length}/${unique.length} pages were not readable (${summarizeFetchFailures(fetchFailures)})`, at: Date.now() });
  if (!sources.length) onProgress({ stage: "fetch-warning", detail: `No readable public sources were retrieved (${summarizeFetchFailures(fetchFailures) || "no failures recorded"}). The model will answer from its own knowledge, clearly labeled.`, at: Date.now() });
  onProgress({ stage: "ranking", detail: "Ranking passages with real BM25 lexical retrieval, free local semantic embeddings, and reciprocal-rank fusion", at: Date.now() });
  let evidence = extractEvidence(question, sources);
  const denseScores = await denseRank(question, evidence.map((e) => e.quote));
  const rerankScores = await crossEncoderRank(question, evidence.map((e) => e.quote));
  evidence = rankEvidence(evidence, denseScores, rerankScores);
  evidence = verifyEvidence(evidence, sources);
  const conflicts = detectContradictions(evidence);
  if (!evidence.length) onProgress({ stage: "fetch-warning", detail: "Citation verification found no usable passages. The model will answer from its own knowledge, clearly labeled.", at: Date.now() });
  onProgress({ stage: "verifying", detail: `Verified ${evidence.length} exact passage citations${conflicts.length ? "; detected mixed evidence" : ""}`, at: Date.now() });
  const context = evidence.length ? evidence.map((e, i) => `[${i + 1}] ${e.quote} (Source: ${e.title} — ${e.url})`).join("\n") : "(No usable web evidence was retrieved.)";
  const technicalQuestion = intent === "programming" || intent === "documentation";
  const fromKnowledgeOnly = !evidence.length && !userAttachments?.contextText;
  const attachmentBlock = userAttachments?.contextText ? `\n\nUSER-PROVIDED DOCUMENT (context the question is about; NOT web evidence — never cite it with [n]):\n${userAttachments.contextText.slice(0, 60000)}` : "";
  const imageParts = (userAttachments?.imageUrls || []).map((url) => ({ type: "image_url" as const, image_url: { url } }));
  const instruction = `Question: ${question}${attachmentBlock}\n\nVerified evidence:\n${context}\n\n${technicalQuestion ? "This is a technical question. Answer it directly, completely, and practically from your own expertise: explain the concept, give concrete examples, and where useful include correct, runnable code. Use the retrieved evidence only where it genuinely helps, citing it with [n]; otherwise answer without citations.\n\n" : ""}${fromKnowledgeOnly ? "The retrieved web evidence is empty, so answer entirely from your own knowledge. Do NOT use [n] citations at all — there are no sources to cite.\n\n" : ""}Write a research answer with exactly these sections, in this order:\n\n## Direct answer\n2-4 sentences that directly answer the question${evidence.length ? ", with inline [n] citations" : ""}.\n\n## Why it happens — analysis\nExplain the underlying causes, mechanisms, and context behind the answer, the way a knowledgeable person would explain it to a curious reader: what drives the phenomenon, how the pieces connect, and what it means in practice. Reason across the evidence instead of only restating quotes. Every factual statement from web research must cite [n].\n\n## Evidence and sources\nThe strongest retrieved evidence that supports the analysis, cited inline.\n\n## Conflicting evidence\nOnly if the retrieved sources disagree or the evidence is mixed; otherwise state that retrieved sources are consistent.\n\n## Limitations\nWhat the retrieved evidence cannot answer, and how current or complete it is.\n\n## Conclusion\n2-3 closing sentences with citations.\n\n## Suggested follow-up questions\nExactly three questions a reader would naturally ask next, one per line, each on its own as a list item.${imageParts.length ? " The user attached image(s) as visual context; describe what is relevant to the question and clearly separate what comes from the images versus the cited web evidence." : ""}`;
  const userMessageContent: any = imageParts.length ? [{ type: "text", text: instruction }, ...imageParts] : instruction;
  const response = await callSynthesisLLM({ messages: [{ role: "system", content: "You are a research analyst. You write answers that research like a search engine and explain like a teacher: direct, then causal — what happens, why it happens, and what it means. Every factual sentence that comes from the retrieved evidence must cite [n]. If the retrieved evidence does not answer part of the question, fill the gap from your own knowledge and mark those sentences inline with 'model knowledge' so the reader can tell what is sourced and what is not. If evidence conflicts, explicitly say evidence is mixed. Never invent URLs, sources, citations, or fake [n] references, and never present model-knowledge claims as cited facts. Do not reveal private reasoning." }, { role: "user", content: userMessageContent }] }, imageParts.length ? "vision" : technicalQuestion ? "code" : "general");
  const answer = typeof response.choices?.[0]?.message?.content === "string" ? response.choices[0].message.content : "The answer generator did not return usable content.";
  const citationAudit = auditCitationReferences(answer, evidence.length);
  if (citationAudit.invalidReferences.length) throw new Error(`Answer contained invalid citation reference(s): ${citationAudit.invalidReferences.join(", ")}`);
  const answerProvenance: "cited_sources" | "model_knowledge" | "technical_direct" = fromKnowledgeOnly ? "model_knowledge" : technicalQuestion ? "technical_direct" : "cited_sources";
  const finalAnswer = fromKnowledgeOnly
    ? `> **Answered from the model\u2019s knowledge** — web research found no usable sources for this question, so nothing here is web-cited. Verify important facts independently.\n\n${answer}`
    : answer;
  onProgress({ stage: "completed", detail: evidence.length ? `Citations verified against retrieved URLs (${answerProvenance === "technical_direct" ? "technical question — answered with model expertise plus evidence" : "evidence-backed"})` : "Answered from model knowledge (labeled)", at: Date.now() });
  const citedSourceIds = new Set(evidence.map((e) => e.sourceId));
  const citedSources = sources.filter((_, sourceId) => citedSourceIds.has(sourceId));
  return { answer: finalAnswer, plan: { question, queries, providers: Array.from(new Set(planned.map((x) => x.provider))), bounded: true, evidence, conflicts, citationAudit, answerProvenance }, sources: citedSources, evidence, conflicts, citationAudit, progress: [] as ResearchProgress[] };
}
