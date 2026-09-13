// Same-origin API routing for the self-contained deployment.
//
// The Express backend is deployed as a Vercel serverless function at
// /api/index (see vercel.json), and /api/* rewrites to it, so the browser
// calls its own origin. An explicit VITE_API_ORIGIN override remains for
// split deployments that host the backend elsewhere.
export function getResearchApiUrl(hostname: string, configuredOrigin?: string) {
  const configured = configuredOrigin?.trim();
  if (configured) return `${trimOrigin(configured)}/api/trpc`;

  // Same-origin everywhere: the API function ships with this frontend.
  void hostname;
  return "/api/trpc";
}

function trimOrigin(origin: string) {
  return origin.trim().replace(/\/$/, "");
}
