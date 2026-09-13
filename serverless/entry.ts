// Serverless entrypoint for Vercel.
//
// This file is bundled by esbuild during `pnpm build` into `api/index.js` —
// bundling it OURSELVES (same recipe as the standalone server) sidesteps the
// platform function bundler, which failed to resolve the server tree when it
// compiled `api/index.ts` itself. The output is a self-contained CommonJS
// module exporting an HTTP handler that lazily creates the Express app on the
// first request (keeps cold starts fast when unused).
import { createApp } from "../server/_core/app";
import type { Request, Response } from "express";

let cachedApp: ReturnType<typeof createApp> | null = null;

function getApp() {
  if (!cachedApp) {
    cachedApp = createApp();
  }
  return cachedApp;
}

// Lightweight diagnostics endpoint so deployments can be identified and
// runtime config observed without dashboard access.
function diagnostics(req: Request, res: Response): boolean {
  // Raw Node/Vercel requests expose the URL via req.url, not Express's req.path.
  const pathname = (req as { url?: string }).url ?? (req as { path?: string }).path ?? "/";
  if (pathname.split("?")[0] === "/api/__build") {
    res.status(200).json({
      build: process.env.VERCEL_GIT_COMMIT_SHA || "dev",
      node: process.version,
      hfKey: Boolean(process.env.HF_API_KEY),
      geminiKey: Boolean(process.env.GEMINI_API_KEY),
      groqKey: Boolean(process.env.XAI_API_KEY || process.env.GROQ_API_KEY),
      sync: process.env.SYNC_RESEARCH === "true" || process.env.VERCEL === "1",
    });
    return true;
  }
  return false;
}

export default async function handler(req: Request, res: Response): Promise<unknown> {
  try {
    if (diagnostics(req, res)) return undefined;
    const app = getApp();
    return app(req, res);
  } catch (error) {
    console.error("[Vercel API initialization]", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "API initialization failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return undefined;
  }
}
