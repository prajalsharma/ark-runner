/**
 * Progression + achievements: cumulative stats accrue, single-run achievements fire,
 * nothing double-unlocks, and the level rises with XP. Pure logic over localStorage.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: () => null, length: 0,
} as unknown as Storage;

const A = await import("../src/game/achievements.ts");

test("first run unlocks first_run + outran_auditor, not coins_100", () => {
  localStorage.clear();
  const r = A.recordRunStats({ score: 1000, coins: 50, distance: 300, perfects: 0, maxFlowMult: 1, archFlips: 0, blockRuns: 0 });
  const ids = r.unlocked.map((a) => a.id);
  assert.ok(ids.includes("first_run") && ids.includes("outran_auditor"));
  assert.ok(!ids.includes("coins_100"));
});

test("coins accumulate across runs", () => {
  localStorage.clear();
  A.recordRunStats({ score: 0, coins: 60, distance: 0, perfects: 0, maxFlowMult: 1, archFlips: 0, blockRuns: 0 });
  const r = A.recordRunStats({ score: 0, coins: 60, distance: 0, perfects: 0, maxFlowMult: 1, archFlips: 0, blockRuns: 0 });
  assert.ok(r.unlocked.map((a) => a.id).includes("coins_100"));
  assert.equal(A.getCumulative().coins, 120);
});

test("single-run achievements fire once, never twice", () => {
  localStorage.clear();
  const r1 = A.recordRunStats({ score: 5000, coins: 0, distance: 600, perfects: 12, maxFlowMult: 4, archFlips: 1, blockRuns: 1 });
  const ids = r1.unlocked.map((a) => a.id);
  for (const id of ["sharp", "flow_max", "distance_5k", "first_flip", "first_block"]) assert.ok(ids.includes(id), `missing ${id}`);
  const r2 = A.recordRunStats({ score: 5000, coins: 0, distance: 600, perfects: 12, maxFlowMult: 4, archFlips: 1, blockRuns: 1 });
  assert.equal(r2.unlocked.length, 0, "already-unlocked achievements must not re-fire");
});

test("runner level rises with XP", () => {
  localStorage.clear();
  assert.equal(A.runnerLevel(0), 1);
  A.recordRunStats({ score: 20000, coins: 0, distance: 0, perfects: 0, maxFlowMult: 1, archFlips: 0, blockRuns: 0 });
  assert.ok(A.runnerLevel() >= 2);
});
