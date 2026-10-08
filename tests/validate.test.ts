/**
 * The anti-cheat contract: an honest input stream validates to its exact score;
 * a tampered score, a wrong ruleset, and physically impossible input are all
 * rejected. This is the server re-running the deterministic sim (docs/anti-cheat.md).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { RunSim, type Action } from "../src/game/sim.ts";
import { validateSubmission } from "../src/server/validate.ts";
import { RULESET, MATCH_SECONDS } from "../src/game/constants.ts";
import { MAX_REPLAY_TICKS } from "../src/game/replay.ts";
import type { RunSubmission } from "../src/shared/contracts.ts";

/** Produce a real submission by driving a sim to its terminal state (death/cap) —
 *  exactly how the server replay runs, so an honest score must match. */
function honestRun(seed: number): { sub: RunSubmission; score: number } {
  const a = new RunSim(seed, { cap: MATCH_SECONDS });
  const script: Array<[number, Action]> = [[18, "jump"], [60, "right"], [95, "slide"], [140, "left"], [185, "jump"]];
  let si = 0;
  for (let t = 0; a.alive && t < MAX_REPLAY_TICKS; t++) {
    while (si < script.length && script[si]![0] === a.tick) { a.input(script[si]![1]); si++; }
    a.step();
  }
  const score = Math.floor(a.score);
  return {
    score,
    sub: { seed, gameVersion: RULESET, inputs: a.inputs.map((e) => ({ tick: e.tick, action: e.action })), clientScore: score },
  };
}

test("an honest run validates to its exact official score", () => {
  const { sub, score } = honestRun(4242);
  const r = validateSubmission(sub);
  assert.equal(r.accepted, true, JSON.stringify(r.flags));
  assert.equal(r.officialScore, score);
  assert.equal(r.flags.length, 0);
});

test("a tampered client score is rejected (score mismatch)", () => {
  const { sub } = honestRun(4242);
  const r = validateSubmission({ ...sub, clientScore: (sub.clientScore ?? 0) + 1_000_000 });
  assert.equal(r.accepted, false);
  assert.ok(r.flags.some((f) => f.code === "SCORE_MISMATCH"));
});

test("a wrong ruleset version is rejected", () => {
  const { sub } = honestRun(7);
  const r = validateSubmission({ ...sub, gameVersion: "HACKED_V9" });
  assert.equal(r.accepted, false);
  assert.ok(r.flags.some((f) => f.code === "VERSION_MISMATCH"));
});

test("impossible input is rejected", () => {
  const bad: RunSubmission = { seed: 1, gameVersion: RULESET, inputs: [{ tick: 50, action: "jump" }, { tick: 10, action: "left" }] };
  assert.ok(validateSubmission(bad).flags.some((f) => f.code === "IMPOSSIBLE_TIMING"), "non-monotonic ticks");

  const botSpam: RunSubmission = { seed: 1, gameVersion: RULESET, inputs: Array.from({ length: 40 }, (_, i) => ({ tick: 100 + i, action: "left" })) };
  assert.ok(validateSubmission(botSpam).flags.some((f) => f.code === "IMPOSSIBLE_SPEED"), "40 actions in <1s");

  const garbage: RunSubmission = { seed: 1, gameVersion: RULESET, inputs: [{ tick: 5, action: "teleport" }] };
  assert.ok(validateSubmission(garbage).flags.some((f) => f.code === "SUSPICIOUS_INPUT"), "unknown action");
});
