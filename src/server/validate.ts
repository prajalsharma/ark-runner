/**
 * Server-side anti-cheat: NEVER trust a client score. We re-run the submitted seed +
 * input stream through the canonical deterministic sim and derive the official score
 * ourselves, after structural sanity checks. A mismatch (or any impossible input) is
 * rejected. This is the whole reason the sim is deterministic — see docs/anti-cheat.md.
 */
import { replayRun, MAX_REPLAY_TICKS } from "../game/replay.ts";
import { RULESET, TICK_HZ } from "../game/constants.ts";
import type { RunSubmission, ValidationResult, FraudFlag } from "../shared/contracts.ts";

const VALID_ACTIONS = new Set(["left", "right", "jump", "slide"]);
const MAX_ACTIONS_PER_SEC = 12; // generous human ceiling; above this is a bot/macro

export function validateSubmission(sub: RunSubmission): ValidationResult {
  const flags: FraudFlag[] = [];

  // 1) Version pinning — a replay is only valid against the ruleset it was played on.
  if (sub.gameVersion !== RULESET) flags.push({ code: "VERSION_MISMATCH", detail: `expected ${RULESET}, got ${sub.gameVersion}` });

  // 2) Structural input sanity (cheap rejects before we bother replaying).
  const inputs = Array.isArray(sub.inputs) ? sub.inputs : [];
  let lastTick = -1;
  for (const e of inputs) {
    if (!e || !VALID_ACTIONS.has(e.action)) { flags.push({ code: "SUSPICIOUS_INPUT", detail: `bad action ${e?.action}` }); break; }
    if (!Number.isInteger(e.tick) || e.tick < 0 || e.tick > MAX_REPLAY_TICKS) { flags.push({ code: "IMPOSSIBLE_TIMING", detail: `tick ${e.tick} out of range` }); break; }
    if (e.tick < lastTick) { flags.push({ code: "IMPOSSIBLE_TIMING", detail: "non-monotonic ticks" }); break; }
    lastTick = e.tick;
  }

  // 3) Rate limit: no human sustains > MAX_ACTIONS_PER_SEC actions in any 1s window.
  for (let i = 0, lo = 0; i < inputs.length; i++) {
    while (inputs[i]!.tick - inputs[lo]!.tick >= TICK_HZ) lo++;
    if (i - lo + 1 > MAX_ACTIONS_PER_SEC) { flags.push({ code: "IMPOSSIBLE_SPEED", detail: "too many actions/sec" }); break; }
  }

  // 4) Authoritative replay → the official score + stats.
  const sim = replayRun(sub.seed, inputs);
  const officialScore = Math.floor(sim.score);
  if (sub.clientScore !== undefined && sub.clientScore !== officialScore) {
    flags.push({ code: "SCORE_MISMATCH", detail: `client ${sub.clientScore} vs official ${officialScore}` });
  }

  return {
    accepted: flags.length === 0,
    officialScore,
    stats: {
      distance: sim.distance, collected: sim.collected, perfects: sim.perfects,
      blockRuns: sim.blockRuns, flips: sim.flips, elapsed: sim.elapsed,
    },
    flags,
  };
}
