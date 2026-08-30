# Netlify deployment handoff

## Import the repository

Open [Netlify](https://app.netlify.com/start) and choose **Add new project → Import an existing project → GitHub**. Select the private repository `Himanshu90909/truthsearch-production`. Netlify will request GitHub authorization before it can read a private repository.

The repository includes `netlify.toml` with these settings:

| Setting | Value |
|---|---|
| Build command | `pnpm build` |
| Publish directory | `dist/public` |
| Node version | `22` |
| SPA fallback | `/*` redirects to `/index.html` with status `200` |

## Environment variables

For a frontend-only Netlify deployment, add only client-safe `VITE_*` values that the frontend actually needs. Never put `DATABASE_URL`, `JWT_SECRET`, OAuth server secrets, provider API keys, or `BUILT_IN_FORGE_API_KEY` into a public frontend deployment.

The full Express+tRPC backend, database persistence, OAuth callback, live research provider calls, and server-side LLM calls should remain on the managed full-stack deployment at [truthsearch-aynnqgr5.manus.space](https://truthsearch-aynnqgr5.manus.space), or another compatible Node host. If the frontend is split onto Netlify, configure its API origin through a reviewed frontend setting before using it; do not proxy private credentials through browser code.

## Post-deploy checks

After Netlify reports a successful deployment, verify the home page loads, the SPA fallback works on a direct route, and the frontend points to the backend host. Then run one real research query from the managed full-stack URL and confirm that citations, source inspection, provider status, and follow-up persistence still work. A Netlify frontend deployment alone does not deploy the backend.

## Current limitation

This handoff intentionally does not claim that the Express server is a Netlify Function. Converting the backend to Netlify Functions would require a separate architectural change for long-running research jobs, database access, OAuth callbacks, and background execution. The current safe split is Netlify for the lightweight frontend and the managed full-stack host for the backend.
