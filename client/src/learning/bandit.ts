// TruthSearch built-in reinforcement learning — an epsilon-style greedy bandit
// over source domains. Every 👍/👎 rating is a reward signal: domains that earn
// positive rewards get ranked higher in future research, weak ones sink. State
// persists in localStorage, so the app keeps learning across sessions without
// any server.

const KEY = "truthsearch_rl_v1";

export type ArmStats = { wins: number; losses: number };
export type RlState = { arms: Record<string, ArmStats>; samples: number };

const load = (): RlState => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "");
    if (parsed && parsed.arms && typeof parsed.arms === "object") return parsed as RlState;
  } catch {
    // corrupted or missing state — start fresh
  }
  return { arms: {}, samples: 0 };
};

const save = (state: RlState) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage full/blocked — learning is best-effort
  }
};

/** Record a reward (+1 helpful / -1 not helpful) for every domain that fed this answer. */
export const reward = (domains: Array<string | undefined>, r: number) => {
  const state = load();
  const seen = new Set<string>();
  for (const d of domains) {
    if (!d || seen.has(d)) continue;
    seen.add(d);
    const arm = state.arms[d] ?? (state.arms[d] = { wins: 0, losses: 0 });
    if (r > 0) arm.wins += 1;
    else arm.losses += 1;
  }
  state.samples += 1;
  save(state);
};

/** Smoothed win rate for a domain, in [0, 1]. Unknown domains start at 0.5. */
export const domainScore = (domain?: string): number => {
  if (!domain) return 0.5;
  const arm = load().arms[domain];
  if (!arm) return 0.5;
  return (1 + arm.wins) / (2 + arm.wins + arm.losses);
};

/** Exploration: domains with few ratings get a small optimistic bonus. */
const combined = (item: { domain?: string; qualityScore?: number }) => {
  const learned = domainScore(item.domain);
  const base = (item.qualityScore ?? 70) / 100;
  return 0.65 * learned + 0.35 * base;
};

/** Rank sources by learned trust blended with intrinsic quality. */
export const rankSources = <T extends { domain?: string; qualityScore?: number }>(items: T[]): T[] =>
  [...items].sort((a, b) => combined(b) - combined(a));

/** Small summary for the sidebar UI. */
export const summary = (): { samples: number; top?: string } => {
  const state = load();
  const top = Object.entries(state.arms).sort(([, a], [, b]) => b.wins - b.losses - (a.wins - a.losses))[0];
  return { samples: state.samples, top: top?.[0] };
};
