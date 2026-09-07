// Vercel serverless entrypoint: the Express app IS the request handler.
// All /api/* traffic is rewritten here (see vercel.json); the app routes
// tRPC, OAuth, and storage proxy internally. Research runs synchronously in
// this mode (SYNC_RESEARCH default-on under VERCEL) because background work
// does not survive a serverless response — the mutation returns after the
// pipeline finishes, so the client's existing start-then-poll flow works.
import { createApp } from "../server/_core/app";

export default createApp();
