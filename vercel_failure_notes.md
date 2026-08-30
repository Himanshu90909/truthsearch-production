# Vercel failure notes

The provided URL https://truthsearch-production-himanshu90909s-projects.vercel.app/ loads the TruthSearch frontend shell successfully. Submitting the default research query fails immediately in the UI with: `Unexpected token 'T', "The page c..." is not valid JSON`.

This indicates the client is parsing an HTML/text response as JSON for its backend request. The next diagnostic steps are to inspect the network request URL/status, frontend tRPC base URL configuration, and Vercel project output/runtime assumptions. The page shell itself is not the failure.

## Confirmed API behavior

The browser’s failed request is same-origin at `/api/trpc/research.providers`. A raw request to the Vercel deployment returns HTTP 302 with `location: https://vercel.com/sso-api?...`, `content-type: text/plain`, and body `Redirecting...`. Following it yields Vercel’s login HTML, which explains the client error when tRPC tries to parse JSON. The same request to https://truthsearch-aynnqgr5.manus.space/api/trpc/research.providers returns HTTP 200 `application/json` from Express with provider data.

This is not a broken React build. The Vercel deployment is protected or otherwise does not expose the backend API route. The existing Vercel manifest is frontend-only and has no API rewrite/function. A safe fix is to configure a reviewed rewrite of `/api/:path*` to the live managed backend, or direct the frontend to that backend origin; if Vercel Deployment Protection intercepts before rewrites, the protection must be disabled for the public deployment or the user must deploy a public production alias.

## Post-fix browser check

After the GitHub push, the provided Vercel page loaded the research plan and entered a loading state when the default query was submitted. It did not immediately display the earlier JSON parse error, indicating the new client bundle with the direct backend fallback was active. Completion, citations, and the provider endpoint still need a final browser check after the backend CORS update is published.

## Latest verification

The Vercel browser page now rendered a completed research session with verified citations. The browser’s direct fetch to the managed backend still returned `TypeError: Failed to fetch`, so the new CORS code is not yet live on the managed deployment. The performance entries shown in the browser still referenced Vercel `/api/trpc/research.get` calls, suggesting the browser may have reused an older cached bundle or an authenticated Vercel path. The final validation must be repeated after publishing the current backend changes and forcing a fresh Vercel deployment/bundle.
