// Source credibility, freshness and de-duplication (spec section C).
//
// Credibility is a transparent heuristic, not a truth oracle: it combines the kind of publisher with a small
// editable allow-list. It is used to ORDER sources and to set thresholds; it never turns a claim into "verified" by
// itself (that needs independent corroboration, see verification/claims.ts).

import { registrableDomain } from "../verification/claims";

export type SourceKind = "government" | "academic_publisher" | "international_org" | "reference" | "major_news" | "company_docs" | "blog_or_social" | "aggregator" | "unknown";

// Editable lists. Entries are registrable domains and are matched exactly (so "notbbc.com" does NOT match "bbc.co.uk").
const LIST: Record<Exclude<SourceKind, "government" | "unknown">, string[]> = {
  academic_publisher: ["nature.com", "science.org", "sciencedirect.com", "springer.com", "wiley.com", "nih.gov", "ncbi.nlm.nih.gov", "arxiv.org", "jstor.org", "plos.org", "thelancet.com", "nejm.org", "bmj.com", "acm.org", "ieee.org", "europepmc.org", "semanticscholar.org", "openalex.org", "doi.org"],
  international_org: ["who.int", "un.org", "worldbank.org", "imf.org", "oecd.org", "unesco.org", "unicef.org", "europa.eu", "wto.org", "iea.org"],
  reference: ["wikipedia.org", "britannica.com", "wikidata.org", "openlibrary.org"],
  major_news: ["reuters.com", "apnews.com", "bbc.com", "bbc.co.uk", "theguardian.com", "nytimes.com", "washingtonpost.com", "ft.com", "economist.com", "wsj.com", "bloomberg.com", "thehindu.com", "indianexpress.com", "npr.org", "aljazeera.com", "dw.com", "espn.com"],
  company_docs: [],
  blog_or_social: ["medium.com", "substack.com", "blogspot.com", "wordpress.com", "tumblr.com", "reddit.com", "quora.com", "linkedin.com", "facebook.com", "x.com", "twitter.com", "youtube.com", "tiktok.com", "pinterest.com"],
  aggregator: ["msn.com", "yahoo.com", "flipboard.com", "newsbreak.com", "pressreader.com", "worldometers.info", "livehumans.net", "worldpopulationclock.net"],
};

export function classifyPublisher(urlOrHost: string): SourceKind {
  const host = (() => { try { return new URL(urlOrHost.includes("://") ? urlOrHost : `https://${urlOrHost}`).hostname.toLowerCase(); } catch { return urlOrHost.toLowerCase(); } })();
  const reg = registrableDomain(host);
  if (/(^|\.)gov(\.[a-z]{2})?$/.test(host) || /(^|\.)(gov|nic)\.in$/.test(host) || /(^|\.)mil$/.test(host)) return "government";
  if (/(^|\.)(edu|ac\.[a-z]{2})$/.test(host)) return "academic_publisher";
  for (const [kind, domains] of Object.entries(LIST) as Array<[SourceKind, string[]]>) if (domains.includes(reg)) return kind;
  if (/^(docs|developer|developers|support|help)\./.test(host)) return "company_docs";
  return "unknown";
}

const BASE: Record<SourceKind, number> = { government: 80, academic_publisher: 82, international_org: 80, reference: 62, major_news: 72, company_docs: 66, blog_or_social: 30, aggregator: 38, unknown: 45 };

/** 0 to 100. `ageYears` null means the publication date is unknown, which is neither rewarded nor invented. */
export function credibilityScore(urlOrHost: string, opts: { hasAuthor?: boolean; hasDate?: boolean; isPeerReviewedProvider?: boolean; relevance?: number } = {}): { score: number; kind: SourceKind } {
  const kind = classifyPublisher(urlOrHost);
  let s = BASE[kind];
  if (opts.isPeerReviewedProvider && (kind === "unknown" || kind === "academic_publisher")) s = Math.max(s, 78);
  if (opts.hasAuthor) s += 3;
  if (opts.hasDate) s += 2;
  s += Math.round(Math.min(5, Math.max(0, opts.relevance ?? 0)) * 2);            // up to +10 for on-topic pages
  return { score: Math.max(5, Math.min(95, s)), kind };
}

/** Freshness multiplier in [0.55, 1]. Only matters for time-sensitive questions; timeless questions are not penalised. */
export function freshnessFactor(published: string | null | undefined, timeSensitive: boolean, now = new Date()): number {
  if (!timeSensitive) return 1;
  if (!published) return 0.8;                                                     // unknown date: mild caution, not a guess
  const ms = Date.parse(published); if (Number.isNaN(ms)) return 0.8;
  const years = (now.getTime() - ms) / (365.25 * 864e5);
  if (years <= 0.25) return 1; if (years <= 1) return 0.92; if (years <= 2) return 0.78; if (years <= 5) return 0.65; return 0.55;
}

export function rankScore(credibility: number, published: string | null | undefined, timeSensitive: boolean, now = new Date()): number {
  return Math.round(credibility * freshnessFactor(published, timeSensitive, now));
}

// ---- de-duplication --------------------------------------------------------
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const titleStem = (t: string) => norm(t).replace(/\b(the|a|an|and|of|in|on|for|to|with)\b/g, " ").replace(/\s+/g, " ").trim();
function shingles(t: string, k = 3): Set<string> { const w = norm(t).split(" ").filter(Boolean); const out = new Set<string>(); for (let i = 0; i + k <= w.length; i++) out.add(w.slice(i, i + k).join(" ")); return out; }
function jaccard(a: Set<string>, b: Set<string>): number { if (!a.size || !b.size) return 0; let n = 0; a.forEach((x) => { if (b.has(x)) n++; }); return n / (a.size + b.size - n); }

export type Dedupable = { url: string; title: string; snippet?: string; domain?: string };
/**
 * Collapses (1) the same URL after canonicalisation, (2) the same story syndicated on several domains (near-identical
 * title, or near-identical text shingles), keeping the highest-ranked copy. Returns the survivors and which URLs were
 * dropped as duplicates of what, so the answer can say how many independent sources there really are.
 */
export function dedupeSources<T extends Dedupable>(items: T[], rank: (x: T) => number, canonical: (u: string) => string = (u) => u): { kept: T[]; dropped: Array<{ url: string; duplicateOf: string; reason: string }> } {
  const ordered = [...items].sort((a, b) => rank(b) - rank(a));
  const kept: T[] = []; const dropped: Array<{ url: string; duplicateOf: string; reason: string }> = [];
  const byUrl = new Map<string, T>(); const byTitle = new Map<string, T>(); const sh = new Map<T, Set<string>>();
  for (const it of ordered) {
    let cu = it.url; try { cu = canonical(it.url); } catch { /* keep raw */ }
    const sameUrl = byUrl.get(cu); if (sameUrl) { dropped.push({ url: it.url, duplicateOf: sameUrl.url, reason: "same URL" }); continue; }
    const ts = titleStem(it.title || "");
    const sameTitle = ts.length >= 25 ? byTitle.get(ts) : undefined;
    if (sameTitle && registrableDomain(sameTitle.url) !== registrableDomain(it.url)) { dropped.push({ url: it.url, duplicateOf: sameTitle.url, reason: "same headline on another site (syndicated)" }); continue; }
    const mine = shingles(`${it.title} ${it.snippet ?? ""}`); let twin: T | undefined;
    // Text overlap only counts across DIFFERENT domains: two pages on one site (e.g. language versions) are separate documents.
    if (mine.size >= 8) kept.forEach((k) => { if (!twin && registrableDomain(k.url) !== registrableDomain(it.url) && jaccard(mine, sh.get(k)!) >= 0.8) twin = k; });
    if (twin) { dropped.push({ url: it.url, duplicateOf: twin.url, reason: "near-identical text" }); continue; }
    kept.push(it); byUrl.set(cu, it); if (ts.length >= 25) byTitle.set(ts, it); sh.set(it, mine);
  }
  return { kept, dropped };
}
