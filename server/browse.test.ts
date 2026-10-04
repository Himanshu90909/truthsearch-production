import { describe, expect, it } from "vitest";
import { extractRelevantLinks, parseDuckDuckGoHtml } from "./research";

const DDG_HTML = `<html><body>
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.amazon.jobs%2Fen%2Fjobs%2F10502000&amp;rut=abc">Front End Engineer Intern 2027</a>
<a class="result__snippet" href="#">Amazon is hiring front end engineer interns for the 2027 batch in Bengaluru and Hyderabad.</a>
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&amp;rut=def">Example page</a>
<a class="result__snippet" href="#">An example snippet about internships.</a>
<a class="result__a" href="/not-a-redirect">Non-redirect link</a>
</body></html>`;

describe("keyless web search (DuckDuckGo HTML parsing)", () => {
  it("parses result links, titles and snippets", () => {
    const hits = parseDuckDuckGoHtml(DDG_HTML);
    expect(hits.length).toBe(2);
    expect(hits[0].url).toBe("https://www.amazon.jobs/en/jobs/10502000");
    expect(hits[0].title).toContain("Front End Engineer Intern");
    expect(hits[0].snippet).toContain("2027 batch");
    expect(hits[0].provider).toBe("duckDuckGo");
    expect(hits[1].url).toBe("https://example.com/page");
  });

  it("ignores links without a uddg redirect", () => {
    const hits = parseDuckDuckGoHtml(DDG_HTML);
    expect(hits.every((h) => h.url.startsWith("http"))).toBe(true);
  });
});

const PAGE_HTML = `<html><body>
<p>Read about the <a href="/jobs/frontend-intern-2027">Front End Engineer Intern 2027 role</a> on our site.</p>
<p>Also see the <a href="https://other.example.org/apply-now">apply now for the front end intern position</a> page.</p>
<p>Irrelevant: <a href="/blog/food">cooking recipes</a> and <a href="/assets/logo.png">our logo</a>.</p>
</body></html>`;

describe("browsing hop 2 link extraction", () => {
  it("keeps only on-question links, resolves relative urls, dedupes against seen", () => {
    const seen = new Set(["https://www.example.com/already-fetched"]);
    const links = extractRelevantLinks(PAGE_HTML, "https://www.example.com/article", "front end engineer intern 2027", seen, 6);
    expect(links.length).toBe(2);
    expect(links[0].url).toBe("https://www.example.com/jobs/frontend-intern-2027");
    expect(links.some((l) => l.url === "https://other.example.org/apply-now")).toBe(true);
    // asset and off-topic links excluded
    expect(links.every((l) => !/recipes|logo/.test(l.url))).toBe(true);
    // anchors mentioning more query terms score higher
    expect(links[0].score).toBeGreaterThanOrEqual(links[1].score);
  });

  it("never returns a url already in the seen set", () => {
    const seen = new Set(["https://www.example.com/jobs/frontend-intern-2027"]);
    const alreadySeen = Array.from(seen);
    const links = extractRelevantLinks(PAGE_HTML, "https://www.example.com/article", "front end engineer intern 2027", seen, 6);
    // links may be added to `seen` (accumulating dedupe), but none of the
    // pre-existing seen urls may ever be returned
    expect(links.every((l) => !alreadySeen.includes(l.url))).toBe(true);
    expect(links.some((l) => l.url === "https://other.example.org/apply-now")).toBe(true);
  });
});
