import type { Request, Response } from "express";

export const DEFAULT_FRONTEND_ORIGINS = [
  "https://truthsearch-production-himanshu90909s-projects.vercel.app",
  "https://truthsearch-aynnqgr5.manus.space",
];

export function normalizeFrontendOrigin(origin: string) {
  return origin.trim().replace(/\/$/, "");
}

export function createFrontendOriginAllowlist(extraOrigins = process.env.FRONTEND_ORIGINS ?? "") {
  return new Set(
    [
      ...DEFAULT_FRONTEND_ORIGINS,
      ...extraOrigins
        .split(",")
        .map(origin => origin.trim())
        .filter(Boolean),
    ].map(normalizeFrontendOrigin)
  );
}

export function applyFrontendCors(
  req: Request,
  res: Response,
  allowedOrigins: ReadonlySet<string>
) {
  const origin = req.header("Origin");
  if (!origin || !allowedOrigins.has(normalizeFrontendOrigin(origin))) return false;

  res.header("Access-Control-Allow-Origin", origin);
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Vary", "Origin");
  return true;
}
