import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { InsertUser, users, researchSessions, researchMessages, researchQueries, researchSources, researchPassages, researchClaims, researchEvidence, researchCitations, localSessions, collections, analyticsEvents, researchFeedback } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { SESSION_TTL_MS, newSessionToken } from "./auth-local";

let _db: ReturnType<typeof drizzle> | null = null;
let _schemaReady: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Idempotent, self-healing schema bootstrap. Creates every table on first
// request after a cold start, and if a table pre-exists with an incompatible
// shape (e.g. leftover from an aborted earlier setup), it is dropped and
// recreated. Tables with the correct shape are never touched.
// ---------------------------------------------------------------------------
const TYPE_STMTS = [
  `DO $$ BEGIN CREATE TYPE "role" AS ENUM ('user', 'admin'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
  `DO $$ BEGIN CREATE TYPE "session_status" AS ENUM ('queued', 'researching', 'completed', 'failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
  `DO $$ BEGIN CREATE TYPE "message_role" AS ENUM ('user', 'assistant', 'system'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
  `DO $$ BEGIN CREATE TYPE "query_status" AS ENUM ('planned', 'searched', 'failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
  `DO $$ BEGIN CREATE TYPE "verification_status" AS ENUM ('verified', 'mixed', 'unsupported'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
  `DO $$ BEGIN CREATE TYPE "visual_status" AS ENUM ('queued', 'analyzing', 'completed', 'failed', 'cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
];

const TABLE_COLUMNS: Record<string, string[]> = {
  users: ["id", "openId", "name", "email", "loginMethod", "role", "passwordHash", "createdAt", "updatedAt", "lastSignedIn"],
  research_sessions: ["id", "userId", "title", "question", "status", "answer", "plan", "error", "collectionId", "createdAt", "updatedAt"],
  research_messages: ["id", "sessionId", "role", "content", "createdAt"],
  research_queries: ["id", "sessionId", "query", "provider", "status", "resultCount", "createdAt"],
  research_sources: ["id", "sessionId", "queryId", "url", "canonicalUrl", "title", "domain", "author", "publicationDate", "sourceType", "qualityScore", "content", "retrievedAt"],
  research_passages: ["id", "sourceId", "passageIndex", "text", "tokenCount", "bm25Score", "denseScore", "fusedScore", "rerankScore"],
  research_claims: ["id", "sessionId", "claim", "confidence", "verificationStatus"],
  research_evidence: ["id", "claimId", "passageId", "supportScore", "exactQuote"],
  research_contradictions: ["id", "sessionId", "claimId", "description", "sourceIds"],
  research_citations: ["id", "claimId", "sourceId", "verified"],
  local_sessions: ["id", "token", "userId", "createdAt", "expiresAt"],
  collections: ["id", "userId", "name", "createdAt"],
  analytics_events: ["id", "userId", "type", "meta", "createdAt"],
  visual_uploads: ["id", "token", "userId", "mime", "byteSize", "width", "height", "data", "createdAt", "expiresAt"],
  visual_sessions: ["id", "userId", "uploadId", "question", "mode", "depth", "language", "status", "error", "researchSessionId", "createdAt", "updatedAt"],
  visual_analyses: ["id", "sessionId", "provider", "model", "imageWidth", "imageHeight", "parsed", "overlaySvg", "diagramSvg", "droppedRegions", "latencyMs", "promptTokens", "completionTokens", "createdAt"],
  visual_annotations: ["id", "analysisId", "regionIndex", "label", "kind", "bbox", "note", "confidence", "createdAt"],
  visual_explanations: ["id", "analysisId", "text", "version", "createdAt"],
  visual_followups: ["id", "sessionId", "question", "answer", "uncertainties", "provider", "model", "createdAt"],
  visual_feedback: ["id", "analysisId", "userId", "rating", "comment", "createdAt"],
  research_feedback: ["id", "sessionId", "userId", "rating", "reason", "createdAt"],
  visual_usage: ["id", "userId", "sessionId", "kind", "provider", "model", "promptTokens", "completionTokens", "latencyMs", "createdAt"],
};

const CREATE_STMTS: Record<string, string> = {
  users: `CREATE TABLE IF NOT EXISTS "users" ("id" serial PRIMARY KEY NOT NULL, "openId" varchar(64) NOT NULL UNIQUE, "name" text, "email" varchar(320), "loginMethod" varchar(64), "role" "role" DEFAULT 'user' NOT NULL, "passwordHash" text, "createdAt" timestamp DEFAULT now() NOT NULL, "updatedAt" timestamp DEFAULT now() NOT NULL, "lastSignedIn" timestamp DEFAULT now() NOT NULL);`,
  research_sessions: `CREATE TABLE IF NOT EXISTS "research_sessions" ("id" serial PRIMARY KEY NOT NULL, "userId" integer, "title" varchar(500) NOT NULL, "question" text NOT NULL, "status" "session_status" DEFAULT 'queued' NOT NULL, "answer" text, "plan" json, "error" text, "collectionId" integer, "createdAt" timestamp DEFAULT now() NOT NULL, "updatedAt" timestamp DEFAULT now() NOT NULL);`,
  research_messages: `CREATE TABLE IF NOT EXISTS "research_messages" ("id" serial PRIMARY KEY NOT NULL, "sessionId" integer NOT NULL, "role" "message_role" NOT NULL, "content" text NOT NULL, "createdAt" timestamp DEFAULT now() NOT NULL);`,
  research_queries: `CREATE TABLE IF NOT EXISTS "research_queries" ("id" serial PRIMARY KEY NOT NULL, "sessionId" integer NOT NULL, "query" varchar(1000) NOT NULL, "provider" varchar(64) NOT NULL, "status" "query_status" DEFAULT 'planned' NOT NULL, "resultCount" integer DEFAULT 0 NOT NULL, "createdAt" timestamp DEFAULT now() NOT NULL);`,
  research_sources: `CREATE TABLE IF NOT EXISTS "research_sources" ("id" serial PRIMARY KEY NOT NULL, "sessionId" integer NOT NULL, "queryId" integer, "url" varchar(2048) NOT NULL, "canonicalUrl" varchar(2048) NOT NULL, "title" text NOT NULL, "domain" varchar(255) NOT NULL, "author" text, "publicationDate" varchar(128), "sourceType" varchar(64) NOT NULL, "qualityScore" integer NOT NULL, "content" text, "retrievedAt" timestamp DEFAULT now() NOT NULL);`,
  research_passages: `CREATE TABLE IF NOT EXISTS "research_passages" ("id" serial PRIMARY KEY NOT NULL, "sourceId" integer NOT NULL, "passageIndex" integer NOT NULL, "text" text NOT NULL, "tokenCount" integer NOT NULL, "bm25Score" integer, "denseScore" integer, "fusedScore" integer, "rerankScore" integer);`,
  research_claims: `CREATE TABLE IF NOT EXISTS "research_claims" ("id" serial PRIMARY KEY NOT NULL, "sessionId" integer NOT NULL, "claim" text NOT NULL, "confidence" integer NOT NULL, "verificationStatus" "verification_status" NOT NULL);`,
  research_evidence: `CREATE TABLE IF NOT EXISTS "research_evidence" ("id" serial PRIMARY KEY NOT NULL, "claimId" integer NOT NULL, "passageId" integer NOT NULL, "supportScore" integer NOT NULL, "exactQuote" text NOT NULL);`,
  research_contradictions: `CREATE TABLE IF NOT EXISTS "research_contradictions" ("id" serial PRIMARY KEY NOT NULL, "sessionId" integer NOT NULL, "claimId" integer NOT NULL, "description" text NOT NULL, "sourceIds" json NOT NULL);`,
  research_citations: `CREATE TABLE IF NOT EXISTS "research_citations" ("id" serial PRIMARY KEY NOT NULL, "claimId" integer NOT NULL, "sourceId" integer NOT NULL, "verified" integer DEFAULT 0 NOT NULL);`,
  local_sessions: `CREATE TABLE IF NOT EXISTS "local_sessions" ("id" serial PRIMARY KEY NOT NULL, "token" varchar(128) NOT NULL UNIQUE, "userId" integer NOT NULL, "createdAt" timestamp DEFAULT now() NOT NULL, "expiresAt" timestamp NOT NULL);`,
  collections: `CREATE TABLE IF NOT EXISTS "collections" ("id" serial PRIMARY KEY NOT NULL, "userId" integer NOT NULL, "name" varchar(120) NOT NULL, "createdAt" timestamp DEFAULT now() NOT NULL);`,
  analytics_events: `CREATE TABLE IF NOT EXISTS "analytics_events" ("id" serial PRIMARY KEY NOT NULL, "userId" integer, "type" varchar(64) NOT NULL, "meta" json, "createdAt" timestamp DEFAULT now() NOT NULL);`,
  visual_uploads: `CREATE TABLE IF NOT EXISTS "visual_uploads" ("id" serial PRIMARY KEY NOT NULL, "token" varchar(64) NOT NULL UNIQUE, "userId" integer, "mime" varchar(64) NOT NULL, "byteSize" integer NOT NULL, "width" integer NOT NULL, "height" integer NOT NULL, "data" text NOT NULL, "createdAt" timestamp DEFAULT now() NOT NULL, "expiresAt" timestamp);`,
  visual_sessions: `CREATE TABLE IF NOT EXISTS "visual_sessions" ("id" serial PRIMARY KEY NOT NULL, "userId" integer, "uploadId" integer NOT NULL, "question" text, "mode" varchar(24) NOT NULL, "depth" varchar(24) NOT NULL, "language" varchar(8) NOT NULL, "status" "visual_status" DEFAULT 'queued' NOT NULL, "error" text, "researchSessionId" integer, "createdAt" timestamp DEFAULT now() NOT NULL, "updatedAt" timestamp DEFAULT now() NOT NULL);`,
  visual_analyses: `CREATE TABLE IF NOT EXISTS "visual_analyses" ("id" serial PRIMARY KEY NOT NULL, "sessionId" integer NOT NULL, "provider" varchar(64) NOT NULL, "model" varchar(160) NOT NULL, "imageWidth" integer NOT NULL, "imageHeight" integer NOT NULL, "parsed" json NOT NULL, "overlaySvg" text, "diagramSvg" text, "droppedRegions" integer DEFAULT 0 NOT NULL, "latencyMs" integer, "promptTokens" integer, "completionTokens" integer, "createdAt" timestamp DEFAULT now() NOT NULL);`,
  visual_annotations: `CREATE TABLE IF NOT EXISTS "visual_annotations" ("id" serial PRIMARY KEY NOT NULL, "analysisId" integer NOT NULL, "regionIndex" integer NOT NULL, "label" varchar(160) NOT NULL, "kind" varchar(24) NOT NULL, "bbox" json NOT NULL, "note" text, "confidence" integer, "createdAt" timestamp DEFAULT now() NOT NULL);`,
  visual_explanations: `CREATE TABLE IF NOT EXISTS "visual_explanations" ("id" serial PRIMARY KEY NOT NULL, "analysisId" integer NOT NULL, "text" text NOT NULL, "version" integer DEFAULT 1 NOT NULL, "createdAt" timestamp DEFAULT now() NOT NULL);`,
  visual_followups: `CREATE TABLE IF NOT EXISTS "visual_followups" ("id" serial PRIMARY KEY NOT NULL, "sessionId" integer NOT NULL, "question" text NOT NULL, "answer" text NOT NULL, "uncertainties" json, "provider" varchar(64), "model" varchar(160), "createdAt" timestamp DEFAULT now() NOT NULL);`,
  visual_feedback: `CREATE TABLE IF NOT EXISTS "visual_feedback" ("id" serial PRIMARY KEY NOT NULL, "analysisId" integer NOT NULL, "userId" integer, "rating" integer NOT NULL, "comment" text, "createdAt" timestamp DEFAULT now() NOT NULL);`,
  research_feedback: `CREATE TABLE IF NOT EXISTS "research_feedback" ("id" serial PRIMARY KEY NOT NULL, "sessionId" integer NOT NULL, "userId" integer, "rating" integer NOT NULL, "reason" varchar(64), "createdAt" timestamp DEFAULT now() NOT NULL);`,
  visual_usage: `CREATE TABLE IF NOT EXISTS "visual_usage" ("id" serial PRIMARY KEY NOT NULL, "userId" integer, "sessionId" integer, "kind" varchar(32) NOT NULL, "provider" varchar(64), "model" varchar(160), "promptTokens" integer, "completionTokens" integer, "latencyMs" integer, "createdAt" timestamp DEFAULT now() NOT NULL);`,
};

async function ensureSchema(db: NonNullable<ReturnType<typeof drizzle>>): Promise<void> {
  for (const stmt of TYPE_STMTS) {
    try { await db.execute(sql.raw(stmt)); } catch (error) { if (!/already exists/i.test(String(error))) console.warn("[Database] Type bootstrap failed:", error); }
  }
  for (const [table, stmt] of Object.entries(CREATE_STMTS)) {
    try { await db.execute(sql.raw(stmt)); } catch (error) { console.warn(`[Database] Create failed for ${table}:`, error); }
  }
  // Shape check: any table that exists with incompatible columns is dropped and recreated.
  try {
    const result = await db.execute(sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`);
    const rows = (Array.isArray(result) ? result : (result as unknown as { rows?: Array<{ table_name: string; column_name: string }> }).rows) || [];
    const actual = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!actual.has(row.table_name)) actual.set(row.table_name, new Set());
      actual.get(row.table_name)!.add(row.column_name);
    }
    for (const [table, expected] of Object.entries(TABLE_COLUMNS)) {
      const cols = actual.get(table);
      if (!cols || !cols.size) continue; // table was just created fresh
      const missing = expected.filter((col) => !cols.has(col));
      if (missing.length) {
        console.warn(`[Database] Table ${table} has incompatible shape (missing: ${missing.join(", ")}); recreating it.`);
        await db.execute(sql.raw(`DROP TABLE IF EXISTS "${table}" CASCADE;`));
        await db.execute(sql.raw(CREATE_STMTS[table]));
      }
    }
  } catch (error) {
    console.warn("[Database] Schema shape check failed:", error);
  }
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(neon(process.env.DATABASE_URL));
      _schemaReady = ensureSchema(_db);
    } catch (error) { console.warn("[Database] Failed to connect:", error); }
  }
  if (_db && _schemaReady) await _schemaReady;
  return _db;
}

// ---------------------------------------------------------------------------
// In-memory fallback store: when DATABASE_URL is absent (e.g. a self-contained
// deployment), research sessions are kept in process memory instead of Postgres.
// Same shapes as the drizzle rows, so routers and the client need no changes.
// ---------------------------------------------------------------------------
type MemSession = { id: number; title: string; question: string; userId: number | null; status: "queued" | "researching" | "completed" | "failed"; answer: string | null; plan: unknown; error: string | null; collectionId: number | null; createdAt: Date; updatedAt: Date };
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

export async function upsertUser(user: InsertUser): Promise<void> { if (!user.openId) throw new Error("User openId is required for upsert"); const db = await getDb(); if (!db) return; const values: InsertUser = { openId: user.openId, name: user.name, email: user.email, loginMethod: user.loginMethod, lastSignedIn: user.lastSignedIn || new Date() }; const updateSet: Record<string, unknown> = { ...values }; if (user.role || user.openId === ENV.ownerOpenId) { values.role = user.role || "admin"; updateSet.role = values.role; } await db.insert(users).values(values).onConflictDoUpdate({ target: users.openId, set: updateSet }); }
export async function getUserByOpenId(openId: string) { const db = await getDb(); if (!db) return undefined; const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1); return result[0]; }

export async function createSession(question: string, userId?: number) {
  const db = await getDb();
  if (!db) {
    const id = memId();
    const now = new Date();
    mem.sessions.set(id, { id, title: question.slice(0, 120), question, userId: userId ?? null, status: "queued", answer: null, plan: null, error: null, collectionId: null, createdAt: now, updatedAt: now });
    return id;
  }
  const result = await db.insert(researchSessions).values({ title: question.slice(0, 120), question, userId, status: "queued" }).returning({ id: researchSessions.id }); return Number(result[0].id);
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
    mem.sources.push({ id, sessionId, url: source.url, canonicalUrl: source.canonicalUrl, title: source.title, domain: source.domain, author: source.author, publicationDate: source.published, sourceType: source.sourceType, qualityScore: Math.round(source.qualityScore), content: source.content });
    return id;
  }
  const result = await db.insert(researchSources).values({ sessionId, url: source.url, canonicalUrl: source.canonicalUrl, title: source.title, domain: source.domain, author: source.author, publicationDate: source.published, sourceType: source.sourceType, qualityScore: source.qualityScore, content: source.content }).returning({ id: researchSources.id }); return Number(result[0].id);
}
export function matchPassageId(passages: string[], quote: string, ids: number[]) { const index = passages.findIndex((passage) => passage === quote); return index >= 0 ? ids[index] || 0 : 0; }
export function buildVerifiedLink(passages: string[], quote: string, passageRowIds: number[], sourceRowId: number, claimRowId: number) { const passageId = matchPassageId(passages, quote, passageRowIds); return passageId && sourceRowId && claimRowId ? { evidence: { claimId: claimRowId, passageId, exactQuote: quote }, citation: { claimId: claimRowId, sourceId: sourceRowId, verified: 1 } } : null; }
export async function addPassage(sourceId: number, passageIndex: number, text: string) { const db = await getDb(); if (!db) { const id = memId(); mem.passages.push({ id, sourceId, passageIndex, text, tokenCount: text.split(/\s+/).length }); return id; } const result = await db.insert(researchPassages).values({ sourceId, passageIndex, text, tokenCount: text.split(/\s+/).length }).returning({ id: researchPassages.id }); return Number(result[0].id); }
export async function addClaim(sessionId: number, claim: string, confidence: number, status: "verified" | "mixed" | "unsupported") { const db = await getDb(); if (!db) { const id = memId(); mem.claims.push({ id, sessionId, claim, confidence, verificationStatus: status }); return id; } const result = await db.insert(researchClaims).values({ sessionId, claim, confidence: Math.round(confidence), verificationStatus: status }).returning({ id: researchClaims.id }); return Number(result[0].id); }
export async function addEvidence(claimId: number, passageId: number, quote: string, supportScore: number) { const db = await getDb(); if (!db) { mem.evidence.push({ id: memId(), claimId, passageId, exactQuote: quote, supportScore }); return; } await db.insert(researchEvidence).values({ claimId, passageId, exactQuote: quote, supportScore: Math.round(supportScore) }); }
export async function addCitation(claimId: number, sourceId: number, verified: boolean) { const db = await getDb(); if (!db) return; await db.insert(researchCitations).values({ claimId, sourceId, verified: verified ? 1 : 0 }); }
export async function listSessions(userId?: number, limit = 30) {
  const db = await getDb();
  if (!db) {
    return Array.from(mem.sessions.values())
      .filter((s) => (userId ? s.userId === userId : true))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, Math.min(Math.max(limit, 1), 100))
      .map((s) => ({ id: s.id, title: s.title, question: s.question, status: s.status, collectionId: s.collectionId, createdAt: s.createdAt, updatedAt: s.updatedAt }));
  }
  const where = userId ? eq(researchSessions.userId, userId) : undefined;
  return db.select({ id: researchSessions.id, title: researchSessions.title, question: researchSessions.question, status: researchSessions.status, collectionId: researchSessions.collectionId, createdAt: researchSessions.createdAt, updatedAt: researchSessions.updatedAt }).from(researchSessions).where(where).orderBy(desc(researchSessions.updatedAt)).limit(Math.min(Math.max(limit, 1), 100));
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

// ---------------------------------------------------------------------------
// Startup infrastructure: local accounts, collections, analytics events.
// Same dual-mode contract as above — Postgres (Neon) via drizzle when DATABASE_URL is
// present, in-process fallback otherwise.
// ---------------------------------------------------------------------------
type MemUser = { id: number; openId: string; name: string | null; email: string | null; passwordHash: string | null; role: "user" | "admin"; createdAt: Date; updatedAt: Date; lastSignedIn: Date };
type MemLocalSession = { token: string; userId: number; createdAt: Date; expiresAt: Date };
type MemCollection = { id: number; userId: number; name: string; createdAt: Date };
type MemEvent = { id: number; userId: number | null; type: string; meta: Record<string, unknown> | null; createdAt: Date };

const startupMem = {
  users: new Map<number, MemUser>(),
  localSessions: new Map<string, MemLocalSession>(),
  collections: [] as MemCollection[],
  events: [] as MemEvent[],
};

export type CollectionRow = { id: number; name: string; createdAt: Date; sessionCount: number };

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) {
    for (const user of Array.from(startupMem.users.values())) if (user.email === email) return user;
    return undefined;
  }
  try {
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return result[0];
  } catch (error) {
    console.error("[DB] getUserByEmail failed:", JSON.stringify({ message: error instanceof Error ? error.message : String(error), cause: error instanceof Error && "cause" in error ? String((error as { cause?: unknown }).cause) : undefined }));
    throw error;
  }
}

export async function createLocalUser(input: { email: string; name: string | null; passwordHash: string }) {
  const db = await getDb();
  if (!db) {
    const now = new Date();
    const id = memId();
    const user: MemUser = { id, openId: `local:${input.email}`, name: input.name, email: input.email, passwordHash: input.passwordHash, role: "user", createdAt: now, updatedAt: now, lastSignedIn: now };
    startupMem.users.set(id, user);
    return user;
  }
  await db.insert(users).values({ openId: `local:${input.email}`, name: input.name, email: input.email, passwordHash: input.passwordHash, loginMethod: "password" });
  const created = await getUserByEmail(input.email);
  if (!created) throw new Error("Account creation failed.");
  return created;
}

export async function createLocalSession(userId: number) {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const db = await getDb();
  if (!db) {
    startupMem.localSessions.set(token, { token, userId, createdAt: new Date(), expiresAt });
    return { token, expiresAt };
  }
  await db.insert(localSessions).values({ token, userId, expiresAt });
  return { token, expiresAt };
}

export async function getLocalUserByToken(token: string) {
  const db = await getDb();
  if (!db) {
    const session = startupMem.localSessions.get(token);
    if (!session || session.expiresAt.getTime() < Date.now()) return undefined;
    return startupMem.users.get(session.userId);
  }
  const session = (await db.select().from(localSessions).where(eq(localSessions.token, token)).limit(1))[0];
  if (!session || session.expiresAt.getTime() < Date.now()) return undefined;
  const user = (await db.select().from(users).where(eq(users.id, session.userId)).limit(1))[0];
  return user;
}

export async function deleteLocalSession(token: string) {
  const db = await getDb();
  if (!db) { startupMem.localSessions.delete(token); return; }
  await db.delete(localSessions).where(eq(localSessions.token, token));
}

export async function createCollection(userId: number, name: string) {
  const db = await getDb();
  if (!db) {
    const id = memId();
    startupMem.collections.push({ id, userId, name, createdAt: new Date() });
    return id;
  }
  const result = await db.insert(collections).values({ userId, name }).returning({ id: collections.id });
  return Number(result[0].id);
}

export async function listCollections(userId: number): Promise<CollectionRow[]> {
  const db = await getDb();
  if (!db) {
    return startupMem.collections
      .filter((c) => c.userId === userId)
      .map((c) => ({ id: c.id, name: c.name, createdAt: c.createdAt, sessionCount: Array.from(mem.sessions.values()).filter((s) => s.collectionId === c.id).length }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  const rows = await db.select({ id: collections.id, name: collections.name, createdAt: collections.createdAt, sessionCount: sql<number>`count(${researchSessions.id})` }).from(collections).leftJoin(researchSessions, eq(researchSessions.collectionId, collections.id)).where(eq(collections.userId, userId)).groupBy(collections.id).orderBy(desc(collections.createdAt));
  return rows.map((r) => ({ ...r, sessionCount: Number(r.sessionCount) }));
}

export async function deleteCollection(userId: number, collectionId: number) {
  const db = await getDb();
  if (!db) {
    startupMem.collections = startupMem.collections.filter((c) => !(c.id === collectionId && c.userId === userId));
    for (const s of Array.from(mem.sessions.values())) if (s.collectionId === collectionId) s.collectionId = null;
    return;
  }
  await db.update(researchSessions).set({ collectionId: null }).where(eq(researchSessions.collectionId, collectionId));
  await db.delete(collections).where(and(eq(collections.id, collectionId), eq(collections.userId, userId)));
}

export async function setSessionCollection(sessionId: number, userId: number, collectionId: number | null) {
  const db = await getDb();
  if (!db) {
    const session = mem.sessions.get(sessionId);
    if (!session || session.userId !== userId) throw new Error("Research session not found.");
    if (collectionId !== null && !startupMem.collections.some((c) => c.id === collectionId && c.userId === userId)) throw new Error("Collection not found.");
    session.collectionId = collectionId;
    touch(session);
    return;
  }
  const session = (await db.select().from(researchSessions).where(and(eq(researchSessions.id, sessionId), eq(researchSessions.userId, userId))).limit(1))[0];
  if (!session) throw new Error("Research session not found.");
  if (collectionId !== null) {
    const collection = (await db.select().from(collections).where(and(eq(collections.id, collectionId), eq(collections.userId, userId))).limit(1))[0];
    if (!collection) throw new Error("Collection not found.");
  }
  await db.update(researchSessions).set({ collectionId }).where(eq(researchSessions.id, sessionId));
}

export async function recordResearchFeedback(sessionId: number, userId: number | null, helpful: boolean, reason: string | null) { const db = await getDb(); if (!db) return; await db.insert(researchFeedback).values({ sessionId, userId, rating: helpful ? 1 : 0, reason }); }

export async function recordEvent(type: string, userId: number | null, meta: Record<string, unknown> | null = null) {
  const db = await getDb();
  if (!db) { startupMem.events.push({ id: memId(), userId, type, meta, createdAt: new Date() }); return; }
  try { await db.insert(analyticsEvents).values({ userId, type, meta }); } catch (error) { console.warn("[Analytics] Failed to record event:", error); }
}

export type EventMetrics = {
  totalsByType: Array<{ type: string; count: number }>;
  daily: Array<{ date: string; count: number }>;
  research: { completed: number; failed: number; avgLatencyMs: number | null; totalSources: number };
  recentEvents: Array<{ type: string; userId: number | null; meta: Record<string, unknown> | null; createdAt: Date }>;
};

export async function eventMetrics(days = 30): Promise<EventMetrics> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const db = await getDb();
  let rows: Array<{ type: string; userId: number | null; meta: Record<string, unknown> | null; createdAt: Date }>;
  if (!db) {
    rows = startupMem.events.filter((e) => e.createdAt >= since);
  } else {
    rows = (await db.select({ type: analyticsEvents.type, userId: analyticsEvents.userId, meta: analyticsEvents.meta, createdAt: analyticsEvents.createdAt }).from(analyticsEvents).where(sql`${analyticsEvents.createdAt} >= ${since}`).orderBy(desc(analyticsEvents.createdAt)).limit(5000)) as Array<{ type: string; userId: number | null; meta: Record<string, unknown> | null; createdAt: Date }>;
  }
  const totals = new Map<string, number>();
  const daily = new Map<string, number>();
  let completed = 0, failed = 0, latencySum = 0, latencyCount = 0, totalSources = 0;
  for (const row of rows) {
    totals.set(row.type, (totals.get(row.type) || 0) + 1);
    const day = row.createdAt.toISOString().slice(0, 10);
    daily.set(day, (daily.get(day) || 0) + 1);
    if (row.type === "research.completed") completed++;
    if (row.type === "research.failed") failed++;
    const latency = typeof row.meta?.latencyMs === "number" ? (row.meta.latencyMs as number) : null;
    if (latency !== null) { latencySum += latency; latencyCount++; }
    if (typeof row.meta?.sources === "number") totalSources += row.meta.sources as number;
  }
  return {
    totalsByType: Array.from(totals.entries()).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    daily: Array.from(daily.entries()).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
    research: { completed, failed, avgLatencyMs: latencyCount ? Math.round(latencySum / latencyCount) : null, totalSources },
    recentEvents: rows.slice(0, 50),
  };
}
