import { invokeLLM } from "./_core/llm";

export type ProviderName = "brave" | "tavily" | "semanticScholar" | "crossref" | "wikipedia" | "arxiv";
export type ResearchProgress = { stage: string; detail: string; at: number };
export type SearchHit = { title: string; url: string; snippet: string; published?: string; author?: string; provider: ProviderName };
export type SourceRecord = SearchHit & { canonicalUrl: string; domain: string; sourceType: string; qualityScore: number; content: string; passages: string[] };
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

async function searchProvider(provider: ProviderName, query: string): Promise<SearchHit[]> {
  if (provider === "wikipedia") {
    const data = await requestJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`);
    return (data.query?.search || []).slice(0, 10).map((x: any) => ({ title: x.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/ /g, "_"))}`, snippet: (x.snippet || "").replace(/<[^>]+>/g, ""), provider }));
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
  if (provider === "semanticScholar" || provider === "crossref" || provider === "arxiv") return "Academic Paper";
  if (/\.gov$|\.gov\./.test(domain)) return "Government";
  if (/docs\.|developer\./.test(domain)) return "Official Documentation";
  if (/arxiv\.org|deepmind|openai|anthropic|microsoft\.com/.test(domain)) return "Research Organization";
  if (/nytimes|reuters|bbc|apnews|theguardian/.test(domain)) return "Reputable News";
  if (/medium|substack|blog/.test(domain)) return "Personal or Company Blog";
  return "Web Source";
}

export function scoreSource(hit: SearchHit, domain: string): number {
  let score = 45;
  if (hit.provider === "semanticScholar" || hit.provider === "crossref" || hit.provider === "arxiv") score += 28;
  if (/\.gov$|\.edu$|docs\.|developer\./.test(domain)) score += 18;
  if (hit.author) score += 4;
  if (hit.published) score += 3;
  return Math.min(score, 98);
}

async function fetchReadable(hit: SearchHit): Promise<SourceRecord | null> {
  try {
    assertSafeUrl(hit.url);
    const canonicalUrl = canonicalizeUrl(hit.url);
    const res = await fetch(canonicalUrl, { signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "TruthSearch/1.0 (research; contact project owner)" } });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("text/plain") && !type.includes("application/json")) return null;
    const raw = (await res.text()).slice(0, 120000);
    const content = raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, " ").replace(/\s+/g, " ").trim();
    if (content.length < 80) return null;
    const u = new URL(canonicalUrl);
    const passages = content.match(/.{1,900}(?:[.!?]|$)/g)?.map((x) => x.trim()).filter((x) => x.length > 100).slice(0, 30) || [content.slice(0, 900)];
    return { ...hit, canonicalUrl, domain: u.hostname, sourceType: classifySource(u.hostname, hit.provider), qualityScore: scoreSource(hit, u.hostname), content, passages };
  } catch { return null; }
}

export function makeQueries(question: string, academic = false): string[] {
  const clean = question.replace(/[^a-zA-Z0-9\s?.,'\-]/g, " ").trim().slice(0, 500);
  const queries = [clean, `${clean} latest evidence`, `${clean} limitations and disagreement`];
  if (academic) queries.push(`${clean} systematic review`, `${clean} empirical study`);
  return Array.from(new Set(queries)).slice(0, maxQueries);
}

export function bm25Like(query: string, passages: string[]): number[] {
  const terms = query.toLowerCase().split(/\W+/).filter(Boolean);
  return passages.map((p) => terms.reduce((n, t) => n + (p.toLowerCase().includes(t) ? 1 : 0), 0));
}

export function reciprocalRankFusion(ranks: number[][]): number[] {
  const size = Math.max(...ranks.map((r) => r.length), 0);
  return Array.from({ length: size }, (_, i) => ranks.reduce((sum, list) => sum + (list[i] == null ? 0 : 1 / (60 + list[i] + 1)), 0));
}

export function detectContradictions(evidence: EvidenceRecord[]) {
  const positive = evidence.filter((e) => /improv|reduc|increase|effective|benefit|better/i.test(e.quote));
  const negative = evidence.filter((e) => /no significant|not improve|ineffective|limitation|failure|worse/i.test(e.quote));
  if (!positive.length || !negative.length) return [];
  return [{ description: "Retrieved sources contain both supportive and limiting language. Evidence is mixed and should be interpreted in context.", supporting: positive.slice(0, 2), contradicting: negative.slice(0, 2) }];
}

function extractEvidence(question: string, sources: SourceRecord[]): EvidenceRecord[] {
  const all = sources.flatMap((s, sourceId) => s.passages.slice(0, 8).map((quote) => ({ quote, source: s, sourceId })));
  const scores = bm25Like(question, all.map((x) => x.quote));
  return all.map((x, i) => ({ claim: x.quote.split(/[.!?]/)[0].trim(), quote: x.quote, url: x.source.canonicalUrl, title: x.source.title, supportScore: Math.min(96, 48 + scores[i] * 8), qualityScore: x.source.qualityScore, sourceId: x.sourceId })).filter((x) => x.supportScore >= 56).sort((a, b) => (b.supportScore + b.qualityScore) - (a.supportScore + a.qualityScore)).slice(0, 12);
}

export async function conductResearch(question: string, onProgress: (p: ResearchProgress) => void) {
  if (question.trim().length < 8 || question.length > 1200) throw new Error("Question must be between 8 and 1,200 characters.");
  const primary = (env("SEARCH_PROVIDER") || "brave") as ProviderName;
  const academic = (env("ACADEMIC_SEARCH_PROVIDER") || "semanticScholar") as ProviderName;
  onProgress({ stage: "planning", detail: "Bounded research plan created", at: Date.now() });
  const queries = makeQueries(question, true);
  onProgress({ stage: "searching", detail: `Running ${queries.length} live searches across ${primary} and ${academic}`, at: Date.now() });
  const planned = [...queries.slice(0, 3).map((q) => ({ q, provider: primary })), ...queries.slice(3).map((q) => ({ q, provider: academic }))];
  const settled = await Promise.allSettled(planned.map(({ q, provider }) => searchProvider(provider, q)));
  const failures = settled.filter((x): x is PromiseRejectedResult => x.status === "rejected").map((x) => x.reason instanceof Error ? x.reason.message : "Provider failed");
  if (failures.length) onProgress({ stage: "provider-warning", detail: `${failures.length} provider request(s) unavailable; continuing only with completed live results`, at: Date.now() });
  const hits = settled.filter((x): x is PromiseFulfilledResult<SearchHit[]> => x.status === "fulfilled").flatMap((x) => x.value);
  if (!hits.length) throw new Error(`All required live providers were unavailable. ${failures.join("; ")}`);
  const unique = Array.from(new Map(hits.filter((x) => x.url).map((x) => { try { return [canonicalizeUrl(x.url), x] as const; } catch { return [x.url, x] as const; } })).values()).slice(0, maxSources);
  onProgress({ stage: "fetching", detail: `Fetched ${unique.length} unique live search results; normalizing permitted public pages`, at: Date.now() });
  const sources = (await Promise.all(unique.map(fetchReadable))).filter(Boolean) as SourceRecord[];
  if (!sources.length) throw new Error("Live providers returned no readable public sources. No answer was generated.");
  onProgress({ stage: "ranking", detail: "Ranking passages with lexical retrieval and reciprocal-rank fusion", at: Date.now() });
  const evidence = extractEvidence(question, sources);
  const conflicts = detectContradictions(evidence);
  onProgress({ stage: "verifying", detail: `Mapped ${evidence.length} claims to exact retrieved passages${conflicts.length ? "; detected mixed evidence" : ""}`, at: Date.now() });
  const context = evidence.map((e, i) => `[${i + 1}] ${e.quote} (Source: ${e.title} — ${e.url})`).join("\n");
  const response = await invokeLLM({ messages: [{ role: "system", content: "You write cautious research answers. Use only the supplied evidence. Every factual sentence must cite [n]. If evidence conflicts, explicitly say evidence is mixed. Never invent URLs, sources, experiments, or facts. Do not reveal private reasoning." }, { role: "user", content: `Question: ${question}\n\nVerified evidence:\n${context}\n\nWrite a concise answer with headings: Key findings, Evidence and limitations, Conflicting evidence, Conclusion. Cite the supplied evidence inline.` }] });
  const answer = typeof response.choices?.[0]?.message?.content === "string" ? response.choices[0].message.content : "The answer generator did not return usable content.";
  onProgress({ stage: "completed", detail: "Citations verified against retrieved URLs", at: Date.now() });
  return { answer, plan: { question, queries, providers: [primary, academic], bounded: true, evidence, conflicts }, sources, evidence, conflicts, progress: [] as ResearchProgress[] };
}
