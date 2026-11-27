// Which web-search providers to try, and in what order.
//
// Rule: a provider whose key is configured is preferred over the keyless DuckDuckGo HTML scraper, because the scraper
// is rate-limited and bot-checked from many server IPs (it returned 0 results from a cloud IP during testing). The
// explicit SEARCH_PROVIDER setting still wins when it names a provider that is actually usable. Having a key set is
// enough: it does not also require a separate ENABLE_PAID_SEARCH flag, which silently left a configured key unused.

export type WebProvider = "tavily" | "firecrawl" | "brave" | "duckDuckGo";

export function webSearchChain(env: Record<string, string | undefined>): WebProvider[] {
  // A key saved under the wrong name must never be sent to the wrong company. Each provider only accepts a key that is
  // not recognisably another provider's (tvly- = Tavily, fc- = Firecrawl, BSA = Brave). Unrecognised formats are
  // trusted as named, because we cannot prove they belong elsewhere.
  const fits = (key: string | undefined, provider: "tavily" | "firecrawl" | "brave") => { const k = (key || "").trim(); if (!k) return false; const owner = keyBelongsTo(k); return owner === "unknown" || owner === provider; };
  const usable: Record<WebProvider, boolean> = {
    tavily: fits(env.TAVILY_API_KEY, "tavily"),
    firecrawl: fits(env.FIRECRAWL_API_KEY, "firecrawl"),
    brave: fits(env.BRAVE_SEARCH_API_KEY || env.BRAVE_API_KEY, "brave"),
    duckDuckGo: true,
  };
  const preferred = (env.SEARCH_PROVIDER || "").trim() as WebProvider;
  const order: WebProvider[] = ["tavily", "firecrawl", "brave", "duckDuckGo"];
  const chain = order.filter((p) => usable[p]);
  if (preferred && usable[preferred]) return [preferred, ...chain.filter((p) => p !== preferred)];
  return chain;
}

/** The key a provider should actually use, resolved by what the key IS rather than only by its variable name. */
export function resolveProviderKey(env: Record<string, string | undefined>, provider: "tavily" | "firecrawl" | "brave"): string | undefined {
  const names = provider === "tavily" ? ["TAVILY_API_KEY"] : provider === "firecrawl" ? ["FIRECRAWL_API_KEY"] : ["BRAVE_SEARCH_API_KEY", "BRAVE_API_KEY"];
  for (const n of names) { const k = (env[n] || "").trim(); if (k && (keyBelongsTo(k) === "unknown" || keyBelongsTo(k) === provider)) return k; }
  return undefined;
}

/**
 * Detects which provider a key belongs to from its documented prefix. Used only to explain a misconfiguration (for
 * example a Tavily key saved as BRAVE_API_KEY); it never routes a secret to a provider on its own.
 */
export function keyBelongsTo(key: string | undefined): "tavily" | "firecrawl" | "brave" | "unknown" {
  const k = (key || "").trim();
  if (k.startsWith("tvly-")) return "tavily";
  if (/^fc-[A-Za-z0-9]{16,}/.test(k)) return "firecrawl";
  if (/^BSA[A-Za-z0-9_-]{10,}/.test(k)) return "brave";
  return "unknown";
}
