// VisualAnalysisService — orchestrates one full visual analysis.
//
// Pipeline: upload (already validated) -> vision provider call -> robust
// JSON extraction -> schema validation (1 repair retry) -> coordinate
// sanitisation -> annotation/diagram rendering -> persistence.

import { VisualAnalysis, sanitizeRegions, rebindSteps, DiagramSpec, type VisualAnalysisParsed, type SanitizedRegion, EXPLANATION_DEPTHS, VISUAL_MODES } from "./schema";
import { invokeVision, type VisionMessage } from "./providers";
import { analysisSystemPrompt, analysisUserPrompt } from "./prompts";
import type { ExplanationDepth, VisualMode } from "./schema";
import { annotationOverlay } from "./annotation";
import { diagramSvg } from "./diagram";
import { z } from "zod";

// Robust JSON extraction: models sometimes wrap JSON in fences or prose.
export function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

export type AnalysisOutcome = {
  analysis: VisualAnalysisParsed;
  regions: SanitizedRegion[];
  droppedRegions: number;
  overlaySvg: string;
  diagramSvgText: string | null;
  provider: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number } | null;
  latencyMs: number;
};

export type AnalyzeArgs = {
  imageDataUrl: string;
  question?: string;
  mode: VisualMode;
  depth: ExplanationDepth;
  language: string;
  width: number;
  height: number;
  signal?: AbortSignal;
};

export async function runAnalysis(args: AnalyzeArgs): Promise<AnalysisOutcome> {
  const system = analysisSystemPrompt(args.mode, args.depth, args.language);
  const user = analysisUserPrompt(args.question, args.mode);
  const messages: VisionMessage[] = [
    { role: "system", content: system },
    { role: "user", content: [
      { type: "text", text: user },
      { type: "image_url", image_url: { url: args.imageDataUrl, detail: "high" } },
    ] },
  ];

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await invokeVision({
      messages: attempt === 0
        ? [...messages]
        : [
            { role: "system", content: system },
            { role: "user", content: [
                { type: "text", text: `${user}\n\nYour previous response was invalid: ${lastError}\nReturn ONLY corrected JSON matching the schema.` },
                { type: "image_url", image_url: { url: args.imageDataUrl, detail: "high" } },
              ] },
          ],
      maxTokens: 6000,
      signal: args.signal,
    });

    const jsonText = extractJsonObject(result.text);
    if (!jsonText) {
      lastError = "response was not JSON";
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(jsonText);
    } catch {
      lastError = "response JSON did not parse";
      continue;
    }
    const parsed = VisualAnalysis.safeParse(raw);
    if (!parsed.success) {
      lastError = parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
      continue;
    }

    const analysis = parsed.data;
    const { regions, dropped } = sanitizeRegions(analysis, args.width, args.height);
    analysis.steps = rebindSteps(analysis.steps, regions.length);
    const overlaySvg = annotationOverlay({ width: args.width, height: args.height, regions, showLabels: true });
    const spec = analysis.diagram && DiagramSpec.safeParse(analysis.diagram).success
      ? DiagramSpec.parse(analysis.diagram)
      : null;
    const diagramSvgText = spec ? diagramSvg(spec) : null;

    return {
      analysis,
      regions,
      droppedRegions: dropped,
      overlaySvg,
      diagramSvgText,
      provider: result.provider,
      model: result.model,
      usage: result.usage,
      latencyMs: result.latencyMs,
    };
  }
  throw new Error(`The vision model could not produce a valid analysis${lastError ? ` (${lastError})` : ""}. Try a clearer image or a different question.`);
}

// Follow-up answers: small JSON, grounded in the stored analysis.
export async function runFollowup(options: { imageDataUrl: string; priorAnalysis: VisualAnalysisParsed; question: string; depth: ExplanationDepth; language: string; signal?: AbortSignal }): Promise<{ answer: string; uncertainties: string[]; provider: string; model: string; latencyMs: number }> {
  const { followupSystemPrompt } = await import("./prompts");
  const context = JSON.stringify({
    imageType: options.priorAnalysis.imageType,
    summary: options.priorAnalysis.summary,
    regions: options.priorAnalysis.regions.map((r) => ({ label: r.label, kind: r.kind, note: r.note })),
    text: options.priorAnalysis.textRegions.map((t) => t.text).join("\n"),
    visible: options.priorAnalysis.visible,
    inferred: options.priorAnalysis.inferred,
    uncertainties: options.priorAnalysis.uncertainties,
  }).slice(0, 12000);
  const result = await invokeVision({
    messages: [
      { role: "system", content: followupSystemPrompt(options.depth, options.language) },
      { role: "user", content: [
        { type: "text", text: `Prior analysis of the attached image (JSON): ${context}\n\nFollow-up question: ${options.question}` },
        { type: "image_url", image_url: { url: options.imageDataUrl, detail: "auto" } },
      ] },
    ],
    maxTokens: 2500,
    signal: options.signal,
  });
  const jsonText = extractJsonObject(result.text);
  let answer = result.text.trim();
  let uncertainties: string[] = [];
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      if (typeof parsed?.answer === "string" && parsed.answer.trim()) answer = parsed.answer.trim();
      if (Array.isArray(parsed?.uncertainties)) uncertainties = parsed.uncertainties.filter((u: unknown) => typeof u === "string").slice(0, 8);
    } catch { /* keep raw text as the answer */ }
  }
  return { answer, uncertainties, provider: result.provider, model: result.model, latencyMs: result.latencyMs };
}

// OCRService — dedicated transcription of all text in an image.
export async function runOcr(options: { imageDataUrl: string; signal?: AbortSignal }): Promise<{ text: string; lines: string[]; ambiguous: string[]; provider: string; model: string }> {
  const { ocrSystemPrompt } = await import("./prompts");
  const result = await invokeVision({
    messages: [
      { role: "system", content: ocrSystemPrompt() },
      { role: "user", content: [
        { type: "text", text: "Transcribe all text in the attached image." },
        { type: "image_url", image_url: { url: options.imageDataUrl, detail: "high" } },
      ] },
    ],
    maxTokens: 4000,
    signal: options.signal,
  });
  const jsonText = extractJsonObject(result.text);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      return {
        text: typeof parsed?.text === "string" ? parsed.text : result.text.trim(),
        lines: Array.isArray(parsed?.lines) ? parsed.lines.filter((l: unknown) => typeof l === "string") : [],
        ambiguous: Array.isArray(parsed?.ambiguous) ? parsed.ambiguous.filter((l: unknown) => typeof l === "string") : [],
        provider: result.provider,
        model: result.model,
      };
    } catch { /* fall through to raw */ }
  }
  return { text: result.text.trim(), lines: [], ambiguous: [], provider: result.provider, model: result.model };
}

export { VISUAL_MODES, EXPLANATION_DEPTHS };
