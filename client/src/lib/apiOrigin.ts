export const VERCEL_FRONTEND_HOST = "truthsearch-production-himanshu90909s-projects.vercel.app";
export const MANAGED_BACKEND_ORIGIN = "https://truthsearch-aynnqgr5.manus.space";

function trimOrigin(origin: string) {
  return origin.trim().replace(/\/$/, "");
}

export function getResearchApiUrl(hostname: string, configuredOrigin?: string) {
  const configured = configuredOrigin?.trim();
  if (configured) return `${trimOrigin(configured)}/api/trpc`;

  if (hostname === VERCEL_FRONTEND_HOST) {
    return `${MANAGED_BACKEND_ORIGIN}/api/trpc`;
  }

  return "/api/trpc";
}
