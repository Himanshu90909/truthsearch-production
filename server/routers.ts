import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { addClaim, addCitation, addEvidence, addMessage, addPassage, addQuery, addSource, createSession, getSession, matchPassageId, updateSession } from "./db";
import { classifyIntent, conductResearch, makeQueries } from "./research";
import { providerRegistry, providerStatuses, providersForIntent } from "./providers/registry";

const questionInput = z.object({ question: z.string().trim().min(8).max(1200) });

async function runResearch(id: number, question: string) {
  try {
    await updateSession(id, { status: "researching" });
    await addMessage(id, "system", "Research started. Progress reflects completed backend actions only.");
    const result = await conductResearch(question, (progress) => { void addMessage(id, "system", `${progress.stage}: ${progress.detail}`); });
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
    start: publicProcedure.input(questionInput).mutation(async ({ input, ctx }) => { const id = await createSession(input.question, ctx.user?.id); void runResearch(id, input.question); return { id }; }),
    get: publicProcedure.input(z.object({ id: z.number().int().positive() })).query(({ input, ctx }) => getSession(input.id, ctx.user?.id)),
    followUp: publicProcedure.input(z.object({ id: z.number().int().positive(), question: z.string().trim().min(8).max(1200) })).mutation(async ({ input, ctx }) => { const existing = await getSession(input.id, ctx.user?.id); if (!existing) throw new Error("Research session not found."); await addMessage(input.id, "user", input.question); const newId = await createSession(`${existing.session.question}\nFollow-up: ${input.question}`, ctx.user?.id); void runResearch(newId, `${existing.session.question}\nFollow-up question: ${input.question}`); return { id: newId }; }),
  }),
});
export type AppRouter = typeof appRouter;
