# TruthSearch architecture audit (Phase A)

Audited commit: `0c9216e` on `main`, 26 Nov 2026. Scope: the whole repository (194 tracked files, about 35k lines).
This report is the required step before major changes (spec section A). Nothing in `main` was modified.

## 1. What exists today

| Area | Current state | Evidence |
|---|---|---|
| Stack | Express + tRPC + superjson on Node; React + Vite + Radix/shadcn client; esbuild bundles a server and a serverless entry | `package.json`, `server/_core/index.ts`, `serverless/entry.ts` |
| Database | Postgres via Drizzle ORM, migrations in `drizzle/` | `drizzle/schema.ts`, `drizzle.config.ts` (`dialect: postgresql`) |
| Schema | 18 tables: users, research_sessions/messages/queries/sources/passages/claims/evidence/contradictions/citations, local_sessions, collections, research_feedback, analytics_events, visual_uploads/sessions/analyses | `drizzle/schema.ts` |
| Auth | Local email/password (scrypt, per-user salt, timing-safe compare), random 384-bit server-side session tokens in an http cookie (30 day TTL), plus an OAuth SDK path; `protectedProcedure` and `adminProcedure` middleware | `server/auth-local.ts`, `server/_core/context.ts`, `server/_core/trpc.ts` |
| Research pipeline | Modes quick / deep / academic / verify / image; query planning, 15 search providers, URL canonicalisation, SSRF guard, 2-hop browsing, BM25 + dense + rerank fused with reciprocal rank fusion, claim/evidence extraction, keyword contradiction detection, citation audit | `server/research.ts` (1,152 lines) |
| Search providers | DuckDuckGo, Brave, Tavily, Semantic Scholar, Crossref, OpenAlex, Europe PMC, Wikipedia, arXiv, GitHub, Stack Exchange, Open Library, Wikidata, World Bank, data.gov | `ProviderName` in `server/research.ts` |
| Model providers | Ordered OpenAI-compatible synthesis chain (Meta, NVIDIA NIM, Gemini, freellm gateway, Hugging Face, etc.) chosen by which env keys are set; separate playground catalogue with live model discovery and probes | `synthesisProviders()` in `server/research.ts`, `server/playground.ts`, `server/providers/registry.ts` |
| Documents and images | RAG over user-supplied text, image upload/analysis tables, S3 client for storage | `server/rag.ts`, `server/embeddings.ts`, `visual_*` tables |
| Analytics | Event table plus an admin metrics query | `analytics_events`, `admin.metrics` in `server/routers.ts` |
| Tests | 9 vitest files, **99 tests, all passing** on this audit | `pnpm exec vitest run` |
| Deployment | Vercel, Netlify, Docker, Firebase and GitHub Pages configs all present | `vercel.json`, `netlify.toml`, `Dockerfile`, `firebase.json`, `vite.ghpages.config.ts` |

The project is not a prototype to replace. Most of sections B, C and D already have a working base, so the right move is targeted upgrades.

## 2. Gaps against the spec, ranked

### Security (fix first)
1. **Admin access can bypass roles.** `admin.metrics` is a `publicProcedure` that also accepts a shared `ADMIN_METRICS_TOKEN` from query input, compared with `===` (not timing-safe) and sent through the client. Spec I asks for role-based authorization. Fix: move to `adminProcedure`, drop the token path or move it to a server-to-server header with `timingSafeEqual`.
2. **Rate limiting is in-memory.** `checkRate` uses a process-local `Map`. On Vercel each serverless instance has its own map, so limits reset per instance and are not real per-user quotas. Fix: Postgres-backed (or Redis) counters keyed by user id and IP.
3. **No budget controls.** No per-user or global token/cost ceiling exists, so one user can drain paid provider credit.
4. **Prompt-injection handling is partial.** Retrieved pages and documents are labelled in the prompt, but there is no explicit isolation (delimiting, instruction stripping, "treat as data" system rule) or detection of injected instructions in fetched content.
5. **No audit log table** for admin actions, credential changes or research runs.

### Multi-model engine (section B)
- Provider choice is a fixed priority list driven by env vars. Missing: per-model timeouts, retry policy objects, budget caps, token/cost/latency recording per call, health checks persisted over time, optional parallel calls, and an admin-editable provider table.
- "Maximum Verification" mode does not exist; `verify` is closest.
- Known issue from the 21 Nov API sweep: the freellm gateway default model `auto` is rejected (502), and Qwen is catalogued twice.

### Browser research (section C)
- **No Google search provider.** Google Programmable Search needs both an API key with the Custom Search JSON API enabled **and** a search engine id (`cx`). See section 4.
- No source freshness ranking (publication date is captured but not scored).
- PDF/document extraction for fetched URLs is limited to what the HTML path handles.

### Claim verification (section D)
- Spec needs 5 states (verified, partially supported, conflicting, unsupported, outdated). The code uses 4 (`verified / partial / conflicting / insufficient`) and the DB enum stores only 3 (`verified / mixed / unsupported`), so statuses are lost on save. **Outdated is missing entirely.**
- `classifyClaimStatuses` marks a claim verified from a **single** passage score (support >= 75, quality >= 50). The spec requires independent evidence: at least two sources from different domains for "verified".
- Contradiction detection is keyword based (negation and number mismatch). It misses paraphrased contradictions.
- Claims are not stored with contradicting sources, exact passages, dates and an explanation in one queryable shape.
- Good: model agreement is not used as proof today. That must stay true.

### Evaluation (section E)
- `evaluation/` and `training/` exist, but there are no task-specific model rankings, and no benchmark set wired to human feedback (`research_feedback` is collected but not used for calibration).

### Product (sections F, G, H)
- The answer view lacks a per-claim inspector and a methodology section.
- No Admin Model Control Center (provider config, masked credentials, connection tests, cost analytics).
- Navigation does not match the 9 required areas.

### Reliability (section I)
- Long research runs execute inside the request process (`void runResearch(...)`). On serverless this can be cut off. Needs a queue (Postgres job table or a hosted queue) with retries.
- No request tracing ids, no error monitoring integration, no data retention controls.

## 3. Proposed order of work

| Phase | Work | Why this order |
|---|---|---|
| 1 | Security fixes 1 to 5, migration adding `audit_logs`, `usage_ledger`, `rate_limits` | Cheapest, highest risk reduction, unblocks quotas and budgets |
| 2 | Claim engine: 5 states, independent-source rule, outdated detection, migration widening the enum and adding passage/date/explanation columns; tests for each rule | Core promise of the product |
| 3 | Provider adapter layer: per-model timeout, retry, fallback, budget, cost/latency ledger, health table; Quick / Deep / Maximum Verification modes | Builds on the ledger from phase 1 |
| 4 | Search orchestration: provider fallback, freshness score, PDF extraction, Google Programmable Search once credentials are confirmed | |
| 5 | Queue-backed research jobs, tracing ids, retention settings | |
| 6 | UI: answer view with claim inspector, Admin Model Control Center, new navigation | Needs phases 2 to 4 data |
| 7 | Evaluation: benchmark set, human feedback calibration, task rankings | Needs real runs to measure; no invented metrics |

Every phase ships as its own branch and PR with tests. No table is dropped; migrations only add or widen.

## 4. Google API key check (verified, not assumed)

A `GOOGLE_API_KEY` (prefix `AIza`, 39 characters) was tested on 26 Nov 2026 against each service directly:

| Service | Result |
|---|---|
| Gemini API (list models, generateContent, embeddings, Search grounding) | 403 `ACCESS_DENIED` |
| Custom Search JSON API | 403 `ACCESS_DENIED` |
| Fact Check Tools API | 403 `ACCESS_DENIED` |
| YouTube Data API, Books API, Cloud Vision | 403 `ACCESS_DENIED` |

Every call returned `ACCESS_DENIED` rather than `SERVICE_DISABLED`, and Google returned no activation link. This usually means the key itself is restricted (to specific APIs, HTTP referrers or IP addresses), deleted, or belongs to a project without access, not that one API simply needs enabling. **No Google service is integrated until a call succeeds.**

To make it usable:
1. In Google Cloud Console, open *APIs & Services > Credentials*, select the key, and check *Application restrictions*: server-side use needs *None* or an IP restriction, not *HTTP referrers*.
2. Under *API restrictions*, allow the APIs you want (for example Generative Language API for Gemini, Custom Search API for web search).
3. Enable those APIs for the project in *APIs & Services > Library*.
4. For Google web search, also create a Programmable Search Engine and provide its `cx` id.
5. For Gemini, a key from Google AI Studio (aistudio.google.com) is the simplest path.

## 5. Not verified in this audit
- The live production database was not connected (no `DATABASE_URL` was provided), so migration state on the deployed database is unknown.
- The deployed Vercel environment variables were not inspected.
- `pnpm check` (TypeScript) was not run in this pass.
