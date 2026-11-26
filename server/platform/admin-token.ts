import { timingSafeEqual } from "node:crypto";

/** Constant-time string comparison so a shared token cannot be recovered by timing differences. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a); const bb = Buffer.from(b);
  if (ab.length !== bb.length) { timingSafeEqual(ab, ab); return false; }
  return timingSafeEqual(ab, bb);
}
