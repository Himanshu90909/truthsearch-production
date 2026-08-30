import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { addMessage, addQuery, addSource, createSession, getSession, updateSession } from "./db";
import { conductResearch, makeQueries } from "./research";

const questionInput = z.object({ question: z.string().trim().min(8).max(1200) });

async function runResearch(id: number, question: string) {
  try {
    await updateSession(id, { status: "researching" });
    await addMessage(id, "system", "Research started. Progress reflects completed backend actions only.");
    const result = await conductResearch(question, (progress) => { void addMessage(id, "system", `${progress.stage}: ${progress.detail}`); });
    for (const q of result.plan.queries) await addQuery(id, q, result.plan.providers.join(" + "), "searched", result.sources.length);
    for (const source of result.sources) await addSource(id, source);
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
    providers: publicProcedure.query(() => ({ web: process.env.SEARCH_PROVIDER || "wikipedia", academic: process.env.ACADEMIC_SEARCH_PROVIDER || "semanticScholar", configured: true })),
    plan: publicProcedure.input(questionInput).query(({ input }) => ({ queries: makeQueries(input.question, true), bounded: true, maxRounds: Number(process.env.MAX_RESEARCH_ROUNDS || 3) })),
    start: publicProcedure.input(questionInput).mutation(async ({ input, ctx }) => { const id = await createSession(input.question, ctx.user?.id); void runResearch(id, input.question); return { id }; }),
    get: publicProcedure.input(z.object({ id: z.number().int().positive() })).query(({ input, ctx }) => getSession(input.id, ctx.user?.id)),
    followUp: publicProcedure.input(z.object({ id: z.number().int().positive(), question: z.string().trim().min(8).max(1200) })).mutation(async ({ input, ctx }) => { const existing = await getSession(input.id, ctx.user?.id); if (!existing) throw new Error("Research session not found."); await addMessage(input.id, "user", input.question); const newId = await createSession(`${existing.session.question}\nFollow-up: ${input.question}`, ctx.user?.id); void runResearch(newId, `${existing.session.question}\nFollow-up question: ${input.question}`); return { id: newId }; }),
  }),
});
export type AppRouter = typeof appRouter;
