// Token, cost and latency accounting plus budget enforcement.
//
// Prices are a CONFIGURATION TABLE, not facts baked into logic. A model with no entry is recorded with
// costUsd = null ("unknown"), never 0, so analytics cannot show a fake "free" figure. Update PRICES_USD_PER_MTOK
// from the provider's own price page; the values below are intentionally empty until verified.

export type ModelPrice = { inputPerMTok: number; outputPerMTok: number; source: string; verifiedOn: string };

export const PRICES_USD_PER_MTOK: Record<string, ModelPrice> = {
  // "provider/model": { inputPerMTok, outputPerMTok, source: "<price page url>", verifiedOn: "YYYY-MM-DD" }
};

export type Usage = { promptTokens: number; completionTokens: number };

export function estimateCostUsd(providerModel: string, usage: Usage, prices: Record<string, ModelPrice> = PRICES_USD_PER_MTOK): number | null {
  const price = prices[providerModel];
  if (!price) return null;
  const cost = (usage.promptTokens * price.inputPerMTok + usage.completionTokens * price.outputPerMTok) / 1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}

/** Rough token estimate used only when a provider does not report usage. Flagged as an estimate in the ledger. */
export function estimateTokens(text: string): number { return Math.ceil((text || "").length / 4); }

export type BudgetPolicy = { dailyTokensPerUser: number; dailyTokensGlobal: number; dailyUsdGlobal: number | null };
export type BudgetDecision = { allowed: boolean; reason?: "user_tokens" | "global_tokens" | "global_usd"; remainingUserTokens: number };

export function readBudgetPolicy(env: Record<string, string | undefined> = process.env): BudgetPolicy {
  const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  return {
    dailyTokensPerUser: num(env.BUDGET_DAILY_TOKENS_PER_USER, 400_000),
    dailyTokensGlobal: num(env.BUDGET_DAILY_TOKENS_GLOBAL, 5_000_000),
    dailyUsdGlobal: env.BUDGET_DAILY_USD_GLOBAL ? num(env.BUDGET_DAILY_USD_GLOBAL, 0) || null : null,
  };
}

export function evaluateBudget(policy: BudgetPolicy, spent: { userTokens: number; globalTokens: number; globalUsd: number }): BudgetDecision {
  const remainingUserTokens = Math.max(0, policy.dailyTokensPerUser - spent.userTokens);
  if (spent.userTokens >= policy.dailyTokensPerUser) return { allowed: false, reason: "user_tokens", remainingUserTokens };
  if (spent.globalTokens >= policy.dailyTokensGlobal) return { allowed: false, reason: "global_tokens", remainingUserTokens };
  if (policy.dailyUsdGlobal != null && spent.globalUsd >= policy.dailyUsdGlobal) return { allowed: false, reason: "global_usd", remainingUserTokens };
  return { allowed: true, remainingUserTokens };
}
