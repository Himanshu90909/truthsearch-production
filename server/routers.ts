import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { addClaim, addCitation, addEvidence, addMessage, addPassage, addQuery, addSource, createSession, getSession, listSessions, matchPassageId, updateSession } from "./db";
import { storagePut } from "./storage";
import { classifyIntent, conductResearch, makeQueries } from "./research";
import { providerRegistry, providerStatuses, providersForIntent } from "./providers/registry";

const questionInput = z.object({ question: z.string().trim().min(8).max(1200) });

async function runResearch(id: number, question: string, userAttachments?: { contextText?: string; imageUrls?: string[] }) {
  try {
    await updateSession(id, { status: "researching" });
    await addMessage(id, "system", "Research started. Progress reflects completed backend actions only.");
    const result = await conductResearch(question, (progress) => { void addMessage(id, "system", `${progress.stage}: ${progress.detail}`); }, userAttachments);
    for (const q of result.plan.queries) await addQuery(id, q, result.plan.providers.join(" + "), "searched", result.sources.length);
    const sourceIds: number[] = []; const passageIds: number[][] = [];
    for (const source of result.sources) { const sourceId = await addSource(id, source); sourceIds.push(sourceId); const ids: number[] = []; for (let i = 0; i < source.passages.length; i++) ids.push(await addPassage(sourceId, i, source.passages[i])); passageIds.push(ids); }
    for (const evidence of result.evidence) { const claimId = await addClaim(id, evidence.claim, evidence.supportScore, "verified"); const source = result.sources[evidence.sourceId]; const passageId = source ? matchPassageId(source.passages, evidence.quote, passageIds[evidence.sourceId] || []) : 0; const sourceId = sourceIds[evidence.sourceId] || 0; if (passageId && sourceId) { await addEvidence(claimId, passageId, evidence.quote, evidence.supportScore); await addCitation(claimId, sourceId, true); } }
    await addMessage(id, "assistant", result.answer);
    await updateSession(id, { status: "completed", answer: result.answer, plan: result.plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research failed for an unknown reason.";
    await addMessage(id, "system", `failed: ${message}`);
    await updateSession(id, { status: "failed", error: message });
  }
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => { const cookieOptions = getSessionCookieOptions(ctx.req); ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 }); return { success: true } as const; }),
  }),
  research: router({
    providers: publicProcedure.query(() => ({ web: process.env.ENABLE_PAID_SEARCH === "true" && (process.env.SEARCH_PROVIDER === "brave" || process.env.SEARCH_PROVIDER === "tavily") ? process.env.SEARCH_PROVIDER : "wikipedia", academic: process.env.ACADEMIC_SEARCH_PROVIDER || "arxiv", paidSearchEnabled: process.env.ENABLE_PAID_SEARCH === "true", configured: true, knowledge: providerStatuses() })),
    health: publicProcedure.query(async () => { const statuses = providerStatuses(); const checks = await Promise.all(statuses.map(async (status) => { const provider = providerRegistry.get(status.name); if (!provider) return status; if (!status.enabled) return status; const healthy = await provider.healthCheck(); return { ...status, status: healthy ? "healthy" as const : "unavailable" as const, ...(healthy ? {} : { reason: "Health check failed or provider is rate limited." }) }; })); return checks; }),
    plan: publicProcedure.input(questionInput).query(({ input }) => { const intent = classifyIntent(input.question); return { queries: makeQueries(input.question, true), intent, providers: providersForIntent(intent), bounded: true, maxRounds: Number(process.env.MAX_RESEARCH_ROUNDS || 3) }; }),
    start: publicProcedure.input(z.object({ question: z.string().trim().min(8).max(1200), contextText: z.string().max(60000).optional(), imageUrls: z.array(z.string().url().max(600)).max(4).optional() })).mutation(async ({ input, ctx }) => { const id = await createSession(input.question, ctx.user?.id); void runResearch(id, input.question, { contextText: input.contextText, imageUrls: input.imageUrls }); return { id }; }),
    list: publicProcedure.input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional()).query(({ input, ctx }) => listSessions(ctx.user?.id, input?.limit || 30)),
    get: publicProcedure.input(z.object({ id: z.number().int().positive() })).query(({ input, ctx }) => getSession(input.id, ctx.user?.id)),
    attachImage: publicProcedure.input(z.object({ filename: z.string().trim().min(1).max(200), dataUrl: z.string().regex(/^data:image\/(jpeg|png|webp);base64,/).max(7_500_000) })).mutation(async ({ input }) => { try { const meta = input.dataUrl.slice(0, input.dataUrl.indexOf(",")); const mime = meta.slice(5, meta.indexOf(";")); const buffer = Buffer.from(input.dataUrl.slice(input.dataUrl.indexOf(",") + 1), "base64"); if (buffer.byteLength > 5 * 1024 * 1024) throw new Error("Image is larger than the 5 MB upload limit."); const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"; const { url } = await storagePut(`attachments/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`, new Uint8Array(buffer), mime); return { url }; } catch (error) { throw new Error(error instanceof Error ? error.message : "Image upload failed. Try another image."); } }),
    extractDocument: publicProcedure.input(z.object({ filename: z.string().trim().min(1).max(200), dataUrl: z.string().min(10).max(11_000_000) })).mutation(async ({ input }) => { try { const base64 = input.dataUrl.includes(",") ? input.dataUrl.slice(input.dataUrl.indexOf(",") + 1) : input.dataUrl; const buffer = Buffer.from(base64, "base64"); const name = input.filename.toLowerCase(); let text = ""; if (name.endsWith(".pdf")) { const { extractText, getDocumentProxy } = await import("unpdf"); const pdf = await getDocumentProxy(new Uint8Array(buffer)); const extracted = await extractText(pdf, { mergePages: true }); text = extracted.text || ""; } else if (name.endsWith(".docx")) { const mammoth = await import("mammoth"); const extracted = await mammoth.extractRawText({ buffer }); text = extracted.value || ""; } else if (name.endsWith(".xlsx")) { const xlsx = await import("xlsx"); const workbook = xlsx.read(buffer, { type: "buffer" }); text = workbook.SheetNames.map((sheetName) => `--- Sheet: ${sheetName} ---\n${xlsx.utils.sheet_to_csv(workbook.Sheets[sheetName])}`).join("\n\n"); } else if (name.endsWith(".txt") || name.endsWith(".csv") || name.endsWith(".md")) { text = buffer.toString("utf-8"); } else if (name.endsWith(".doc")) { throw new Error("Legacy .doc files are not supported — please upload the .docx version."); } else { throw new Error("That document type is not supported. Use PDF, DOCX, XLSX, TXT, CSV, or MD."); } const clean = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim(); if (clean.length < 60) throw new Error("No readable text could be extracted from this document."); return { text: clean.slice(0, 60000), characters: clean.length }; } catch (error) { throw new Error(error instanceof Error ? error.message : "Document processing failed. Try another file."); } }),
    followUp: publicProcedure.input(z.object({ id: z.number().int().positive(), question: z.string().trim().min(8).max(1200) })).mutation(async ({ input, ctx }) => { const existing = await getSession(input.id, ctx.user?.id); if (!existing) throw new Error("Research session not found."); await addMessage(input.id, "user", input.question); const context = existing.session.answer ? `\nPrevious verified answer:\n${existing.session.answer.slice(0, 30000)}` : ""; const followUpQuestion = `${existing.session.question}\nFollow-up question: ${input.question}${context}`; const newId = await createSession(`${existing.session.question}\nFollow-up: ${input.question}`, ctx.user?.id); void runResearch(newId, followUpQuestion); return { id: newId }; }),
  }),
});
export type AppRouter = typeof appRouter;
