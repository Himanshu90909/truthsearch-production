import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { parse as parseCookieHeader } from "cookie";
import type { User } from "../../drizzle/schema";
import { LOCAL_SESSION_COOKIE } from "../auth-local";
import { getLocalUserByToken } from "../db";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  // Local email/password accounts: fall back to our own session cookie when
  // the platform SDK has no session for this request.
  if (!user) {
    try {
      const token = parseCookieHeader(opts.req.headers.cookie ?? "")[LOCAL_SESSION_COOKIE];
      if (token) {
        const localUser = await getLocalUserByToken(token);
        if (localUser) user = localUser as unknown as User;
      }
    } catch (error) {
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
