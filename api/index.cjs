"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc2) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc2 = __getOwnPropDesc(from, key)) || desc2.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// serverless/entry.ts
var entry_exports = {};
__export(entry_exports, {
  default: () => handler
});
module.exports = __toCommonJS(entry_exports);

// server/_core/app.ts
var import_express = __toESM(require("express"), 1);
var import_express2 = require("@trpc/server/adapters/express");

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
var OAUTH_STATE_COOKIE = "__Host-oauth_state";
var decodeOAuthState = (state) => {
  let decoded;
  try {
    decoded = atob(state);
  } catch {
    return { redirectUri: "" };
  }
  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.redirectUri === "string") return parsed;
  } catch {
  }
  return { redirectUri: decoded };
};

// server/_core/oauth.ts
var import_cookie2 = require("cookie");

// server/db.ts
var import_drizzle_orm = require("drizzle-orm");
var import_mysql2 = require("drizzle-orm/mysql2");

// drizzle/schema.ts
var import_mysql_core = require("drizzle-orm/mysql-core");
var users = (0, import_mysql_core.mysqlTable)("users", {
  id: (0, import_mysql_core.int)("id").autoincrement().primaryKey(),
  openId: (0, import_mysql_core.varchar)("openId", { length: 64 }).notNull().unique(),
  name: (0, import_mysql_core.text)("name"),
  email: (0, import_mysql_core.varchar)("email", { length: 320 }),
  loginMethod: (0, import_mysql_core.varchar)("loginMethod", { length: 64 }),
  role: (0, import_mysql_core.mysqlEnum)("role", ["user", "admin"]).default("user").notNull(),
  createdAt: (0, import_mysql_core.timestamp)("createdAt").defaultNow().notNull(),
  updatedAt: (0, import_mysql_core.timestamp)("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: (0, import_mysql_core.timestamp)("lastSignedIn").defaultNow().notNull()
});
var researchSessions = (0, import_mysql_core.mysqlTable)("research_sessions", {
  id: (0, import_mysql_core.int)("id").autoincrement().primaryKey(),
  userId: (0, import_mysql_core.int)("userId"),
  title: (0, import_mysql_core.varchar)("title", { length: 500 }).notNull(),
  question: (0, import_mysql_core.text)("question").notNull(),
  status: (0, import_mysql_core.mysqlEnum)("status", ["queued", "researching", "completed", "failed"]).default("queued").notNull(),
  answer: (0, import_mysql_core.text)("answer"),
  plan: (0, import_mysql_core.json)("plan"),
  error: (0, import_mysql_core.text)("error"),
  createdAt: (0, import_mysql_core.timestamp)("createdAt").defaultNow().notNull(),
  updatedAt: (0, import_mysql_core.timestamp)("updatedAt").defaultNow().onUpdateNow().notNull()
});
var researchMessages = (0, import_mysql_core.mysqlTable)("research_messages", {
  id: (0, import_mysql_core.int)("id").autoincrement().primaryKey(),
  sessionId: (0, import_mysql_core.int)("sessionId").notNull(),
  role: (0, import_mysql_core.mysqlEnum)("role", ["user", "assistant", "system"]).notNull(),
  content: (0, import_mysql_core.text)("content").notNull(),
  createdAt: (0, import_mysql_core.timestamp)("createdAt").defaultNow().notNull()
});
var researchQueries = (0, import_mysql_core.mysqlTable)("research_queries", {
  id: (0, import_mysql_core.int)("id").autoincrement().primaryKey(),
  sessionId: (0, import_mysql_core.int)("sessionId").notNull(),
  query: (0, import_mysql_core.varchar)("query", { length: 1e3 }).notNull(),
  provider: (0, import_mysql_core.varchar)("provider", { length: 64 }).notNull(),
  status: (0, import_mysql_core.mysqlEnum)("status", ["planned", "searched", "failed"]).default("planned").notNull(),
  resultCount: (0, import_mysql_core.int)("resultCount").default(0).notNull(),
  createdAt: (0, import_mysql_core.timestamp)("createdAt").defaultNow().notNull()
});
var researchSources = (0, import_mysql_core.mysqlTable)("research_sources", {
  id: (0, import_mysql_core.int)("id").autoincrement().primaryKey(),
  sessionId: (0, import_mysql_core.int)("sessionId").notNull(),
  queryId: (0, import_mysql_core.int)("queryId"),
  url: (0, import_mysql_core.varchar)("url", { length: 2048 }).notNull(),
  canonicalUrl: (0, import_mysql_core.varchar)("canonicalUrl", { length: 2048 }).notNull(),
  title: (0, import_mysql_core.text)("title").notNull(),
  domain: (0, import_mysql_core.varchar)("domain", { length: 255 }).notNull(),
  author: (0, import_mysql_core.text)("author"),
  publicationDate: (0, import_mysql_core.varchar)("publicationDate", { length: 128 }),
  sourceType: (0, import_mysql_core.varchar)("sourceType", { length: 64 }).notNull(),
  qualityScore: (0, import_mysql_core.int)("qualityScore").notNull(),
  content: (0, import_mysql_core.text)("content"),
  retrievedAt: (0, import_mysql_core.timestamp)("retrievedAt").defaultNow().notNull()
});
var researchPassages = (0, import_mysql_core.mysqlTable)("research_passages", {
  id: (0, import_mysql_core.int)("id").autoincrement().primaryKey(),
  sourceId: (0, import_mysql_core.int)("sourceId").notNull(),
  passageIndex: (0, import_mysql_core.int)("passageIndex").notNull(),
  text: (0, import_mysql_core.text)("text").notNull(),
  tokenCount: (0, import_mysql_core.int)("tokenCount").notNull(),
  bm25Score: (0, import_mysql_core.int)("bm25Score"),
  denseScore: (0, import_mysql_core.int)("denseScore"),
  fusedScore: (0, import_mysql_core.int)("fusedScore"),
  rerankScore: (0, import_mysql_core.int)("rerankScore")
});
var researchClaims = (0, import_mysql_core.mysqlTable)("research_claims", {
  id: (0, import_mysql_core.int)("id").autoincrement().primaryKey(),
  sessionId: (0, import_mysql_core.int)("sessionId").notNull(),
  claim: (0, import_mysql_core.text)("claim").notNull(),
  confidence: (0, import_mysql_core.int)("confidence").notNull(),
  verificationStatus: (0, import_mysql_core.mysqlEnum)("verificationStatus", ["verified", "mixed", "unsupported"]).notNull()
});
var researchEvidence = (0, import_mysql_core.mysqlTable)("research_evidence", {
  id: (0, import_mysql_core.int)("id").autoincrement().primaryKey(),
  claimId: (0, import_mysql_core.int)("claimId").notNull(),
  passageId: (0, import_mysql_core.int)("passageId").notNull(),
  supportScore: (0, import_mysql_core.int)("supportScore").notNull(),
  exactQuote: (0, import_mysql_core.text)("exactQuote").notNull()
});
var researchContradictions = (0, import_mysql_core.mysqlTable)("research_contradictions", {
  id: (0, import_mysql_core.int)("id").autoincrement().primaryKey(),
  sessionId: (0, import_mysql_core.int)("sessionId").notNull(),
  claimId: (0, import_mysql_core.int)("claimId").notNull(),
  description: (0, import_mysql_core.text)("description").notNull(),
  sourceIds: (0, import_mysql_core.json)("sourceIds").notNull()
});
var researchCitations = (0, import_mysql_core.mysqlTable)("research_citations", {
  id: (0, import_mysql_core.int)("id").autoincrement().primaryKey(),
  claimId: (0, import_mysql_core.int)("claimId").notNull(),
  sourceId: (0, import_mysql_core.int)("sourceId").notNull(),
  verified: (0, import_mysql_core.int)("verified").notNull().default(0)
});

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/db.ts
var _db = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = (0, import_mysql2.drizzle)(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
    }
  }
  return _db;
}
var mem = {
  nextId: 1,
  sessions: /* @__PURE__ */ new Map(),
  messages: [],
  queries: [],
  sources: [],
  passages: [],
  claims: [],
  evidence: []
};
function memId() {
  return mem.nextId++;
}
function touch(s) {
  if (s) {
    s.updatedAt = /* @__PURE__ */ new Date();
  }
}
async function upsertUser(user) {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values = { openId: user.openId, name: user.name, email: user.email, loginMethod: user.loginMethod, lastSignedIn: user.lastSignedIn || /* @__PURE__ */ new Date() };
  const updateSet = { ...values };
  if (user.role || user.openId === ENV.ownerOpenId) {
    values.role = user.role || "admin";
    updateSet.role = values.role;
  }
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(users).where((0, import_drizzle_orm.eq)(users.openId, openId)).limit(1);
  return result[0];
}
async function createSession(question, userId) {
  const db = await getDb();
  if (!db) {
    const id = memId();
    const now = /* @__PURE__ */ new Date();
    mem.sessions.set(id, { id, title: question.slice(0, 120), question, userId: userId ?? null, status: "queued", answer: null, plan: null, error: null, createdAt: now, updatedAt: now });
    return id;
  }
  const result = await db.insert(researchSessions).values({ title: question.slice(0, 120), question, userId, status: "queued" });
  return Number(result[0].insertId);
}
async function updateSession(id, patch) {
  const db = await getDb();
  if (!db) {
    const s = mem.sessions.get(id);
    if (s) {
      Object.assign(s, patch);
      touch(s);
    }
    return;
  }
  await db.update(researchSessions).set(patch).where((0, import_drizzle_orm.eq)(researchSessions.id, id));
}
async function addMessage(sessionId, role, content) {
  const db = await getDb();
  if (!db) {
    mem.messages.push({ id: memId(), sessionId, role, content, createdAt: /* @__PURE__ */ new Date() });
    return;
  }
  await db.insert(researchMessages).values({ sessionId, role, content });
}
async function addQuery(sessionId, query, provider, status, resultCount = 0) {
  const db = await getDb();
  if (!db) {
    mem.queries.push({ id: memId(), sessionId, query, provider, status, resultCount, createdAt: /* @__PURE__ */ new Date() });
    return;
  }
  await db.insert(researchQueries).values({ sessionId, query, provider, status, resultCount });
}
async function addSource(sessionId, source) {
  const db = await getDb();
  if (!db) {
    const id = memId();
    mem.sources.push({ id, sessionId, url: source.url, canonicalUrl: source.canonicalUrl, title: source.title, domain: source.domain, author: source.author, publicationDate: source.published, sourceType: source.sourceType, qualityScore: source.qualityScore, content: source.content });
    return id;
  }
  const result = await db.insert(researchSources).values({ sessionId, url: source.url, canonicalUrl: source.canonicalUrl, title: source.title, domain: source.domain, author: source.author, publicationDate: source.published, sourceType: source.sourceType, qualityScore: source.qualityScore, content: source.content });
  return Number(result[0].insertId);
}
function matchPassageId(passages, quote, ids) {
  const index = passages.findIndex((passage) => passage === quote);
  return index >= 0 ? ids[index] || 0 : 0;
}
async function addPassage(sourceId, passageIndex, text2) {
  const db = await getDb();
  if (!db) {
    const id = memId();
    mem.passages.push({ id, sourceId, passageIndex, text: text2, tokenCount: text2.split(/\s+/).length });
    return id;
  }
  const result = await db.insert(researchPassages).values({ sourceId, passageIndex, text: text2, tokenCount: text2.split(/\s+/).length });
  return Number(result[0].insertId);
}
async function addClaim(sessionId, claim, confidence, status) {
  const db = await getDb();
  if (!db) {
    const id = memId();
    mem.claims.push({ id, sessionId, claim, confidence, verificationStatus: status });
    return id;
  }
  const result = await db.insert(researchClaims).values({ sessionId, claim, confidence, verificationStatus: status });
  return Number(result[0].insertId);
}
async function addEvidence(claimId, passageId, quote, supportScore) {
  const db = await getDb();
  if (!db) {
    mem.evidence.push({ id: memId(), claimId, passageId, exactQuote: quote, supportScore });
    return;
  }
  await db.insert(researchEvidence).values({ claimId, passageId, exactQuote: quote, supportScore });
}
async function addCitation(claimId, sourceId, verified) {
  const db = await getDb();
  if (!db) return;
  await db.insert(researchCitations).values({ claimId, sourceId, verified: verified ? 1 : 0 });
}
async function listSessions(userId, limit = 30) {
  const db = await getDb();
  if (!db) {
    return Array.from(mem.sessions.values()).filter((s) => userId ? s.userId === userId : true).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, Math.min(Math.max(limit, 1), 100)).map((s) => ({ id: s.id, title: s.title, question: s.question, status: s.status, createdAt: s.createdAt, updatedAt: s.updatedAt }));
  }
  const where = userId ? (0, import_drizzle_orm.eq)(researchSessions.userId, userId) : void 0;
  return db.select({ id: researchSessions.id, title: researchSessions.title, question: researchSessions.question, status: researchSessions.status, createdAt: researchSessions.createdAt, updatedAt: researchSessions.updatedAt }).from(researchSessions).where(where).orderBy((0, import_drizzle_orm.desc)(researchSessions.updatedAt)).limit(Math.min(Math.max(limit, 1), 100));
}
async function getSession(id, userId) {
  const db = await getDb();
  if (!db) {
    const session2 = mem.sessions.get(id);
    if (!session2 || userId && session2.userId !== userId) return void 0;
    const messages2 = mem.messages.filter((m) => m.sessionId === id).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const queries2 = mem.queries.filter((q) => q.sessionId === id).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const sources2 = mem.sources.filter((s) => s.sessionId === id).sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0));
    const claims2 = mem.claims.filter((c) => c.sessionId === id);
    const evidence2 = claims2.length ? mem.evidence.filter((e) => claims2.some((c) => c.id === e.claimId)) : [];
    return { session: session2, messages: messages2, queries: queries2, sources: sources2, claims: claims2, evidence: evidence2 };
  }
  const where = userId ? (0, import_drizzle_orm.and)((0, import_drizzle_orm.eq)(researchSessions.id, id), (0, import_drizzle_orm.eq)(researchSessions.userId, userId)) : (0, import_drizzle_orm.eq)(researchSessions.id, id);
  const session = (await db.select().from(researchSessions).where(where).limit(1))[0];
  if (!session) return void 0;
  const [messages, queries, sources, claims] = await Promise.all([
    db.select().from(researchMessages).where((0, import_drizzle_orm.eq)(researchMessages.sessionId, id)).orderBy(researchMessages.createdAt),
    db.select().from(researchQueries).where((0, import_drizzle_orm.eq)(researchQueries.sessionId, id)).orderBy(researchQueries.createdAt),
    db.select().from(researchSources).where((0, import_drizzle_orm.eq)(researchSources.sessionId, id)).orderBy((0, import_drizzle_orm.desc)(researchSources.qualityScore)),
    db.select().from(researchClaims).where((0, import_drizzle_orm.eq)(researchClaims.sessionId, id))
  ]);
  const evidence = claims.length ? await db.select().from(researchEvidence).where((0, import_drizzle_orm.inArray)(researchEvidence.claimId, claims.map((claim) => claim.id))) : [];
  return { session, messages, queries, sources, claims, evidence };
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
var import_axios = __toESM(require("axios"), 1);
var import_cookie = require("cookie");
var import_jose = require("jose");
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    return decodeOAuthState(state).redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => import_axios.default.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = (0, import_cookie.parse)(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new import_jose.SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await (0, import_jose.jwtVerify)(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    let sessionToken = cookies.get(COOKIE_NAME);
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        sessionToken = authHeader.slice(7);
      }
    }
    const session = await this.verifySession(sessionToken);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
      const taskUid = userInfo.taskUid ?? null;
      if (!taskUid) {
        throw ForbiddenError("Cron session missing task_uid");
      }
      return buildCronUser(userInfo);
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var CRON_OPEN_ID_PREFIX = "cron_";
function buildCronUser(userInfo) {
  const now = /* @__PURE__ */ new Date();
  return {
    id: -1,
    openId: userInfo.openId,
    name: userInfo.name || "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    taskUid: userInfo.taskUid ?? void 0,
    isCron: true
  };
}
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    const { nonce } = decodeOAuthState(state);
    const expectedNonce = (0, import_cookie2.parse)(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!nonce || nonce !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/storageProxy.ts
function registerStorageProxy(app) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = req.params[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }
    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/"
      );
      forgeUrl.searchParams.set("path", key);
      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` }
      });
      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }
      const { url } = await forgeResp.json();
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}

// server/routers.ts
var import_zod2 = require("zod");

// server/_core/systemRouter.ts
var import_zod = require("zod");

// server/_core/notification.ts
var import_server = require("@trpc/server");
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new import_server.TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new import_server.TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new import_server.TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new import_server.TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new import_server.TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new import_server.TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
var import_server2 = require("@trpc/server");
var import_superjson = __toESM(require("superjson"), 1);
var t = import_server2.initTRPC.context().create({
  transformer: import_superjson.default
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new import_server2.TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new import_server2.TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    import_zod.z.object({
      timestamp: import_zod.z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    import_zod.z.object({
      title: import_zod.z.string().min(1, "title is required"),
      content: import_zod.z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/storage.ts
function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;
  if (!forgeUrl || !forgeKey) {
    throw new Error(
      "Storage config missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY"
    );
  }
  return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
}
function normalizeKey(relKey) {
  return relKey.replace(/^\/+/, "");
}
function appendHashSuffix(relKey) {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}
async function storagePut(relKey, data, contentType = "application/octet-stream") {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = appendHashSuffix(normalizeKey(relKey));
  const presignUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
  presignUrl.searchParams.set("path", key);
  const presignResp = await fetch(presignUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` }
  });
  if (!presignResp.ok) {
    const msg = await presignResp.text().catch(() => presignResp.statusText);
    throw new Error(`Storage presign failed (${presignResp.status}): ${msg}`);
  }
  const { url: s3Url } = await presignResp.json();
  if (!s3Url) throw new Error("Forge returned empty presign URL");
  const blob = typeof data === "string" ? new Blob([data], { type: contentType }) : new Blob([data], { type: contentType });
  const uploadResp = await fetch(s3Url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob
  });
  if (!uploadResp.ok) {
    throw new Error(`Storage upload to S3 failed (${uploadResp.status})`);
  }
  return { key, url: `/manus-storage/${key}` };
}

// server/ml.ts
var embedModule = null;
async function getEmbedModule() {
  if (!embedModule) {
    const specifier = ["./embeddings"].join("");
    embedModule = await import(
      /* webpackIgnore: true */
      specifier
    );
  }
  return embedModule;
}
async function denseRank(query, passages) {
  const endpoint = process.env.DENSE_RETRIEVER_URL;
  if (endpoint) {
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, passages }), signal: AbortSignal.timeout(1e4) });
    if (!response.ok) throw new Error(`Dense retriever unavailable: HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.scores) || data.scores.length !== passages.length) throw new Error("Dense retriever returned an invalid score vector.");
    return data.scores;
  }
  if (!passages.length) return [];
  if (process.env.DISABLE_LOCAL_EMBEDDINGS === "true") return passages.map(() => 0);
  try {
    const { embedTexts, cosineSimilarity } = await getEmbedModule();
    const [queryEmbedding, ...passageEmbeddings] = await embedTexts([query, ...passages]);
    return passageEmbeddings.map((embedding) => cosineSimilarity(queryEmbedding, embedding));
  } catch {
    return passages.map(() => 0);
  }
}
async function crossEncoderRank(query, passages) {
  const endpoint = process.env.RERANKER_URL;
  if (!endpoint) return passages.map(() => 0);
  const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, passages }), signal: AbortSignal.timeout(1e4) });
  if (!response.ok) throw new Error(`Cross-encoder reranker unavailable: HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.scores) || data.scores.length !== passages.length) throw new Error("Cross-encoder returned an invalid score vector.");
  return data.scores;
}

// server/providers/registry.ts
var env = (key) => process.env[key]?.trim();
var timeoutMs = Math.min(Number(env("RESEARCH_TIMEOUT_MS") || 15e3), 3e4);
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function json2(url, init) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal, headers: { accept: "application/json", "user-agent": "TruthSearch/1.0 (public research adapter)", ...init?.headers || {} } });
      if (response.ok) return await response.json();
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get("retry-after") || "2");
        await sleep(Math.min(Math.max(retryAfter, 1), 8) * 1e3);
        continue;
      }
      throw new Error(`Provider returned HTTP ${response.status}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Provider request exhausted its bounded retry budget.");
}
async function ok(url) {
  try {
    await json2(url);
    return true;
  } catch {
    return false;
  }
}
function configuredStatus(name, category, requiresKey, configured, reason) {
  return { name, category, enabled: configured, status: configured ? "healthy" : "not_configured", requiresKey, ...reason ? { reason } : {} };
}
var GitHubProvider = class {
  name = "github";
  category = "programming";
  status() {
    const token = env("GITHUB_TOKEN");
    return configuredStatus(this.name, this.category, false, true, token ? "Authenticated optional; public API remains available" : "Public unauthenticated API; 60 requests/hour documented limit");
  }
  async healthCheck() {
    return ok("https://api.github.com/rate_limit");
  }
  async search(query, limit = 10) {
    const data = await json2(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${Math.min(limit, 10)}`, { headers: { "user-agent": "TruthSearch/1.0", ...env("GITHUB_TOKEN") ? { authorization: `Bearer ${env("GITHUB_TOKEN")}` } : {} } });
    return (data.items || []).map((x) => ({ id: x.id?.toString(), title: x.full_name, url: x.html_url, source: this.name, sourceType: this.category, snippet: x.description || "", published: x.updated_at, metadata: { stars: x.stargazers_count, language: x.language } }));
  }
};
var StackExchangeProvider = class {
  name = "stackExchange";
  category = "programming";
  status() {
    return configuredStatus(this.name, this.category, false, true, "Public Stack Exchange API; honors quota_max and quota_remaining");
  }
  async healthCheck() {
    return ok("https://api.stackexchange.com/2.3/info?site=stackoverflow");
  }
  async search(query, limit = 10) {
    const data = await json2(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=${Math.min(limit, 10)}`);
    return (data.items || []).map((x) => ({ id: x.question_id?.toString(), title: x.title, url: x.link, source: this.name, sourceType: this.category, snippet: `Score ${x.score}; answers ${x.answer_count}`, published: x.last_activity_date ? new Date(x.last_activity_date * 1e3).toISOString() : void 0, metadata: { isAnswered: x.is_answered } }));
  }
};
var OpenLibraryProvider = class {
  name = "openLibrary";
  category = "books";
  status() {
    return configuredStatus(this.name, this.category, false, true, "Public Open Library APIs for book discovery metadata");
  }
  async healthCheck() {
    return ok("https://openlibrary.org/search.json?q=computer+science&limit=1");
  }
  async search(query, limit = 10) {
    const data = await json2(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${Math.min(limit, 10)}`);
    return (data.docs || []).map((x) => ({ id: x.key, title: x.title || "Untitled book", url: x.key ? `https://openlibrary.org${x.key}` : "https://openlibrary.org", source: this.name, sourceType: this.category, snippet: [x.first_sentence?.[0], x.subject?.slice(0, 5)?.join(", ")].filter(Boolean).join(" \u2014 "), published: x.first_publish_year ? String(x.first_publish_year) : void 0, author: x.author_name?.slice(0, 5)?.join(", "), metadata: { isbn: x.isbn?.[0] } }));
  }
};
var WikidataProvider = class {
  name = "wikidata";
  category = "open_knowledge";
  status() {
    return configuredStatus(this.name, this.category, false, true, "Public Wikibase search API");
  }
  async healthCheck() {
    return ok("https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=computer&format=json&srlimit=1");
  }
  async search(query, limit = 10) {
    const data = await json2(`https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${Math.min(limit, 10)}`);
    return (data.query?.search || []).map((x) => ({ id: x.id, title: x.title, url: `https://www.wikidata.org/wiki/${x.title}`, source: this.name, sourceType: this.category, snippet: x.snippet?.replace(/<[^>]+>/g, "") || "" }));
  }
};
var WorldBankProvider = class {
  name = "worldBank";
  category = "government";
  status() {
    return configuredStatus(this.name, this.category, false, true, "Public World Bank Indicators API");
  }
  async healthCheck() {
    return ok("https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&per_page=1");
  }
  async search(query, limit = 10) {
    const data = await json2(`https://api.worldbank.org/v2/indicator?format=json&per_page=${Math.min(limit, 10)}&source=2`);
    const terms = query.toLowerCase().split(/\W+/).filter(Boolean);
    return (data[1] || []).filter((x) => terms.some((t2) => `${x.name} ${x.sourceNote || ""}`.toLowerCase().includes(t2))).slice(0, limit).map((x) => ({ id: x.id, title: x.name, url: `https://data.worldbank.org/indicator/${x.id}`, source: this.name, sourceType: this.category, snippet: x.sourceNote || "", metadata: { unit: x.unit, sourceOrganization: x.sourceOrganization } }));
  }
};
var DataGovProvider = class {
  name = "dataGov";
  category = "datasets";
  status() {
    const configured = Boolean(env("DATA_GOV_API_KEY"));
    return configuredStatus(this.name, this.category, true, configured, configured ? "Data.gov catalog metadata API configured" : "Data.gov API key not configured; no placeholder key is used");
  }
  async healthCheck() {
    const key = env("DATA_GOV_API_KEY");
    if (!key) return false;
    return ok(`https://api.gsa.gov/technology/datagov/v3/search?api_key=${encodeURIComponent(key)}&q=education&rows=1`);
  }
  async search(query, limit = 10) {
    const key = env("DATA_GOV_API_KEY");
    if (!key) throw new Error("Data.gov is unavailable: DATA_GOV_API_KEY is not configured.");
    const data = await json2(`https://api.gsa.gov/technology/datagov/v3/search?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&rows=${Math.min(limit, 10)}`);
    return (data.results || []).map((x) => ({ id: x.id, title: x.title, url: x.distribution?.[0]?.accessURL || x.landingPage || `https://catalog.data.gov/dataset/${x.id}`, source: this.name, sourceType: this.category, snippet: x.notes || "", metadata: { organization: x.organization?.title } }));
  }
};
var knowledgeProviders = [new GitHubProvider(), new StackExchangeProvider(), new OpenLibraryProvider(), new WikidataProvider(), new WorldBankProvider(), new DataGovProvider()];
var providerRegistry = new Map(knowledgeProviders.map((provider) => [provider.name, provider]));
var unavailableProviders = [
  { name: "coursera", category: "education", enabled: false, status: "not_configured", requiresKey: true, reason: "No verified public adapter configured; do not scrape course pages." },
  { name: "udemy", category: "education", enabled: false, status: "not_configured", requiresKey: true, reason: "No verified public adapter configured; do not scrape course pages." },
  { name: "edX", category: "education", enabled: false, status: "not_configured", requiresKey: false, reason: "No verified public adapter configured; use permitted public feeds only." },
  { name: "classCentral", category: "education", enabled: false, status: "not_configured", requiresKey: false, reason: "No verified public adapter configured; do not scrape search pages." },
  { name: "geeksforGeeks", category: "education", enabled: false, status: "not_configured", requiresKey: false, reason: "No verified public API configured; no unofficial scraping." },
  { name: "youtube", category: "video", enabled: false, status: "not_configured", requiresKey: true, reason: "YouTube Data API key not configured; transcript access is not assumed." },
  { name: "googleBooks", category: "books", enabled: false, status: "not_configured", requiresKey: true, reason: "Google Books API key not configured; Open Library is the free default." },
  { name: "mitOpenCourseWare", category: "education", enabled: false, status: "not_configured", requiresKey: false, reason: "No official adapter configured; no course-page scraping." },
  { name: "freeCodeCamp", category: "education", enabled: false, status: "not_configured", requiresKey: false, reason: "No official search API configured; use permitted source discovery only." }
];
function providerStatuses() {
  return [...knowledgeProviders.map((provider) => provider.status()), ...unavailableProviders];
}
function providersForIntent(intent) {
  const routes = {
    programming: ["github", "stackExchange"],
    documentation: ["github", "stackExchange"],
    books: ["openLibrary"],
    dataset: ["dataGov", "worldBank"],
    government: ["worldBank", "dataGov"],
    education: ["openLibrary", "wikidata", "github"],
    academic_research: ["wikidata", "worldBank"],
    general_research: ["wikidata", "worldBank"]
  };
  return routes[intent] || ["wikidata"];
}

// server/research.ts
var env2 = (key) => process.env[key]?.trim();
var maxQueries = Math.min(Number(env2("MAX_SEARCH_QUERIES") || 8), 20);
var maxSources = Math.min(Number(env2("MAX_SOURCES") || 24), 50);
var timeoutMs2 = Math.min(Number(env2("RESEARCH_TIMEOUT_MS") || 15e3), 3e4);
function canonicalizeUrl(raw) {
  const u = new URL(raw);
  u.hash = "";
  ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid"].forEach((p) => u.searchParams.delete(p));
  return u.toString().replace(/\/$/, "");
}
function assertSafeUrl(raw) {
  const u = new URL(raw);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only HTTP(S) sources are permitted.");
  if (u.username || u.password) throw new Error("Credential-bearing URLs are not permitted.");
  const host = u.hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host) || host.endsWith(".local")) throw new Error("Private network URLs are not permitted.");
  if (/^(10|127)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error("Private network URLs are not permitted.");
}
async function requestText(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs2);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, headers: { accept: "application/atom+xml,text/plain", ...init?.headers || {} } });
    if (!res.ok) throw new Error(`Provider returned HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}
async function requestJson(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs2);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, headers: { accept: "application/json", ...init?.headers || {} } });
    if (!res.ok) throw new Error(`Provider returned HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
async function searchProvider(provider, query) {
  const knowledgeProvider = providerRegistry.get(provider);
  if (knowledgeProvider) {
    const results = await knowledgeProvider.search(query, 10);
    return results.map((result) => ({ title: result.title, url: result.url, snippet: result.snippet, published: result.published, author: result.author, provider }));
  }
  if (provider === "wikipedia") {
    const data2 = await requestJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`);
    return (data2.query?.search || []).slice(0, 10).map((x) => ({ title: x.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/ /g, "_"))}`, snippet: (x.snippet || "").replace(/<[^>]+>/g, ""), provider }));
  }
  if (provider === "openalex") {
    const data2 = await requestJson(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=10&select=title,doi,publication_year,authorships,abstract_inverted_index`);
    return (data2.results || []).map((x) => ({ title: x.title || "OpenAlex work", url: x.doi || x.id, snippet: x.abstract_inverted_index ? Object.keys(x.abstract_inverted_index).slice(0, 80).join(" ") : "", published: x.publication_year ? String(x.publication_year) : void 0, author: x.authorships?.map((a) => a.author?.display_name).filter(Boolean).join(", "), provider }));
  }
  if (provider === "europePmc") {
    const data2 = await requestJson(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&pageSize=10&resultType=core`);
    return (data2.resultList?.result || []).map((x) => ({ title: x.title || "Europe PMC article", url: x.fullTextUrlList?.fullTextUrl?.[0]?.url || `https://europepmc.org/article/${x.source}/${x.id}`, snippet: x.abstractText || "", published: x.firstPublicationDate, author: x.authorString, provider }));
  }
  if (provider === "arxiv") {
    const xml = await requestText(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=10`);
    const entries = xml.split("<entry>").slice(1, 11);
    const between = (input, start, end) => {
      const a = input.indexOf(start);
      if (a < 0) return "";
      const b = input.indexOf(end, a + start.length);
      return b < 0 ? "" : input.slice(a + start.length, b).replace(/[[:space:]]+/g, " ").trim();
    };
    return entries.map((entry) => ({ title: between(entry, "<title>", "</title>") || `arXiv result for ${query}`, url: between(entry, "<id>", "</id>") || `https://arxiv.org/search/?query=${encodeURIComponent(query)}&searchtype=all`, snippet: between(entry, "<summary>", "</summary>"), published: between(entry, "<published>", "</published>"), provider }));
  }
  if (provider === "brave") {
    const key = env2("BRAVE_SEARCH_API_KEY");
    if (!key) throw new Error("Brave Search is unavailable: BRAVE_SEARCH_API_KEY is not configured.");
    const data2 = await requestJson(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`, { headers: { "X-Subscription-Token": key } });
    return (data2.web?.results || []).map((x) => ({ title: x.title, url: x.url, snippet: x.description || "", published: x.age, provider }));
  }
  if (provider === "tavily") {
    const key = env2("TAVILY_API_KEY");
    if (!key) throw new Error("Tavily is unavailable: TAVILY_API_KEY is not configured.");
    const data2 = await requestJson("https://api.tavily.com/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: key, query, search_depth: "advanced", max_results: 10, include_answer: false }) });
    return (data2.results || []).map((x) => ({ title: x.title, url: x.url, snippet: x.content || "", published: x.published_date, provider }));
  }
  if (provider === "semanticScholar") {
    const data2 = await requestJson(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=10&fields=title,url,abstract,year,authors,venue`);
    return (data2.data || []).map((x) => ({ title: x.title, url: x.url || `https://www.semanticscholar.org/paper/${x.paperId}`, snippet: x.abstract || "", published: x.year ? String(x.year) : void 0, author: x.authors?.map((a) => a.name).join(", "), provider }));
  }
  const data = await requestJson(`https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=10&select=title,URL,abstract,published,author`);
  return (data.message?.items || []).map((x) => ({ title: x.title?.[0] || "Untitled work", url: x.URL, snippet: (x.abstract || "").replace(/<[^>]+>/g, ""), published: x.published?.["date-parts"]?.[0]?.join("-"), author: x.author?.map((a) => `${a.given || ""} ${a.family || ""}`).join(", "), provider }));
}
function classifySource(domain, provider) {
  if (["semanticScholar", "crossref", "openalex", "europePmc", "arxiv"].includes(provider)) return "Academic Paper";
  if (/\.gov$|\.gov\./.test(domain)) return "Government";
  if (/docs\.|developer\./.test(domain)) return "Official Documentation";
  if (/arxiv\.org|deepmind|openai|anthropic|microsoft\.com/.test(domain)) return "Research Organization";
  if (/nytimes|reuters|bbc|apnews|theguardian/.test(domain)) return "Reputable News";
  if (/medium|substack|blog/.test(domain)) return "Personal or Company Blog";
  return "Web Source";
}
var STOPWORDS = /* @__PURE__ */ new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "do",
  "does",
  "did",
  "in",
  "on",
  "at",
  "of",
  "to",
  "for",
  "and",
  "or",
  "but",
  "how",
  "why",
  "what",
  "when",
  "where",
  "who",
  "which",
  "this",
  "that",
  "these",
  "those",
  "with",
  "from",
  "by",
  "as",
  "be",
  "it",
  "its",
  "can",
  "could",
  "should",
  "would",
  "will",
  "shall",
  "not",
  "no",
  "there",
  "their",
  "than"
]);
function stem(term) {
  if (term.length < 6) return term;
  return term.slice(0, Math.max(4, Math.round(term.length * 0.75)));
}
var BOILERPLATE_PATTERNS = [
  /this article may (?:have been generated|include text generated)[^.]*\./gi,
  /vocab distribution typical of [^)]*\)/gi,
  /learn how and when to remove this message\)?/gi,
  /may include hallucinated information[^.]*\./gi,
  /WP:AISIGNS/gi
];
function stripBoilerplate(content) {
  return BOILERPLATE_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, " "), content);
}
function queryContentRelevance(query, content) {
  const terms = Array.from(new Set(query.toLowerCase().split(/\W+/).filter((t2) => t2.length > 2 && !STOPWORDS.has(t2))));
  if (!terms.length) return 2.5;
  const lower = stripBoilerplate(content).toLowerCase();
  const matched = terms.filter((term) => lower.includes(stem(term))).length;
  return matched / terms.length * 5;
}
function scoreSource(hit, domain, relevance = 0) {
  let score = 30 + Math.round(Math.min(relevance, 5) * 6);
  if (hit.provider === "semanticScholar" || hit.provider === "crossref" || hit.provider === "arxiv" || hit.provider === "openalex" || hit.provider === "europePmc") score += 20;
  if (/\.gov$|\.edu$|docs\.|developer\./.test(domain)) score += 14;
  if (hit.author) score += 3;
  if (hit.published) score += 2;
  return Math.max(5, Math.min(score, 98));
}
function synthesisProviders() {
  const providers = [];
  const hfKey = env2("HF_API_KEY");
  if (hfKey) {
    providers.push({
      name: "huggingface",
      endpoint: "https://router.huggingface.co/v1/chat/completions",
      apiKey: hfKey,
      models: {
        vision: ["Qwen/Qwen3.8-27B", "zai-org/GLM-5.3-Flash"],
        code: ["Qwen/Qwen3.8-27B", "deepseek-ai/DeepSeek-V4-Flash-0731"],
        general: ["Qwen/Qwen3.8-27B", "zai-org/GLM-5.3"]
      }
    });
  }
  const geminiKey = env2("GEMINI_API_KEY");
  if (geminiKey) {
    providers.push({
      name: "gemini",
      endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      apiKey: geminiKey,
      models: {
        vision: ["gemini-2.0-flash"],
        code: ["gemini-2.0-flash"],
        general: ["gemini-2.0-flash"]
      }
    });
  }
  const groqKey = env2("XAI_API_KEY") || env2("GROQ_API_KEY");
  if (groqKey) {
    providers.push({
      name: "groq",
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      apiKey: groqKey,
      models: {
        vision: ["openai/gpt-oss-120b"],
        code: ["openai/gpt-oss-120b"],
        general: ["openai/gpt-oss-120b"]
      }
    });
  }
  return providers;
}
async function callSynthesisLLM(params, kind = "general") {
  const providers = synthesisProviders();
  if (!providers.length) {
    throw new Error("Synthesis model is not configured: set HF_API_KEY, GEMINI_API_KEY, or XAI_API_KEY (Groq). No answer was generated.");
  }
  const failures = [];
  for (const provider of providers) {
    const candidates = provider.models[kind];
    for (const model of candidates) {
      try {
        const res = await fetch(provider.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${provider.apiKey}` },
          body: JSON.stringify({
            model,
            messages: params.messages,
            temperature: 0.3,
            max_tokens: 4096
          }),
          signal: AbortSignal.timeout(Math.max(timeoutMs2, 12e4))
        });
        if (!res.ok) {
          const detail = (await res.text().catch(() => "")).slice(0, 200);
          failures.push(`${provider.name}/${model} returned HTTP ${res.status}: ${detail}`);
          continue;
        }
        const data = await res.json();
        const rawContent = data.choices?.[0]?.message?.content;
        const content = typeof rawContent === "string" ? rawContent : Array.isArray(rawContent) ? rawContent.map((part) => typeof part === "string" ? part : "text" in part ? part.text : "").join("") : "";
        if (!content.trim()) {
          failures.push(`${provider.name}/${model} returned an empty answer (reasoning did not complete)`);
          continue;
        }
        return data;
      } catch (error) {
        failures.push(`${provider.name}/${model}: ${error instanceof Error ? error.message : "request failed"}`);
      }
    }
  }
  throw new Error(`All synthesis providers failed for this ${kind} question: ${failures.join("; ")}`);
}
function summarizeFetchFailures(failures) {
  const counts = /* @__PURE__ */ new Map();
  for (const failure of failures) {
    const reason = failure.replace(/^[^:]+: /, "");
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([reason, count]) => `${count} ${reason}`).join(", ");
}
async function fetchReadable(hit, question, failures) {
  try {
    assertSafeUrl(hit.url);
    const canonicalUrl = canonicalizeUrl(hit.url);
    const domain = new URL(canonicalUrl).hostname;
    const res = await fetch(canonicalUrl, { signal: AbortSignal.timeout(timeoutMs2), headers: { "user-agent": "TruthSearch/1.0 (research; contact project owner)" } });
    if (!res.ok) {
      failures?.push(`${domain}: blocked or error (HTTP ${res.status})`);
      return null;
    }
    const type = res.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("text/plain") && !type.includes("application/json")) {
      failures?.push(`${domain}: unsupported content-type`);
      return null;
    }
    const raw = (await res.text()).slice(0, 12e4);
    const content = raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, " ").replace(/\s+/g, " ").trim();
    if (content.length < 80) {
      failures?.push(`${domain}: no readable text`);
      return null;
    }
    const u = new URL(canonicalUrl);
    const passages = content.match(/.{1,900}(?:[.!?]|$)/g)?.map((x) => x.trim()).filter((x) => x.length > 100).slice(0, 30) || [content.slice(0, 900)];
    const relevance = queryContentRelevance(question, `${hit.title} ${hit.snippet} ${content}`);
    return { ...hit, canonicalUrl, domain: u.hostname, sourceType: classifySource(u.hostname, hit.provider), qualityScore: scoreSource(hit, u.hostname, relevance), content, passages, relevance };
  } catch (error) {
    failures?.push(`${new URL(hit.url).hostname}: ${error instanceof Error ? error.name === "TimeoutError" ? "timed out" : error.message.slice(0, 60) : "fetch failed"}`);
    return null;
  }
}
function classifyIntent(question) {
  const q = question.toLowerCase();
  if (/\b(dataset|data source|open data|indicator|statistics)\b/.test(q)) return "dataset";
  if (/\b(book|textbook|reading list|isbn)\b/.test(q)) return "books";
  if (/\b(course|tutorial|learn|beginner|lesson|education)\b/.test(q)) return "education";
  if (/\bpython|javascript|typescript|rust|java|postgres|docker|kubernetes|programming|code|api\b/.test(q)) return "programming";
  if (/\bdocs?|documentation|reference|how does .* work\b/.test(q)) return "documentation";
  if (/\bgovernment|gdp|population|health|economy|country\b/.test(q)) return "government";
  if (/\bpaper|study|research|systematic review|academic\b/.test(q)) return "academic_research";
  return "general_research";
}
function makeQueries(question, academic = false) {
  const clean = question.replace(/[^a-zA-Z0-9\s?.,'\-]/g, " ").trim().slice(0, 500);
  const queries = [clean, `${clean} latest evidence`, `${clean} limitations and disagreement`];
  if (academic) queries.push(`${clean} systematic review`, `${clean} empirical study`);
  return Array.from(new Set(queries)).slice(0, maxQueries);
}
function bm25Like(query, passages) {
  const k1 = 1.5;
  const b = 0.75;
  const tokenize = (s) => s.toLowerCase().split(/\W+/).filter(Boolean);
  const queryTerms = Array.from(new Set(tokenize(query)));
  const docs = passages.map(tokenize);
  const docLens = docs.map((d) => d.length || 1);
  const avgLen = docLens.reduce((sum, len) => sum + len, 0) / (docLens.length || 1);
  const docCount = docs.length || 1;
  const idf = /* @__PURE__ */ new Map();
  queryTerms.forEach((term) => {
    const docsWithTerm = docs.filter((d) => d.includes(term)).length;
    idf.set(term, Math.log(1 + (docCount - docsWithTerm + 0.5) / (docsWithTerm + 0.5)));
  });
  return docs.map(
    (doc, i) => queryTerms.reduce((score, term) => {
      const termFreq = doc.filter((word) => word === term).length;
      if (!termFreq) return score;
      const numerator = termFreq * (k1 + 1);
      const denominator = termFreq + k1 * (1 - b + b * docLens[i] / (avgLen || 1));
      return score + (idf.get(term) || 0) * (numerator / denominator);
    }, 0)
  );
}
function reciprocalRankFusion(rankings) {
  const size = Math.max(...rankings.flat(), -1) + 1;
  const scores = Array.from({ length: size }, () => 0);
  rankings.forEach((ranking) => ranking.forEach((item, rank) => {
    scores[item] = (scores[item] || 0) + 1 / (60 + rank + 1);
  }));
  return scores;
}
function rankEvidence(evidence, denseScores, rerankScores) {
  const lexicalOrder = evidence.map((_, i) => i).sort((a, b) => evidence[b].supportScore - evidence[a].supportScore);
  const denseOrder = evidence.map((_, i) => i).sort((a, b) => (denseScores[b] || 0) - (denseScores[a] || 0));
  const rerankOrder = evidence.map((_, i) => i).sort((a, b) => (rerankScores[b] || 0) - (rerankScores[a] || 0));
  const fusedScores = reciprocalRankFusion([lexicalOrder, denseOrder, rerankOrder]);
  return evidence.map((e, i) => ({ ...e, supportScore: e.supportScore + fusedScores[i] * 100 })).sort((a, b) => b.supportScore - a.supportScore);
}
function verifyEvidence(evidence, sources) {
  return evidence.filter((item) => {
    const source = sources[item.sourceId];
    if (!source) return false;
    try {
      assertSafeUrl(item.url);
    } catch {
      return false;
    }
    return item.quote.length >= 40 && source.content.includes(item.quote) && item.supportScore >= 56;
  });
}
function detectContradictions(evidence) {
  const positive = evidence.filter((e) => /\b(improv|reduc|increase|effective|benefit|better|significant positive)\w*/i.test(e.quote) && !/\b(no|not|never|without)\s+(?:significant\s+)?(?:improv|benefit|effect)/i.test(e.quote));
  const negative = evidence.filter((e) => /\b(no significant|not improve|ineffective|limitation|failure|worse|insufficient|uncertain|mixed evidence)\b/i.test(e.quote));
  if (!positive.length || !negative.length) return [];
  return [{ description: "Retrieved sources contain both supportive and limiting language. Evidence is mixed and should be interpreted in context.", supporting: positive.slice(0, 2), contradicting: negative.slice(0, 2) }];
}
function auditCitationReferences(answer, evidenceCount) {
  const references = Array.from(answer.matchAll(/\[(\d+)\]/g)).map((match) => Number(match[1]));
  const invalid = references.filter((reference) => reference < 1 || reference > evidenceCount);
  const factualLines = answer.split(/\n+/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && !/^[-*]\s*$/.test(line));
  const citedLines = factualLines.filter((line) => /\[\d+\]/.test(line));
  return {
    references: Array.from(new Set(references)),
    invalidReferences: Array.from(new Set(invalid)),
    citationCoverage: factualLines.length ? citedLines.length / factualLines.length : 0
  };
}
function extractEvidence(question, sources) {
  const all = sources.flatMap((s, sourceId) => s.passages.slice(0, 8).map((quote) => ({ quote, source: s, sourceId })));
  const scores = bm25Like(question, all.map((x) => x.quote));
  return all.map((x, i) => ({ claim: x.quote.split(/[.!?]/)[0].trim(), quote: x.quote, url: x.source.canonicalUrl, title: x.source.title, supportScore: Math.min(96, 48 + scores[i] * 8), qualityScore: x.source.qualityScore, sourceId: x.sourceId })).filter((x) => x.supportScore >= 56).sort((a, b) => b.supportScore + b.qualityScore - (a.supportScore + a.qualityScore)).slice(0, 12);
}
async function conductResearch(question, onProgress, userAttachments) {
  if (question.trim().length < 8 || question.length > 1200) throw new Error("Question must be between 8 and 1,200 characters.");
  const requested = env2("SEARCH_PROVIDER");
  const paidEnabled = env2("ENABLE_PAID_SEARCH") === "true";
  const primary = paidEnabled && (requested === "brave" || requested === "tavily") ? requested : "wikipedia";
  const academic = env2("ACADEMIC_SEARCH_PROVIDER") || "arxiv";
  const intent = classifyIntent(question);
  const extraProviders = providersForIntent(intent);
  onProgress({ stage: "planning", detail: `Bounded research plan created for ${intent.replace("_", " ")} intent`, at: Date.now() });
  const queries = makeQueries(question, true);
  onProgress({ stage: "searching", detail: `Running ${queries.length} live searches across ${primary}, ${academic}, and ${extraProviders.join(", ")}`, at: Date.now() });
  const freeAcademic = [academic, "openalex", "europePmc", "crossref"];
  const planned = queries.map((q, i) => ({ q, provider: i === 0 ? primary : i < 6 ? freeAcademic[(i - 1) % freeAcademic.length] : extraProviders[(i - 6) % Math.max(extraProviders.length, 1)] || "wikidata" }));
  const settled = await Promise.allSettled(planned.map(({ q, provider }) => searchProvider(provider, q)));
  const failures = settled.filter((x) => x.status === "rejected").map((x) => x.reason instanceof Error ? x.reason.message : "Provider failed");
  if (failures.length) onProgress({ stage: "provider-warning", detail: `${failures.length} provider request(s) unavailable; continuing only with completed live results`, at: Date.now() });
  const hits = settled.filter((x) => x.status === "fulfilled").flatMap((x) => x.value);
  if (!hits.length) onProgress({ stage: "provider-warning", detail: `All live providers were unavailable (${failures.join("; ") || "no results"}). The model will answer from its own knowledge, clearly labeled.`, at: Date.now() });
  const unique = Array.from(new Map(hits.filter((x) => x.url).map((x) => {
    try {
      return [canonicalizeUrl(x.url), x];
    } catch {
      return [x.url, x];
    }
  })).values()).slice(0, maxSources);
  onProgress({ stage: "fetching", detail: `Fetched ${unique.length} unique live search results; normalizing permitted public pages`, at: Date.now() });
  const fetchFailures = [];
  const sources = (await Promise.all(unique.map((hit) => fetchReadable(hit, question, fetchFailures)))).filter(Boolean);
  if (fetchFailures.length) onProgress({ stage: "fetch-warning", detail: `${fetchFailures.length}/${unique.length} pages were not readable (${summarizeFetchFailures(fetchFailures)})`, at: Date.now() });
  if (!sources.length) onProgress({ stage: "fetch-warning", detail: `No readable public sources were retrieved (${summarizeFetchFailures(fetchFailures) || "no failures recorded"}). The model will answer from its own knowledge, clearly labeled.`, at: Date.now() });
  onProgress({ stage: "ranking", detail: "Ranking passages with real BM25 lexical retrieval, free local semantic embeddings, and reciprocal-rank fusion", at: Date.now() });
  let evidence = extractEvidence(question, sources);
  const denseScores = await denseRank(question, evidence.map((e) => e.quote));
  const rerankScores = await crossEncoderRank(question, evidence.map((e) => e.quote));
  evidence = rankEvidence(evidence, denseScores, rerankScores);
  evidence = verifyEvidence(evidence, sources);
  const conflicts = detectContradictions(evidence);
  if (!evidence.length) onProgress({ stage: "fetch-warning", detail: "Citation verification found no usable passages. The model will answer from its own knowledge, clearly labeled.", at: Date.now() });
  onProgress({ stage: "verifying", detail: `Verified ${evidence.length} exact passage citations${conflicts.length ? "; detected mixed evidence" : ""}`, at: Date.now() });
  const context = evidence.length ? evidence.map((e, i) => `[${i + 1}] ${e.quote} (Source: ${e.title} \u2014 ${e.url})`).join("\n") : "(No usable web evidence was retrieved.)";
  const technicalQuestion = intent === "programming" || intent === "documentation";
  const fromKnowledgeOnly = !evidence.length && !userAttachments?.contextText;
  const attachmentBlock = userAttachments?.contextText ? `

USER-PROVIDED DOCUMENT (context the question is about; NOT web evidence \u2014 never cite it with [n]):
${userAttachments.contextText.slice(0, 6e4)}` : "";
  const imageParts = (userAttachments?.imageUrls || []).map((url) => ({ type: "image_url", image_url: { url } }));
  const instruction = `Question: ${question}${attachmentBlock}

Verified evidence:
${context}

${technicalQuestion ? "This is a technical question. Answer it directly, completely, and practically from your own expertise: explain the concept, give concrete examples, and where useful include correct, runnable code. Use the retrieved evidence only where it genuinely helps, citing it with [n]; otherwise answer without citations.\n\n" : ""}${fromKnowledgeOnly ? "The retrieved web evidence is empty, so answer entirely from your own knowledge. Do NOT use [n] citations at all \u2014 there are no sources to cite.\n\n" : ""}Write a research answer with exactly these sections, in this order:

## Direct answer
2-4 sentences that directly answer the question${evidence.length ? ", with inline [n] citations" : ""}.

## Why it happens \u2014 analysis
Explain the underlying causes, mechanisms, and context behind the answer, the way a knowledgeable person would explain it to a curious reader: what drives the phenomenon, how the pieces connect, and what it means in practice. Reason across the evidence instead of only restating quotes. Every factual statement from web research must cite [n].

## Evidence and sources
The strongest retrieved evidence that supports the analysis, cited inline.

## Conflicting evidence
Only if the retrieved sources disagree or the evidence is mixed; otherwise state that retrieved sources are consistent.

## Limitations
What the retrieved evidence cannot answer, and how current or complete it is.

## Conclusion
2-3 closing sentences with citations.

## Suggested follow-up questions
Exactly three questions a reader would naturally ask next, one per line, each on its own as a list item.${imageParts.length ? " The user attached image(s) as visual context; describe what is relevant to the question and clearly separate what comes from the images versus the cited web evidence." : ""}`;
  const userMessageContent = imageParts.length ? [{ type: "text", text: instruction }, ...imageParts] : instruction;
  const response = await callSynthesisLLM({ messages: [{ role: "system", content: "You are a research analyst. You write answers that research like a search engine and explain like a teacher: direct, then causal \u2014 what happens, why it happens, and what it means. Every factual sentence that comes from the retrieved evidence must cite [n]. If the retrieved evidence does not answer part of the question, fill the gap from your own knowledge and mark those sentences inline with 'model knowledge' so the reader can tell what is sourced and what is not. If evidence conflicts, explicitly say evidence is mixed. Never invent URLs, sources, citations, or fake [n] references, and never present model-knowledge claims as cited facts. Do not reveal private reasoning." }, { role: "user", content: userMessageContent }] }, imageParts.length ? "vision" : technicalQuestion ? "code" : "general");
  const answer = typeof response.choices?.[0]?.message?.content === "string" ? response.choices[0].message.content : "The answer generator did not return usable content.";
  const citationAudit = auditCitationReferences(answer, evidence.length);
  if (citationAudit.invalidReferences.length) throw new Error(`Answer contained invalid citation reference(s): ${citationAudit.invalidReferences.join(", ")}`);
  const answerProvenance = fromKnowledgeOnly ? "model_knowledge" : technicalQuestion ? "technical_direct" : "cited_sources";
  const finalAnswer = fromKnowledgeOnly ? `> **Answered from the model\u2019s knowledge** \u2014 web research found no usable sources for this question, so nothing here is web-cited. Verify important facts independently.

${answer}` : answer;
  onProgress({ stage: "completed", detail: evidence.length ? `Citations verified against retrieved URLs (${answerProvenance === "technical_direct" ? "technical question \u2014 answered with model expertise plus evidence" : "evidence-backed"})` : "Answered from model knowledge (labeled)", at: Date.now() });
  const citedSourceIds = new Set(evidence.map((e) => e.sourceId));
  const citedSources = sources.filter((_, sourceId) => citedSourceIds.has(sourceId));
  return { answer: finalAnswer, plan: { question, queries, providers: Array.from(new Set(planned.map((x) => x.provider))), bounded: true, evidence, conflicts, citationAudit, answerProvenance }, sources: citedSources, evidence, conflicts, citationAudit, progress: [] };
}

// server/routers.ts
var questionInput = import_zod2.z.object({ question: import_zod2.z.string().trim().min(8).max(1200) });
var SYNC_RESEARCH = process.env.SYNC_RESEARCH ? process.env.SYNC_RESEARCH === "true" : process.env.VERCEL === "1";
async function runResearch(id, question, userAttachments) {
  try {
    await updateSession(id, { status: "researching" });
    await addMessage(id, "system", "Research started. Progress reflects completed backend actions only.");
    const result = await conductResearch(question, (progress) => {
      void addMessage(id, "system", `${progress.stage}: ${progress.detail}`);
    }, userAttachments);
    for (const q of result.plan.queries) await addQuery(id, q, result.plan.providers.join(" + "), "searched", result.sources.length);
    const sourceIds = [];
    const passageIds = [];
    for (const source of result.sources) {
      const sourceId = await addSource(id, source);
      sourceIds.push(sourceId);
      const ids = [];
      for (let i = 0; i < source.passages.length; i++) ids.push(await addPassage(sourceId, i, source.passages[i]));
      passageIds.push(ids);
    }
    for (const evidence of result.evidence) {
      const claimId = await addClaim(id, evidence.claim, evidence.supportScore, "verified");
      const source = result.sources[evidence.sourceId];
      const passageId = source ? matchPassageId(source.passages, evidence.quote, passageIds[evidence.sourceId] || []) : 0;
      const sourceId = sourceIds[evidence.sourceId] || 0;
      if (passageId && sourceId) {
        await addEvidence(claimId, passageId, evidence.quote, evidence.supportScore);
        await addCitation(claimId, sourceId, true);
      }
    }
    await addMessage(id, "assistant", result.answer);
    await updateSession(id, { status: "completed", answer: result.answer, plan: result.plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research failed for an unknown reason.";
    await addMessage(id, "system", `failed: ${message}`);
    await updateSession(id, { status: "failed", error: message });
  }
}
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    })
  }),
  research: router({
    providers: publicProcedure.query(() => ({ web: process.env.ENABLE_PAID_SEARCH === "true" && (process.env.SEARCH_PROVIDER === "brave" || process.env.SEARCH_PROVIDER === "tavily") ? process.env.SEARCH_PROVIDER : "wikipedia", academic: process.env.ACADEMIC_SEARCH_PROVIDER || "arxiv", paidSearchEnabled: process.env.ENABLE_PAID_SEARCH === "true", configured: true, knowledge: providerStatuses() })),
    health: publicProcedure.query(async () => {
      const statuses = providerStatuses();
      const checks = await Promise.all(statuses.map(async (status) => {
        const provider = providerRegistry.get(status.name);
        if (!provider) return status;
        if (!status.enabled) return status;
        const healthy = await provider.healthCheck();
        return { ...status, status: healthy ? "healthy" : "unavailable", ...healthy ? {} : { reason: "Health check failed or provider is rate limited." } };
      }));
      return checks;
    }),
    plan: publicProcedure.input(questionInput).query(({ input }) => {
      const intent = classifyIntent(input.question);
      return { queries: makeQueries(input.question, true), intent, providers: providersForIntent(intent), bounded: true, maxRounds: Number(process.env.MAX_RESEARCH_ROUNDS || 3) };
    }),
    start: publicProcedure.input(import_zod2.z.object({ question: import_zod2.z.string().trim().min(8).max(1200), contextText: import_zod2.z.string().max(6e4).optional(), imageUrls: import_zod2.z.array(import_zod2.z.string().url().max(600)).max(4).optional() })).mutation(async ({ input, ctx }) => {
      const id = await createSession(input.question, ctx.user?.id);
      const research = runResearch(id, input.question, { contextText: input.contextText, imageUrls: input.imageUrls });
      if (SYNC_RESEARCH) await research;
      else void research;
      return { id };
    }),
    list: publicProcedure.input(import_zod2.z.object({ limit: import_zod2.z.number().int().min(1).max(100).optional() }).optional()).query(({ input, ctx }) => listSessions(ctx.user?.id, input?.limit || 30)),
    get: publicProcedure.input(import_zod2.z.object({ id: import_zod2.z.number().int().positive() })).query(({ input, ctx }) => getSession(input.id, ctx.user?.id)),
    attachImage: publicProcedure.input(import_zod2.z.object({ filename: import_zod2.z.string().trim().min(1).max(200), dataUrl: import_zod2.z.string().regex(/^data:image\/(jpeg|png|webp);base64,/).max(75e5) })).mutation(async ({ input }) => {
      try {
        const meta = input.dataUrl.slice(0, input.dataUrl.indexOf(","));
        const mime = meta.slice(5, meta.indexOf(";"));
        const buffer = Buffer.from(input.dataUrl.slice(input.dataUrl.indexOf(",") + 1), "base64");
        if (buffer.byteLength > 5 * 1024 * 1024) throw new Error("Image is larger than the 5 MB upload limit.");
        const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
        const { url } = await storagePut(`attachments/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`, new Uint8Array(buffer), mime);
        return { url };
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : "Image upload failed. Try another image.");
      }
    }),
    extractDocument: publicProcedure.input(import_zod2.z.object({ filename: import_zod2.z.string().trim().min(1).max(200), dataUrl: import_zod2.z.string().min(10).max(11e6) })).mutation(async ({ input }) => {
      try {
        const base64 = input.dataUrl.includes(",") ? input.dataUrl.slice(input.dataUrl.indexOf(",") + 1) : input.dataUrl;
        const buffer = Buffer.from(base64, "base64");
        const name = input.filename.toLowerCase();
        let text2 = "";
        if (name.endsWith(".pdf")) {
          const { extractText, getDocumentProxy } = await import("unpdf");
          const pdf = await getDocumentProxy(new Uint8Array(buffer));
          const extracted = await extractText(pdf, { mergePages: true });
          text2 = extracted.text || "";
        } else if (name.endsWith(".docx")) {
          const mammoth = await import("mammoth");
          const extracted = await mammoth.extractRawText({ buffer });
          text2 = extracted.value || "";
        } else if (name.endsWith(".xlsx")) {
          const xlsx = await import("xlsx");
          const workbook = xlsx.read(buffer, { type: "buffer" });
          text2 = workbook.SheetNames.map((sheetName) => `--- Sheet: ${sheetName} ---
${xlsx.utils.sheet_to_csv(workbook.Sheets[sheetName])}`).join("\n\n");
        } else if (name.endsWith(".txt") || name.endsWith(".csv") || name.endsWith(".md")) {
          text2 = buffer.toString("utf-8");
        } else if (name.endsWith(".doc")) {
          throw new Error("Legacy .doc files are not supported \u2014 please upload the .docx version.");
        } else {
          throw new Error("That document type is not supported. Use PDF, DOCX, XLSX, TXT, CSV, or MD.");
        }
        const clean = text2.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
        if (clean.length < 60) throw new Error("No readable text could be extracted from this document.");
        return { text: clean.slice(0, 6e4), characters: clean.length };
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : "Document processing failed. Try another file.");
      }
    }),
    followUp: publicProcedure.input(import_zod2.z.object({ id: import_zod2.z.number().int().positive(), question: import_zod2.z.string().trim().min(8).max(1200) })).mutation(async ({ input, ctx }) => {
      const existing = await getSession(input.id, ctx.user?.id);
      if (!existing) throw new Error("Research session not found.");
      await addMessage(input.id, "user", input.question);
      const context = existing.session.answer ? `
Previous verified answer:
${existing.session.answer.slice(0, 3e4)}` : "";
      const followUpQuestion = `${existing.session.question}
Follow-up question: ${input.question}${context}`;
      const newId = await createSession(`${existing.session.question}
Follow-up: ${input.question}`, ctx.user?.id);
      const research = runResearch(newId, followUpQuestion);
      if (SYNC_RESEARCH) await research;
      else void research;
      return { id: newId };
    })
  })
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/frontendCors.ts
var DEFAULT_FRONTEND_ORIGINS = [
  "https://truthsearch-production-himanshu90909s-projects.vercel.app",
  "https://truthsearch-aynnqgr5.manus.space"
];
function normalizeFrontendOrigin(origin) {
  return origin.trim().replace(/\/$/, "");
}
function createFrontendOriginAllowlist(extraOrigins = process.env.FRONTEND_ORIGINS ?? "") {
  return new Set(
    [
      ...DEFAULT_FRONTEND_ORIGINS,
      ...extraOrigins.split(",").map((origin) => origin.trim()).filter(Boolean)
    ].map(normalizeFrontendOrigin)
  );
}
function applyFrontendCors(req, res, allowedOrigins) {
  const origin = req.header("Origin");
  if (!origin || !allowedOrigins.has(normalizeFrontendOrigin(origin))) return false;
  res.header("Access-Control-Allow-Origin", origin);
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Vary", "Origin");
  return true;
}

// server/_core/app.ts
var allowedFrontendOrigins = createFrontendOriginAllowlist();
function createApp() {
  const app = (0, import_express.default)();
  app.use((req, res, next) => {
    const allowed = applyFrontendCors(req, res, allowedFrontendOrigins);
    if (req.method === "OPTIONS") {
      res.sendStatus(allowed ? 204 : 403);
      return;
    }
    next();
  });
  app.use((req, res, next) => {
    if (req.body !== void 0 && typeof req.body === "object" && Object.keys(req.body).length > 0) {
      next();
      return;
    }
    import_express.default.json({ limit: "50mb" })(req, res, next);
  });
  app.use(import_express.default.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.use(
    "/api/trpc",
    (0, import_express2.createExpressMiddleware)({
      router: appRouter,
      createContext
    })
  );
  return app;
}

// serverless/entry.ts
var cachedApp = null;
function getApp() {
  if (!cachedApp) {
    cachedApp = createApp();
  }
  return cachedApp;
}
function diagnostics(req, res) {
  const pathname = req.url ?? req.path ?? "/";
  if (pathname.split("?")[0] === "/api/__build") {
    res.status(200).json({
      build: process.env.VERCEL_GIT_COMMIT_SHA || "dev",
      node: process.version,
      hfKey: Boolean(process.env.HF_API_KEY),
      geminiKey: Boolean(process.env.GEMINI_API_KEY),
      groqKey: Boolean(process.env.XAI_API_KEY || process.env.GROQ_API_KEY),
      sync: process.env.SYNC_RESEARCH === "true" || process.env.VERCEL === "1"
    });
    return true;
  }
  return false;
}
async function handler(req, res) {
  try {
    if (diagnostics(req, res)) return void 0;
    const app = getApp();
    return app(req, res);
  } catch (error) {
    console.error("[Vercel API initialization]", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "API initialization failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
    return void 0;
  }
}
