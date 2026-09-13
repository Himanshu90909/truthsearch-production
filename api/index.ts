// Vercel serverless entrypoint. Export the Express app directly so the
// platform bundles the server graph as an ESM Node function. This avoids
// loading a generated CommonJS file at runtime.
import { createApp } from "../server/_core/app";
import type { Request, Response, NextFunction } from "express";

const app = createApp();

app.use((req: Request, res: Response, next: NextFunction) => {
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
