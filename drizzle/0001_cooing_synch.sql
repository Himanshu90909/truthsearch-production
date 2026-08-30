CREATE TABLE `research_citations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`claimId` int NOT NULL,
	`sourceId` int NOT NULL,
	`verified` int NOT NULL DEFAULT 0,
	CONSTRAINT `research_citations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `research_claims` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`claim` text NOT NULL,
	`confidence` int NOT NULL,
	`verificationStatus` enum('verified','mixed','unsupported') NOT NULL,
	CONSTRAINT `research_claims_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `research_contradictions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`claimId` int NOT NULL,
	`description` text NOT NULL,
	`sourceIds` json NOT NULL,
	CONSTRAINT `research_contradictions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `research_evidence` (
	`id` int AUTO_INCREMENT NOT NULL,
	`claimId` int NOT NULL,
	`passageId` int NOT NULL,
	`supportScore` int NOT NULL,
	`exactQuote` text NOT NULL,
	CONSTRAINT `research_evidence_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `research_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`role` enum('user','assistant','system') NOT NULL,
	`content` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `research_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `research_passages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceId` int NOT NULL,
	`passageIndex` int NOT NULL,
	`text` text NOT NULL,
	`tokenCount` int NOT NULL,
	`bm25Score` int,
	`denseScore` int,
	`fusedScore` int,
	`rerankScore` int,
	CONSTRAINT `research_passages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `research_queries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`query` varchar(1000) NOT NULL,
	`provider` varchar(64) NOT NULL,
	`status` enum('planned','searched','failed') NOT NULL DEFAULT 'planned',
	`resultCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `research_queries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `research_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`title` varchar(500) NOT NULL,
	`question` text NOT NULL,
	`status` enum('queued','researching','completed','failed') NOT NULL DEFAULT 'queued',
	`answer` text,
	`plan` json,
	`error` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `research_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `research_sources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`queryId` int,
	`url` varchar(2048) NOT NULL,
	`canonicalUrl` varchar(2048) NOT NULL,
	`title` text NOT NULL,
	`domain` varchar(255) NOT NULL,
	`author` text,
	`publicationDate` varchar(128),
	`sourceType` varchar(64) NOT NULL,
	`qualityScore` int NOT NULL,
	`content` text,
	`retrievedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `research_sources_id` PRIMARY KEY(`id`)
);
