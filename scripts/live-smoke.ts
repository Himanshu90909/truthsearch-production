import { conductResearch } from "../server/research";

const question = process.argv.slice(2).join(" ") || "How do retrieval systems reduce hallucinations?";
conductResearch(question, (p) => console.log(`[${p.stage}] ${p.detail}`)).then((result) => {
  console.log(JSON.stringify({ answerPreview: result.answer.slice(0, 500), sources: result.sources.length, evidence: result.evidence.length }, null, 2));
}).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
