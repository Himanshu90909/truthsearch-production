# Full-stack deployment runbook

## Recommended deployment

Use the project’s managed full-stack Publish flow for the complete TruthSearch application. This project includes a React frontend, an Express server, tRPC procedures, database persistence, OAuth, and server-side provider/LLM calls. The Vercel manifest in this repository is intentionally frontend-only and must not be used as the only deployment for live research.

## Publish steps

1. Open the TruthSearch project in the management interface and select the latest checkpoint.
2. Confirm the project name and visibility settings, then select **Publish**.
3. Keep the full-stack/server mode enabled; do not convert the project to a static site.
4. Confirm the managed database is enabled and that the applied Drizzle schema includes users, sessions, messages, queries, sources, passages, claims, evidence, contradictions, and citations.
5. Confirm the existing managed secrets are available: `DATABASE_URL`, `JWT_SECRET`, `VITE_APP_ID`, `OAUTH_SERVER_URL`, `VITE_OAUTH_PORTAL_URL`, `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY`, `OWNER_OPEN_ID`, and `OWNER_NAME`.
6. For no-card research, set `ENABLE_PAID_SEARCH=false`, `SEARCH_PROVIDER=wikipedia`, and `ACADEMIC_SEARCH_PROVIDER=arxiv`. Optional free adapters include OpenAlex, Europe PMC, and Crossref. Paid Brave/Tavily adapters require explicit opt-in and their own keys.

## OAuth and domain checks

After a custom domain is assigned, update the OAuth application’s allowed callback/origin settings to match the published domain and retain the managed callback path `/api/oauth/callback`. Verify that the login portal returns to the same published origin and that secure cookies are preserved. Do not place server-only secrets in client-side `VITE_*` variables unless the value is intentionally public configuration.

## Post-publish smoke test

Run these checks from the published URL: load the homepage; sign in and sign out; call the provider-status view; submit a real no-card question; observe planning, searching, fetching, ranking, verifying, and completed progress; open source cards and exact evidence passages; confirm a citation URL opens; submit a follow-up question; refresh the session; and confirm the persisted answer remains available. Also test a deliberately unavailable paid provider and confirm the UI reports the dependency error without fabricating an answer.

## Known limitations

The sandbox validates TypeScript, unit tests, production bundling, real development-time free-provider queries, and production-bundle boot: `dist/index.js` starts successfully with the managed OAuth base URL and serves on the configured `PORT`. It cannot simulate the management interface’s final publish transaction, the production database connection, or an external OAuth callback without the user’s deployment authorization. Large retriever/reranker training remains an external GPU workload; the application uses honest lexical fallback until model endpoints are configured.
