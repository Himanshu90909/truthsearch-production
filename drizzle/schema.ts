import { int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const researchSessions = mysqlTable("research_sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  title: varchar("title", { length: 500 }).notNull(),
  question: text("question").notNull(),
  status: mysqlEnum("status", ["queued", "researching", "completed", "failed"]).default("queued").notNull(),
  answer: text("answer"),
  plan: json("plan"),
  error: text("error"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const researchMessages = mysqlTable("research_messages", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const researchQueries = mysqlTable("research_queries", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  query: varchar("query", { length: 1000 }).notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["planned", "searched", "failed"]).default("planned").notNull(),
  resultCount: int("resultCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const researchSources = mysqlTable("research_sources", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  queryId: int("queryId"),
  url: varchar("url", { length: 2048 }).notNull(),
  canonicalUrl: varchar("canonicalUrl", { length: 2048 }).notNull(),
  title: text("title").notNull(),
  domain: varchar("domain", { length: 255 }).notNull(),
  author: text("author"),
  publicationDate: varchar("publicationDate", { length: 128 }),
  sourceType: varchar("sourceType", { length: 64 }).notNull(),
  qualityScore: int("qualityScore").notNull(),
  content: text("content"),
  retrievedAt: timestamp("retrievedAt").defaultNow().notNull(),
});

export const researchPassages = mysqlTable("research_passages", {
  id: int("id").autoincrement().primaryKey(),
  sourceId: int("sourceId").notNull(),
  passageIndex: int("passageIndex").notNull(),
  text: text("text").notNull(),
  tokenCount: int("tokenCount").notNull(),
  bm25Score: int("bm25Score"),
  denseScore: int("denseScore"),
  fusedScore: int("fusedScore"),
  rerankScore: int("rerankScore"),
});

export const researchClaims = mysqlTable("research_claims", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  claim: text("claim").notNull(),
  confidence: int("confidence").notNull(),
  verificationStatus: mysqlEnum("verificationStatus", ["verified", "mixed", "unsupported"]).notNull(),
});

export const researchEvidence = mysqlTable("research_evidence", {
  id: int("id").autoincrement().primaryKey(),
  claimId: int("claimId").notNull(),
  passageId: int("passageId").notNull(),
  supportScore: int("supportScore").notNull(),
  exactQuote: text("exactQuote").notNull(),
});

export const researchContradictions = mysqlTable("research_contradictions", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  claimId: int("claimId").notNull(),
  description: text("description").notNull(),
  sourceIds: json("sourceIds").notNull(),
});

export const researchCitations = mysqlTable("research_citations", {
  id: int("id").autoincrement().primaryKey(),
  claimId: int("claimId").notNull(),
  sourceId: int("sourceId").notNull(),
  verified: int("verified").notNull().default(0),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type ResearchSession = typeof researchSessions.$inferSelect;
