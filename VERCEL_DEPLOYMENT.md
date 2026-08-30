# Deployment handoff

## Vercel scope

The checked-in `vercel.json` intentionally configures **frontend-only Vercel hosting**. It builds the React interface into `dist/public` and adds basic security headers. It does not run the Express+tRPC server bundle, database writes, OAuth callback, live provider calls, or server-side LLM calls. This avoids presenting a broken static deployment as the complete product.

For the complete application, use the project’s managed full-stack hosting or another compatible Node host for `dist/index.js`. That backend must expose `/api/trpc`, connect to the database, and receive the server-side secrets below. The Vercel frontend should then be configured to reach that backend through the project’s supported gateway/origin setup; do not put server secrets in Vercel client variables.

## Vercel import settings

Import the private repository with the repository root as the project root. Use `pnpm install --frozen-lockfile` as the install command and `pnpm build` as the build command. The output directory is `dist/public`, as declared in `vercel.json`.

## Environment-variable split

| Location | Variables | Purpose |
| --- | --- | --- |
| Full-stack Node backend only | `DATABASE_URL`, `JWT_SECRET`, `OAUTH_SERVER_URL`, `VITE_APP_ID`, `VITE_OAUTH_PORTAL_URL`, `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY` | Database, authentication, server-side LLM, and tRPC runtime. |
| Full-stack Node backend only, free research defaults | `ENABLE_PAID_SEARCH=false`, `SEARCH_PROVIDER=wikipedia`, `ACADEMIC_SEARCH_PROVIDER=arxiv` | No-card live research through public providers. |
| Optional backend configuration | `MAX_SEARCH_QUERIES`, `MAX_SOURCES`, `RESEARCH_TIMEOUT_MS`, `MAX_RESEARCH_ROUNDS` | Bound request cost, time, and scope. |
| Optional paid backend adapters | `ENABLE_PAID_SEARCH=true`, `SEARCH_PROVIDER=brave` or `tavily`, plus the matching provider key | Paid search only when explicitly enabled. |
| Vercel frontend | `VITE_OAUTH_PORTAL_URL`, `VITE_APP_ID` | These are the only environment values referenced directly by the client bundle. They are public configuration values, not secrets. |

The server code also reads `OWNER_OPEN_ID`, `NODE_ENV`, `PORT`, `SEARCH_PROVIDER`, `ACADEMIC_SEARCH_PROVIDER`, `ENABLE_PAID_SEARCH`, `MAX_SEARCH_QUERIES`, `MAX_SOURCES`, `RESEARCH_TIMEOUT_MS`, and `MAX_RESEARCH_ROUNDS`; the last eight have safe runtime defaults or are optional, while the core server variables above must be supplied by the backend host. This split was verified against `client/src/const.ts`, `server/_core/env.ts`, `server/_core/index.ts`, `server/research.ts`, and the server integration modules.

After importing the frontend, test that the static page renders. Test the complete research flow against the Node backend separately: provider status, a real no-card session, `/api/trpc` calls, exact citations, OAuth, and persistence. If the deployment needs one integrated service rather than two, use a compatible full-stack Node host instead of Vercel frontend-only mode.

Never commit `.env` files or tokens. The exposed token previously pasted into chat must remain revoked.
