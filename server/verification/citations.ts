// Citation validity (spec J). A citation is valid only if its number exists AND the cited source actually contains
// text that supports the sentence it is attached to. Previously only the number range was checked.
import { judgeStance } from "./claims";

export type CitationIssue = { line: string; reference: number; problem: "out_of_range" | "source_does_not_support" };
export type CitationAudit = { references: number[]; issues: CitationIssue[]; coverage: number; validShare: number };

export function auditCitations(answer: string, sourcePassages: string[][]): CitationAudit {
  const lines = answer.split(/\n+/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.length > 30);
  const cited = lines.filter((l) => /\[\d+\]/.test(l));
  const issues: CitationIssue[] = []; const refs = new Set<number>(); let checked = 0, valid = 0;
  for (const line of cited) {
    const claim = line.replace(/\[\d+(?:,\s*\d+)*\]/g, "").replace(/\*\*/g, "").replace(/^[-*•\s]+/, "").trim();
    for (const m of Array.from(line.matchAll(/\[(\d+)\]/g))) {
      const n = Number(m[1]); refs.add(n); checked++;
      if (n < 1 || n > sourcePassages.length) { issues.push({ line: claim.slice(0, 140), reference: n, problem: "out_of_range" }); continue; }
      const supports = sourcePassages[n - 1].some((p) => judgeStance(claim, p).stance === "supports");
      if (supports) valid++; else issues.push({ line: claim.slice(0, 140), reference: n, problem: "source_does_not_support" });
    }
  }
  return { references: Array.from(refs).sort((a, b) => a - b), issues, coverage: lines.length ? cited.length / lines.length : 0, validShare: checked ? valid / checked : 0 };
}
