// Express routes for Visual Intelligence (outside tRPC):
//   GET /api/visual/image/:id        — private image serving (token or ownership)
//   GET /api/visual/stream/:id       — SSE: progress + token deltas + final result
//
// SSE is used because tRPC-over-serverless streams awkwardly; this is the
// same pattern the research router approximates with polling. Client
// disconnect cancels the provider call via AbortController (graceful cancel).

import type { Express, Request, Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import { LOCAL_SESSION_COOKIE } from "../auth-local";
import { getLocalUserByToken } from "../db";
import { getVisualSession, getVisualUpload, canAccessUpload } from "./db";
import { runAnalysis } from "./analysis";
import { visionConfigured } from "./providers";
import { saveAnalysis, updateSessionStatus } from "./router";

async function currentUser(req: Request): Promise<{ id: number } | null> {
  try {
    const token = parseCookieHeader(req.headers.cookie ?? "")[LOCAL_SESSION_COOKIE];
    if (!token) return null;
    const user = await getLocalUserByToken(token);
    return user ? { id: Number(user.id) } : null;
  } catch {
    return null;
  }
}

export function registerVisualRoutes(app: Express): void {
  // Private image serving. Signed-in users get their own images by id;
  // anyone (including anonymous) needs the unguessable upload token.
  app.get("/api/visual/image/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid image id" }); return; }
      const token = typeof req.query.t === "string" ? req.query.t : undefined;
      const user = await currentUser(req);
      const upload = await canAccessUpload(id, user?.id ?? null, token);
      if (!upload) { res.status(404).json({ error: "Image not found" }); return; }
      const buffer = Buffer.from(upload.data, "base64");
      res.setHeader("content-type", upload.mime);
      res.setHeader("content-length", String(buffer.byteLength));
      res.setHeader("cache-control", "private, max-age=3600");
      res.setHeader("x-content-type-options", "nosniff");
      res.end(buffer);
    } catch (error) {
      console.error("[Visual] image serve failed:", error);
      res.status(500).json({ error: "Image could not be served" });
    }
  });

  // SSE analysis stream: progress events, explanation deltas, final payload.
  app.get("/api/visual/stream/:id", async (req: Request, res: Response) => {
    const sessionId = Number(req.params.id);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      res.status(400).json({ error: "Invalid session id" });
      return;
    }
    const user = await currentUser(req);
    const session = await getVisualSession(sessionId, user?.id ?? null);
    if (!session) { res.status(404).json({ error: "Visual session not found" }); return; }
    const upload = await getVisualUpload(session.uploadId);
    if (!upload) { res.status(404).json({ error: "The uploaded image has expired or was deleted." }); return; }

    if (!visionConfigured()) {
      res.writeHead(200, sseHeaders());
      send(res, { type: "error", message: "No vision model is configured on this deployment. Set GEMINI_API_KEY, HF_API_KEY, GROQ_API_KEY, or VISION_API_URL + VISION_API_KEY + VISION_MODEL." });
      res.end();
      return;
    }

    res.writeHead(200, sseHeaders());
    const abort = new AbortController();
    req.on("close", () => abort.abort());
    res.on("close", () => abort.abort());

    await updateSessionStatus(sessionId, "analyzing");
    send(res, { type: "stage", stage: "analyzing", message: "Reading the image…" });

    try {
      const outcome = await runAnalysis({
        imageDataUrl: `data:${upload.mime};base64,${upload.data}`,
        question: session.question ?? undefined,
        mode: session.mode as "explain",
        depth: session.depth as "intermediate",
        language: session.language,
        width: upload.width,
        height: upload.height,
        signal: abort.signal,
      });
      send(res, { type: "stage", stage: "structuring", message: "Validating regions and building annotations…" });
      const analysisId = await saveAnalysis(sessionId, upload, outcome);
      await updateSessionStatus(sessionId, "completed");
      // Final payload: everything the UI needs to render the result.
      send(res, {
        type: "done",
        analysisId,
        provider: outcome.provider,
        model: outcome.model,
        droppedRegions: outcome.droppedRegions,
        analysis: outcome.analysis,
        overlaySvg: outcome.overlaySvg,
        diagramSvg: outcome.diagramSvgText,
      });
      res.end();
    } catch (error) {
      if (abort.signal.aborted) {
        await updateSessionStatus(sessionId, "cancelled").catch(() => {});
        try { send(res, { type: "cancelled" }); res.end(); } catch { /* client gone */ }
        return;
      }
      const message = error instanceof Error ? error.message : "Visual analysis failed.";
      await updateSessionStatus(sessionId, "failed", message).catch(() => {});
      send(res, { type: "error", message });
      res.end();
    }
  });
}

function sseHeaders(): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  };
}

function send(res: Response, event: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
