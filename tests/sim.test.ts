/**
 * Determinism is the anti-cheat foundation: the server re-runs the same seed +
 * the same recorded inputs and MUST get the client's exact score. These tests
 * prove the simulation is reproducible and that inputs are the only nondeterminism.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { RunSim, type InputEvent } from "../src/game/sim.ts";
import { SegmentGenerator, isFlipGateSegment, flipLaneFor } from "../src/game/patterns.ts";
import { isBlockRunSegment, BLOCK_START_SEG, FLIP_START_SEG, LANES } from "../src/game/constants.ts";

/** Re-run a recorded input stream against a fresh sim for the same tick count. */
function replay(seed: number, inputs: InputEvent[], ticks: number): RunSim {
  const s = new RunSim(seed);
  let k = 0;
  for (let t = 0; t < ticks; t++) {
    while (k < inputs.length && inputs[k]!.tick === s.tick) { s.input(inputs[k]!.action); k++; }
    s.step();
    if (!s.alive) break;
  }
  return s;
}

test("identical seed + no input → identical outcome", () => {
  const a = new RunSim(777);
  const b = new RunSim(777);
  for (let i = 0; i < 400; i++) { a.step(); b.step(); }
  assert.equal(a.distance, b.distance);
  assert.equal(a.score, b.score);
  assert.equal(a.alive, b.alive);
});

test("recorded inputs reproduce the same score on replay", () => {
  // Drive a scripted run on sim A, capture its inputs, then replay on a fresh sim.
  const a = new RunSim(2026);
  const script: Array<[number, "left" | "right" | "jump" | "slide"]> = [
    [20, "jump"], [55, "right"], [90, "slide"], [130, "left"], [175, "jump"], [210, "right"],
  ];
  let si = 0;
  for (let t = 0; t < 600 && a.alive; t++) {
    while (si < script.length && script[si]![0] === a.tick) { a.input(script[si]![1]); si++; }
    a.step();
  }
  const b = replay(2026, a.inputs, 600);
  assert.equal(b.score, a.score, "replayed score must equal original");
  assert.equal(b.distance, a.distance);
  assert.equal(b.collected, a.collected);
  assert.equal(b.alive, a.alive);
  // Phase-2 counters are part of the deterministic state and must reproduce too.
  assert.equal(b.perfects, a.perfects, "perfects must reproduce");
  assert.equal(b.blockRuns, a.blockRuns, "block runs must reproduce");
  assert.equal(b.maxFlow, a.maxFlow, "max flow must reproduce");
  assert.equal(b.flips, a.flips, "arch flips must reproduce");
});

test("ARCH FLIP gates + flip lane are deterministic and off the Block Run bands", () => {
  // Gates start at FLIP_START_SEG and never coincide with a Block Run.
  assert.equal(isFlipGateSegment(FLIP_START_SEG), true);
  for (let i = 0; i < 400; i++) {
    if (isFlipGateSegment(i)) assert.equal(isBlockRunSegment(i), false, `flip gate ${i} must not be a block run`);
    assert.equal(isFlipGateSegment(i), isFlipGateSegment(i)); // pure
  }
  // Flip lane is a valid lane and stable for a given (seed, index).
  for (const seed of [1, 2, 99, 40503]) {
    for (let i = FLIP_START_SEG; i < 60; i++) {
      const lane = flipLaneFor(seed, i);
      assert.ok(LANES.includes(lane as -1 | 0 | 1), "flip lane must be a real lane");
      assert.equal(lane, flipLaneFor(seed, i), "flip lane must be stable");
    }
  }
});

test("Block Run bands are deterministic and gated past the learning phase", () => {
  for (let i = 0; i < BLOCK_START_SEG; i++) assert.equal(isBlockRunSegment(i), false, `seg ${i} must be calm`);
  // With period 16 / length 3 starting at 8, segments 13,14,15 are block runs; 16..28 are not.
  assert.equal(isBlockRunSegment(13), true);
  assert.equal(isBlockRunSegment(15), true);
  assert.equal(isBlockRunSegment(16), false);
  assert.equal(isBlockRunSegment(29), true);
  // Pure function: same input, same output.
  for (let i = 0; i < 200; i++) assert.equal(isBlockRunSegment(i), isBlockRunSegment(i));
});

test("different seeds produce different worlds (fair-but-varied)", () => {
  const sig = (seed: number) => {
    const g = new SegmentGenerator(seed);
    return Array.from({ length: 24 }, (_, i) =>
      g.generate(i).obstacles.map((o) => `${o.lane}${o.type[0]}${Math.round(o.z)}`).join(",")
    ).join("|");
  };
  assert.notEqual(sig(1), sig(2), "two seeds must generate different worlds");
});
