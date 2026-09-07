// Prebuilt serverless entrypoint. This file is bundled by esbuild during
// `pnpm build` into dist/api.cjs — bundling it OURSELVES (same recipe as the
// standalone server) sidesteps the platform function bundler, which crashed
// the deployment. The output is a CommonJS module exporting the Express app,
// which doubles as the HTTP handler for Vercel's runtime bridge.
import { createApp } from "../server/_core/app";
import type { Request, Response } from "express";

const app = createApp();

// Lightweight diagnostics endpoint so deployments can be identified and
// runtime config observed without dashboard access.
app.use((req: Request, res: Response, next: () => void) => {
  if (req.path === "/api/__build") {
    res.status(200).json({
      build: process.env.VERCEL_GIT_COMMIT_SHA || "dev",
      node: process.version,
      hfKey: Boolean(process.env.HF_API_KEY),
      sync: process.env.SYNC_RESEARCH === "true" || process.env.VERCEL === "1",
    });
    return;
  }
  next();
});

export default app;
