CREATE TABLE "analytics_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer,
	"type" varchar(64) NOT NULL,
	"meta" json,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" varchar(128) NOT NULL,
	"userId" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp NOT NULL,
	CONSTRAINT "local_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "research_citations" (
	"id" serial PRIMARY KEY NOT NULL,
	"claimId" integer NOT NULL,
	"sourceId" integer NOT NULL,
	"verified" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"sessionId" integer NOT NULL,
	"claim" text NOT NULL,
	"confidence" integer NOT NULL,
	"verificationStatus" "verification_status" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_contradictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"sessionId" integer NOT NULL,
	"claimId" integer NOT NULL,
	"description" text NOT NULL,
	"sourceIds" json NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"claimId" integer NOT NULL,
	"passageId" integer NOT NULL,
	"supportScore" integer NOT NULL,
	"exactQuote" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"sessionId" integer NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_passages" (
	"id" serial PRIMARY KEY NOT NULL,
	"sourceId" integer NOT NULL,
	"passageIndex" integer NOT NULL,
	"text" text NOT NULL,
	"tokenCount" integer NOT NULL,
	"bm25Score" integer,
	"denseScore" integer,
	"fusedScore" integer,
	"rerankScore" integer
);
--> statement-breakpoint
CREATE TABLE "research_queries" (
	"id" serial PRIMARY KEY NOT NULL,
	"sessionId" integer NOT NULL,
	"query" varchar(1000) NOT NULL,
	"provider" varchar(64) NOT NULL,
	"status" "query_status" DEFAULT 'planned' NOT NULL,
	"resultCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer,
	"title" varchar(500) NOT NULL,
	"question" text NOT NULL,
	"status" "session_status" DEFAULT 'queued' NOT NULL,
	"answer" text,
	"plan" json,
	"error" text,
	"collectionId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"sessionId" integer NOT NULL,
	"queryId" integer,
	"url" varchar(2048) NOT NULL,
	"canonicalUrl" varchar(2048) NOT NULL,
	"title" text NOT NULL,
	"domain" varchar(255) NOT NULL,
	"author" text,
	"publicationDate" varchar(128),
	"sourceType" varchar(64) NOT NULL,
	"qualityScore" integer NOT NULL,
	"content" text,
	"retrievedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "role" DEFAULT 'user' NOT NULL,
	"passwordHash" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
