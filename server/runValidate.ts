/**
 * Daily Block run validation for /run/submit. The service NEVER trusts a client score.
 * Three gates, mirroring the client's honest boundary (src/game/records.ts) plus the
 * authoritative replay (src/server/validate.ts):
 *   1. seed must equal the day's canonical dailySeed(dateKey)
 *   2. rule versions must match the accepted DAILY_RULES
 *   3. if an input stream is supplied, re-simulate it and derive the official score
 * Without an input stream the claimed score is recorded but flagged replayVerified=false,
 * so the honesty boundary is explicit.
 */
import { dailySeed } from "../src/game/daily.ts";
import { DAILY_RULES } from "../src/game/records.ts";
import { RULESET } from "../src/game/constants.ts";
import { validateSubmission } from "../src/server/validate.ts";
import type { RunStats } from "../src/shared/contracts.ts";

export type SubmitBody = {
  matchId: string;
  player: string;        // 64-hex on-chain pubkey
  dateKey: string;
  seed: number;
  clientScore: number;
  dist: number;
  flips: number;
  blockRuns: number;
  versions: { gameVersion: string; physicsVersion: string; scoringVersion: string };
  inputs?: Array<{ tick: number; action: string }>;
};

export type RunStatus = "ACCEPTED" | "REJECTED" | "DUPLICATE";
export type RunVerdict = {
  status: RunStatus;
  officialScore: number;
  stats: RunStats;
  replayVerified: boolean;
  flags: string[];
  detail?: string;
};

const HEX64 = /^[0-9a-f]{64}$/;

export function validateRun(b: SubmitBody): RunVerdict {
  const flags: string[] = [];
  const zero: RunStats = { distance: 0, collected: 0, perfects: 0, blockRuns: 0, flips: 0, elapsed: 0 };

  if (!b.player || !HEX64.test(b.player)) {
    return { status: "REJECTED", officialScore: 0, stats: zero, replayVerified: false, flags: ["BAD_PLAYER"], detail: "player must be a 64-hex on-chain pubkey" };
  }
  if (b.seed !== dailySeed(b.dateKey)) {
    return { status: "REJECTED", officialScore: 0, stats: zero, replayVerified: false, flags: ["SEED_MISMATCH"], detail: "seed does not match the daily seed" };
  }
  const v = b.versions ?? ({} as SubmitBody["versions"]);
  if (v.gameVersion !== DAILY_RULES.gameVersion || v.physicsVersion !== DAILY_RULES.physicsVersion || v.scoringVersion !== DAILY_RULES.scoringVersion) {
    return { status: "REJECTED", officialScore: 0, stats: zero, replayVerified: false, flags: ["VERSION_MISMATCH"], detail: "run was produced on an outdated rule version" };
  }

  // Optional authoritative replay: re-simulate the input stream and derive the score.
  if (Array.isArray(b.inputs) && b.inputs.length > 0) {
    const res = validateSubmission({ seed: b.seed, gameVersion: RULESET, inputs: b.inputs, clientScore: b.clientScore });
    if (!res.accepted) {
      return { status: "REJECTED", officialScore: res.officialScore, stats: res.stats, replayVerified: true, flags: res.flags.map((f) => f.code), detail: res.flags.map((f) => f.detail).join("; ") };
    }
    return { status: "ACCEPTED", officialScore: res.officialScore, stats: res.stats, replayVerified: true, flags };
  }

  // No input stream: record the claimed score, honestly flagged as not replay-verified.
  flags.push("NO_REPLAY_STREAM");
  const score = Number.isFinite(b.clientScore) && b.clientScore >= 0 ? Math.floor(b.clientScore) : 0;
  return {
    status: "ACCEPTED",
    officialScore: score,
    stats: { distance: b.dist | 0, collected: 0, perfects: 0, blockRuns: b.blockRuns | 0, flips: b.flips | 0, elapsed: 0 },
    replayVerified: false,
    flags,
  };
}
