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
