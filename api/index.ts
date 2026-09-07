// Vercel serverless entrypoint. All /api/* traffic is rewritten here (see
// vercel.json); the Express app routes tRPC, OAuth, and storage proxy
// internally. Research runs synchronously in this mode (SYNC_RESEARCH
// default-on under VERCEL) because background work does not survive a
// serverless response — the mutation returns after the pipeline finishes, so
// the client's existing start-then-poll flow works.
//
// Initialisation and request handling are wrapped defensively so a crash
// surfaces as a JSON stack trace (vercelFn error) instead of the platform's
// generic FUNCTION_INVOCATION_FAILED, and /api/__build reports which build
// is actually live.
import type { Request, Response } from "express";
import { createApp } from "../server/_core/app";

const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || "dev";

let ready: ReturnType<typeof createApp> | null = null;

export default async function handler(req: Request, res: Response) {
  if (!ready) {
    try {
      const app = createApp();
      // Lightweight diagnostics endpoint so deployments can be identified
      // and init errors observed without dashboard access.
      app.use((req2, res2, next) => {
        if (req2.path === "/api/__build") {
          res2.status(200).json({
            build: BUILD_ID,
            node: process.version,
            hfKey: Boolean(process.env.HF_API_KEY),
          });
          return;
        }
        next();
      });
      ready = app;
    } catch (err: unknown) {
      const stack = err instanceof Error ? err.stack : String(err);
      if (!res.headersSent) {
        res.status(500).json({ vercelFn: "init-error", stack });
      }
      return;
    }
  }

  try {
    await new Promise<void>((resolve, reject) => {
      res.on("close", resolve);
      ready!(req, res, (err?: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } catch (err: unknown) {
    const stack = err instanceof Error ? err.stack : String(err);
    if (!res.headersSent) {
      res.status(500).json({ vercelFn: "handler-error", stack });
    }
  }
}
