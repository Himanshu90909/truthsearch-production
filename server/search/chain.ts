// Which web-search providers to try, and in what order.
//
// Rule: a provider whose key is configured is preferred over the keyless DuckDuckGo HTML scraper, because the scraper
// is rate-limited and bot-checked from many server IPs (it returned 0 results from a cloud IP during testing). The
// explicit SEARCH_PROVIDER setting still wins when it names a provider that is actually usable. Having a key set is
// enough: it does not also require a separate ENABLE_PAID_SEARCH flag, which silently left a configured key unused.

export type WebProvider = "tavily" | "brave" | "duckDuckGo";

export function webSearchChain(env: Record<string, string | undefined>): WebProvider[] {
  const has = (k: string) => !!env[k]?.trim();
  // A key saved under the wrong name must never be sent to the wrong company. A key that is recognisably Tavily's
  // (tvly-...) is not offered to Brave, and the other way round. Unrecognised formats are trusted as named.
  const braveKey = (env.BRAVE_SEARCH_API_KEY || env.BRAVE_API_KEY || "").trim();
  const tavilyKey = (env.TAVILY_API_KEY || "").trim();
  const usable: Record<WebProvider, boolean> = {
    tavily: !!tavilyKey && keyBelongsTo(tavilyKey) !== "brave",
    brave: !!braveKey && keyBelongsTo(braveKey) !== "tavily",
    duckDuckGo: true,
  };
  void has;
  const preferred = (env.SEARCH_PROVIDER || "").trim() as WebProvider;
  const order: WebProvider[] = ["tavily", "brave", "duckDuckGo"];
  const chain = order.filter((p) => usable[p]);
  if (preferred && usable[preferred]) return [preferred, ...chain.filter((p) => p !== preferred)];
  return chain;
}

/**
 * Detects which provider a key belongs to from its documented prefix. Used only to explain a misconfiguration (for
 * example a Tavily key saved as BRAVE_API_KEY); it never routes a secret to a provider on its own.
 */
export function keyBelongsTo(key: string | undefined): "tavily" | "brave" | "unknown" {
  const k = (key || "").trim();
  if (k.startsWith("tvly-")) return "tavily";
  if (/^BSA[A-Za-z0-9_-]{10,}/.test(k)) return "brave";
  return "unknown";
}
