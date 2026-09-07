# Self-contained deployment: builds the Vite client and bundles the Express
# server, then serves both from one Node process on $PORT (default 7860 for
# HuggingFace Spaces). No MySQL needed: the server falls back to its
# in-memory session store when DATABASE_URL is absent.
FROM node:20-bookworm-slim

WORKDIR /app
RUN corepack enable

COPY . .

RUN pnpm install --no-frozen-lockfile
RUN pnpm build

ENV NODE_ENV=production
ENV PORT=7860
EXPOSE 7860

CMD ["node", "dist/index.js"]
