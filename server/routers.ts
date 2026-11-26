import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { parse as parseCookieHeader } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { extractClaims, verifyClaims, type SourceRef } from "./verification/claims";
import { addContradiction, addClaim, addCitation, addEvidence, addMessage, addPassage, addQuery, addSource, createSession, createCollection, createLocalSession, createLocalUser, deleteCollection, deleteLocalSession, eventMetrics, getSession, getUserByEmail, listCollections, listSessions, matchPassageId, recordEvent, recordResearchFeedback, setSessionCollection, updateSession } from "./db";
import { LOCAL_SESSION_COOKIE, SESSION_TTL_MS, hashPassword, normalizeEmail, validateEmail, verifyPassword } from "./auth-local";
import { storagePut } from "./storage";
import { buildModeQueries, classifyIntent, conductResearch, makeQueries, RESEARCH_MODES } from "./research";
import { providerRegistry, providerStatuses, providersForIntent } from "./providers/registry";
import { PostgresRateLimitStore, listAudit, spentToday, writeAudit } from "./db";
import { MemoryRateLimitStore, callerKey, checkRateLimit, hourlyLimitFor, type RateLimitStore } from "./platform/ratelimit";
import { evaluateBudget, readBudgetPolicy } from "./platform/budget";
import { safeEqual } from "./platform/admin-token";
import { adminProcedure } from "./_core/trpc";
import { gnaniConfigured, gnaniSpeak, gnaniTranscribe, STT_LANGUAGES, TTS_LANGUAGES } from "./gnani";

const questionInput = z.object({ question: z.string().trim().min(8).max(1200) });

// On serverless hosts (Vercel) background promises die when the response is
// sent, so research runs synchronously there by default. SYNC_RESEARCH=false forces
// the fire-and-forget behaviour (standalone server with a real database).
const SYNC_RESEARCH = process.env.SYNC_RESEARCH ? process.env.SYNC_RESEARCH === "true" : process.env.VERCEL === "1";

import type { ResearchMode } from "./research";
async function runResearch(id: number, question: string, userId: number | null, userAttachments: { contextText?: string; imageUrls?: string[]; imageDataUrls?: string[] } | undefined, mode: ResearchMode) {
  const startedAt = Date.now();
  try {
    await updateSession(id, { status: "researching" });
    await addMessage(id, "system", "Research started. Progress reflects completed backend actions only.");
    const result = await conductResearch(question, (progress) => { void addMessage(id, "system", `${progress.stage}: ${progress.detail}`); }, userAttachments, mode);
    for (const q of result.plan.queries) await addQuery(id, q, result.plan.providers.join(" + "), "searched", result.sources.length);
    const sourceIds: number[] = []; const passageIds: number[][] = [];
    for (const source of result.sources) { const sourceId = await addSource(id, source); sourceIds.push(sourceId); const ids: number[] = []; for (let i = 0; i < source.passages.length; i++) ids.push(await addPassage(sourceId, i, source.passages[i])); passageIds.push(ids); }
    // Claim-level verification (spec D). Claims come from the ANSWER the user reads; each is checked against the
    // retrieved passages. A claim is "verified" only with >= 2 independent domains and no credible contradiction.
    // Nothing is defaulted to verified, and model agreement is never an input.
    const refs: SourceRef[] = result.sources.map((src, i) => ({ id: i, url: src.canonicalUrl, domain: src.domain, title: src.title, publishedAt: src.published || null, credibility: src.qualityScore ?? 0 }));
    const allPassages = result.sources.flatMap((src, i) => src.passages.map((text) => ({ sourceId: i, text })));
    const verdicts = verifyClaims(extractClaims(result.answer, 14), refs, allPassages);
    for (const v of verdicts) {
      const claimId = await addClaim(id, v.claim, v.confidence, v.status, v.explanation);
      for (const kind of ["supporting", "contradicting"] as const) {
        for (const e of v[kind].slice(0, 3)) {
          const sourceId = sourceIds[e.source.id] || 0; const passageId = matchPassageId(result.sources[e.source.id]?.passages || [], e.passage, passageIds[e.source.id] || []);
          if (kind === "supporting" && passageId && sourceId) { await addEvidence(claimId, passageId, e.passage, e.relevance); await addCitation(claimId, sourceId, true); }
          if (kind === "contradicting" && sourceId) { await addContradiction(id, claimId, `${e.source.domain}: ${e.passage.slice(0, 280)}`, [sourceId]); }
        }
      }
    }
    await addMessage(id, "assistant", result.answer);
    await updateSession(id, { status: "completed", answer: result.answer, plan: result.plan });
    void recordEvent("research.completed", userId, { latencyMs: Date.now() - startedAt, sources: result.sources.length, mode });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research failed for an unknown reason.";
    await addMessage(id, "system", `failed: ${message}`);
    await updateSession(id, { status: "failed", error: message });
    void recordEvent("research.failed", userId, { latencyMs: Date.now() - startedAt, error: message.slice(0, 200), mode });
  }
}

// ---------------------------------------------------------------------------
// Usage guards: sliding-window hourly limits, per signed-in user or client IP.
// In-memory (per instance) — good enough for a public beta; swap for Redis when
// the queue-backed worker phase lands.
// ---------------------------------------------------------------------------
const RATE_WINDOW_MS = 60 * 60 * 1000;
// Shared limiter: Postgres when DATABASE_URL is set (so every serverless instance sees the same counters), memory otherwise.
const rateStore: RateLimitStore = process.env.DATABASE_URL ? new PostgresRateLimitStore() : new MemoryRateLimitStore();
const memoryFallback = new MemoryRateLimitStore();
async function enforceQuota(ctx: { user: { id: number; role?: string } | null; req: { headers: Record<string, unknown> } }): Promise<void> {
  const key = callerKey(ctx.user, ctx.req.headers["x-forwarded-for"]);
  let decision;
  try { decision = await checkRateLimit(rateStore, key, hourlyLimitFor(ctx.user), RATE_WINDOW_MS); }
  catch { decision = await checkRateLimit(memoryFallback, key, hourlyLimitFor(ctx.user), RATE_WINDOW_MS); } // never fail open on a store outage
  if (!decision.allowed) {
    void writeAudit({ userId: ctx.user?.id ?? null, action: "ratelimit.blocked", target: key, meta: { limit: decision.limit } });
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Hourly research limit reached. Try again in ${Math.ceil(decision.retryAfterSec / 60)} min${ctx.user ? "" : ", or sign in for a higher limit"}.` });
  }
  const policy = readBudgetPolicy();
  const [mine, everyone] = await Promise.all([ctx.user ? spentToday(ctx.user.id) : Promise.resolve({ tokens: 0, usd: 0 }), spentToday(null)]);
  const budget = evaluateBudget(policy, { userTokens: mine.tokens, globalTokens: everyone.tokens, globalUsd: everyone.usd });
  if (!budget.allowed) {
    void writeAudit({ userId: ctx.user?.id ?? null, action: "budget.blocked", target: key, meta: { reason: budget.reason } });
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: budget.reason === "user_tokens" ? "Your daily usage budget is used up. It resets at 00:00 UTC." : "The service has reached its daily usage budget. Please try again tomorrow." });
  }
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user ? { id: opts.ctx.user.id, name: opts.ctx.user.name, email: opts.ctx.user.email, role: opts.ctx.user.role } : null),
    register: publicProcedure.input(z.object({ email: z.string().trim().max(320), password: z.string().min(8).max(200), name: z.string().trim().min(1).max(80).optional() })).mutation(async ({ input, ctx }) => {
      const email = normalizeEmail(input.email);
      if (!validateEmail(email)) throw new Error("Enter a valid email address.");
      if (await getUserByEmail(email)) throw new Error("An account with that email already exists — sign in instead.");
      const passwordHash = await hashPassword(input.password);
      const user = await createLocalUser({ email, name: input.name ?? email.split("@")[0], passwordHash });
      const { token } = await createLocalSession(user.id);
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(LOCAL_SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_TTL_MS });
      void recordEvent("account.registered", user.id, { domain: email.split("@")[1] ?? null }); void writeAudit({ userId: user.id, action: "auth.register" });
      return { user: { id: user.id, name: user.name, email: user.email, role: user.role } };
    }),
    login: publicProcedure.input(z.object({ email: z.string().trim().max(320), password: z.string().min(1).max(200) })).mutation(async ({ input, ctx }) => {
      const email = normalizeEmail(input.email);
      const user = await getUserByEmail(email);
      const bad = async () => { void writeAudit({ userId: user?.id ?? null, action: "auth.login_failed", ip: String(ctx.req.headers["x-forwarded-for"] ?? "").split(",")[0].trim().slice(0, 64) || null }); throw new Error("Email or password is incorrect."); };
      if (!user || !user.passwordHash) return bad();
      if (!(await verifyPassword(input.password, user.passwordHash))) return bad();
      const { token } = await createLocalSession(user.id);
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(LOCAL_SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_TTL_MS });
      void recordEvent("account.login", user.id, null); void writeAudit({ userId: user.id, action: "auth.login", ip: String(ctx.req.headers["x-forwarded-for"] ?? "").split(",")[0].trim().slice(0, 64) || null });
      return { user: { id: user.id, name: user.name, email: user.email, role: user.role } };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      const token = parseCookieHeader(ctx.req.headers.cookie ?? "")[LOCAL_SESSION_COOKIE];
      if (token) { void deleteLocalSession(token); ctx.res.clearCookie(LOCAL_SESSION_COOKIE, { ...cookieOptions, maxAge: -1 }); }
      return { success: true } as const;
    }),
  }),
  research: router({
    providers: publicProcedure.query(() => ({ web: process.env.ENABLE_PAID_SEARCH === "true" && (process.env.SEARCH_PROVIDER === "brave" || process.env.SEARCH_PROVIDER === "tavily") ? process.env.SEARCH_PROVIDER : "duckduckgo", academic: process.env.ACADEMIC_SEARCH_PROVIDER || "arxiv", paidSearchEnabled: process.env.ENABLE_PAID_SEARCH === "true", configured: true, knowledge: providerStatuses() })),
    health: publicProcedure.query(async () => { const statuses = providerStatuses(); const checks = await Promise.all(statuses.map(async (status) => { const provider = providerRegistry.get(status.name); if (!provider) return status; if (!status.enabled) return status; const healthy = await provider.healthCheck(); return { ...status, status: healthy ? "healthy" as const : "unavailable" as const, ...(healthy ? {} : { reason: "Health check failed or provider is rate limited." }) }; })); return checks; }),
    plan: publicProcedure.input(z.object({ question: questionInput.shape.question, mode: z.enum(RESEARCH_MODES).default("quick") })).query(({ input }) => { const intent = classifyIntent(input.question); return { queries: buildModeQueries(input.question, input.mode), mode: input.mode, intent, providers: providersForIntent(intent), bounded: true, maxRounds: Number(process.env.MAX_RESEARCH_ROUNDS || 3) }; }),
    start: publicProcedure.input(z.object({ question: z.string().trim().min(8).max(1200), mode: z.enum(RESEARCH_MODES).default("quick"), contextText: z.string().max(60000).optional(), imageUrls: z.array(z.string().url().max(600)).max(4).optional(), imageDataUrls: z.array(z.string().regex(/^data:image\/(jpeg|png|webp);base64,/).max(1_600_000)).max(4).optional() })).mutation(async ({ input, ctx }) => { await enforceQuota(ctx); void writeAudit({ userId: ctx.user?.id ?? null, action: "research.start", meta: { mode: input.mode } }); const id = await createSession(input.question, ctx.user?.id); void recordEvent("research.started", ctx.user?.id ?? null, { mode: input.mode }); const research = runResearch(id, input.question, ctx.user?.id ?? null, { contextText: input.contextText, imageUrls: input.imageUrls, imageDataUrls: input.imageDataUrls }, input.mode); if (SYNC_RESEARCH) await research; else void research; return { id }; }),
    list: publicProcedure.input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional()).query(({ input, ctx }) => listSessions(ctx.user?.id, input?.limit || 30)),
    get: publicProcedure.input(z.object({ id: z.number().int().positive() })).query(({ input, ctx }) => getSession(input.id, ctx.user?.id)),
    attachImage: publicProcedure.input(z.object({ filename: z.string().trim().min(1).max(200), dataUrl: z.string().regex(/^data:image\/(jpeg|png|webp);base64,/).max(7_500_000) })).mutation(async ({ input }) => { try { const meta = input.dataUrl.slice(0, input.dataUrl.indexOf(",")); const mime = meta.slice(5, meta.indexOf(";")); const buffer = Buffer.from(input.dataUrl.slice(input.dataUrl.indexOf(",") + 1), "base64"); if (buffer.byteLength > 5 * 1024 * 1024) throw new Error("Image is larger than the 5 MB upload limit."); const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"; const { url } = await storagePut(`attachments/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`, new Uint8Array(buffer), mime); return { url }; } catch (error) { throw new Error(error instanceof Error ? error.message : "Image upload failed. Try another image."); } }),
    extractDocument: publicProcedure.input(z.object({ filename: z.string().trim().min(1).max(200), dataUrl: z.string().min(10).max(11_000_000) })).mutation(async ({ input }) => { try { const base64 = input.dataUrl.includes(",") ? input.dataUrl.slice(input.dataUrl.indexOf(",") + 1) : input.dataUrl; const buffer = Buffer.from(base64, "base64"); const name = input.filename.toLowerCase(); let text = ""; if (name.endsWith(".pdf")) { const { extractText, getDocumentProxy } = await import("unpdf"); const pdf = await getDocumentProxy(new Uint8Array(buffer)); const extracted = await extractText(pdf, { mergePages: true }); text = extracted.text || ""; } else if (name.endsWith(".docx")) { const mammoth = await import("mammoth"); const extracted = await mammoth.extractRawText({ buffer }); text = extracted.value || ""; } else if (name.endsWith(".xlsx")) { const xlsx = await import("xlsx"); const workbook = xlsx.read(buffer, { type: "buffer" }); text = workbook.SheetNames.map((sheetName) => `--- Sheet: ${sheetName} ---\n${xlsx.utils.sheet_to_csv(workbook.Sheets[sheetName])}`).join("\n\n"); } else if (name.endsWith(".txt") || name.endsWith(".csv") || name.endsWith(".md")) { text = buffer.toString("utf-8"); } else if (name.endsWith(".doc")) { throw new Error("Legacy .doc files are not supported — please upload the .docx version."); } else { throw new Error("That document type is not supported. Use PDF, DOCX, XLSX, TXT, CSV, or MD."); } const clean = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim(); if (clean.length < 60) throw new Error("No readable text could be extracted from this document."); return { text: clean.slice(0, 60000), characters: clean.length }; } catch (error) { throw new Error(error instanceof Error ? error.message : "Document processing failed. Try another file."); } }),
    feedback: publicProcedure.input(z.object({ sessionId: z.number().int().positive(), helpful: z.boolean(), reason: z.enum(["incorrect_information", "bad_source", "missing_information", "citation_problem", "too_long", "too_short"]).optional() })).mutation(async ({ input, ctx }) => { const existing = await getSession(input.sessionId, ctx.user?.id); if (!existing) throw new Error("Research session not found."); await recordResearchFeedback(input.sessionId, ctx.user?.id ?? null, input.helpful, input.reason ?? null); void recordEvent("research.feedback", ctx.user?.id ?? null, { sessionId: input.sessionId, helpful: input.helpful, reason: input.reason ?? null }); return { ok: true }; }),
  followUp: publicProcedure.input(z.object({ id: z.number().int().positive(), question: z.string().trim().min(8).max(1200) })).mutation(async ({ input, ctx }) => { const existing = await getSession(input.id, ctx.user?.id); if (!existing) throw new Error("Research session not found."); await addMessage(input.id, "user", input.question); const context = existing.session.answer ? `\nPrevious verified answer:\n${existing.session.answer.slice(0, 30000)}` : ""; const followUpQuestion = `${existing.session.question}\nFollow-up question: ${input.question}${context}`; const newId = await createSession(`${existing.session.question}\nFollow-up: ${input.question}`, ctx.user?.id); const research = runResearch(newId, followUpQuestion, ctx.user?.id ?? null, undefined, ((existing.session.plan as { mode?: "quick" | "deep" | "academic" | "verify" } | null)?.mode) || "quick"); if (SYNC_RESEARCH) await research; else void research; return { id: newId }; }),
  }),
  collections: router({
    list: publicProcedure.query(({ ctx }) => { if (!ctx.user) throw new Error("Sign in to use collections."); return listCollections(ctx.user.id); }),
    create: publicProcedure.input(z.object({ name: z.string().trim().min(1).max(120) })).mutation(async ({ input, ctx }) => { if (!ctx.user) throw new Error("Sign in to use collections."); const id = await createCollection(ctx.user.id, input.name); void recordEvent("collection.created", ctx.user.id, null); return { id }; }),
    remove: publicProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => { if (!ctx.user) throw new Error("Sign in to use collections."); await deleteCollection(ctx.user.id, input.id); return { success: true } as const; }),
    assign: publicProcedure.input(z.object({ sessionId: z.number().int().positive(), collectionId: z.number().int().positive().nullable() })).mutation(async ({ input, ctx }) => { if (!ctx.user) throw new Error("Sign in to use collections."); await setSessionCollection(input.sessionId, ctx.user.id, input.collectionId); return { success: true } as const; }),
  }),
  gnani: router({
    // Voice layer backed by Gnani AI (api.vachana.ai):
    //  - transcribe: speak your research question (Prisma v2.5 STT)
    //  - speak: hear the answer read aloud (Timbre v2.5 TTS)
    available: publicProcedure.query(() => ({ configured: gnaniConfigured() })),
    transcribe: publicProcedure.input(z.object({ audioBase64: z.string().min(10).max(15_000_000), mimeType: z.string().trim().min(3).max(60).default("audio/wav"), languageCode: z.enum(STT_LANGUAGES).default("indic-auto") })).mutation(async ({ input }) => { if (!gnaniConfigured()) throw new Error("Voice input is not configured on this deployment: set GNANI_API_KEY."); try { return await gnaniTranscribe({ audioBase64: input.audioBase64, mimeType: input.mimeType, languageCode: input.languageCode }); } catch (error) { throw new Error(error instanceof Error ? error.message : "Transcription failed."); } }),
    speak: publicProcedure.input(z.object({ text: z.string().trim().min(1).max(6000), language: z.enum(TTS_LANGUAGES).default("auto"), voice: z.string().trim().min(1).max(60).optional() })).mutation(async ({ input }) => { if (!gnaniConfigured()) throw new Error("Spoken answers are not configured on this deployment: set GNANI_API_KEY."); try { return await gnaniSpeak({ text: input.text, language: input.language, voice: input.voice }); } catch (error) { throw new Error(error instanceof Error ? error.message : "Speech synthesis failed."); } }),
  }),
  admin: router({
    // Admin-only. The old public endpoint that accepted a shared token in the request body is gone. A monitoring
    // service may still call this with the x-admin-token header (compared in constant time); browsers use role=admin.
    metrics: publicProcedure.input(z.object({ days: z.number().int().min(1).max(90).optional() }).optional()).query(async ({ input, ctx }) => {
      const configured = (process.env.ADMIN_METRICS_TOKEN || "").trim();
      const header = ctx.req.headers["x-admin-token"];
      const viaHeader = configured !== "" && typeof header === "string" && safeEqual(header.trim(), configured);
      if (ctx.user?.role !== "admin" && !viaHeader) throw new TRPCError({ code: "UNAUTHORIZED", message: "Admin access required." });
      void writeAudit({ userId: ctx.user?.id ?? null, action: "admin.metrics_view", meta: { via: viaHeader ? "token" : "role" } });
      return eventMetrics(input?.days ?? 30);
    }),
    audit: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional()).query(({ input }) => listAudit(input?.limit ?? 100)),
  }),
});
export type AppRouter = typeof appRouter;
