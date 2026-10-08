/**
 * Daily Block + local records. The daily seed is a pure function of the UTC date,
 * so every player worldwide gets the SAME world on a given day (skill decides the
 * score). Wall-clock is used only to pick which seed to play — never inside the
 * deterministic sim. Records live in localStorage (this device only, until the
 * Phase-4 backend provides a real shared leaderboard).
 */
import { seedFromString } from "../engine/rng.ts";

export type Mode = "daily" | "free";
export type RunRecord = { score: number; mode: Mode; dateKey: string; ts: number; dist: number; flips: number; blockRuns: number };

const EPOCH_UTC = Date.UTC(2026, 0, 1); // DAILY BLOCK #1 = 2026-01-01

export function dateKeyUTC(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Deterministic shared seed for a given UTC day. */
export function dailySeed(dateKey: string = dateKeyUTC()): number {
  return seedFromString(`ARCH-DAILY-${dateKey}`);
}

/** Human-friendly "DAILY BLOCK #N" counter. */
export function dailyNumber(dateKey: string = dateKeyUTC()): number {
  const day = Math.floor((Date.parse(`${dateKey}T00:00:00Z`) - EPOCH_UTC) / 86_400_000) + 1;
  return Math.max(1, day);
}

/** A daily challenge "theme" + goal, chosen deterministically by the day. This is a
 *  GOAL layered on the same fair daily seed — it does NOT change the deterministic
 *  score (so replay/leaderboard parity holds); it gives the day an identity and a
 *  reason to replay. "Met" is computed from the run's stats. */
export type ChallengeStats = { coins: number; flips: number; perfects: number; blockRuns: number; distance: number; elapsed: number };
export type DailyVariant = { id: string; name: string; goal: string; test: (s: ChallengeStats) => boolean };

const VARIANTS: DailyVariant[] = [
  { id: "coin_storm", name: "COIN STORM", goal: "Collect 60+ coins", test: (s) => s.coins >= 60 },
  { id: "flip_master", name: "FLIP MASTER", goal: "Survive 2+ ARCH FLIPs", test: (s) => s.flips >= 2 },
  { id: "perfectionist", name: "PERFECTIONIST", goal: "Land 15+ Perfects", test: (s) => s.perfects >= 15 },
  { id: "block_breaker", name: "BLOCK BREAKER", goal: "Reach 2+ Block Runs", test: (s) => s.blockRuns >= 2 },
  { id: "marathon", name: "MARATHON", goal: "Run 4.0+ KM", test: (s) => s.distance >= 400 },
  { id: "auditor_escape", name: "AUDITOR ESCAPE", goal: "Survive 75s+", test: (s) => s.elapsed >= 75 },
];

export function dailyVariant(dateKey: string = dateKeyUTC()): DailyVariant {
  return VARIANTS[dailyNumber(dateKey) % VARIANTS.length]!;
}

// --- persistence (best-effort; private mode / blocked storage degrade cleanly) ---
const HISTORY_KEY = "archrunner.history.v1";
const DAILY_BEST_KEY = "archrunner.dailybest.v1";

function read<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ephemeral */ }
}

export function loadHistory(): RunRecord[] { return read<RunRecord[]>(HISTORY_KEY, []); }

export function recordRun(r: RunRecord): void {
  const hist = loadHistory();
  hist.unshift(r);
  write(HISTORY_KEY, hist.slice(0, 20)); // keep the last 20
  if (r.mode === "daily") {
    const bests = read<Record<string, number>>(DAILY_BEST_KEY, {});
    if (r.score > (bests[r.dateKey] ?? 0)) { bests[r.dateKey] = r.score; write(DAILY_BEST_KEY, bests); }
  }
}

export function dailyBest(dateKey: string = dateKeyUTC()): number {
  return read<Record<string, number>>(DAILY_BEST_KEY, {})[dateKey] ?? 0;
}
