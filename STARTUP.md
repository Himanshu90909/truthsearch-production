# TruthSearch — Startup Architecture & Roadmap

TruthSearch is an AI answer engine: you ask a question, it searches live sources,
verifies claims against passages, and synthesizes an answer with citations.
This document maps where the product stands today, what infrastructure exists,
and the phased plan from here to a production startup.

The guiding principle: **evidence before certainty** — every answer is grounded
in retrieved sources, and uncertainty is surfaced rather than hidden.

## Architecture (current)

Modular monolith — one deployable app, no premature microservices.

```
client/            React + Vite frontend (Perplexity-style thread UI)
  └── tRPC client → server/routers.ts
server/
  ├── research.ts        research orchestration (plan → search → fetch →
  │                     rank → verify → synthesize), 4 modes
  ├── providers/         pluggable source adapters (web, academic, …)
  ├── ml.ts              lexical + dense ranking (local MiniLM embeddings)
  ├── auth-local.ts      scrypt password hashing, session tokens
  ├── db.ts              storage layer — MySQL (drizzle) with in-memory fallback
  └── _core/             tRPC/express plumbing, LLM abstraction, cookies
drizzle/            MySQL schema + migrations (users, sessions, sources,
                    claims, evidence, citations, collections, events)
```

## What is implemented today

| Capability | Status | Where |
|---|---|---|
| Multi-step research pipeline | ✅ | `server/research.ts` |
| Provider adapters + health checks | ✅ | `server/providers/registry.ts` |
| Semantic + lexical ranking | ✅ | `server/ml.ts`, `server/embeddings.ts` |
| Claim-level citation verification | ✅ | evidence/citations tables |
| Research modes (quick/deep/academic/verify) | ✅ | `routers.ts` |
| Persistent accounts (email + password) | ✅ | `auth-local.ts`, `auth` router |
| Collections (organize research) | ✅ | `collections` router + sidebar UI |
| Per-user history (cross-device when signed in) | ✅ | `research_sessions.userId` |
| Feedback → contextual bandit (source trust) | ✅ | `client/src/learning/bandit.ts` |
| Analytics events (usage, latency, failures) | ✅ | `analytics_events` + `admin.metrics` |
| Usage guards (hourly rate limits per user/IP) | ✅ | `routers.ts` `checkRate` |

### Accounts

Self-contained email + password accounts — scrypt hashes, per-user salt,
server-side session tokens (30-day cookie, revocable). No external auth service
required; the platform OAuth path remains available alongside it.
Sessions are stored in `local_sessions` (deleted on logout).

### Analytics & monitoring

`recordEvent()` writes typed events (`research.started`, `research.completed`,
`research.failed`, `account.registered`, …) with metadata (latency, source
count, mode). `admin.metrics` (tRPC) aggregates them:

- totals by event type
- daily activity counts
- research success/failure counts, average latency, sources retrieved

Access: signed in as a user with `role = "admin"`, or via
`ADMIN_METRICS_TOKEN` env passed to the `metrics` procedure. On Vercel, check
logs for `[Analytics]` to confirm events are reaching the database.

### Rate limits

Sliding-window hourly limits on `research.start` (anonymous 8/h, signed-in
40/h) and `followUp`. In-memory per instance — adequate for a public beta;
swap for a shared store when queue-backed workers land (roadmap phase 5).

## Database

Works in two modes:

1. **MySQL via `DATABASE_URL`** (production) — set `DATABASE_URL` to a managed
   MySQL (e.g. PlanetScale) and run `pnpm db:push` to apply migrations
   (`drizzle/0002_*.sql` adds accounts, collections, analytics tables).
2. **In-memory fallback** (no `DATABASE_URL`) — everything works, but data is
   per-process and resets; fine for local dev only.

⚠️ For real persistence in production, `DATABASE_URL` **must** be set —
otherwise accounts/history reset with each serverless instance.

## How this maps to the ML lifecycle

```
data →        provider adapters fetch live sources, passages extracted
processing →  ranking (lexical + dense), dedupe, quality scoring
agent/tooling → research orchestration: query planning, staged pipeline
evaluation →  claim verification (support scores), user feedback, bandit
observability → analytics events, latency metrics, provider health checks
```

## Roadmap

### Phase 1 — MVP polish (done ✅ + ongoing)
- [x] Persistent accounts, per-user history
- [x] Collections to organize research
- [x] Analytics events + admin metrics
- [x] Rate limiting
- [x] Wire a managed Postgres in production — **done: Neon Postgres via Vercel integration, self-healing schema bootstrap (Oct 2026)**
- [ ] Terms of service + privacy policy pages (needed before public beta)

### Phase 2 — Research platform
- [ ] Deep research: multi-round retrieval with source-count budgets per mode
- [ ] Academic mode: more scholarly providers (Semantic Scholar, OpenAlex)
- [ ] Research export: Markdown/PDF report with full citation list
- [ ] Personalization: preferred domains/sources per account

### Phase 3 — Learning system
- [ ] Consent-based feedback dataset (already recording; needs export tooling)
- [ ] Offline evaluation harness: golden question set → ranking metrics
    (MRR/nDCG over source relevance), regression gates in CI
- [ ] Bandit experiments behind a quality gate before ranking changes ship

### Phase 4 — Business infrastructure
- [ ] Subscription plans (Stripe) + usage accounting (research runs/month)
- [ ] Developer API with keys and quotas
- [ ] Team workspaces (shared collections)

### Phase 5 — Scale & maturity
- [ ] Queue-backed research workers (SQS/BullMQ) — removes serverless
    synchronous-research constraint, enables longer deep-research runs
- [ ] Postgres + pgvector migration if semantic search needs scale
- [ ] OpenTelemetry tracing, structured log shipping, alerting
- [ ] Load testing, incident runbooks, backups

## Honest notes

- Background research on serverless runs synchronously today (`SYNC_RESEARCH`)
    because fire-and-forget promises die with the lambda. The queue phase
    (5) is the real fix, not a workaround.
- Rate limiting is per-instance until phase 5.
- The in-memory fallback makes local dev dependency-free but is not durable.
