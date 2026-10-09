/**
 * Record boundary: FREE-RUN (local) data and COMPETITIVE (wallet-linked) data must never
 * mix. Daily Block submissions are validated against the day's seed + rule versions and
 * de-duplicated, and keyed by the verified wallet address.
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

const R = await import("../src/game/records.ts");
const { dailySeed } = await import("../src/game/daily.ts");

const DAY = "2026-02-01";
const SEED = dailySeed(DAY);
const V = R.DAILY_RULES;
const ADDR = "tb1pqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqs0abcde";

const freeRec = (score: number) => ({ score, mode: "free" as const, dateKey: DAY, ts: Date.now(), dist: 100, flips: 0, blockRuns: 0 });
const sub = (over: Partial<Parameters<typeof R.submitDailyRun>[0]> = {}) =>
  R.submitDailyRun({ address: ADDR, score: 5000, dateKey: DAY, dist: 320, flips: 1, blockRuns: 1, seed: SEED, versions: V, ...over });

test("free run writes LOCAL only, never competitive", () => {
  store.clear();
  R.recordFreeRun(freeRec(1234), 40);
  assert.equal(R.localBest(), 1234);
  assert.equal(localStorage.getItem("archrunner.comp.v1"), null); // competitive untouched
  assert.equal(R.competitiveBest(ADDR), 0);
});

test("daily run writes COMPETITIVE (keyed by wallet), never local", () => {
  store.clear();
  const r = sub({ score: 7000 });
  assert.equal(r.status, "ACCEPTED");
  assert.equal(R.competitiveBest(ADDR), 7000);
  assert.equal(R.competitiveDailyBest(ADDR, DAY), 7000);
  assert.equal(localStorage.getItem("archrunner.local.v1"), null); // local untouched
  assert.equal(R.localBest(), 0);
});

test("a different wallet has its own competitive record", () => {
  store.clear();
  sub({ score: 7000 });
  const other = "tb1potherotherotherotherotherotherotherotherotherotherxy";
  assert.equal(R.competitiveBest(other), 0);
});

test("wrong seed is REJECTED and does not count", () => {
  store.clear();
  const r = sub({ seed: SEED + 1 });
  assert.equal(r.status, "REJECTED");
  assert.equal(R.competitiveBest(ADDR), 0);
});

test("outdated rule version is REJECTED", () => {
  store.clear();
  const r = sub({ versions: { ...V, physicsVersion: "ARCHRUN_V1" } });
  assert.equal(r.status, "REJECTED");
  assert.equal(R.competitiveBest(ADDR), 0);
});

test("identical re-submission is a DUPLICATE, counted once", () => {
  store.clear();
  assert.equal(sub({ score: 8000, dist: 500 }).status, "ACCEPTED");
  assert.equal(sub({ score: 8000, dist: 500 }).status, "DUPLICATE");
  const accepted = R.competitiveProfile(ADDR).history.filter((h) => h.status === "ACCEPTED");
  assert.equal(accepted.length, 1);
  assert.equal(R.competitiveBest(ADDR), 8000);
});

test("best keeps the max across accepted daily runs", () => {
  store.clear();
  sub({ score: 3000, dist: 200 });
  sub({ score: 9000, dist: 600 });
  sub({ score: 1000, dist: 80 });
  assert.equal(R.competitiveBest(ADDR), 9000);
  assert.equal(R.competitiveDailyBest(ADDR, DAY), 9000);
});
