import "dotenv/config";
import net from "net";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "http";
import { createApp } from "./app";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting at ${startPort}`);
}

async function startServer() {
  const app = createApp();
  const server = createServer(app);

  // Development mode serves the client through Vite; production serves the
  // built static files from dist/public when present.
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    // Bundled (dist/index.js) and tsx (server/_core/index.ts) resolve
    // import.meta.dirname differently — try both candidate locations.
    const candidates = [
      path.resolve(import.meta.dirname, "public"),
      path.resolve(import.meta.dirname, "../..", "dist", "public"),
    ];
    if (candidates.some((candidate) => fs.existsSync(candidate))) {
      serveStatic(app);
    }
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
