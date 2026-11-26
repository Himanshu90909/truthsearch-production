import { splitSentences } from "./text";

// ---------------------------------------------------------------------------
// Claim-level verification (spec section D).
//
// Statuses: verified | partial | conflicting | unsupported | outdated
//
// Hard rules, each covered by tests:
//  * "verified" needs support from at least MIN_INDEPENDENT_DOMAINS different registrable domains. Two pages on one
//    site, or a site and its own mirror, count once. Model agreement is NOT an input to this function at all.
//  * If any credible source contradicts, the claim is "conflicting", whatever the support count.
//  * Support that is all older than OUTDATED_AFTER_YEARS and about a time-sensitive topic is "outdated".
//  * No evidence at all is "unsupported". Nothing is ever defaulted to "verified".
// ---------------------------------------------------------------------------

export type ClaimStatus = "verified" | "partial" | "conflicting" | "unsupported" | "outdated";
export const MIN_INDEPENDENT_DOMAINS = 2;
export const OUTDATED_AFTER_YEARS = 2;

export type SourceRef = { id: number; url: string; domain: string; title?: string; publishedAt?: string | null; credibility: number };
export type Passage = { sourceId: number; text: string };
export type Stance = "supports" | "contradicts" | "neutral";
export type EvidenceItem = { claim: string; source: SourceRef; passage: string; stance: Stance; relevance: number };

export type ClaimVerdict = {
  claim: string;
  status: ClaimStatus;
  supporting: EvidenceItem[];
  contradicting: EvidenceItem[];
  independentSupportingDomains: string[];
  newestSupportDate: string | null;
  confidence: number; // 0..100, derived only from evidence, never from model self-reports
  explanation: string;
};

/** Reduce a hostname to a registrable-ish domain so www.bbc.co.uk and news.bbc.co.uk count as one publisher. */
export function registrableDomain(hostOrUrl: string): string {
  let host = hostOrUrl.toLowerCase();
  try { host = new URL(hostOrUrl).hostname.toLowerCase(); } catch { /* already a hostname */ }
  host = host.replace(/^www\./, "");
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const secondLevel = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);
  return secondLevel.has(parts[parts.length - 2]) && parts[parts.length - 1].length === 2 ? parts.slice(-3).join(".") : parts.slice(-2).join(".");
}

const TIME_SENSITIVE = /\b(current(ly)?|latest|now|today|this year|as of|ceo|president|prime minister|population|price|record|ranking|champion|leader|rate|population)\b/i;

export function isTimeSensitive(claim: string): boolean { return TIME_SENSITIVE.test(claim); }

export function yearsSince(date: string | null | undefined, now = new Date()): number | null {
  if (!date) return null; const t = Date.parse(date); if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / (365.25 * 864e5);
}

// ---- claim extraction ------------------------------------------------------

const FACT_SIGNAL = /\b(\d[\d,.]*\s?(%|percent|million|billion|trillion|crore|lakh|thousand)?|is|are|was|were|has|have|had|became|founded|born|died|won|located|consists|contains|measures|equals|reported|according to)\b/i;
const OPINION_SIGNAL = /\b(i think|i believe|in my opinion|arguably|might|may|could|perhaps|should|best|worst|beautiful|amazing|terrible)\b/i;
const PAGE_LABEL = /^(from wikipedia|this article is about|for other uses|population pyramid|see also|external links|references|main article)/i;
const QUESTION_OR_CTA = /\?\s*$|\b(click|subscribe|sign up|download|buy now|learn more)\b/i;

/** Extract checkable factual statements from answer text. Drops headings, questions, calls to action and opinion. */
export function extractClaims(text: string, max = 12): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n+/)) {
    const t = line.trim().replace(/^[-*•\d.)\s]+/, "").replace(/\*\*/g, "");
    if (!t || t.startsWith("#") || t.startsWith(">")) continue;
    for (const s of splitSentences(t)) {
      const claim = s.replace(/\s*\[\d+(?:,\s*\d+)*\]/g, "").trim();
      if (claim.length < 25 || PAGE_LABEL.test(claim) || QUESTION_OR_CTA.test(claim) || OPINION_SIGNAL.test(claim)) continue;
      if (!FACT_SIGNAL.test(claim)) continue;
      if (!out.some((c) => c.toLowerCase() === claim.toLowerCase())) out.push(claim);
      if (out.length >= max) return out;
    }
  }
  return out;
}

// ---- contradiction detection ----------------------------------------------

const NUMBER = /(\d[\d,]*(?:\.\d+)?)\s*(%|percent|million|billion|trillion|crore|lakh|thousand|k|m|bn)?/gi;
const SCALE: Record<string, number> = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, lakh: 1e5, crore: 1e7, billion: 1e9, bn: 1e9, trillion: 1e12 };

export type Quantity = { value: number; unit: string };
export function extractQuantities(text: string): Quantity[] {
  const out: Quantity[] = [];
  for (const m of Array.from(text.matchAll(NUMBER))) {
    const raw = Number(m[1].replace(/,/g, "")); if (!Number.isFinite(raw)) continue;
    const unit = (m[2] || "").toLowerCase(); const scale = SCALE[unit] ?? 1;
    // years and tiny integers are not quantities worth comparing
    if (!unit && raw >= 1800 && raw <= 2100 && Number.isInteger(raw)) continue;
    out.push({ value: unit === "%" || unit === "percent" ? raw : raw * scale, unit: unit === "percent" ? "%" : scale > 1 ? "scaled" : unit });
  }
  return out;
}

const NEGATION = /\b(not|no|never|none|neither|without|fails? to|did not|does not|is not|was not|cannot|can't|isn't|wasn't|false|incorrect|debunked|myth|disproven)\b/i;
const CONTENT_WORD = /[a-z]{4,}/g;
const STOP = new Set(["that", "this", "with", "from", "have", "were", "been", "their", "which", "there", "about", "would", "could", "than", "then", "also", "into", "over", "after", "before", "more", "most", "some", "such"]);
function keywords(s: string): Set<string> { return new Set((s.toLowerCase().match(CONTENT_WORD) || []).filter((w) => !STOP.has(w))); }
function overlap(a: Set<string>, b: Set<string>): number { let n = 0; Array.from(a).forEach((x) => { if (b.has(x)) n++; }); return n / Math.max(1, Math.min(a.size, b.size)); }

/**
 * Decide whether a passage supports, contradicts, or is neutral to a claim. Heuristic and deliberately conservative:
 * it needs strong topical overlap first. Two ways to contradict: opposite polarity on the same topic, or the same
 * quantity with a materially different value (more than 15% apart).
 */
export function judgeStance(claim: string, passage: string): { stance: Stance; relevance: number; reason: string } {
  const ck = keywords(claim), pk = keywords(passage);
  const relevance = Math.round(overlap(ck, pk) * 100);
  if (relevance < 40) return { stance: "neutral", relevance, reason: "passage is not about the same topic" };

  const cq = extractQuantities(claim), pq = extractQuantities(passage);
  if (cq.length && pq.length) {
    const close = cq.some((c) => pq.some((p) => Math.abs(c.value - p.value) / Math.max(Math.abs(c.value), 1) <= 0.15));
    if (close) return { stance: "supports", relevance, reason: "same figure within 15%" };
    const sameKind = cq.some((c) => pq.some((p) => c.unit === p.unit));
    if (sameKind) return { stance: "contradicts", relevance, reason: `figures differ by more than 15% (${cq[0].value} vs ${pq[0].value})` };
  }
  const cNeg = NEGATION.test(claim), pNeg = NEGATION.test(passage);
  if (cNeg !== pNeg && relevance >= 60) return { stance: "contradicts", relevance, reason: "opposite polarity on the same topic" };
  if (relevance >= 55) return { stance: "supports", relevance, reason: "passage states the same thing" };
  return { stance: "neutral", relevance, reason: "weak overlap" };
}

// ---- verification ----------------------------------------------------------

export type VerifyOptions = { now?: Date; minCredibility?: number };

export function verifyClaim(claim: string, evidence: EvidenceItem[], opts: VerifyOptions = {}): ClaimVerdict {
  const now = opts.now ?? new Date(); const minCred = opts.minCredibility ?? 35;
  const usable = evidence.filter((e) => e.relevance >= 40);
  const supporting = usable.filter((e) => e.stance === "supports");
  const contradicting = usable.filter((e) => e.stance === "contradicts" && e.source.credibility >= minCred);
  const domains = Array.from(new Set(supporting.map((e) => registrableDomain(e.source.domain || e.source.url))));
  const dated = supporting.map((e) => e.source.publishedAt).filter((d): d is string => !!d && !Number.isNaN(Date.parse(d))).sort();
  const newest = dated.length ? dated[dated.length - 1] : null;
  const strength = supporting.length ? Math.round(supporting.reduce((s, e) => s + e.source.credibility * (e.relevance / 100), 0) / supporting.length) : 0;
  const base = { claim, supporting, contradicting, independentSupportingDomains: domains, newestSupportDate: newest };

  if (contradicting.length) {
    const cd = Array.from(new Set(contradicting.map((e) => registrableDomain(e.source.domain || e.source.url))));
    return { ...base, status: "conflicting", confidence: Math.min(45, strength), explanation: `${contradicting.length} passage${contradicting.length > 1 ? "s" : ""} from ${cd.join(", ")} contradict this claim${supporting.length ? `, while ${domains.length} domain${domains.length === 1 ? "" : "s"} support it` : ""}. Reported as conflicting rather than picking a side.` };
  }
  if (!supporting.length) return { ...base, status: "unsupported", confidence: 0, explanation: "No retrieved passage states this claim. It is not verified and should not be relied on." };

  const age = yearsSince(newest, now);
  if (isTimeSensitive(claim) && age != null && age > OUTDATED_AFTER_YEARS) {
    return { ...base, status: "outdated", confidence: Math.min(40, strength), explanation: `The newest supporting source is dated ${newest!.slice(0, 10)} (${age.toFixed(1)} years ago) and the claim concerns something that changes over time. It may no longer be true.` };
  }
  if (domains.length >= MIN_INDEPENDENT_DOMAINS) {
    return { ...base, status: "verified", confidence: Math.min(95, strength + 10 * (domains.length - MIN_INDEPENDENT_DOMAINS + 1)), explanation: `Supported by ${domains.length} independent domains (${domains.slice(0, 4).join(", ")}) with no credible contradiction found.${newest ? ` Newest source ${newest.slice(0, 10)}.` : " Source dates were not available."}` };
  }
  return { ...base, status: "partial", confidence: Math.min(60, strength), explanation: `Only ${domains.length} independent domain (${domains[0]}) supports this. Verification needs at least ${MIN_INDEPENDENT_DOMAINS} independent domains, so it is reported as partially supported.` };
}

/** Group a pile of passages into per-claim evidence and verify each claim. */
export function verifyClaims(claims: string[], sources: SourceRef[], passages: Passage[], opts: VerifyOptions = {}): ClaimVerdict[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  return claims.map((claim) => {
    const evidence: EvidenceItem[] = [];
    for (const p of passages) {
      const source = byId.get(p.sourceId); if (!source) continue;
      const j = judgeStance(claim, p.text);
      if (j.stance !== "neutral") evidence.push({ claim, source, passage: p.text, stance: j.stance, relevance: j.relevance });
    }
    return verifyClaim(claim, evidence, opts);
  });
}
