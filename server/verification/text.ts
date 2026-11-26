// Text hygiene for retrieved web pages. Retrieved content is UNTRUSTED data: it is cleaned for readability here and
// scanned for prompt-injection in injection.ts. It is never executed or treated as instructions.

// Any letter in the scripts we care about (Latin incl. accents, Greek, Cyrillic, Hebrew, Arabic, Devanagari, Bengali, CJK).
const LETTER = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0780-\u07BF\u0900-\u097F\u0980-\u09FF\u3040-\u30FF\u4E00-\u9FFF]/g;
// Banner and footer phrases. These only count on SHORT lines (<= 160 chars) so a real sentence that merely mentions
// cookies or copyright is kept. A line starting with the copyright sign is always a footer.
const SHORT_LINE_BOILERPLATE = [
  /\b(we|this (site|website)) (use|uses) cookies\b/i,
  /\b(accept (all|cookies)|manage (cookie|consent)|cookie (settings|preferences|statement|policy))\b/i,
  /\bcopyright\b/i,
  /\ball rights reserved\b/i,
  /\b(subscribe to (our|the) newsletter|follow us on|share on (facebook|twitter|x|linkedin|whatsapp))\b/i,
];
const BOILERPLATE_LINE = [
  /^\s*(©|\(c\))/i,
  /^\s*from (wikipedia|the free encyclopedia)\b/i,
  /\b(this article is about|for other uses,? see|redirects here|not to be confused with|coordinates:)\b/i,
  /\b(population pyramid|\bimage:|\bfile:|thumb\|)\b/i,
  /^\s*(skip to|jump to|toggle|menu|navigation|search|log ?in|sign ?(in|up)|subscribe|cookie|accept all|privacy policy|terms of (use|service)|share this|follow us|advertisement|related (articles|posts)|read more|click here|©|copyright)\b/i,
  /\b(\d{1,3}\s+languages?|languages?\s+\d{1,3})\b/i,           // Wikipedia language-switcher blocks
  /^\s*(table of contents|contents|edit|view history|talk|tools|actions|print\/export)\s*$/i,
];

// A real sentence has several common function words and a finite verb. Banners and footers ("We use cookies. Accept
// all", "Copyright 2026 Example Ltd") are mostly nouns and imperatives.
const FUNCTION_WORDS = /\b(that|which|because|since|while|although|than|was|were|had|has|have|did|found|ruled|showed|reported|said|according|estimated|increased|decreased)\b/gi;
function looksLikeSentence(t: string): boolean {
  const hits = (t.match(FUNCTION_WORDS) || []).length;
  return hits >= 2 && /[a-z]{3,}\s+[a-z]{3,}\s+[a-z]{3,}/.test(t) && /[.!?]$/.test(t.trim());
}

/** True when a line looks like page chrome (menus, cookie banners, language lists) rather than prose. */
export function isBoilerplate(line: string): boolean {
  const t = line.trim();
  if (t.length < 25) return true;
  if (BOILERPLATE_LINE.some((re) => re.test(t))) return true;
  if (t.length <= 160 && !looksLikeSentence(t) && SHORT_LINE_BOILERPLATE.some((re) => re.test(t))) return true;
  const letters = (t.match(LETTER) || []).length;
  if (letters / t.length < 0.55) return true;                       // mostly digits/symbols
  const scripts = new Set((t.match(LETTER) || []).map((c) => (/[A-Za-z]/.test(c) ? "latin" : /[\u0400-\u04FF]/.test(c) ? "cyr" : /[\u0590-\u06FF\u0780-\u07BF]/.test(c) ? "arab" : /[\u0900-\u09FF]/.test(c) ? "deva" : /[\u3040-\u30FF\u4E00-\u9FFF]/.test(c) ? "cjk" : /[\u0370-\u03FF]/.test(c) ? "greek" : "other")));
  if (scripts.size >= 3) return true;                               // many scripts in one line = a language switcher
  const words = t.split(/\s+/);
  const caps = words.filter((w) => /^[A-Z\u00C0-\u024F][\w\u00C0-\u024F'-]*$/.test(w)).length;
  if (words.length >= 8 && caps / words.length > 0.8) return true;  // Title Case Menu Of Links
  return false;
}

export function splitSentences(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").replace(/\[(?:\d+|citation needed|note \d+)\]/gi, "").trim();
  const parts = cleaned.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\u201C])/);
  return parts.map((s) => s.trim()).filter((s) => s.length >= 25 && s.length <= 400);
}

/** Split page text into readable passages, dropping boilerplate lines first. Replaces blind 900-character slicing. */
export function buildPassages(raw: string, maxPassages = 30, targetChars = 700): string[] {
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const prose = lines.filter((l) => !isBoilerplate(l));
  const sentences = prose.flatMap((l) => (l.length > 400 ? splitSentences(l) : [l]));
  const passages: string[] = []; let cur = "";
  for (const s of sentences) {
    if (cur && (cur + " " + s).length > targetChars) { passages.push(cur); cur = s; } else cur = cur ? `${cur} ${s}` : s;
    if (passages.length >= maxPassages) break;
  }
  if (cur && passages.length < maxPassages) passages.push(cur);
  return passages.filter((p) => p.length >= 80);
}

const DROP_BLOCKS = /<(script|style|noscript|svg|nav|header|footer|aside|form|iframe|template)\b[\s\S]*?<\/\1>/gi;
const BLOCK_TAGS = /<\/?(p|div|section|article|main|li|ul|ol|tr|td|th|h[1-6]|br|blockquote|figcaption|table|dd|dt)\b[^>]*>/gi;
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " ", "&ndash;": "-", "&mdash;": "-" };

/**
 * HTML to plain text that KEEPS block boundaries as newlines (the old code flattened everything onto one line, which
 * made menus and article text indistinguishable). Page chrome elements (nav, header, footer, aside, forms) are dropped.
 */
export function htmlToText(html: string): string {
  // The page is often truncated before </body> (we only download the first part), so find where the body STARTS
  // and take everything after it. Requiring a closing tag made the whole head leak into the text.
  const start = html.search(/<body\b/i);
  const body = start >= 0 ? html.slice(start) : html;
  return body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[\s\S]*?(<\/\1>|$)/gi, "\n")   // also drops an unterminated script/style at the cut-off point
    .replace(/<img\b[^>]*>?/gi, " ")
    .replace(/\{\{[\s\S]{0,2000}?\}\}/g, " ")                 // leaked wiki/template markup such as {{cite web | ...}}
    .replace(/<[a-z][^>]{0,500}$/i, " ")                          // a tag cut in half by truncation
    .replace(DROP_BLOCKS, "\n")
    .replace(BLOCK_TAGS, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp|ndash|mdash);/g, (m) => ENTITIES[m] ?? " ")
    .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c > 31 && c < 65536 ? String.fromCharCode(c) : " "; })
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Publication date from page metadata, used only when the search provider did not supply one. Checks, in order:
 * Open Graph/article meta, JSON-LD datePublished/dateModified, Dublin Core/citation meta, then the first <time datetime>.
 * Returns an ISO date (YYYY-MM-DD) or null. Never guesses from body text and rejects future or pre-1990 dates.
 */
export function extractPublishedDate(html: string, now = new Date()): string | null {
  const head = html.slice(0, 400_000);
  const candidates: string[] = [];
  const meta = (name: string) => {
    const a = head.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i"));
    const b = head.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${name}["']`, "i"));
    return (a || b)?.[1];
  };
  for (const n of ["article:published_time", "og:published_time", "datePublished", "pubdate", "publish-date", "date", "dc.date", "DC.date.issued", "citation_publication_date", "citation_date", "article:modified_time", "dateModified", "og:updated_time"]) { const v = meta(n); if (v) candidates.push(v); }
  for (const m of Array.from(head.matchAll(/"date(?:Published|Created|Modified)"\s*:\s*"([^"]{8,40})"/g))) candidates.push(m[1]);
  const t = head.match(/<time[^>]+datetime=["']([^"']{8,40})["']/i); if (t) candidates.push(t[1]);
  for (const c of candidates) {
    const ms = Date.parse(c.trim()); if (Number.isNaN(ms)) continue;
    const d = new Date(ms); if (d.getUTCFullYear() < 1990 || ms > now.getTime() + 2 * 864e5) continue;
    return d.toISOString().slice(0, 10);
  }
  return null;
}
