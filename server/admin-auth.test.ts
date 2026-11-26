import { describe, expect, it, beforeEach } from "vitest";
import { appRouter } from "./routers";

// Calls the real router with a hand-built context (no HTTP, no database needed: audit writes no-op without DATABASE_URL).
function caller(user: { id: number; role: "user" | "admin"; name?: string; email?: string } | null, headers: Record<string, string> = {}) {
  const ctx: any = { user, req: { headers, protocol: "https", get: () => "x" }, res: { cookie() {}, clearCookie() {} } };
  return appRouter.createCaller(ctx);
}

describe("admin.metrics authorization", () => {
  beforeEach(() => { delete process.env.DATABASE_URL; process.env.ADMIN_METRICS_TOKEN = "s3cret-monitor-token"; });

  it("rejects anonymous callers", async () => {
    await expect(caller(null).admin.metrics()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("rejects a normal signed-in user", async () => {
    await expect(caller({ id: 5, role: "user" }).admin.metrics()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("no longer accepts the shared token inside the request body", async () => {
    // @ts-expect-error the input schema no longer has a token field; extra keys are stripped, so access must still fail
    await expect(caller(null).admin.metrics({ token: "s3cret-monitor-token" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("rejects a wrong header token", async () => {
    await expect(caller(null, { "x-admin-token": "wrong-token-value!" }).admin.metrics()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("accepts the correct header token for server-to-server monitoring", async () => {
    await expect(caller(null, { "x-admin-token": "s3cret-monitor-token" }).admin.metrics()).resolves.toBeDefined();
  });
  it("accepts a real admin", async () => {
    await expect(caller({ id: 1, role: "admin" }).admin.metrics()).resolves.toBeDefined();
  });
  it("admin.audit is admin-only (FORBIDDEN for users)", async () => {
    await expect(caller({ id: 5, role: "user" }).admin.audit()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(null).admin.audit()).rejects.toMatchObject({ code: "FORBIDDEN" }); // anonymous is denied too
  });
  it("an empty configured token never grants access", async () => {
    process.env.ADMIN_METRICS_TOKEN = "";
    await expect(caller(null, { "x-admin-token": "" }).admin.metrics()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("research.start quota", () => {
  beforeEach(() => { delete process.env.DATABASE_URL; });
  it("blocks an anonymous caller after the hourly limit (shared limiter, not a per-call counter)", async () => {
    const c = caller(null, { "x-forwarded-for": "203.0.113.77" });
    const results: string[] = [];
    for (let i = 0; i < 10; i++) {
      try { await c.research.start({ question: "What is the boiling point of water at sea level?", mode: "quick" } as any); results.push("ok"); }
      catch (e: any) { results.push(e.code ?? "err"); }
    }
    expect(results.filter((r) => r === "TOO_MANY_REQUESTS").length).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
