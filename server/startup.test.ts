import { beforeEach, describe, expect, it } from "vitest";
import {
  LOCAL_SESSION_COOKIE,
  SESSION_TTL_MS,
  hashPassword,
  newSessionToken,
  normalizeEmail,
  validateEmail,
  verifyPassword,
} from "./auth-local";
import {
  createCollection,
  createLocalSession,
  createLocalUser,
  createSession,
  deleteCollection,
  deleteLocalSession,
  eventMetrics,
  getUserByEmail,
  getLocalUserByToken,
  listCollections,
  listSessions,
  recordEvent,
  setSessionCollection,
} from "./db";

describe("auth-local password handling", () => {
  it("hashes and verifies a password round-trip", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(stored.startsWith("scrypt:")).toBe(true);
    await expect(verifyPassword("correct horse battery staple", stored)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", stored)).resolves.toBe(false);
  });

  it("produces a different hash for the same password (per-user salt)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
  });

  it("rejects malformed stored hashes without throwing", async () => {
    await expect(verifyPassword("x", "plaintext")).resolves.toBe(false);
    await expect(verifyPassword("x", "scrypt:not-hex:")).resolves.toBe(false);
  });

  it("validates and normalizes emails", () => {
    expect(normalizeEmail("  HB@Example.COM ")).toBe("hb@example.com");
    expect(validateEmail("hb@example.com")).toBe(true);
    expect(validateEmail("not-an-email")).toBe(false);
    expect(validateEmail("missing@tld")).toBe(false);
  });

  it("mints long, unique session tokens", () => {
    const token = newSessionToken();
    expect(token.length).toBeGreaterThanOrEqual(60);
    expect(token).not.toBe(newSessionToken());
    expect(LOCAL_SESSION_COOKIE).toBe("ts_local_session");
    expect(SESSION_TTL_MS).toBeGreaterThan(0);
  });
});

describe("local account lifecycle (in-memory fallback)", () => {
  it("registers a user, opens a session, and revokes it on logout", async () => {
    const email = normalizeEmail("hb@truthsearch.dev");
    const user = await createLocalUser({ email, name: "HB", passwordHash: await hashPassword("password-123") });
    expect(user.id).toBeGreaterThan(0);
    expect(user.openId).toBe(`local:${email}`);
    expect(user.role).toBe("user");

    const found = await getUserByEmail(email);
    expect(found?.id).toBe(user.id);
    expect(found?.passwordHash).toBeTruthy();
    expect((found as { passwordHash: string }).passwordHash.startsWith("scrypt:")).toBe(true);

    const { token, expiresAt } = await createLocalSession(user.id);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const sessionUser = await getLocalUserByToken(token);
    expect(sessionUser?.id).toBe(user.id);

    await deleteLocalSession(token);
    await expect(getLocalUserByToken(token)).resolves.toBeUndefined();
  });

  it("returns undefined for unknown or expired tokens", async () => {
    await expect(getLocalUserByToken("does-not-exist")).resolves.toBeUndefined();
  });
});

describe("collections", () => {
  const email = normalizeEmail("collector@truthsearch.dev");

  beforeEach(async () => {
    if (!(await getUserByEmail(email))) {
      await createLocalUser({ email, name: "Collector", passwordHash: await hashPassword("password-123") });
    }
  });

  it("creates collections, assigns sessions, and reports counts", async () => {
    const user = (await getUserByEmail(email))!;
    const collectionId = await createCollection(user.id, "AI research");
    const sessionId = await createSession("How reliable are AI agents today?", user.id);

    const before = await listCollections(user.id);
    expect(before.some((c) => c.id === collectionId && c.name === "AI research")).toBe(true);

    await setSessionCollection(sessionId, user.id, collectionId);
    const sessions = await listSessions(user.id, 30);
    const assigned = sessions.find((s) => s.id === sessionId);
    expect(assigned?.collectionId).toBe(collectionId);

    const withCount = await listCollections(user.id);
    expect(withCount.find((c) => c.id === collectionId)?.sessionCount).toBe(1);
  });

  it("rejects assigning another user's session or collection", async () => {
    const user = (await getUserByEmail(email))!;
    const strangerId = 999999;
    const sessionId = await createSession("Question owned by another user?", user.id);
    const collectionId = await createCollection(user.id, "Private");
    await expect(setSessionCollection(sessionId, strangerId, collectionId)).rejects.toThrow("Research session not found");
    await expect(setSessionCollection(sessionId, user.id, 888888)).rejects.toThrow("Collection not found");
  });

  it("deleting a collection releases its sessions", async () => {
    const user = (await getUserByEmail(email))!;
    const collectionId = await createCollection(user.id, "Temporary");
    const sessionId = await createSession("Question for temporary collection?", user.id);
    await setSessionCollection(sessionId, user.id, collectionId);
    await deleteCollection(user.id, collectionId);
    const sessions = await listSessions(user.id, 30);
    expect(sessions.find((s) => s.id === sessionId)?.collectionId ?? null).toBeNull();
    expect((await listCollections(user.id)).some((c) => c.id === collectionId)).toBe(false);
  });
});

describe("analytics events", () => {
  it("aggregates totals, daily counts, and research metrics", async () => {
    await recordEvent("research.started", null, { mode: "quick" });
    await recordEvent("research.completed", null, { latencyMs: 4000, sources: 5, mode: "quick" });
    await recordEvent("research.completed", null, { latencyMs: 2000, sources: 3, mode: "deep" });
    await recordEvent("research.failed", null, { error: "timeout", latencyMs: 9000, mode: "quick" });

    const metrics = await eventMetrics(30);
    expect(metrics.totalsByType.find((t) => t.type === "research.completed")?.count).toBeGreaterThanOrEqual(2);
    expect(metrics.totalsByType.find((t) => t.type === "research.failed")?.count).toBeGreaterThanOrEqual(1);
    expect(metrics.daily.length).toBeGreaterThanOrEqual(1);
    expect(metrics.research.completed).toBeGreaterThanOrEqual(2);
    expect(metrics.research.failed).toBeGreaterThanOrEqual(1);
    expect(metrics.research.avgLatencyMs).toBeGreaterThan(0);
    expect(metrics.research.totalSources).toBeGreaterThanOrEqual(8);
  });
});
