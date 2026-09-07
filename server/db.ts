import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, researchSessions, researchMessages, researchQueries, researchSources, researchPassages, researchClaims, researchEvidence, researchCitations } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
export async function getDb() { if (!_db && process.env.DATABASE_URL) { try { _db = drizzle(process.env.DATABASE_URL); } catch (error) { console.warn("[Database] Failed to connect:", error); } } return _db; }

// ---------------------------------------------------------------------------
// In-memory fallback store: when DATABASE_URL is absent (e.g. a self-contained
// deployment), research sessions are kept in process memory instead of MySQL.
// Same shapes as the drizzle rows, so routers and the client need no changes.
// ---------------------------------------------------------------------------
type MemSession = { id: number; title: string; question: string; userId: number | null; status: "queued" | "researching" | "completed" | "failed"; answer: string | null; plan: unknown; error: string | null; createdAt: Date; updatedAt: Date };
type MemMessage = { id: number; sessionId: number; role: "user" | "assistant" | "system"; content: string; createdAt: Date };
type MemQuery = { id: number; sessionId: number; query: string; provider: string; status: "planned" | "searched" | "failed"; resultCount: number; createdAt: Date };
type MemSource = { id: number; sessionId: number; url: string; canonicalUrl: string | null; title: string | null; domain: string | null; author: string | null; publicationDate: string | null; sourceType: string | null; qualityScore: number | null; content: string | null };
type MemClaim = { id: number; sessionId: number; claim: string; confidence: number; verificationStatus: "verified" | "mixed" | "unsupported" };
type MemEvidence = { id: number; claimId: number; passageId: number; exactQuote: string; supportScore: number };

const mem = {
  nextId: 1,
  sessions: new Map<number, MemSession>(),
  messages: [] as MemMessage[],
  queries: [] as MemQuery[],
  sources: [] as MemSource[],
  passages: [] as { id: number; sourceId: number; passageIndex: number; text: string; tokenCount: number }[],
  claims: [] as MemClaim[],
  evidence: [] as MemEvidence[],
};
function memId() { return mem.nextId++; }
function touch(s: MemSession | undefined) { if (s) { s.updatedAt = new Date(); } }

export async function upsertUser(user: InsertUser): Promise<void> { if (!user.openId) throw new Error("User openId is required for upsert"); const db = await getDb(); if (!db) return; const values: InsertUser = { openId: user.openId, name: user.name, email: user.email, loginMethod: user.loginMethod, lastSignedIn: user.lastSignedIn || new Date() }; const updateSet: Record<string, unknown> = { ...values }; if (user.role || user.openId === ENV.ownerOpenId) { values.role = user.role || "admin"; updateSet.role = values.role; } await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet }); }
export async function getUserByOpenId(openId: string) { const db = await getDb(); if (!db) return undefined; const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1); return result[0]; }

export async function createSession(question: string, userId?: number) {
  const db = await getDb();
  if (!db) {
    const id = memId();
    const now = new Date();
    mem.sessions.set(id, { id, title: question.slice(0, 120), question, userId: userId ?? null, status: "queued", answer: null, plan: null, error: null, createdAt: now, updatedAt: now });
    return id;
  }
  const result = await db.insert(researchSessions).values({ title: question.slice(0, 120), question, userId, status: "queued" }); return Number(result[0].insertId);
}
export async function updateSession(id: number, patch: Partial<typeof researchSessions.$inferInsert>) {
  const db = await getDb();
  if (!db) { const s = mem.sessions.get(id); if (s) { Object.assign(s, patch); touch(s); } return; }
  await db.update(researchSessions).set(patch).where(eq(researchSessions.id, id));
}
export async function addMessage(sessionId: number, role: "user" | "assistant" | "system", content: string) { const db = await getDb(); if (!db) { mem.messages.push({ id: memId(), sessionId, role, content, createdAt: new Date() }); return; } await db.insert(researchMessages).values({ sessionId, role, content }); }
export async function addQuery(sessionId: number, query: string, provider: string, status: "planned" | "searched" | "failed", resultCount = 0) { const db = await getDb(); if (!db) { mem.queries.push({ id: memId(), sessionId, query, provider, status, resultCount, createdAt: new Date() }); return; } await db.insert(researchQueries).values({ sessionId, query, provider, status, resultCount }); }
export async function addSource(sessionId: number, source: any) {
  const db = await getDb();
  if (!db) {
    const id = memId();
    mem.sources.push({ id, sessionId, url: source.url, canonicalUrl: source.canonicalUrl, title: source.title, domain: source.domain, author: source.author, publicationDate: source.published, sourceType: source.sourceType, qualityScore: source.qualityScore, content: source.content });
    return id;
  }
  const result = await db.insert(researchSources).values({ sessionId, url: source.url, canonicalUrl: source.canonicalUrl, title: source.title, domain: source.domain, author: source.author, publicationDate: source.published, sourceType: source.sourceType, qualityScore: source.qualityScore, content: source.content }); return Number(result[0].insertId);
}
export function matchPassageId(passages: string[], quote: string, ids: number[]) { const index = passages.findIndex((passage) => passage === quote); return index >= 0 ? ids[index] || 0 : 0; }
export function buildVerifiedLink(passages: string[], quote: string, passageRowIds: number[], sourceRowId: number, claimRowId: number) { const passageId = matchPassageId(passages, quote, passageRowIds); return passageId && sourceRowId && claimRowId ? { evidence: { claimId: claimRowId, passageId, exactQuote: quote }, citation: { claimId: claimRowId, sourceId: sourceRowId, verified: 1 } } : null; }
export async function addPassage(sourceId: number, passageIndex: number, text: string) { const db = await getDb(); if (!db) { const id = memId(); mem.passages.push({ id, sourceId, passageIndex, text, tokenCount: text.split(/\s+/).length }); return id; } const result = await db.insert(researchPassages).values({ sourceId, passageIndex, text, tokenCount: text.split(/\s+/).length }); return Number(result[0].insertId); }
export async function addClaim(sessionId: number, claim: string, confidence: number, status: "verified" | "mixed" | "unsupported") { const db = await getDb(); if (!db) { const id = memId(); mem.claims.push({ id, sessionId, claim, confidence, verificationStatus: status }); return id; } const result = await db.insert(researchClaims).values({ sessionId, claim, confidence, verificationStatus: status }); return Number(result[0].insertId); }
export async function addEvidence(claimId: number, passageId: number, quote: string, supportScore: number) { const db = await getDb(); if (!db) { mem.evidence.push({ id: memId(), claimId, passageId, exactQuote: quote, supportScore }); return; } await db.insert(researchEvidence).values({ claimId, passageId, exactQuote: quote, supportScore }); }
export async function addCitation(claimId: number, sourceId: number, verified: boolean) { const db = await getDb(); if (!db) return; await db.insert(researchCitations).values({ claimId, sourceId, verified: verified ? 1 : 0 }); }
export async function listSessions(userId?: number, limit = 30) {
  const db = await getDb();
  if (!db) {
    return Array.from(mem.sessions.values())
      .filter((s) => (userId ? s.userId === userId : true))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, Math.min(Math.max(limit, 1), 100))
      .map((s) => ({ id: s.id, title: s.title, question: s.question, status: s.status, createdAt: s.createdAt, updatedAt: s.updatedAt }));
  }
  const where = userId ? eq(researchSessions.userId, userId) : undefined;
  return db.select({ id: researchSessions.id, title: researchSessions.title, question: researchSessions.question, status: researchSessions.status, createdAt: researchSessions.createdAt, updatedAt: researchSessions.updatedAt }).from(researchSessions).where(where).orderBy(desc(researchSessions.updatedAt)).limit(Math.min(Math.max(limit, 1), 100));
}

export async function getSession(id: number, userId?: number) {
  const db = await getDb();
  if (!db) {
    const session = mem.sessions.get(id);
    if (!session || (userId && session.userId !== userId)) return undefined;
    const messages = mem.messages.filter((m) => m.sessionId === id).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const queries = mem.queries.filter((q) => q.sessionId === id).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const sources = mem.sources.filter((s) => s.sessionId === id).sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0));
    const claims = mem.claims.filter((c) => c.sessionId === id);
    const evidence = claims.length ? mem.evidence.filter((e) => claims.some((c) => c.id === e.claimId)) : [];
    return { session, messages, queries, sources, claims, evidence };
  }
  const where = userId ? and(eq(researchSessions.id, id), eq(researchSessions.userId, userId)) : eq(researchSessions.id, id);
  const session = (await db.select().from(researchSessions).where(where).limit(1))[0];
  if (!session) return undefined;
  const [messages, queries, sources, claims] = await Promise.all([
    db.select().from(researchMessages).where(eq(researchMessages.sessionId, id)).orderBy(researchMessages.createdAt),
    db.select().from(researchQueries).where(eq(researchQueries.sessionId, id)).orderBy(researchQueries.createdAt),
    db.select().from(researchSources).where(eq(researchSources.sessionId, id)).orderBy(desc(researchSources.qualityScore)),
    db.select().from(researchClaims).where(eq(researchClaims.sessionId, id)),
  ]);
  const evidence = claims.length
    ? await db.select().from(researchEvidence).where(inArray(researchEvidence.claimId, claims.map((claim) => claim.id)))
    : [];
  return { session, messages, queries, sources, claims, evidence };
}
