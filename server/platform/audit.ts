// Audit log entries. Secrets and raw credentials are never written: sanitizeMeta() removes anything that looks like
// a key, token, password or authorization value before it reaches the database.

export type AuditAction =
  | "auth.login" | "auth.register" | "auth.logout" | "auth.login_failed"
  | "admin.metrics_view" | "admin.provider_update" | "admin.provider_test" | "admin.credential_set" | "admin.credential_removed"
  | "research.start" | "research.complete" | "research.fail" | "research.delete"
  | "budget.blocked" | "ratelimit.blocked" | "data.export" | "data.delete" | "account.delete";

export type AuditEntry = { userId: number | null; action: AuditAction; target?: string | null; ip?: string | null; requestId?: string | null; meta?: Record<string, unknown> | null };

const SECRET_KEY = /(key|token|secret|password|passwd|authorization|cookie|bearer|credential)/i;
const SECRET_VALUE = /(sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|nvapi-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})/g;

export function sanitizeMeta(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "string") return value.replace(SECRET_VALUE, "[redacted]").slice(0, 500);
  if (typeof value !== "object") return value;
  if (depth > 3) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitizeMeta(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 30)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : sanitizeMeta(v, depth + 1);
  return out;
}

/** Show only enough of a credential to recognise it. Never returns the full secret. */
export function maskSecret(secret: string | undefined | null): string {
  if (!secret) return "not set";
  const s = secret.trim();
  if (s.length <= 8) return "••••";
  return `${s.slice(0, 3)}••••${s.slice(-2)}`;
}
