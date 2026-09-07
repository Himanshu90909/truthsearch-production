// Vercel serverless entrypoint. api/entry.ts is prebuilt by esbuild during
// `pnpm build` into dist/api.cjs (CommonJS) — the platform's TS bundler never
// touches the server graph. This shim only re-exports the prebuilt handler.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const prebuilt = require("../dist/api.cjs") as { default?: unknown };
const handler = (prebuilt.default ?? prebuilt) as (req: unknown, res: unknown) => void;
export default handler;
