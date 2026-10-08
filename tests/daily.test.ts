/**
 * The Daily Block must be the SAME world for everyone on a given UTC day, and that
 * world is a pure function of the date — no wall-clock inside the sim. These tests
 * pin the seed/number helpers and prove two players on the daily seed get identical
 * worlds (so only skill separates scores).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { dailySeed, dailyNumber } from "../src/game/daily.ts";
import { RunSim } from "../src/game/sim.ts";

test("daily seed is a pure function of the date", () => {
  assert.equal(dailySeed("2026-05-01"), dailySeed("2026-05-01"), "same day → same seed");
  assert.notEqual(dailySeed("2026-05-01"), dailySeed("2026-05-02"), "different days → different seed");
});

test("daily block number counts days from the epoch", () => {
  assert.equal(dailyNumber("2026-01-01"), 1);
  assert.equal(dailyNumber("2026-01-02"), 2);
  assert.ok(dailyNumber("2026-12-31") > dailyNumber("2026-06-01"));
});

test("two players on the same daily seed get the same world", () => {
  const seed = dailySeed("2026-08-30");
  const a = new RunSim(seed);
  const b = new RunSim(seed);
  for (let i = 0; i < 500; i++) { a.step(); b.step(); }
  assert.equal(a.distance, b.distance);
  assert.equal(a.score, b.score);
});
