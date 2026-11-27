import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

// Per-request context carried through async calls, so deep code (model calls, ledger writes, audit entries) knows which
// user and research session it is working for without threading arguments through every function.
export type RequestContext = { requestId: string; userId: number | null; sessionId: number | null };
const store = new AsyncLocalStorage<RequestContext>();

export const newRequestId = () => randomUUID().replace(/-/g, "").slice(0, 16);
export function runWithContext<T>(ctx: Partial<RequestContext> & { userId: number | null }, fn: () => Promise<T>): Promise<T> {
  return store.run({ requestId: ctx.requestId ?? newRequestId(), userId: ctx.userId, sessionId: ctx.sessionId ?? null }, fn);
}
export const currentContext = (): RequestContext | undefined => store.getStore();
