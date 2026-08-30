# Vercel deployment handoff

TruthSearch is a full-stack React + Express + tRPC application. The frontend can be built by Vercel, but the complete application also needs the Node server, managed database, server-side LLM configuration, and provider environment variables. Do not deploy it as a static-only site if you need live research APIs or persisted sessions.

## Recommended path

Use the project’s managed full-stack hosting for the complete application, because it already supplies the Node runtime, database wiring, OAuth, and server-side environment values. If using Vercel anyway, deploy the frontend and backend through a compatible Node/serverless architecture and verify every tRPC route before inviting users.

## Vercel import settings

Import the repository, use the repository root as the project root, and use `pnpm install --frozen-lockfile` as the install command. Use `pnpm build` as the build command. The generated frontend is under `dist/public`; the Express server bundle is `dist/index.js` and must be hosted as a Node-compatible server entry rather than discarded.

Required server-side variables include `DATABASE_URL`, `JWT_SECRET`, `OAUTH_SERVER_URL`, `VITE_APP_ID`, `VITE_OAUTH_PORTAL_URL`, `BUILT_IN_FORGE_API_URL`, and `BUILT_IN_FORGE_API_KEY`. For free research mode, set `ENABLE_PAID_SEARCH=false`, `SEARCH_PROVIDER=wikipedia`, and `ACADEMIC_SEARCH_PROVIDER=arxiv`. Optional public adapters include `openalex` and `europePmc`; optional paid adapters require their own credentials and explicit opt-in.

Never commit `.env` files or tokens. After import, test the home page, `/api/trpc/research.providers`, a real research session, citation inspection, and session persistence. If Vercel cannot serve the Express entry and database-backed tRPC routes in the selected configuration, use the managed full-stack host instead of presenting a broken static deployment.
