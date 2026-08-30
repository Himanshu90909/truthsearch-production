# Vercel deployment handoff

## Scope and current architecture

The checked-in `vercel.json` builds the React interface into `dist/public` and rewrites `/api/*` requests to the live Express+tRPC backend at `https://truthsearch-aynnqgr5.manus.space`. This makes the Vercel frontend usable without duplicating the database, OAuth, live-provider, or server-side LLM runtime on Vercel.

Vercel is still **not running the Express server bundle**. The managed full-stack deployment remains responsible for `/api/trpc`, database writes, OAuth callbacks, live research provider calls, and server-side LLM calls. The rewrite is a split-deployment bridge, not a claim that the backend is deployed as a Vercel Function.

## Import settings

Import the private repository `Himanshu90909/truthsearch-production` with the repository root as the project root. Use `pnpm install --frozen-lockfile` as the install command and `pnpm build` as the build command. The output directory is `dist/public`, as declared in `vercel.json`.

The deployed Vercel project must be publicly reachable for browser API calls. If Vercel Deployment Protection is enabled on the deployment, it can intercept `/api/*` before the rewrite and return a 302 SSO response. In that case, deploy a public production alias or adjust the Vercel project’s Deployment Protection settings for the public site.

## Environment-variable split

| Location | Variables | Purpose |
| --- | --- | --- |
| Managed full-stack backend only | `DATABASE_URL`, `JWT_SECRET`, `OAUTH_SERVER_URL`, `VITE_APP_ID`, `VITE_OAUTH_PORTAL_URL`, `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY` | Database, authentication, server-side LLM, and tRPC runtime. |
| Managed backend, free research defaults | `ENABLE_PAID_SEARCH=false`, `SEARCH_PROVIDER=wikipedia`, `ACADEMIC_SEARCH_PROVIDER=arxiv` | No-card live research through public providers. |
| Optional backend configuration | `MAX_SEARCH_QUERIES`, `MAX_SOURCES`, `RESEARCH_TIMEOUT_MS`, `MAX_RESEARCH_ROUNDS` | Bound request cost, time, and scope. |
| Optional paid backend adapters | `ENABLE_PAID_SEARCH=true`, `SEARCH_PROVIDER=brave` or `tavily`, plus the matching provider key | Paid search only when explicitly enabled. |
| Vercel frontend | `VITE_OAUTH_PORTAL_URL`, `VITE_APP_ID` | Public client configuration referenced directly by the browser bundle. |

Never put `DATABASE_URL`, `JWT_SECRET`, OAuth server secrets, provider API keys, or `BUILT_IN_FORGE_API_KEY` into Vercel client variables. Never commit `.env` files or tokens. The token previously pasted into chat must remain revoked.

## Verification

After Vercel finishes the deployment, open the site and run a real research query. Confirm that the browser request to `/api/trpc/research.providers` returns JSON rather than HTML or a Vercel SSO redirect, then verify a completed answer, exact citations, provider status, and follow-up persistence. The canonical backend-only fallback remains `https://truthsearch-aynnqgr5.manus.space` if the Vercel project is protected or its rewrite has not yet propagated.
