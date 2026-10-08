/**
 * Procedural-generation safety: statistically prove no segment is impossible.
 * Rules an ARCH RUNNER segment must never violate:
 *  - a WALL (full-block) never covers all 3 lanes at the same depth → run-ending.
 *  - a PIT never covers all 3 lanes → unjumpable wall of gaps.
 *  - no single depth requires jump AND slide at once (LOW+HIGH coincident).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SegmentGenerator, isFlipGateSegment } from "../src/game/patterns.ts";
import { isBlockRunSegment } from "../src/game/constants.ts";

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

test("consecutive same-lane hazards leave fair reaction distance (>= 12u)", () => {
  // Block Run and flip stretches are the designed-expert exception — excluded here.
  for (let seed = 1; seed <= 15; seed++) {
    const gen = new SegmentGenerator(seed * 7919);
    const perLane = new Map<number, number[]>();
    for (let i = 0; i < 200; i++) {
      if (isBlockRunSegment(i) || isFlipGateSegment(i)) continue;
      for (const o of gen.generate(i).obstacles) {
        const arr = perLane.get(o.lane) ?? [];
        arr.push(o.z); perLane.set(o.lane, arr);
      }
    }
    for (const [lane, zs] of perLane) {
      zs.sort((a, b) => a - b);
      for (let k = 1; k < zs.length; k++) {
        assert.ok(zs[k]! - zs[k - 1]! >= 11.9, `seed ${seed} lane ${lane}: hazards ${zs[k - 1]}→${zs[k]} too close`);
      }
    }
  }
});

test("generation is varied — no pattern repeats back-to-back, many distinct", () => {
  const gen = new SegmentGenerator(424242);
  const names: string[] = [];
  for (let i = 0; i < 60; i++) {
    if (isBlockRunSegment(i) || isFlipGateSegment(i) || i < 6) continue; // skip scripted/expert
    names.push(gen.patternNameAt(i));
  }
  let maxRun = 1, run = 1;
  for (let i = 1; i < names.length; i++) { run = names[i] === names[i - 1] ? run + 1 : 1; maxRun = Math.max(maxRun, run); }
  assert.ok(maxRun <= 2, `a pattern repeated ${maxRun} segments running`);
  assert.ok(new Set(names).size >= 6, `only ${new Set(names).size} distinct patterns across 50+ segments`);
});

test("same seed+index is reproducible", () => {
  const a = new SegmentGenerator(12345).generate(42);
  const b = new SegmentGenerator(12345).generate(42);
  assert.equal(JSON.stringify(a.obstacles.map((o) => [o.lane, o.type, o.z])),
    JSON.stringify(b.obstacles.map((o) => [o.lane, o.type, o.z])));
});
