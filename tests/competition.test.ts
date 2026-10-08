/**
 * The competition state machine must forbid illegal transitions and only record
 * server-validated runs, keeping the leaderboard honest.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Competition } from "../src/server/competition.ts";
import type { ValidationResult } from "../src/shared/contracts.ts";

const ok = (score: number): ValidationResult => ({ accepted: true, officialScore: score, stats: { distance: 0, collected: 0, perfects: 0, blockRuns: 0, flips: 0, elapsed: 0 }, flags: [] });
const bad: ValidationResult = { accepted: false, officialScore: 999999, stats: { distance: 0, collected: 0, perfects: 0, blockRuns: 0, flips: 0, elapsed: 0 }, flags: [{ code: "SCORE_MISMATCH", detail: "x" }] };

test("the happy-path lifecycle is allowed end to end", () => {
  const c = new Competition("daily-1", 123);
  c.open(); c.lock();
  c.transition("VALIDATING"); c.transition("FINALIZED"); c.transition("SETTLING"); c.transition("SETTLED");
  assert.equal(c.state, "SETTLED");
});

test("illegal transitions throw", () => {
  const c = new Competition("x", 1);
  assert.throws(() => c.transition("SETTLED"), /illegal/); // CREATED → SETTLED
  c.open();
  c.lock();
  assert.throws(() => c.transition("OPEN"), /illegal/); // LOCKED → OPEN not allowed
});

test("only validated runs enter the leaderboard, best score per player, sorted", () => {
  const c = new Competition("daily-2", 7);
  c.open();
  assert.throws(() => c.submit("alice", bad), /unvalidated/);
  c.submit("alice", ok(1000));
  c.submit("bob", ok(2500));
  c.submit("alice", ok(1800)); // alice improves
  c.submit("alice", ok(1200)); // worse — ignored
  const lb = c.leaderboard();
  assert.deepEqual(lb, [{ player: "bob", score: 2500 }, { player: "alice", score: 1800 }]);
  c.lock();
  assert.throws(() => c.submit("carol", ok(500)), /not accepting/); // closed window
});
