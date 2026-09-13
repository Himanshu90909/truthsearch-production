import type { Request, Response } from "express";

type ExpressHandler = (req: Request, res: Response) => unknown;
let appPromise: Promise<ExpressHandler> | undefined;

export default async function handler(req: Request, res: Response): Promise<unknown> {
  try {
    appPromise ??= import("../server/_core/app").then(({ createApp }) => {
      const app = createApp();
      return app as unknown as ExpressHandler;
    });
    const app = await appPromise;
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
