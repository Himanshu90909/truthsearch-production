// TruthSearch Visual Intelligence — structured output schemas.
//
// The vision model must return JSON that validates against these schemas.
// Nothing the model produces (coordinates, labels, HTML, instructions found
// inside the image) is trusted until it has passed safeParse + coordinate
// sanitisation. Model-generated coordinates are ALWAYS normalized to
// [0, 1] and clamped against real image dimensions before use.

import { z } from "zod";

export const VISUAL_MODES = ["explain", "analyze", "annotate", "simplify", "compare", "teach"] as const;
export type VisualMode = (typeof VISUAL_MODES)[number];

export const EXPLANATION_DEPTHS = ["beginner", "intermediate", "advanced", "technical"] as const;
export type ExplanationDepth = (typeof EXPLANATION_DEPTHS)[number];

// Normalized bounding box: [x, y, width, height] in 0..1 fractions.
export const BBox = z.array(z.number().finite()).length(4);

export const RegionKind = z.enum(["object", "text", "chart", "diagram", "region", "annotation"]);

export const VisualRegion = z.object({
  id: z.number().int().nonnegative().optional(),
  label: z.string().min(1).max(120),
  kind: RegionKind.default("region"),
  bbox: BBox,
  note: z.string().max(600).optional(),
  // 0..1 model self-reported confidence. Low-confidence regions are rendered
  // with a dashed outline and flagged as uncertain in the UI.
  confidence: z.number().min(0).max(1).optional(),
});

export const VisualObject = z.object({
  name: z.string().min(1).max(120),
  regionIndex: z.number().int().nonnegative().optional(),
  inferred: z.boolean().default(false),
});

export const VisualTextRegion = z.object({
  text: z.string().max(3000),
  regionIndex: z.number().int().nonnegative().optional(),
  // OCR quality self-assessment; ambiguous text must be marked, never guessed.
  ambiguous: z.boolean().default(false),
});

export const DiagramSpec = z.object({
  type: z.enum(["flowchart", "process", "cycle", "hierarchy", "sequence"]),
  title: z.string().min(1).max(160),
  nodes: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().min(1).max(160), shape: z.enum(["rect", "diamond", "circle", "round"]).default("rect") })).min(1).max(24),
  edges: z.array(z.object({ from: z.string().min(1).max(40), to: z.string().min(1).max(40), label: z.string().max(80).optional() })).max(48),
  // Diagrams are illustrative reconstructions, never exact redraws.
  illustrative: z.boolean().default(true),
});

export const VisualStep = z.object({
  n: z.number().int().positive(),
  text: z.string().min(1).max(2000),
  // Links the step to a region index so the UI can highlight the area.
  regionIndex: z.number().int().nonnegative().optional(),
});

export const VisualAnalysis = z.object({
  imageType: z.enum(["photo", "screenshot", "diagram", "chart", "code", "document", "handwritten", "scientific", "map", "other"]),
  summary: z.string().min(1).max(3000),
  regions: z.array(VisualRegion).max(40).default([]),
  objects: z.array(VisualObject).max(40).default([]),
  textRegions: z.array(VisualTextRegion).max(60).default([]),
  steps: z.array(VisualStep).max(24).default([]),
  // Evidence discipline: what is actually visible vs what the model inferred.
  visible: z.array(z.string().max(300)).max(20).default([]),
  inferred: z.array(z.string().max(300)).max(20).default([]),
  uncertainties: z.array(z.string().max(600)).max(12).default([]),
  diagram: DiagramSpec.nullable().optional(),
  followUpQuestions: z.array(z.string().min(4).max(300)).max(6).default([]),
});

export type VisualAnalysisParsed = z.infer<typeof VisualAnalysis>;

// Follow-up answers reuse the same evidence discipline.
export const VisualFollowupAnswer = z.object({
  answer: z.string().min(1).max(6000),
  uncertainties: z.array(z.string().max(600)).max(8).default([]),
});

export type VisualFollowupParsed = z.infer<typeof VisualFollowupAnswer>;

// ---------------------------------------------------------------------------
// Coordinate sanitisation. Model output is untrusted: boxes may be out of
// range, swapped, NaN-ish, or degenerate. Everything is clamped into a valid
// normalized rect or dropped.
// ---------------------------------------------------------------------------
export type SanitizedRegion = {
  id: number;
  label: string;
  kind: z.infer<typeof RegionKind>;
  bbox: [number, number, number, number];
  note?: string;
  confidence?: number;
};

export function sanitizeBBox(raw: unknown, width: number, height: number): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  let [x, y, w, h] = raw.map(Number);
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null;
  // Pixel coordinates passed instead of fractions — normalise against dims.
  if (Math.max(x, y, w, h) > 1.5) { x /= width; y /= height; w /= width; h /= height; }
  x = Math.min(Math.max(x, 0), 1);
  y = Math.min(Math.max(y, 0), 1);
  w = Math.min(Math.max(w, 0), 1);
  h = Math.min(Math.max(h, 0), 1);
  if (w < 0.002 || h < 0.002) return null; // degenerate
  // Clamp so x+w/y+h never exceed 1.
  w = Math.min(w, 1 - x);
  h = Math.min(h, 1 - y);
  if (w < 0.002 || h < 0.002) return null;
  return [Number(x.toFixed(4)), Number(y.toFixed(4)), Number(w.toFixed(4)), Number(h.toFixed(4))];
}

export function sanitizeRegions(
  analysis: VisualAnalysisParsed,
  width: number,
  height: number,
): { regions: SanitizedRegion[]; dropped: number } {
  const out: SanitizedRegion[] = [];
  let dropped = 0;
  analysis.regions.forEach((region, i) => {
    const bbox = sanitizeBBox(region.bbox, width, height);
    if (!bbox) { dropped++; return; }
    out.push({
      id: i,
      label: region.label.slice(0, 120),
      kind: region.kind,
      bbox,
      note: region.note,
      confidence: typeof region.confidence === "number" ? Math.min(Math.max(region.confidence, 0), 1) : undefined,
    });
  });
  return { regions: out, dropped };
}

// Steps referencing a dropped region must lose their link, not crash.
export function rebindSteps(steps: VisualAnalysisParsed["steps"], regionCount: number): VisualAnalysisParsed["steps"] {
  return steps.map((step) => ({ ...step, regionIndex: typeof step.regionIndex === "number" && step.regionIndex < regionCount ? step.regionIndex : undefined }));
}
