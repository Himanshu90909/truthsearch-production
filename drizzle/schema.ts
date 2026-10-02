import { integer, json, pgEnum, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

const roleEnum = pgEnum("role", ["user", "admin"]);
const sessionStatusEnum = pgEnum("session_status", ["queued", "researching", "completed", "failed"]);
const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system"]);
const queryStatusEnum = pgEnum("query_status", ["planned", "searched", "failed"]);
const verificationStatusEnum = pgEnum("verification_status", ["verified", "mixed", "unsupported"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  passwordHash: text("passwordHash"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().$onUpdate(() => new Date()).notNull(),
  lastSignedIn: timestamp("lastSignedIn", { mode: "date" }).defaultNow().notNull(),
});

export const researchSessions = pgTable("research_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("userId"),
  title: varchar("title", { length: 500 }).notNull(),
  question: text("question").notNull(),
  status: sessionStatusEnum("status").default("queued").notNull(),
  answer: text("answer"),
  plan: json("plan"),
  error: text("error"),
  collectionId: integer("collectionId"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().$onUpdate(() => new Date()).notNull(),
});

export const researchMessages = pgTable("research_messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("sessionId").notNull(),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

export const researchQueries = pgTable("research_queries", {
  id: serial("id").primaryKey(),
  sessionId: integer("sessionId").notNull(),
  query: varchar("query", { length: 1000 }).notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  status: queryStatusEnum("status").default("planned").notNull(),
  resultCount: integer("resultCount").default(0).notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

export const researchSources = pgTable("research_sources", {
  id: serial("id").primaryKey(),
  sessionId: integer("sessionId").notNull(),
  queryId: integer("queryId"),
  url: varchar("url", { length: 2048 }).notNull(),
  canonicalUrl: varchar("canonicalUrl", { length: 2048 }).notNull(),
  title: text("title").notNull(),
  domain: varchar("domain", { length: 255 }).notNull(),
  author: text("author"),
  publicationDate: varchar("publicationDate", { length: 128 }),
  sourceType: varchar("sourceType", { length: 64 }).notNull(),
  qualityScore: integer("qualityScore").notNull(),
  content: text("content"),
  retrievedAt: timestamp("retrievedAt", { mode: "date" }).defaultNow().notNull(),
});

export const researchPassages = pgTable("research_passages", {
  id: serial("id").primaryKey(),
  sourceId: integer("sourceId").notNull(),
  passageIndex: integer("passageIndex").notNull(),
  text: text("text").notNull(),
  tokenCount: integer("tokenCount").notNull(),
  bm25Score: integer("bm25Score"),
  denseScore: integer("denseScore"),
  fusedScore: integer("fusedScore"),
  rerankScore: integer("rerankScore"),
});

export const researchClaims = pgTable("research_claims", {
  id: serial("id").primaryKey(),
  sessionId: integer("sessionId").notNull(),
  claim: text("claim").notNull(),
  confidence: integer("confidence").notNull(),
  verificationStatus: verificationStatusEnum("verificationStatus").notNull(),
});

export const researchEvidence = pgTable("research_evidence", {
  id: serial("id").primaryKey(),
  claimId: integer("claimId").notNull(),
  passageId: integer("passageId").notNull(),
  supportScore: integer("supportScore").notNull(),
  exactQuote: text("exactQuote").notNull(),
});

export const researchContradictions = pgTable("research_contradictions", {
  id: serial("id").primaryKey(),
  sessionId: integer("sessionId").notNull(),
  claimId: integer("claimId").notNull(),
  description: text("description").notNull(),
  sourceIds: json("sourceIds").notNull(),
});

export const researchCitations = pgTable("research_citations", {
  id: serial("id").primaryKey(),
  claimId: integer("claimId").notNull(),
  sourceId: integer("sourceId").notNull(),
  verified: integer("verified").notNull().default(0),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type ResearchSession = typeof researchSessions.$inferSelect;

export const localSessions = pgTable("local_sessions", {
  id: serial("id").primaryKey(),
  token: varchar("token", { length: 128 }).notNull().unique(),
  userId: integer("userId").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  expiresAt: timestamp("expiresAt", { mode: "date" }).notNull(),
});

export const collections = pgTable("collections", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

export const analyticsEvents = pgTable("analytics_events", {
  id: serial("id").primaryKey(),
  userId: integer("userId"),
  type: varchar("type", { length: 64 }).notNull(),
  meta: json("meta"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// TruthSearch Visual Intelligence (Oct 2026)
// ---------------------------------------------------------------------------
const visualStatusEnum = pgEnum("visual_status", ["queued", "analyzing", "completed", "failed", "cancelled"]);

export const visualUploads = pgTable("visual_uploads", {
  id: serial("id").primaryKey(),
  // Capability token: anonymous access to the image is only possible with it.
  token: varchar("token", { length: 64 }).notNull().unique(),
  userId: integer("userId"),
  mime: varchar("mime", { length: 64 }).notNull(),
  byteSize: integer("byteSize").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  // Base64 payload (private: never exposed without token or ownership).
  data: text("data").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  expiresAt: timestamp("expiresAt", { mode: "date" }),
});

export const visualSessions = pgTable("visual_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("userId"),
  uploadId: integer("uploadId").notNull(),
  question: text("question"),
  mode: varchar("mode", { length: 24 }).notNull(),
  depth: varchar("depth", { length: 24 }).notNull(),
  language: varchar("language", { length: 8 }).notNull(),
  status: visualStatusEnum("status").default("queued").notNull(),
  error: text("error"),
  researchSessionId: integer("researchSessionId"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).$onUpdate(() => new Date()).defaultNow().notNull(),
});

export const visualAnalyses = pgTable("visual_analyses", {
  id: serial("id").primaryKey(),
  sessionId: integer("sessionId").notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  model: varchar("model", { length: 160 }).notNull(),
  imageWidth: integer("imageWidth").notNull(),
  imageHeight: integer("imageHeight").notNull(),
  parsed: json("parsed").notNull(),
  overlaySvg: text("overlaySvg"),
  diagramSvg: text("diagramSvg"),
  droppedRegions: integer("droppedRegions").default(0).notNull(),
  latencyMs: integer("latencyMs"),
  promptTokens: integer("promptTokens"),
  completionTokens: integer("completionTokens"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

export const visualAnnotations = pgTable("visual_annotations", {
  id: serial("id").primaryKey(),
  analysisId: integer("analysisId").notNull(),
  regionIndex: integer("regionIndex").notNull(),
  label: varchar("label", { length: 160 }).notNull(),
  kind: varchar("kind", { length: 24 }).notNull(),
  bbox: json("bbox").notNull(),
  note: text("note"),
  confidence: integer("confidence"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

export const visualExplanations = pgTable("visual_explanations", {
  id: serial("id").primaryKey(),
  analysisId: integer("analysisId").notNull(),
  text: text("text").notNull(),
  version: integer("version").default(1).notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

export const visualFollowups = pgTable("visual_followups", {
  id: serial("id").primaryKey(),
  sessionId: integer("sessionId").notNull(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  uncertainties: json("uncertainties"),
  provider: varchar("provider", { length: 64 }),
  model: varchar("model", { length: 160 }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

export const visualFeedback = pgTable("visual_feedback", {
  id: serial("id").primaryKey(),
  analysisId: integer("analysisId").notNull(),
  userId: integer("userId"),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

export const visualUsage = pgTable("visual_usage", {
  id: serial("id").primaryKey(),
  userId: integer("userId"),
  sessionId: integer("sessionId"),
  kind: varchar("kind", { length: 32 }).notNull(),
  provider: varchar("provider", { length: 64 }),
  model: varchar("model", { length: 160 }),
  promptTokens: integer("promptTokens"),
  completionTokens: integer("completionTokens"),
  latencyMs: integer("latencyMs"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});
