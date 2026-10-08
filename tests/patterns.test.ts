/**
 * Procedural-generation safety: statistically prove no segment is impossible.
 * Rules an ARCH RUNNER segment must never violate:
 *  - a WALL (full-block) never covers all 3 lanes at the same depth → run-ending.
 *  - a PIT never covers all 3 lanes → unjumpable wall of gaps.
 *  - no single depth requires jump AND slide at once (LOW+HIGH coincident).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SegmentGenerator } from "../src/game/patterns.ts";

test("10,000 segments across seeds contain no impossible depth", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const gen = new SegmentGenerator(seed * 7919);
    for (let i = 0; i < 500; i++) {
      const seg = gen.generate(i);
      // Bucket obstacles by rounded depth.
      const byZ = new Map<number, { walls: Set<number>; pits: Set<number>; low: Set<number>; high: Set<number> }>();
      for (const o of seg.obstacles) {
        const z = Math.round(o.z);
        let b = byZ.get(z);
        if (!b) { b = { walls: new Set(), pits: new Set(), low: new Set(), high: new Set() }; byZ.set(z, b); }
        if (o.type === "WALL") b.walls.add(o.lane);
        else if (o.type === "PIT") b.pits.add(o.lane);
        else if (o.type === "LOW") b.low.add(o.lane);
        else if (o.type === "HIGH") b.high.add(o.lane);
      }
      for (const [z, b] of byZ) {
        assert.ok(b.walls.size < 3, `seed ${seed} seg ${i} z ${z}: WALL blocks all 3 lanes`);
        assert.ok(b.pits.size < 3, `seed ${seed} seg ${i} z ${z}: PIT covers all 3 lanes`);
        assert.ok(!(b.low.size > 0 && b.high.size > 0), `seed ${seed} seg ${i} z ${z}: jump+slide required at once`);
      }
    }
  }
});

test("same seed+index is reproducible", () => {
  const a = new SegmentGenerator(12345).generate(42);
  const b = new SegmentGenerator(12345).generate(42);
  assert.equal(JSON.stringify(a.obstacles.map((o) => [o.lane, o.type, o.z])),
    JSON.stringify(b.obstacles.map((o) => [o.lane, o.type, o.z])));
});
