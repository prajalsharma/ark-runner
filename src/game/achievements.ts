/**
 * Progression + achievements — pure logic over run stats, persisted per device (UX
 * only, never authoritative). Each run updates cumulative stats and XP; achievements
 * unlock once. Surfaced on the result card and the profile. No gameplay effect — this
 * is reward, not power (anti pay-to-win).
 */
export type Achievement = { id: string; title: string; desc: string };

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first_run", title: "FIRST STEPS", desc: "Complete your first run" },
  { id: "coins_100", title: "POCKET CHANGE", desc: "Collect 100 coins total" },
  { id: "coins_1000", title: "BLOCK BANDIT", desc: "Collect 1,000 coins total" },
  { id: "first_flip", title: "RISK TAKER", desc: "Survive an ARCH FLIP" },
  { id: "first_block", title: "ON THE BLOCK", desc: "Reach a Block Run" },
  { id: "sharp", title: "SHARP", desc: "10 Perfects in one run" },
  { id: "flow_max", title: "IN THE FLOW", desc: "Hit max Flow (×4) in a run" },
  { id: "distance_5k", title: "LONG HAUL", desc: "Run 5 KM in a single run" },
  { id: "outran_auditor", title: "OUTRAN THE AUDITOR", desc: "Pass the first Auditor checkpoint" },
];

export type RunStats = { score: number; coins: number; distance: number; perfects: number; maxFlowMult: number; archFlips: number; blockRuns: number };

type Cumulative = { runs: number; coins: number; distance: number; archFlips: number; blockRuns: number; bestScore: number; xp: number };

const CUM_KEY = "archrunner.cumulative.v1";
const UNLOCK_KEY = "archrunner.achievements.v1";
const ZERO: Cumulative = { runs: 0, coins: 0, distance: 0, archFlips: 0, blockRuns: 0, bestScore: 0, xp: 0 };

function read<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function write(key: string, v: unknown): void { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ephemeral */ } }

export function getCumulative(): Cumulative { return read<Cumulative>(CUM_KEY, { ...ZERO }); }
export function unlockedIds(): string[] { return read<string[]>(UNLOCK_KEY, []); }

/** XP → runner level (gentle curve). */
export function runnerLevel(xp = getCumulative().xp): number { return Math.max(1, Math.floor(1 + Math.sqrt(xp / 1500))); }

/** Record a finished run; returns newly-unlocked achievements + the (new) level. */
export function recordRunStats(run: RunStats): { unlocked: Achievement[]; level: number; leveledUp: boolean } {
  const cum = getCumulative();
  const levelBefore = runnerLevel(cum.xp);
  cum.runs += 1;
  cum.coins += run.coins;
  cum.distance += run.distance;
  cum.archFlips += run.archFlips;
  cum.blockRuns += run.blockRuns;
  cum.bestScore = Math.max(cum.bestScore, run.score);
  cum.xp += run.score;
  write(CUM_KEY, cum);

  const have = new Set(unlockedIds());
  const test: Record<string, boolean> = {
    first_run: cum.runs >= 1,
    coins_100: cum.coins >= 100,
    coins_1000: cum.coins >= 1000,
    first_flip: cum.archFlips >= 1,
    first_block: cum.blockRuns >= 1,
    sharp: run.perfects >= 10,
    flow_max: run.maxFlowMult >= 4,
    distance_5k: run.distance >= 500, // UI shows distance/100 KM → 500u = 5.00 KM
    outran_auditor: run.distance >= 260,
  };
  const unlocked: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!have.has(a.id) && test[a.id]) { have.add(a.id); unlocked.push(a); }
  }
  if (unlocked.length) write(UNLOCK_KEY, [...have]);
  const level = runnerLevel(cum.xp);
  return { unlocked, level, leveledUp: level > levelBefore };
}
