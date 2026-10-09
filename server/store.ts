/**
 * In-memory store of SERVER-VALIDATED competitive runs, keyed by on-chain match + player.
 * This is the off-chain source of truth the settlement service ranks at settle time. A real
 * deployment swaps this for Postgres without changing the shape. Nothing here holds money or
 * keys — it only records which verified wallet earned which validated score in which match.
 */
export type ValidatedRun = {
  matchId: string;        // u64 as decimal string
  player: string;         // on-chain pubkey, 64-hex (must be a joined player to count on-chain)
  dateKey: string;
  seed: number;
  officialScore: number;  // the score the SERVER derived/accepted (never the raw client claim)
  dist: number;
  flips: number;
  blockRuns: number;
  ts: number;
  replayVerified: boolean; // true = an input stream was re-simulated server-side
};

type MatchBook = {
  best: Map<string, ValidatedRun>; // player -> their best accepted run
  all: ValidatedRun[];
};

const books = new Map<string, MatchBook>();

function book(matchId: string): MatchBook {
  let b = books.get(matchId);
  if (!b) { b = { best: new Map(), all: [] }; books.set(matchId, b); }
  return b;
}

/** True if an identical accepted run (same match/player/seed/score/dist) was already recorded. */
export function isDuplicate(r: Omit<ValidatedRun, "ts" | "replayVerified">): boolean {
  return book(r.matchId).all.some(
    (h) => h.player === r.player && h.seed === r.seed && h.officialScore === r.officialScore && h.dist === r.dist,
  );
}

export function record(run: ValidatedRun): void {
  const b = book(run.matchId);
  b.all.push(run);
  const prev = b.best.get(run.player);
  if (!prev || run.officialScore > prev.officialScore) b.best.set(run.player, run);
}

/** Best accepted score per player in a match (the leaderboard the settler ranks). */
export function leaderboard(matchId: string): ValidatedRun[] {
  return [...book(matchId).best.values()].sort((a, b) => b.officialScore - a.officialScore);
}

export function matchRuns(matchId: string): ValidatedRun[] {
  return [...book(matchId).all];
}

/** Test-only: wipe the store (used by the E2E harness between runs). */
export function _reset(): void { books.clear(); }
