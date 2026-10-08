/**
 * GAME-001 regression: each coin is an individual entity. Collecting a coin in the
 * player's lane must NEVER remove a coin in another lane — a coin only leaves view by
 * being collected (in the player's lane) or by scrolling behind the player.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { RunSim } from "../src/game/sim.ts";

test("a side-lane coin never disappears while the player collects in its own lane", () => {
  for (const seed of [777, 2026, 99, 4242, 31337]) {
    const s = new RunSim(seed); // no input → stays in the centre lane (0)
    for (let t = 0; t < 700 && s.alive; t++) {
      const before = new Map(s.view().energy.map((e) => [e.id, e]));
      s.step();
      const after = new Set(s.view().energy.map((e) => e.id));
      for (const [id, e] of before) {
        if (after.has(id)) continue;                       // still visible — fine
        const scrolledBehind = e.z <= s.distance - 2 + 1e-6; // left the render window naturally
        const inPlayerLane = e.lane === s.lane;              // could legitimately be collected
        assert.ok(scrolledBehind || inPlayerLane,
          `seed ${seed}: coin ${id} in lane ${e.lane} vanished without being collected or scrolling (z=${e.z.toFixed(1)}, dist=${s.distance.toFixed(1)})`);
      }
    }
  }
});

test("coin count only ever increases (no coin counted twice)", () => {
  const s = new RunSim(2026);
  let prev = 0;
  for (let t = 0; t < 500 && s.alive; t++) {
    s.step();
    assert.ok(s.collected >= prev, "coin count must be monotonic");
    prev = s.collected;
  }
});
