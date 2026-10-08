/**
 * Procedural segment generation — "designed procedural content", not random blocks.
 * Deterministic (seed + segmentIndex), so Daily Block is identical for everyone and
 * server replay reproduces exactly. Guarantees:
 *  - every segment is BEATABLE (no 3-lane WALL/PIT wall, no coincident LOW+HIGH);
 *  - hazards sit in a band [z0+6, z0+18] so consecutive same-lane hazards are always
 *    >= ~12 units apart (fair reaction time) — block/flip stretches are the designed
 *    expert exception;
 *  - a scripted teaching opening, pacing "phrases", and anti-repetition memory
 *    (never the same pattern 3 segments running) keep runs varied.
 * tests/patterns.test.ts verifies beatability, reaction spacing, and variety.
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

const wall = (c: Ctx, lane: number, z: number): void => void c.obstacles.push({ id: nextId++, lane, type: "WALL", z });
const hazard = (c: Ctx, lane: number, type: ObstacleType, z: number): void => void c.obstacles.push({ id: nextId++, lane, type, z });
function energyLine(c: Ctx, lane: number, z: number, n: number, y = 0): void {
  for (let i = 0; i < n; i++) c.energy.push({ id: nextId++, lane, z: z + i * 1.6, y });
}
const SIDES = [-1, 1] as const;

/** Pattern library. Each fills a ~SEGMENT_LEN window; hazards stay within [z0+6, z0+18]. */
const PATTERNS: Record<string, (c: Ctx) => void> = {
  // --- flowy / breather (no hazards) ---
  straight_easy(c) { energyLine(c, c.rng.pick(LANES), c.z0 + 6, 6); },
  coin_switch(c) { energyLine(c, c.rng.pick(SIDES), c.z0 + 6, 6); },           // coins off-center → teach lane change
  coin_trail(c) {                                                              // zigzag coins guide movement
    energyLine(c, 0, c.z0 + 4, 3);
    energyLine(c, c.rng.pick(SIDES), c.z0 + 9, 3);
    energyLine(c, 0, c.z0 + 14, 3);
  },
  // --- single mechanic ---
  single_wall(c) {
    const blocked = c.rng.pick(LANES);
    wall(c, blocked, c.z0 + 12);
    for (const l of LANES) if (l !== blocked) energyLine(c, l, c.z0 + 10, 3);
  },
  jump_low(c) { for (const l of LANES) hazard(c, l, "LOW", c.z0 + 12); energyLine(c, c.rng.pick(LANES), c.z0 + 12, 3, 1.6); },
  slide_high(c) { for (const l of LANES) hazard(c, l, "HIGH", c.z0 + 12); energyLine(c, c.rng.pick(LANES), c.z0 + 16, 3); },
  pit_gap(c) {
    const safe = c.rng.pick(LANES);
    for (const l of LANES) if (l !== safe) hazard(c, l, "PIT", c.z0 + 12);
    energyLine(c, safe, c.z0 + 7, 5);
  },
  pit_hop(c) {                                                                 // jump a pit, air coins reward it
    const l = c.rng.pick(LANES);
    hazard(c, l, "PIT", c.z0 + 12);
    energyLine(c, l, c.z0 + 9, 4, 1.6);
    for (const o of LANES) if (o !== l) energyLine(c, o, c.z0 + 7, 2);
  },
  // --- route choice ---
  gate_choice(c) {                                                             // center blocked → pick a side
    wall(c, 0, c.z0 + 12);
    for (const l of SIDES) energyLine(c, l, c.z0 + 7, 4);
  },
  reward_risk(c) {                                                             // one open lane holds a fat line
    const open = c.rng.pick(LANES);
    for (const l of LANES) if (l !== open) wall(c, l, c.z0 + 14);
    energyLine(c, open, c.z0 + 6, 8);
  },
  high_low_lane(c) {                                                           // slide one lane / jump another / dodge third
    const a = c.rng.pick(LANES);
    let b = c.rng.pick(LANES); if (b === a) b = LANES[(LANES.indexOf(a) + 1) % 3]!;
    hazard(c, a, "HIGH", c.z0 + 8);   // staggered depths so no single depth needs jump+slide
    hazard(c, b, "LOW", c.z0 + 16);
    const open = LANES.find((l) => l !== a && l !== b)!;
    energyLine(c, open, c.z0 + 7, 4);
  },
  // --- pressure ---
  double_switch(c) {
    const a = c.rng.pick(LANES);
    let b = c.rng.pick(LANES); if (b === a) b = LANES[(LANES.indexOf(a) + 1) % 3]!;
    wall(c, a, c.z0 + 8); wall(c, b, c.z0 + 16);
  },
  zigzag_walls(c) {                                                            // alternating side walls, center always open
    const a = c.rng.pick(SIDES);
    wall(c, a, c.z0 + 7); wall(c, -a, c.z0 + 16);
    energyLine(c, 0, c.z0 + 6, 6);
  },
  combo_chain(c) {                                                             // jump then slide — rhythm (12u apart)
    for (const l of LANES) hazard(c, l, "LOW", c.z0 + 6);
    for (const l of LANES) hazard(c, l, "HIGH", c.z0 + 18);
    energyLine(c, c.rng.pick(LANES), c.z0 + 12, 2);
  },
  three_lane_pressure(c) {
    for (const l of LANES) hazard(c, l, "LOW", c.z0 + 6);
    wall(c, c.rng.pick(LANES), c.z0 + 18);
  },
  // --- Block Run (dense, designed-expert; excluded from the strict reaction test) ---
  block_rush(c) { energyLine(c, 0, c.z0 + 2, 11); wall(c, -1, c.z0 + 7); wall(c, 1, c.z0 + 15); },
  block_leap(c) {
    for (const l of LANES) hazard(c, l, "LOW", c.z0 + 6);
    for (const l of LANES) hazard(c, l, "LOW", c.z0 + 15);
    energyLine(c, c.rng.pick(LANES), c.z0 + 9, 4, 1.6);
  },
  block_weave(c) {
    const a = c.rng.pick(LANES);
    wall(c, a, c.z0 + 6); energyLine(c, a === 0 ? 1 : 0, c.z0 + 4, 5);
    let b = c.rng.pick(LANES); if (b === a) b = LANES[(LANES.indexOf(a) + 1) % 3]!;
    hazard(c, b, "HIGH", c.z0 + 16);
  },
};

// Pacing "phrases" — give the run emotional rhythm instead of a flat difficulty ramp.
const FLOW = ["straight_easy", "coin_trail", "coin_switch", "single_wall"];
const CHOICE = ["gate_choice", "reward_risk", "high_low_lane", "zigzag_walls"];
const TECHNICAL = ["jump_low", "slide_high", "combo_chain", "pit_hop"];
const BREATHER = ["coin_trail", "straight_easy", "coin_switch"];
const RISK = ["double_switch", "zigzag_walls", "three_lane_pressure", "reward_risk"];
const PHRASES = [FLOW, CHOICE, TECHNICAL, BREATHER, RISK];
const BLOCK = ["block_rush", "block_leap", "block_weave"];

// Curated opening — teach one thing at a time (move → lane → dodge → jump → slide → breather).
const INTRO_SCRIPT = ["straight_easy", "coin_switch", "single_wall", "jump_low", "slide_high", "coin_trail"];

/** Flip gate: the flip lane holds a fat reward behind beatable hazards; other lanes are safe. */
function buildFlipGate(c: Ctx, flipLane: number): void {
  hazard(c, flipLane, "LOW", c.z0 + 10);
  energyLine(c, flipLane, c.z0 + 12, 7);
  hazard(c, flipLane, "HIGH", c.z0 + 18);
  for (const l of LANES) if (l !== flipLane) c.energy.push({ id: nextId++, lane: l, z: c.z0 + 12, y: 0 });
}

export class SegmentGenerator {
  constructor(private seed: number) { reset(); }

  private difficulty(index: number): number { return Math.min(1, index / 60); }

  private nameRng(index: number): SeededRandom { return new SeededRandom(((this.seed >>> 0) ^ (index * 2246822519)) >>> 0); }

  private phrasePool(index: number): string[] {
    const p = Math.floor((index - INTRO_SCRIPT.length) / 3) % PHRASES.length;
    const pool = PHRASES[(p + PHRASES.length) % PHRASES.length]!;
    return pool === RISK && index < 18 ? CHOICE : pool; // ease players in before the RISK phrase
  }

  /** The pattern a segment would use before anti-repetition. Pure (seed+index). */
  private rawName(index: number): string {
    if (isFlipGateSegment(index)) return "flip_gate";
    if (isBlockRunSegment(index)) return this.nameRng(index).pick(BLOCK);
    if (index < INTRO_SCRIPT.length) return INTRO_SCRIPT[index]!;
    return this.nameRng(index).pick(this.phrasePool(index));
  }

  /** Avoid the same pattern 3 segments running (only in the free phrase region). */
  private resolvedName(index: number): string {
    const name = this.rawName(index);
    if (index < INTRO_SCRIPT.length || isFlipGateSegment(index) || isBlockRunSegment(index)) return name;
    const prev1 = this.rawName(index - 1), prev2 = this.rawName(index - 2);
    if (name !== prev1 && name !== prev2) return name;
    const pool = this.phrasePool(index);
    const start = Math.max(0, pool.indexOf(name));
    for (let k = 1; k <= pool.length; k++) {
      const cand = pool[(start + k) % pool.length]!;
      if (cand !== prev1 && cand !== prev2) return cand;
    }
    return name;
  }

  /** The pattern name actually used at a segment (post anti-repetition). For tests/debug. */
  patternNameAt(index: number): string { return this.resolvedName(index); }

  generate(index: number): Segment {
    const rng = new SeededRandom(this.seed ^ (index * 2654435761));
    const startZ = index * SEGMENT_LEN;
    const c: Ctx = { rng, z0: startZ, obstacles: [], energy: [], difficulty: this.difficulty(index) };
    const name = this.resolvedName(index);
    if (name === "flip_gate") buildFlipGate(c, flipLaneFor(this.seed, index));
    else PATTERNS[name]!(c);
    return { index, startZ, endZ: startZ + SEGMENT_LEN, obstacles: c.obstacles, energy: c.energy };
  }
}
