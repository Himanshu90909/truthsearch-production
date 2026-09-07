import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { applyFrontendCors, createFrontendOriginAllowlist } from "./frontendCors";

const allowedFrontendOrigins = createFrontendOriginAllowlist();

// Build the Express app without binding a port or touching the filesystem.
// Used both by the classic standalone server (server/_core/index.ts) and by
// serverless entrypoints (api/index.ts) where the function handler is the
// Express app itself. Static serving of the built client stays in the
// standalone entrypoint so the serverless bundle never imports vite or uses
// import.meta helpers that may not survive bundling.
export function createApp(): express.Express {
  const app = express();

  // Allow the public Vercel frontend to call the managed backend directly when
  // Vercel Deployment Protection intercepts its same-origin /api path.
  app.use((req, res, next) => {
    const allowed = applyFrontendCors(req, res, allowedFrontendOrigins);
    if (req.method === "OPTIONS") {
      res.sendStatus(allowed ? 204 : 403);
      return;
    }
    next();
  });

  // Body parser with a larger size limit for file uploads. On serverless hosts
  // (Vercel) the platform already parses the JSON body before the handler
  // runs; re-parsing a drained stream would produce an empty object, so skip
  // the parser whenever req.body is already populated.
  app.use((req, res, next) => {
    if (req.body !== undefined && typeof req.body === "object" && Object.keys(req.body as object).length > 0) {
      next();
      return;
    }
    express.json({ limit: "50mb" })(req, res, next);
  });
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  return app;
}
