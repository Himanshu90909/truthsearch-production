// TruthSearch Visual Intelligence — tRPC procedures.
//
// Convention-matched to the research router: publicProcedure with rate
// limiting, ownership enforced in the data layer, honest errors, and usage
// events recorded through both visual_usage and the existing analytics
// stream (eventMetrics-compatible).

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../_core/trpc";
import { recordEvent } from "../db";
import { visionConfigured, visionProviders } from "./providers";
import { VISUAL_MODES, EXPLANATION_DEPTHS } from "./schema";
import { SUPPORTED_LANGUAGES } from "./prompts";
import {
  MAX_UPLOAD_BYTES, ALLOWED_MIME, sniffImageMime, retentionDays,
  createVisualUpload, createVisualSession, getVisualSession, listVisualSessions,
  deleteVisualSession, getVisualAnalysisBySession, addVisualFollowup, listVisualFollowups,
  addVisualFeedback, recordVisualUsage, getVisualUpload, canAccessUpload,
} from "./db";
import { runAnalysis, runFollowup, runOcr } from "./analysis";

const RATE_WINDOW_MS = 60 * 60 * 1000;
const rateBuckets = new Map<string, number[]>();
function checkRate(key: string, limit: number): boolean {
  const now = Date.now();
  const hits = (rateBuckets.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= limit) { rateBuckets.set(key, hits); return false; }
  hits.push(now);
  rateBuckets.set(key, hits);
  if (rateBuckets.size > 5000) rateBuckets.clear();
  return true;
}
function rateKey(ctx: { user: { id: number } | null; req: { headers: Record<string, unknown> } }): string {
  if (ctx.user) return `visual:user:${ctx.user.id}`;
  const forwarded = ctx.req.headers["x-forwarded-for"];
  const ip = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "anonymous";
  return `visual:ip:${ip}`;
}

const visualStartInput = z.object({
  dataUrl: z.string().min(30).max(1_200_000), // base64 of ≤ ~8MB
  width: z.number().int().min(16).max(12000),
  height: z.number().int().min(16).max(12000),
  question: z.string().trim().max(1000).optional(),
  mode: z.enum(VISUAL_MODES).default("explain"),
  depth: z.enum(EXPLANATION_DEPTHS).default("intermediate"),
  language: z.string().trim().max(8).default("en"),
});

export const visualRouter = router({
  // Capability info for the UI (honest notConfigured state, never fake success).
  info: publicProcedure.query(() => ({
    configured: visionConfigured(),
    providers: visionProviders().map((p) => ({ name: p.name, model: p.model })),
    languages: SUPPORTED_LANGUAGES,
    modes: VISUAL_MODES,
    depths: EXPLANATION_DEPTHS,
    maxUploadBytes: MAX_UPLOAD_BYTES,
    allowedMime: ALLOWED_MIME,
    retentionDays: retentionDays(),
  })),

  // Stage 1: validate + store the upload, create the session. The analysis
  // itself runs through the streaming route (or analyze for non-streaming).
  start: publicProcedure.input(visualStartInput).mutation(async ({ input, ctx }) => {
    if (!checkRate(rateKey(ctx), ctx.user ? 20 : 5)) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Hourly visual analysis limit reached. Sign in for more, or try again later." });
    }
    if (!visionConfigured()) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No vision model is configured on this deployment. Set GEMINI_API_KEY, HF_API_KEY, GROQ_API_KEY, or VISION_API_URL + VISION_API_KEY + VISION_MODEL." });
    }
    const metaMatch = /^data:([^;]+);base64,/.exec(input.dataUrl);
    if (!metaMatch) throw new Error("Image must be a base64 data URL.");
    const buffer = Buffer.from(input.dataUrl.slice(input.dataUrl.indexOf(",") + 1), "base64");
    const sniffed = sniffImageMime(buffer);
    if (!sniffed) throw new Error("That file is not a recognised JPEG, PNG, WebP or GIF image.");
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_UPLOAD_BYTES) throw new Error(`Image is empty or larger than the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB upload limit.`);

    const upload = await createVisualUpload({
      userId: ctx.user?.id ?? null,
      mime: sniffed,
      byteSize: buffer.byteLength,
      width: input.width,
      height: input.height,
      data: buffer.toString("base64"),
    });
    const sessionId = await createVisualSession({
      userId: ctx.user?.id ?? null,
      uploadId: upload.id,
      question: input.question?.trim() || null,
      mode: input.mode,
      depth: input.depth,
      language: input.language,
    });
    void recordEvent("visual.started", ctx.user?.id ?? null, { mode: input.mode, bytes: buffer.byteLength });
    return { sessionId, uploadId: upload.id, uploadToken: upload.token, mime: sniffed };
  }),

  // Full analysis without streaming (fallback path + used by tests).
  analyze: publicProcedure.input(z.object({ sessionId: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    const session = await getVisualSession(input.sessionId, ctx.user?.id ?? null);
    if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Visual session not found." });
    const upload = await getVisualUpload(session.uploadId);
    if (!upload) throw new TRPCError({ code: "NOT_FOUND", message: "The uploaded image has expired or was deleted." });

    const startedAt = Date.now();
    await updateSessionStatus(session.id, "analyzing");
    try {
      const outcome = await runAnalysis({
        imageDataUrl: `data:${upload.mime};base64,${upload.data}`,
        question: session.question ?? undefined,
        mode: session.mode as "explain",
        depth: session.depth as "intermediate",
        language: session.language,
        width: upload.width,
        height: upload.height,
      });
      const analysisId = await saveAnalysis(session.id, upload, outcome);
      await updateSessionStatus(session.id, "completed");
      void recordVisualUsage({ userId: ctx.user?.id ?? null, sessionId: session.id, kind: "analysis", provider: outcome.provider, model: outcome.model, promptTokens: outcome.usage?.promptTokens ?? null, completionTokens: outcome.usage?.completionTokens ?? null, latencyMs: Date.now() - startedAt });
      void recordEvent("visual.completed", ctx.user?.id ?? null, { mode: session.mode, latencyMs: Date.now() - startedAt });
      return { analysisId };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Visual analysis failed.";
      await updateSessionStatus(session.id, "failed", message);
      void recordEvent("visual.failed", ctx.user?.id ?? null, { error: message.slice(0, 200) });
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
    }
  }),

  get: publicProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ input, ctx }) => {
    const session = await getVisualSession(input.id, ctx.user?.id ?? null);
    if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Visual session not found." });
    const upload = await getVisualUpload(session.uploadId);
    const analysis = await getVisualAnalysisBySession(session.id);
    const followups = await listVisualFollowups(session.id);
    return {
      session: {
        id: session.id,
        question: session.question,
        mode: session.mode,
        depth: session.depth,
        language: session.language,
        status: session.status,
        error: session.error,
        researchSessionId: session.researchSessionId,
        createdAt: session.createdAt,
      },
      image: upload ? { uploadId: upload.id, mime: upload.mime, width: upload.width, height: upload.height } : null,
      analysis: analysis ? {
        analysisId: analysis.analysisId,
        provider: analysis.provider,
        model: analysis.model,
        parsed: analysis.parsed,
        overlaySvg: analysis.overlaySvg,
        diagramSvg: analysis.diagramSvg,
      } : null,
      followups,
    };
  }),

  list: publicProcedure.input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional()).query(({ input, ctx }) => {
    if (!ctx.user) return [] as Array<{ id: number; question: string | null; mode: string; depth: string; status: string; createdAt: Date }>;
    return listVisualSessions(ctx.user.id, input?.limit || 30);
  }),

  followup: publicProcedure.input(z.object({ sessionId: z.number().int().positive(), question: z.string().trim().min(3).max(1000) })).mutation(async ({ input, ctx }) => {
    if (!checkRate(rateKey(ctx), ctx.user ? 60 : 10)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Hourly follow-up limit reached. Try again later." });
    const session = await getVisualSession(input.sessionId, ctx.user?.id ?? null);
    if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Visual session not found." });
    const upload = await getVisualUpload(session.uploadId);
    const analysis = await getVisualAnalysisBySession(session.id);
    if (!upload || !analysis) throw new TRPCError({ code: "NOT_FOUND", message: "The uploaded image or its analysis is no longer available." });
    const startedAt = Date.now();
    const result = await runFollowup({
      imageDataUrl: `data:${upload.mime};base64,${upload.data}`,
      priorAnalysis: analysis.parsed,
      question: input.question,
      depth: session.depth as "intermediate",
      language: session.language,
    });
    await addVisualFollowup({ sessionId: session.id, question: input.question, answer: result.answer, uncertainties: result.uncertainties, provider: result.provider, model: result.model });
    void recordVisualUsage({ userId: ctx.user?.id ?? null, sessionId: session.id, kind: "followup", provider: result.provider, model: result.model, latencyMs: Date.now() - startedAt });
    return result;
  }),

  ocr: publicProcedure.input(z.object({ uploadId: z.number().int().positive(), token: z.string().max(64).optional() })).mutation(async ({ input, ctx }) => {
    if (!checkRate(rateKey(ctx), ctx.user ? 30 : 6)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Hourly OCR limit reached. Try again later." });
    const upload = await canAccessUpload(input.uploadId, ctx.user?.id ?? null, input.token);
    if (!upload) throw new TRPCError({ code: "NOT_FOUND", message: "Image not found or not accessible." });
    const result = await runOcr({ imageDataUrl: `data:${upload.mime};base64,${upload.data}` });
    void recordVisualUsage({ userId: ctx.user?.id ?? null, sessionId: null, kind: "ocr", provider: result.provider, model: result.model });
    return result;
  }),

  feedback: publicProcedure.input(z.object({ analysisId: z.number().int().positive(), rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() })).mutation(async ({ input, ctx }) => {
    await addVisualFeedback({ analysisId: input.analysisId, userId: ctx.user?.id ?? null, rating: input.rating, comment: input.comment });
    void recordEvent("visual.feedback", ctx.user?.id ?? null, { rating: input.rating });
    return { success: true } as const;
  }),

  // Privacy: delete a session and everything attached to it.
  delete: publicProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    const deleted = await deleteVisualSession(input.id, ctx.user?.id ?? null);
    if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "Visual session not found." });
    void recordEvent("visual.deleted", ctx.user?.id ?? null, null);
    return { success: true } as const;
  }),

  // Launch a TruthSearch research run to verify concepts found in the image.
  verify: publicProcedure.input(z.object({ sessionId: z.number().int().positive(), question: z.string().trim().min(8).max(1200) })).mutation(async ({ input, ctx }) => {
    const session = await getVisualSession(input.sessionId, ctx.user?.id ?? null);
    if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Visual session not found." });
    const { conductResearch, RESEARCH_MODES } = await import("../research");
    const analysis = await getVisualAnalysisBySession(session.id);
    const contextText = analysis
      ? `Visual analysis context: ${analysis.parsed.summary}\nVisible text: ${analysis.parsed.textRegions.map((t) => t.text).join(" | ").slice(0, 2000)}`
      : undefined;
    const result = await conductResearch(input.question, () => {}, { contextText }, "verify" as (typeof RESEARCH_MODES)[number]);
    return { answer: result.answer, sources: result.sources.slice(0, 8).map((s) => ({ title: s.title, url: s.url, domain: s.domain })) };
  }),
});

// -- helpers shared with the streaming route -------------------------------
async function updateSessionStatus(id: number, status: "queued" | "analyzing" | "completed" | "failed" | "cancelled", error?: string) {
  const { updateVisualSession } = await import("./db");
  await updateVisualSession(id, { status, error: error ?? null });
}

async function saveAnalysis(sessionId: number, upload: { width: number; height: number }, outcome: Awaited<ReturnType<typeof runAnalysis>>): Promise<number> {
  const { saveVisualAnalysis } = await import("./db");
  // The "explanation" persisted is the structured analysis rendered as
  // readable text — one source of truth, versioned in visual_explanations.
  const explanationText = [
    outcome.analysis.summary,
    ...outcome.analysis.steps.map((step) => `${step.n}. ${step.text}`),
    outcome.analysis.visible.length ? `\nVisible in the image: ${outcome.analysis.visible.join("; ")}` : "",
    outcome.analysis.inferred.length ? `\nInferred (not directly visible): ${outcome.analysis.inferred.join("; ")}` : "",
    outcome.analysis.uncertainties.length ? `\nUncertainties: ${outcome.analysis.uncertainties.join("; ")}` : "",
  ].filter(Boolean).join("\n");
  return saveVisualAnalysis({
    sessionId,
    provider: outcome.provider,
    model: outcome.model,
    imageWidth: upload.width,
    imageHeight: upload.height,
    parsed: outcome.analysis,
    overlaySvg: outcome.overlaySvg,
    diagramSvg: outcome.diagramSvgText,
    droppedRegions: outcome.droppedRegions,
    regions: outcome.regions,
    explanationText,
    latencyMs: outcome.latencyMs,
    promptTokens: outcome.usage?.promptTokens ?? null,
    completionTokens: outcome.usage?.completionTokens ?? null,
  });
}

export { saveAnalysis, updateSessionStatus };
