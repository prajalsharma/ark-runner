/**
 * Procedural segment generation. Deterministic (seed + segmentIndex), ramps in
 * difficulty, and — critically — every emitted pattern is BEATABLE. A WALL never
 * blocks all three lanes at the same depth; obstacles are spaced so the runner
 * always has reaction time. tests/patterns.test.ts statistically verifies this.
 */
import { SeededRandom } from "../engine/rng.ts";
import {
  LANES, SEGMENT_LEN, isBlockRunSegment,
  FLIP_START_SEG, FLIP_PERIOD_SEGS, type ObstacleType,
} from "./constants.ts";

/** A flip gate lives here — deterministic, and never on a Block Run segment. */
export function isFlipGateSegment(index: number): boolean {
  if (index < FLIP_START_SEG || isBlockRunSegment(index)) return false;
  return index % FLIP_PERIOD_SEGS === FLIP_START_SEG % FLIP_PERIOD_SEGS;
}

/** Which lane is the (dangerous, rewarding) flip lane for this gate. Seed-derived. */
export function flipLaneFor(seed: number, index: number): number {
  const r = new SeededRandom((seed >>> 0) ^ (index * 40503));
  return r.pick(LANES);
}

export type Obstacle = { z: number; lane: number; type: ObstacleType; id: number };
export type Energy = { z: number; lane: number; y: number; id: number };
export type Segment = { index: number; obstacles: Obstacle[]; energy: Energy[]; startZ: number; endZ: number };

let nextId = 1;
const reset = () => { nextId = 1; };

type Ctx = { rng: SeededRandom; z0: number; obstacles: Obstacle[]; energy: Energy[]; difficulty: number };

function energyLine(c: Ctx, lane: number, z: number, n: number, y = 0): void {
  for (let i = 0; i < n; i++) c.energy.push({ id: nextId++, lane, z: z + i * 1.6, y });
}

/** Pattern library. Each fills a ~SEGMENT_LEN window from z0. All beatable. */
const PATTERNS: Record<string, (c: Ctx) => void> = {
  straight_easy(c) {
    const lane = c.rng.pick(LANES);
    energyLine(c, lane, c.z0 + 4, 6);
  },
  single_wall(c) {
    const blocked = c.rng.pick(LANES);
    c.obstacles.push({ id: nextId++, lane: blocked, type: "WALL", z: c.z0 + 12 });
    for (const l of LANES) if (l !== blocked) energyLine(c, l, c.z0 + 10, 3);
  },
  jump_low(c) {
    // LOW can span all lanes — you jump it. Floating reward for the brave.
    for (const l of LANES) c.obstacles.push({ id: nextId++, lane: l, type: "LOW", z: c.z0 + 12 });
    energyLine(c, c.rng.pick(LANES), c.z0 + 12, 3, 1.6); // air orbs over the bar
  },
  slide_high(c) {
    for (const l of LANES) c.obstacles.push({ id: nextId++, lane: l, type: "HIGH", z: c.z0 + 12 });
    energyLine(c, c.rng.pick(LANES), c.z0 + 16, 4);
  },
  pit_gap(c) {
    const safe = c.rng.pick(LANES);
    for (const l of LANES) if (l !== safe) c.obstacles.push({ id: nextId++, lane: l, type: "PIT", z: c.z0 + 12 });
    energyLine(c, safe, c.z0 + 8, 5);
  },
  double_switch(c) {
    const a = c.rng.pick(LANES);
    let b = c.rng.pick(LANES);
    if (b === a) b = LANES[(LANES.indexOf(a) + 1) % 3]!;
    c.obstacles.push({ id: nextId++, lane: a, type: "WALL", z: c.z0 + 8 });
    c.obstacles.push({ id: nextId++, lane: b, type: "WALL", z: c.z0 + 16 });
  },
  combo_chain(c) {
    // jump then slide — the classic rhythm test.
    for (const l of LANES) c.obstacles.push({ id: nextId++, lane: l, type: "LOW", z: c.z0 + 8 });
    for (const l of LANES) c.obstacles.push({ id: nextId++, lane: l, type: "HIGH", z: c.z0 + 18 });
    energyLine(c, c.rng.pick(LANES), c.z0 + 12, 3);
  },
  reward_risk(c) {
    // two lanes walled; the open lane holds a big energy line (risk = tight path).
    const open = c.rng.pick(LANES);
    for (const l of LANES) if (l !== open) c.obstacles.push({ id: nextId++, lane: l, type: "WALL", z: c.z0 + 14 });
    energyLine(c, open, c.z0 + 6, 9);
  },
};

const EASY = ["straight_easy", "single_wall", "jump_low", "slide_high"];
const MED = ["single_wall", "jump_low", "slide_high", "pit_gap", "double_switch"];
const HARD = ["double_switch", "combo_chain", "pit_gap", "reward_risk", "three_lane_pressure"];
PATTERNS.three_lane_pressure = (c) => {
  for (const l of LANES) c.obstacles.push({ id: nextId++, lane: l, type: "LOW", z: c.z0 + 7 });
  const blocked = c.rng.pick(LANES);
  c.obstacles.push({ id: nextId++, lane: blocked, type: "WALL", z: c.z0 + 17 });
};

// Block Run patterns: denser + more reward, but still beatable by construction
// (no WALL/PIT across all three lanes, no coincident LOW+HIGH in a lane).
PATTERNS.block_rush = (c) => {
  energyLine(c, 0, c.z0 + 2, 11);                                           // long center reward line
  c.obstacles.push({ id: nextId++, lane: -1, type: "WALL", z: c.z0 + 7 });  // hop out, hop back
  c.obstacles.push({ id: nextId++, lane: 1, type: "WALL", z: c.z0 + 15 });
};
PATTERNS.block_leap = (c) => {
  for (const l of LANES) c.obstacles.push({ id: nextId++, lane: l, type: "LOW", z: c.z0 + 6 });
  for (const l of LANES) c.obstacles.push({ id: nextId++, lane: l, type: "LOW", z: c.z0 + 15 });
  energyLine(c, c.rng.pick(LANES), c.z0 + 9, 4, 1.6); // air orbs between the bars
};
PATTERNS.block_weave = (c) => {
  const a = c.rng.pick(LANES);
  c.obstacles.push({ id: nextId++, lane: a, type: "WALL", z: c.z0 + 6 });
  energyLine(c, a === 0 ? 1 : 0, c.z0 + 4, 5);
  const b = c.rng.pick(LANES);
  c.obstacles.push({ id: nextId++, lane: b, type: "HIGH", z: c.z0 + 16 });
};
const BLOCK = ["block_rush", "block_leap", "block_weave"];

/** Flip gate: the flip lane holds a fat reward behind beatable hazards; the other
 *  lanes are clearly safe so "stay safe" is a real (duller) option. */
function buildFlipGate(c: Ctx, flipLane: number): void {
  // Flip lane: jump a LOW, grab the reward line, slide a HIGH on the way out.
  c.obstacles.push({ id: nextId++, lane: flipLane, type: "LOW", z: c.z0 + 10 });
  energyLine(c, flipLane, c.z0 + 12, 8);
  c.obstacles.push({ id: nextId++, lane: flipLane, type: "HIGH", z: c.z0 + 20 });
  // Safe lanes: a small consolation orb, no hazards.
  for (const l of LANES) if (l !== flipLane) c.energy.push({ id: nextId++, lane: l, z: c.z0 + 12, y: 0 });
}

export class SegmentGenerator {
  constructor(private seed: number) {
    reset();
  }

  /** difficulty 0..1 ramps with segment index (and thus distance/time). */
  private difficulty(index: number): number {
    return Math.min(1, index / 60);
  }

  generate(index: number): Segment {
    // Per-segment RNG derived from seed+index so segments are independent & stable.
    const rng = new SeededRandom(this.seed ^ (index * 2654435761));
    const startZ = index * SEGMENT_LEN;
    const diff = this.difficulty(index);
    const c: Ctx = { rng, z0: startZ, obstacles: [], energy: [], difficulty: diff };
    if (isFlipGateSegment(index)) {
      buildFlipGate(c, flipLaneFor(this.seed, index));
    } else {
      const pool = isBlockRunSegment(index)
        ? BLOCK
        : index < 3 ? ["straight_easy"] : diff < 0.3 ? EASY : diff < 0.6 ? MED : HARD;
      PATTERNS[rng.pick(pool)]!(c);
    }
    return { index, startZ, endZ: startZ + SEGMENT_LEN, obstacles: c.obstacles, energy: c.energy };
  }
}
