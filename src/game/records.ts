/**
 * Record boundary — the hard wall between FREE-RUN (local, device-only practice) data and
 * COMPETITIVE (wallet-linked Daily Block) data. These are different stores with different
 * keys and different write paths, so an anonymous free run can NEVER enter the competition
 * record or claim a prize, and a stale local cache can never overwrite competitive history.
 *
 * Local store: free-run best/distance/coins/history — keyed per device, no identity.
 * Competitive store: keyed by VERIFIED wallet address; every Daily Block submission is
 * validated (seed + rule versions) and de-duplicated before it counts.
 *
 * NOTE: localStorage is a convenience cache ONLY. It is never authoritative for competitive
 * results — a real server validator (docs/security.md) will be the source of truth. Until
 * that backend is live, competitive records here are provisional and labelled as such.
 */
import { RULESET } from "./constants.ts";
import { dailySeed, dateKeyUTC, type Mode, type RunRecord } from "./daily.ts";

// ---- namespaces (explicit + versioned; never share a key across the boundary) ----
const LOCAL_KEY = "archrunner.local.v1";
const COMP_KEY = "archrunner.comp.v1";

/** Rule versions a Daily Block submission must match to be accepted. */
export const DAILY_RULES = { gameVersion: "1.0.0", physicsVersion: RULESET, scoringVersion: "1.0.0" } as const;

function read<T>(k: string, f: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : f; } catch { return f; } }
function write(k: string, v: unknown): void { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ephemeral */ } }

// ---- LOCAL (free run) --------------------------------------------------------------
export type LocalStore = { bestScore: number; bestDist: number; totalCoins: number; runs: number; history: RunRecord[] };
const EMPTY_LOCAL: LocalStore = { bestScore: 0, bestDist: 0, totalCoins: 0, runs: 0, history: [] };

export function localStore(): LocalStore { return read<LocalStore>(LOCAL_KEY, { ...EMPTY_LOCAL }); }
export function localBest(): number { return localStore().bestScore; }

/** Record a FREE run. Local only — never touches competitive data. */
export function recordFreeRun(rec: RunRecord, coins: number): void {
  const s = localStore();
  s.bestScore = Math.max(s.bestScore, rec.score);
  s.bestDist = Math.max(s.bestDist, rec.dist);
  s.totalCoins += Math.max(0, coins | 0);
  s.runs += 1;
  s.history.unshift({ ...rec, mode: "free" });
  s.history = s.history.slice(0, 20);
  write(LOCAL_KEY, s);
}

// ---- COMPETITIVE (wallet-linked Daily Block) --------------------------------------
export type SubmitStatus = "ACCEPTED" | "REJECTED" | "DUPLICATE";
export type CompSubmission = {
  score: number; dateKey: string; ts: number; dist: number; flips: number; blockRuns: number;
  seed: number; gameVersion: string; physicsVersion: string; scoringVersion: string;
  status: SubmitStatus; detail?: string;
};
export type CompProfile = { bestScore: number; dailyBest: Record<string, number>; history: CompSubmission[] };
type CompStore = Record<string, CompProfile>; // address -> profile

function compAll(): CompStore { return read<CompStore>(COMP_KEY, {}); }
function emptyComp(): CompProfile { return { bestScore: 0, dailyBest: {}, history: [] }; }

export function competitiveProfile(address: string): CompProfile { return compAll()[address] ?? emptyComp(); }
export function competitiveBest(address: string): number { return competitiveProfile(address).bestScore; }
export function competitiveDailyBest(address: string, dateKey: string = dateKeyUTC()): number {
  return competitiveProfile(address).dailyBest[dateKey] ?? 0;
}

export type DailySubmissionInput = {
  address: string; score: number; dateKey: string; dist: number; flips: number; blockRuns: number;
  seed: number; versions: { gameVersion: string; physicsVersion: string; scoringVersion: string };
};

/**
 * Validate + record a Daily Block run against a VERIFIED wallet address. Rejects a wrong
 * seed or mismatched rule version; de-duplicates an identical re-submission. Returns the
 * truthful status (provisional until the server validator is live).
 */
export function submitDailyRun(inp: DailySubmissionInput): CompSubmission {
  const now = Date.now();
  const base: CompSubmission = {
    score: inp.score, dateKey: inp.dateKey, ts: now, dist: inp.dist, flips: inp.flips, blockRuns: inp.blockRuns,
    seed: inp.seed, gameVersion: inp.versions.gameVersion, physicsVersion: inp.versions.physicsVersion, scoringVersion: inp.versions.scoringVersion,
    status: "ACCEPTED",
  };

  // Validate against the day's canonical seed + the accepted rule versions.
  if (inp.seed !== dailySeed(inp.dateKey)) return reject(inp.address, base, "seed does not match the daily seed");
  if (inp.versions.gameVersion !== DAILY_RULES.gameVersion || inp.versions.physicsVersion !== DAILY_RULES.physicsVersion || inp.versions.scoringVersion !== DAILY_RULES.scoringVersion)
    return reject(inp.address, base, "run was produced on an outdated rule version");

  const all = compAll();
  const prof = all[inp.address] ?? emptyComp();

  // Idempotency: an identical run (same day/seed/score/dist) is a duplicate, not a new entry.
  if (prof.history.some((h) => h.status === "ACCEPTED" && h.dateKey === base.dateKey && h.seed === base.seed && h.score === base.score && h.dist === base.dist)) {
    const dup: CompSubmission = { ...base, status: "DUPLICATE", detail: "identical run already recorded" };
    prof.history.unshift(dup); prof.history = prof.history.slice(0, 50);
    all[inp.address] = prof; write(COMP_KEY, all);
    return dup;
  }

  prof.bestScore = Math.max(prof.bestScore, base.score);
  prof.dailyBest[base.dateKey] = Math.max(prof.dailyBest[base.dateKey] ?? 0, base.score);
  prof.history.unshift(base); prof.history = prof.history.slice(0, 50);
  all[inp.address] = prof; write(COMP_KEY, all);
  return base;
}

function reject(address: string, base: CompSubmission, detail: string): CompSubmission {
  const rec: CompSubmission = { ...base, status: "REJECTED", detail };
  const all = compAll(); const prof = all[address] ?? emptyComp();
  prof.history.unshift(rec); prof.history = prof.history.slice(0, 50);
  all[address] = prof; write(COMP_KEY, all);
  return rec;
}

/** The current UTC day's canonical submission input helper (seed + versions pre-filled). */
export function dailyContext(address: string, dateKey: string = dateKeyUTC()): { address: string; dateKey: string; seed: number; versions: typeof DAILY_RULES } {
  return { address, dateKey, seed: dailySeed(dateKey), versions: DAILY_RULES };
}

export type { Mode };
