export type KnowledgeCategory = "academic" | "education" | "programming" | "documentation" | "books" | "video" | "datasets" | "open_knowledge" | "government";

export type ProviderResult = {
  id: string;
  title: string;
  url: string;
  source: string;
  sourceType: KnowledgeCategory;
  snippet: string;
  published?: string;
  author?: string;
  metadata?: Record<string, unknown>;
};

export type ProviderStatus = {
  name: string;
  category: KnowledgeCategory;
  enabled: boolean;
  status: "healthy" | "not_configured" | "unavailable";
  requiresKey: boolean;
  reason?: string;
};

export interface KnowledgeProvider {
  readonly name: string;
  readonly category: KnowledgeCategory;
  search(query: string, limit?: number): Promise<ProviderResult[]>;
  healthCheck(): Promise<boolean>;
  status(): ProviderStatus;
}

const env = (key: string) => process.env[key]?.trim();
const timeoutMs = Math.min(Number(env("RESEARCH_TIMEOUT_MS") || 15000), 30000);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function json(url: string, init?: RequestInit) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal, headers: { accept: "application/json", "user-agent": "TruthSearch/1.0 (public research adapter)", ...(init?.headers || {}) } });
      if (response.ok) return await response.json() as any;
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get("retry-after") || "2");
        await sleep(Math.min(Math.max(retryAfter, 1), 8) * 1000);
        continue;
      }
      throw new Error(`Provider returned HTTP ${response.status}`);
    } finally { clearTimeout(timer); }
  }
  throw new Error("Provider request exhausted its bounded retry budget.");
}

async function ok(url: string) {
  try { await json(url); return true; } catch { return false; }
}

function configuredStatus(name: string, category: KnowledgeCategory, requiresKey: boolean, configured: boolean, reason?: string): ProviderStatus {
  return { name, category, enabled: configured, status: configured ? "healthy" : "not_configured", requiresKey, ...(reason ? { reason } : {}) };
}

class GitHubProvider implements KnowledgeProvider {
  readonly name = "github"; readonly category = "programming" as const;
  status() { const token = env("GITHUB_TOKEN"); return configuredStatus(this.name, this.category, false, true, token ? "Authenticated optional; public API remains available" : "Public unauthenticated API; 60 requests/hour documented limit"); }
  async healthCheck() { return ok("https://api.github.com/rate_limit"); }
  async search(query: string, limit = 10) { const data = await json(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${Math.min(limit, 10)}`, { headers: { "user-agent": "TruthSearch/1.0", ...(env("GITHUB_TOKEN") ? { authorization: `Bearer ${env("GITHUB_TOKEN")}` } : {}) } }); return (data.items || []).map((x: any) => ({ id: x.id?.toString(), title: x.full_name, url: x.html_url, source: this.name, sourceType: this.category, snippet: x.description || "", published: x.updated_at, metadata: { stars: x.stargazers_count, language: x.language } })); }
}

class StackExchangeProvider implements KnowledgeProvider {
  readonly name = "stackExchange"; readonly category = "programming" as const;
  status() { return configuredStatus(this.name, this.category, false, true, "Public Stack Exchange API; honors quota_max and quota_remaining"); }
  async healthCheck() { return ok("https://api.stackexchange.com/2.3/info?site=stackoverflow"); }
  async search(query: string, limit = 10) { const data = await json(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=${Math.min(limit, 10)}`); return (data.items || []).map((x: any) => ({ id: x.question_id?.toString(), title: x.title, url: x.link, source: this.name, sourceType: this.category, snippet: `Score ${x.score}; answers ${x.answer_count}`, published: x.last_activity_date ? new Date(x.last_activity_date * 1000).toISOString() : undefined, metadata: { isAnswered: x.is_answered } })); }
}

class OpenLibraryProvider implements KnowledgeProvider {
  readonly name = "openLibrary"; readonly category = "books" as const;
  status() { return configuredStatus(this.name, this.category, false, true, "Public Open Library APIs for book discovery metadata"); }
  async healthCheck() { return ok("https://openlibrary.org/search.json?q=computer+science&limit=1"); }
  async search(query: string, limit = 10) { const data = await json(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${Math.min(limit, 10)}`); return (data.docs || []).map((x: any) => ({ id: x.key, title: x.title || "Untitled book", url: x.key ? `https://openlibrary.org${x.key}` : "https://openlibrary.org", source: this.name, sourceType: this.category, snippet: [x.first_sentence?.[0], x.subject?.slice(0, 5)?.join(", ")].filter(Boolean).join(" — "), published: x.first_publish_year ? String(x.first_publish_year) : undefined, author: x.author_name?.slice(0, 5)?.join(", "), metadata: { isbn: x.isbn?.[0] } })); }
}

class WikidataProvider implements KnowledgeProvider {
  readonly name = "wikidata"; readonly category = "open_knowledge" as const;
  status() { return configuredStatus(this.name, this.category, false, true, "Public Wikibase search API"); }
  async healthCheck() { return ok("https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=computer&format=json&srlimit=1"); }
  async search(query: string, limit = 10) { const data = await json(`https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${Math.min(limit, 10)}`); return (data.query?.search || []).map((x: any) => ({ id: x.id, title: x.title, url: `https://www.wikidata.org/wiki/${x.title}`, source: this.name, sourceType: this.category, snippet: x.snippet?.replace(/<[^>]+>/g, "") || "" })); }
}

class WorldBankProvider implements KnowledgeProvider {
  readonly name = "worldBank"; readonly category = "government" as const;
  status() { return configuredStatus(this.name, this.category, false, true, "Public World Bank Indicators API"); }
  async healthCheck() { return ok("https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&per_page=1"); }
  async search(query: string, limit = 10) { const data = await json(`https://api.worldbank.org/v2/indicator?format=json&per_page=${Math.min(limit, 10)}&source=2`); const terms = query.toLowerCase().split(/\W+/).filter(Boolean); return (data[1] || []).filter((x: any) => terms.some((t: string) => `${x.name} ${x.sourceNote || ""}`.toLowerCase().includes(t))).slice(0, limit).map((x: any) => ({ id: x.id, title: x.name, url: `https://data.worldbank.org/indicator/${x.id}`, source: this.name, sourceType: this.category, snippet: x.sourceNote || "", metadata: { unit: x.unit, sourceOrganization: x.sourceOrganization } })); }
}

class DataGovProvider implements KnowledgeProvider {
  readonly name = "dataGov"; readonly category = "datasets" as const;
  status() { const configured = Boolean(env("DATA_GOV_API_KEY")); return configuredStatus(this.name, this.category, true, configured, configured ? "Data.gov catalog metadata API configured" : "Data.gov API key not configured; no placeholder key is used"); }
  async healthCheck() { const key = env("DATA_GOV_API_KEY"); if (!key) return false; return ok(`https://api.gsa.gov/technology/datagov/v3/search?api_key=${encodeURIComponent(key)}&q=education&rows=1`); }
  async search(query: string, limit = 10) { const key = env("DATA_GOV_API_KEY"); if (!key) throw new Error("Data.gov is unavailable: DATA_GOV_API_KEY is not configured."); const data = await json(`https://api.gsa.gov/technology/datagov/v3/search?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&rows=${Math.min(limit, 10)}`); return (data.results || []).map((x: any) => ({ id: x.id, title: x.title, url: x.distribution?.[0]?.accessURL || x.landingPage || `https://catalog.data.gov/dataset/${x.id}`, source: this.name, sourceType: this.category, snippet: x.notes || "", metadata: { organization: x.organization?.title } })); }
}

export const knowledgeProviders: KnowledgeProvider[] = [new GitHubProvider(), new StackExchangeProvider(), new OpenLibraryProvider(), new WikidataProvider(), new WorldBankProvider(), new DataGovProvider()];
export const providerRegistry = new Map(knowledgeProviders.map((provider) => [provider.name, provider]));

export const unavailableProviders: ProviderStatus[] = [
  { name: "coursera", category: "education", enabled: false, status: "not_configured", requiresKey: true, reason: "No verified public adapter configured; do not scrape course pages." },
  { name: "udemy", category: "education", enabled: false, status: "not_configured", requiresKey: true, reason: "No verified public adapter configured; do not scrape course pages." },
  { name: "edX", category: "education", enabled: false, status: "not_configured", requiresKey: false, reason: "No verified public adapter configured; use permitted public feeds only." },
  { name: "classCentral", category: "education", enabled: false, status: "not_configured", requiresKey: false, reason: "No verified public adapter configured; do not scrape search pages." },
  { name: "geeksforGeeks", category: "education", enabled: false, status: "not_configured", requiresKey: false, reason: "No verified public API configured; no unofficial scraping." },
  { name: "youtube", category: "video", enabled: false, status: "not_configured", requiresKey: true, reason: "YouTube Data API key not configured; transcript access is not assumed." },
  { name: "googleBooks", category: "books", enabled: false, status: "not_configured", requiresKey: true, reason: "Google Books API key not configured; Open Library is the free default." },
  { name: "mitOpenCourseWare", category: "education", enabled: false, status: "not_configured", requiresKey: false, reason: "No official adapter configured; no course-page scraping." },
  { name: "freeCodeCamp", category: "education", enabled: false, status: "not_configured", requiresKey: false, reason: "No official search API configured; use permitted source discovery only." },
];

export function providerStatuses(): ProviderStatus[] { return [...knowledgeProviders.map((provider) => provider.status()), ...unavailableProviders]; }

export function providersForIntent(intent: string): string[] {
  const routes: Record<string, string[]> = {
    programming: ["github", "stackExchange"], documentation: ["github", "stackExchange"], books: ["openLibrary"], dataset: ["dataGov", "worldBank"], government: ["worldBank", "dataGov"], education: ["openLibrary", "wikidata", "github"], academic_research: ["wikidata", "worldBank"], general_research: ["wikidata", "worldBank"],
  };
  return routes[intent] || ["wikidata"];
}
