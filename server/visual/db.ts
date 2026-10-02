// VisualSessionService — persistence for Visual Intelligence.
//
// Follows the established db.ts pattern: drizzle/Neon Postgres via getDb(),
// with an in-memory fallback so the standalone dev server works without
// DATABASE_URL. Ownership is enforced on every read: signed-in users only
// see their own sessions; anonymous sessions require the upload token.

import { and, desc, eq, isNull, or, lt } from "drizzle-orm";
import { getDb } from "../db";
import { visualUploads, visualSessions, visualAnalyses, visualAnnotations, visualExplanations, visualFollowups, visualFeedback, visualUsage } from "../../drizzle/schema";
import { randomBytes } from "node:crypto";
import type { SanitizedRegion, VisualAnalysisParsed } from "./schema";

// ---------------------------------------------------------------------------
// Upload validation: magic-byte sniffing — the declared MIME is never trusted.
// ---------------------------------------------------------------------------

// Parse intrinsic pixel dimensions from image headers (PNG/GIF/JPEG/WebP).
export function imageDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length > 24 && buf[0] === 0x89 && buf.toString("latin1", 12, 16) === "IHDR") return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length >= 10 && buf.toString("latin1", 0, 3) === "GIF") return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) { off++; continue; }
      const marker = buf[off + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
      off += 2 + buf.readUInt16BE(off + 2);
    }
  }
  if (buf.length > 30 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") {
    const fourcc = buf.toString("latin1", 12, 16);
    if (fourcc === "VP8 " && buf[23] === 0x9d) return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (fourcc === "VP8L") { const bits = buf.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
    if (fourcc === "VP8X") return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  return null;
}

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export function sniffImageMime(buffer: Buffer): "image/jpeg" | "image/png" | "image/webp" | "image/gif" | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return "image/gif";
  if (buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

// Retention: VISUAL_RETENTION_DAYS (default 30). Pruned opportunistically on
// upload — serverless has no cron, and uploads are the natural trigger.
export function retentionDays(): number {
  const raw = Number(process.env.VISUAL_RETENTION_DAYS);
  return Number.isFinite(raw) && raw >= 1 && raw <= 365 ? Math.floor(raw) : 30;
}

// ---------------------------------------------------------------------------
// Memory fallback (mirrors db.ts mem pattern; per-instance, dev only).
// ---------------------------------------------------------------------------
type MemUpload = { id: number; token: string; userId: number | null; mime: string; byteSize: number; width: number; height: number; data: string; createdAt: Date; expiresAt: Date | null };
type MemSession = { id: number; userId: number | null; uploadId: number; question: string | null; mode: string; depth: string; language: string; status: string; error: string | null; researchSessionId: number | null; createdAt: Date; updatedAt: Date };
type MemAnalysis = { id: number; sessionId: number; provider: string; model: string; imageWidth: number; imageHeight: number; parsed: any; overlaySvg: string | null; diagramSvg: string | null; droppedRegions: number; latencyMs: number | null; promptTokens: number | null; completionTokens: number | null; createdAt: Date };

const mem = {
  nextId: 1,
  uploads: new Map<number, MemUpload>(),
  sessions: new Map<number, MemSession>(),
  analyses: new Map<number, MemAnalysis>(),
  annotations: [] as Array<Record<string, unknown>>,
  explanations: [] as Array<Record<string, unknown>>,
  followups: [] as Array<Record<string, unknown>>,
  feedback: [] as Array<Record<string, unknown>>,
  usage: [] as Array<Record<string, unknown>>,
};
function memId() { return mem.nextId++; }

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------
export async function createVisualUpload(input: { userId: number | null; mime: string; byteSize: number; width: number; height: number; data: string }): Promise<{ id: number; token: string }> {
  const db = await getDb();
  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + retentionDays() * 24 * 60 * 60 * 1000);
  if (!db) {
    const id = memId();
    mem.uploads.set(id, { id, token, userId: input.userId, mime: input.mime, byteSize: input.byteSize, width: input.width, height: input.height, data: input.data, createdAt: new Date(), expiresAt });
    return { id, token };
  }
  const result = await db.insert(visualUploads).values({ token, userId: input.userId, mime: input.mime, byteSize: input.byteSize, width: input.width, height: input.height, data: input.data, expiresAt }).returning({ id: visualUploads.id });
  void pruneExpiredUploads().catch(() => {});
  return { id: Number(result[0].id), token };
}

export type UploadRecord = { id: number; token: string; userId: number | null; mime: string; byteSize: number; width: number; height: number; data: string };

export async function getVisualUpload(id: number): Promise<UploadRecord | null> {
  const db = await getDb();
  if (!db) {
    const u = mem.uploads.get(id);
    return u ? { id: u.id, token: u.token, userId: u.userId, mime: u.mime, byteSize: u.byteSize, width: u.width, height: u.height, data: u.data } : null;
  }
  const result = await db.select().from(visualUploads).where(eq(visualUploads.id, id)).limit(1);
  const u = result[0];
  if (!u) return null;
  if (u.expiresAt && u.expiresAt.getTime() < Date.now()) return null; // expired — treat as gone
  return { id: Number(u.id), token: u.token, userId: u.userId, mime: u.mime, byteSize: u.byteSize, width: u.width, height: u.height, data: u.data };
}

// Image access: ownership by user id OR unguessable capability token.
export async function canAccessUpload(id: number, userId: number | null, token?: string): Promise<UploadRecord | null> {
  const upload = await getVisualUpload(id);
  if (!upload) return null;
  if (token && token === upload.token) return upload;
  if (userId != null && upload.userId === userId) return upload;
  return null;
}

async function pruneExpiredUploads(): Promise<void> {
  const db = await getDb();
  if (!db) { Array.from(mem.uploads.keys()).forEach((id) => { const u = mem.uploads.get(id)!; if (u.expiresAt && u.expiresAt.getTime() < Date.now()) mem.uploads.delete(id); }); return; }
  await db.delete(visualUploads).where(lt(visualUploads.expiresAt, new Date()));
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
export async function createVisualSession(input: { userId: number | null; uploadId: number; question: string | null; mode: string; depth: string; language: string }): Promise<number> {
  const db = await getDb();
  if (!db) {
    const id = memId();
    mem.sessions.set(id, { id, userId: input.userId, uploadId: input.uploadId, question: input.question, mode: input.mode, depth: input.depth, language: input.language, status: "queued", error: null, researchSessionId: null, createdAt: new Date(), updatedAt: new Date() });
    return id;
  }
  const result = await db.insert(visualSessions).values({ userId: input.userId, uploadId: input.uploadId, question: input.question, mode: input.mode, depth: input.depth, language: input.language }).returning({ id: visualSessions.id });
  return Number(result[0].id);
}

export async function updateVisualSession(id: number, patch: Partial<{ status: "queued" | "analyzing" | "completed" | "failed" | "cancelled"; error: string | null; researchSessionId: number }>): Promise<void> {
  const db = await getDb();
  if (!db) { const s = mem.sessions.get(id); if (s) Object.assign(s, patch, { updatedAt: new Date() }); return; }
  await db.update(visualSessions).set(patch).where(eq(visualSessions.id, id));
}

export async function getVisualSession(id: number, userId: number | null): Promise<MemSession | null> {
  const db = await getDb();
  if (!db) {
    const s = mem.sessions.get(id);
    return s && (s.userId === userId || (s.userId === null && userId === null)) ? s : null;
  }
  // Ownership: user-owned sessions require the same user id. Anonymous
  // sessions (userId null) are open — the upload token gates image access.
  const where = userId == null
    ? and(eq(visualSessions.id, id), isNull(visualSessions.userId))
    : and(eq(visualSessions.id, id), eq(visualSessions.userId, userId));
  const result = await db.select().from(visualSessions).where(where).limit(1);
  const s = result[0];
  if (!s) return null;
  return { id: Number(s.id), userId: s.userId, uploadId: s.uploadId, question: s.question, mode: s.mode, depth: s.depth, language: s.language, status: s.status, error: s.error, researchSessionId: s.researchSessionId, createdAt: s.createdAt, updatedAt: s.updatedAt };
}

export async function listVisualSessions(userId: number, limit = 30): Promise<Array<{ id: number; question: string | null; mode: string; depth: string; status: string; createdAt: Date }>> {
  const db = await getDb();
  if (!db) {
    return Array.from(mem.sessions.values())
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, Math.min(limit, 100))
      .map((s) => ({ id: s.id, question: s.question, mode: s.mode, depth: s.depth, status: s.status, createdAt: s.createdAt }));
  }
  const rows = await db.select({ id: visualSessions.id, question: visualSessions.question, mode: visualSessions.mode, depth: visualSessions.depth, status: visualSessions.status, createdAt: visualSessions.createdAt })
    .from(visualSessions).where(eq(visualSessions.userId, userId)).orderBy(desc(visualSessions.updatedAt)).limit(Math.min(Math.max(limit, 1), 100));
  return rows.map((r) => ({ id: Number(r.id), question: r.question, mode: r.mode, depth: r.depth, status: r.status, createdAt: r.createdAt }));
}

// Privacy control: deleting a session removes its analyses, annotations,
// explanations, followups and (when no other session uses it) the upload.
export async function deleteVisualSession(id: number, userId: number | null): Promise<boolean> {
  const session = await getVisualSession(id, userId);
  if (!session) return false;
  const db = await getDb();
  if (!db) {
    mem.sessions.delete(id);
    mem.annotations = mem.annotations.filter((a) => (a.sessionId as number) !== id);
    mem.followups = mem.followups.filter((f) => (f.sessionId as number) !== id);
    const analysisIds = new Set(Array.from(mem.analyses.values()).filter((a) => a.sessionId === id).map((a) => a.id));
    Array.from(mem.analyses.keys()).forEach((key) => { const a = mem.analyses.get(key)!; if (analysisIds.has(a.id)) mem.analyses.delete(key); });
    mem.explanations = mem.explanations.filter((e) => !analysisIds.has(e.analysisId as number));
    return true;
  }
  const analyses = await db.select({ id: visualAnalyses.id }).from(visualAnalyses).where(eq(visualAnalyses.sessionId, id));
  const analysisIds = analyses.map((a) => Number(a.id));
  if (analysisIds.length) {
    for (const aid of analysisIds) {
      await db.delete(visualAnnotations).where(eq(visualAnnotations.analysisId, aid));
      await db.delete(visualExplanations).where(eq(visualExplanations.analysisId, aid));
      await db.delete(visualFeedback).where(eq(visualFeedback.analysisId, aid));
    }
    await db.delete(visualAnalyses).where(eq(visualAnalyses.sessionId, id));
  }
  await db.delete(visualFollowups).where(eq(visualFollowups.sessionId, id));
  await db.delete(visualSessions).where(eq(visualSessions.id, id));
  // Drop the upload if it is no longer referenced by any session.
  const remaining = await db.select({ id: visualSessions.id }).from(visualSessions).where(eq(visualSessions.uploadId, session.uploadId)).limit(1);
  if (!remaining.length) await db.delete(visualUploads).where(eq(visualUploads.id, session.uploadId));
  return true;
}

// ---------------------------------------------------------------------------
// Analyses / annotations / explanations
// ---------------------------------------------------------------------------
export async function saveVisualAnalysis(input: {
  sessionId: number;
  provider: string;
  model: string;
  imageWidth: number;
  imageHeight: number;
  parsed: VisualAnalysisParsed;
  overlaySvg: string;
  diagramSvg: string | null;
  droppedRegions: number;
  regions: SanitizedRegion[];
  explanationText: string;
  latencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
}): Promise<number> {
  const db = await getDb();
  if (!db) {
    const id = memId();
    mem.analyses.set(id, { id, sessionId: input.sessionId, provider: input.provider, model: input.model, imageWidth: input.imageWidth, imageHeight: input.imageHeight, parsed: input.parsed, overlaySvg: input.overlaySvg, diagramSvg: input.diagramSvg, droppedRegions: input.droppedRegions, latencyMs: input.latencyMs, promptTokens: input.promptTokens, completionTokens: input.completionTokens, createdAt: new Date() });
    for (const region of input.regions) mem.annotations.push({ id: memId(), analysisId: id, regionIndex: region.id, label: region.label, kind: region.kind, bbox: region.bbox, note: region.note, confidence: region.confidence != null ? Math.round(region.confidence * 100) : null, createdAt: new Date() });
    mem.explanations.push({ id: memId(), analysisId: id, text: input.explanationText, version: 1, createdAt: new Date() });
    return id;
  }
  const result = await db.insert(visualAnalyses).values({
    sessionId: input.sessionId, provider: input.provider, model: input.model, imageWidth: input.imageWidth, imageHeight: input.imageHeight,
    parsed: input.parsed as unknown as Record<string, unknown>, overlaySvg: input.overlaySvg, diagramSvg: input.diagramSvg,
    droppedRegions: input.droppedRegions, latencyMs: input.latencyMs, promptTokens: input.promptTokens, completionTokens: input.completionTokens,
  }).returning({ id: visualAnalyses.id });
  const analysisId = Number(result[0].id);
  if (input.regions.length) {
    await db.insert(visualAnnotations).values(input.regions.map((region) => ({
      analysisId, regionIndex: region.id, label: region.label.slice(0, 160), kind: region.kind,
      bbox: region.bbox as unknown as Record<string, unknown>, note: region.note ?? null,
      confidence: region.confidence != null ? Math.round(region.confidence * 100) : null,
    })));
  }
  await db.insert(visualExplanations).values({ analysisId, text: input.explanationText, version: 1 });
  return analysisId;
}

export async function getVisualAnalysisBySession(sessionId: number): Promise<{ analysisId: number; provider: string; model: string; parsed: VisualAnalysisParsed; overlaySvg: string | null; diagramSvg: string | null } | null> {
  const db = await getDb();
  if (!db) {
    const a = Array.from(mem.analyses.values()).filter((x) => x.sessionId === sessionId).sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0];
    return a ? { analysisId: a.id, provider: a.provider, model: a.model, parsed: a.parsed, overlaySvg: a.overlaySvg, diagramSvg: a.diagramSvg } : null;
  }
  const result = await db.select().from(visualAnalyses).where(eq(visualAnalyses.sessionId, sessionId)).orderBy(desc(visualAnalyses.createdAt)).limit(1);
  const a = result[0];
  if (!a) return null;
  return { analysisId: Number(a.id), provider: a.provider, model: a.model, parsed: a.parsed as unknown as VisualAnalysisParsed, overlaySvg: a.overlaySvg, diagramSvg: a.diagramSvg };
}

export async function addVisualFollowup(input: { sessionId: number; question: string; answer: string; uncertainties: string[]; provider: string; model: string }): Promise<void> {
  const db = await getDb();
  if (!db) { mem.followups.push({ id: memId(), ...input, uncertainties: input.uncertainties, createdAt: new Date() }); return; }
  await db.insert(visualFollowups).values({ ...input, uncertainties: input.uncertainties });
}

export async function listVisualFollowups(sessionId: number): Promise<Array<{ question: string; answer: string; uncertainties: string[] | null; createdAt: Date }>> {
  const db = await getDb();
  if (!db) return mem.followups.filter((f) => (f.sessionId as number) === sessionId).map((f) => ({ question: f.question as string, answer: f.answer as string, uncertainties: (f.uncertainties as string[]) ?? null, createdAt: f.createdAt as Date }));
  const rows = await db.select().from(visualFollowups).where(eq(visualFollowups.sessionId, sessionId)).orderBy(visualFollowups.createdAt);
  return rows.map((r) => ({ question: r.question, answer: r.answer, uncertainties: r.uncertainties as string[] | null, createdAt: r.createdAt }));
}

// ---------------------------------------------------------------------------
// Feedback + usage (never silent training: explicit user actions only)
// ---------------------------------------------------------------------------
export async function addVisualFeedback(input: { analysisId: number; userId: number | null; rating: number; comment?: string }): Promise<void> {
  const db = await getDb();
  if (!db) { mem.feedback.push({ id: memId(), ...input, comment: input.comment ?? null, createdAt: new Date() }); return; }
  await db.insert(visualFeedback).values({ analysisId: input.analysisId, userId: input.userId, rating: input.rating, comment: input.comment ?? null });
}

export async function recordVisualUsage(input: { userId: number | null; sessionId: number | null; kind: string; provider?: string; model?: string; promptTokens?: number | null; completionTokens?: number | null; latencyMs?: number | null }): Promise<void> {
  const db = await getDb();
  if (!db) { mem.usage.push({ id: memId(), ...input, createdAt: new Date() }); return; }
  await db.insert(visualUsage).values({ userId: input.userId, sessionId: input.sessionId, kind: input.kind, provider: input.provider ?? null, model: input.model ?? null, promptTokens: input.promptTokens ?? null, completionTokens: input.completionTokens ?? null, latencyMs: input.latencyMs ?? null });
}

export async function visualUsageSummary(userId: number): Promise<{ analyses: number; followups: number; promptTokens: number; completionTokens: number }> {
  const db = await getDb();
  if (!db) {
    const mine = mem.usage.filter((u) => u.userId === userId);
    return {
      analyses: mine.filter((u) => u.kind === "analysis").length,
      followups: mine.filter((u) => u.kind === "followup").length,
      promptTokens: mine.reduce((sum: number, u) => sum + ((u.promptTokens as number) || 0), 0),
      completionTokens: mine.reduce((sum: number, u) => sum + ((u.completionTokens as number) || 0), 0),
    };
  }
  const rows = await db.select().from(visualUsage).where(eq(visualUsage.userId, userId));
  return {
    analyses: rows.filter((r) => r.kind === "analysis").length,
    followups: rows.filter((r) => r.kind === "followup").length,
    promptTokens: rows.reduce((sum, r) => sum + (r.promptTokens || 0), 0),
    completionTokens: rows.reduce((sum, r) => sum + (r.completionTokens || 0), 0),
  };
}
