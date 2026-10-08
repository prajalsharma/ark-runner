/**
 * RunSim — the deterministic ARCH RUNNER simulation. Pure given (seed, input
 * events, constants): the client runs it to play, and the server will re-run the
 * same inputs to validate the score (anti-cheat). No Math.random, no wall-clock —
 * everything advances in fixed DT ticks.
 */
import { SegmentGenerator, isFlipGateSegment, flipLaneFor, type Obstacle, type Energy, type Segment } from "./patterns.ts";
import {
  DT, START_SPEED, MAX_SPEED, SPEED_RAMP, LANE_WIDTH, LANE_SWITCH_SPEED,
  GRAVITY, JUMP_V, JUMP_CLEAR_Y, SLIDE_SECS, PLAYER_DEPTH, SEGMENT_LEN, SPAWN_AHEAD,
  ENERGY_VALUE, DIST_PER_POINT, NEAR_MISS_POINTS, FLOW_PER_ACTION,
  FLOW_MULT_STEP, FLOW_MULT_MAX, FLOW_HYPER_AT,
  isBlockRunSegment, BLOCK_SPEED_MULT, BLOCK_SCORE_MULT,
  PERFECT_LOW_WINDOW, PERFECT_PIT_MAX_Y, PERFECT_SLIDE_FRAC, PERFECT_POINTS,
  FLIP_GATE_OFFSET, FLIP_LEN_SEGS, FLIP_SCORE_MULT, FLIP_BONUS_BASE,
} from "./constants.ts";

export type Action = "left" | "right" | "jump" | "slide";
export type InputEvent = { tick: number; action: Action };

export class RunSim {
  tick = 0;
  distance = 0;
  speed = START_SPEED;
  elapsed = 0;

  lane = 0;          // target lane -1/0/1
  laneX = 0;         // interpolated world x
  y = 0; vy = 0; grounded = true;
  sliding = false; slideTimer = 0;

  score = 0;
  energy = 0;
  collected = 0;
  nearMisses = 0;
  perfects = 0;      // tight same-lane clearances
  flow = 0;          // consecutive clean actions
  flowMult = 1;
  maxFlow = 0;       // peak flow reached this run
  alive = true;
  phase: "live" | "ended" = "live";
  blockRun = false;  // inside a Block Run right now
  blockRuns = 0;     // Block Runs entered this run
  private wasBlock = false;

  flipActive = false; // inside an ARCH FLIP stretch the player committed to
  flips = 0;          // flip stretches survived (banked)
  private flipEndZ = 0;
  private flipArmedSeg = -1;

  readonly seed: number;
  readonly inputs: InputEvent[] = []; // recorded for replay / server validation
  private gen: SegmentGenerator;
  private segs = new Map<number, Segment>();
  private resolved = new Set<number>();
  private cap: number;

  constructor(seed: number, opts: { cap?: number } = {}) {
    this.seed = seed >>> 0;
    this.cap = opts.cap ?? 0; // 0 = endless; >0 = competition soft cap (seconds)
    this.gen = new SegmentGenerator(this.seed);
    this.ensureSegments();
  }

  /** Queue + record an action at the current tick. */
  input(a: Action): void {
    if (!this.alive) return;
    this.inputs.push({ tick: this.tick, action: a });
    this.apply(a);
  }

  private apply(a: Action): void {
    switch (a) {
      case "left": this.lane = Math.max(-1, this.lane - 1); break;
      case "right": this.lane = Math.min(1, this.lane + 1); break;
      case "jump": if (this.grounded) { this.vy = JUMP_V; this.grounded = false; } break;
      case "slide": if (this.grounded) { this.sliding = true; this.slideTimer = SLIDE_SECS; } break;
    }
  }

  /** Advance exactly one fixed tick. */
  step(): void {
    if (!this.alive) return;
    this.tick++;
    this.elapsed += DT;

    // Block Run is a deterministic function of the segment we're currently in.
    const curSeg = Math.floor(this.distance / SEGMENT_LEN);
    this.blockRun = isBlockRunSegment(curSeg);
    if (this.blockRun && !this.wasBlock) this.blockRuns++;
    this.wasBlock = this.blockRun;

    const base = Math.min(MAX_SPEED, START_SPEED + SPEED_RAMP * this.elapsed);
    this.speed = this.blockRun ? Math.min(MAX_SPEED * BLOCK_SPEED_MULT, base * BLOCK_SPEED_MULT) : base;
    const prevDist = this.distance;
    this.distance += this.speed * DT;
    this.checkFlipGate(prevDist, this.distance);

    // Lane slide.
    const targetX = this.lane * LANE_WIDTH;
    const dx = targetX - this.laneX;
    const maxStep = LANE_SWITCH_SPEED * DT;
    this.laneX += Math.abs(dx) <= maxStep ? dx : Math.sign(dx) * maxStep;

    // Vertical.
    if (!this.grounded) {
      this.vy -= GRAVITY * DT;
      this.y += this.vy * DT;
      if (this.y <= 0) { this.y = 0; this.vy = 0; this.grounded = true; }
    }
    if (this.sliding) { this.slideTimer -= DT; if (this.slideTimer <= 0) this.sliding = false; }

    this.ensureSegments();
    this.flowMult = Math.min(FLOW_MULT_MAX, 1 + this.flow * FLOW_MULT_STEP);
    const gain = (this.blockRun ? BLOCK_SCORE_MULT : 1) * (this.flipActive ? FLIP_SCORE_MULT : 1);
    this.score += this.speed * DT * DIST_PER_POINT * this.flowMult * gain; // distance, flow/block/flip-scaled
    this.resolveWorld(gain);
    if (this.flow > this.maxFlow) this.maxFlow = this.flow;

    // Survived the flip stretch → bank the bonus.
    if (this.flipActive && this.distance >= this.flipEndZ) {
      this.flipActive = false;
      this.flips++;
      this.score += FLIP_BONUS_BASE * this.flowMult;
    }

    if (this.cap && this.elapsed >= this.cap) this.end(true);
  }

  get hyperFlow(): boolean { return this.flow >= FLOW_HYPER_AT; }
  get maxFlowMult(): number { return Math.min(FLOW_MULT_MAX, 1 + this.maxFlow * FLOW_MULT_STEP); }

  private ensureSegments(): void {
    const cur = Math.floor(this.distance / SEGMENT_LEN);
    for (let i = Math.max(0, cur); i <= cur + SPAWN_AHEAD; i++) {
      if (!this.segs.has(i)) this.segs.set(i, this.gen.generate(i));
    }
    for (const k of this.segs.keys()) if (k < cur - 1) this.segs.delete(k);
  }

  private laneAligned(): boolean {
    return Math.abs(this.laneX - this.lane * LANE_WIDTH) < 0.85;
  }

  private resolveWorld(gain: number): void {
    const z = this.distance;
    for (const seg of this.segs.values()) {
      for (const o of seg.obstacles) {
        if (this.resolved.has(o.id) || o.z > z + PLAYER_DEPTH) continue; // ahead → not reached
        this.resolved.add(o.id);
        if (o.lane === this.lane && this.laneAligned()) {
          const hit =
            o.type === "WALL" ? true :
            o.type === "LOW" ? this.y < JUMP_CLEAR_Y :
            o.type === "HIGH" ? !this.sliding :
            /* PIT */ this.y < 0.25;
          if (hit) { this.end(false); return; }
          // Perfect Dodge: beat the hazard with the tightest margin.
          const perfect =
            o.type === "LOW" ? this.y < JUMP_CLEAR_Y + PERFECT_LOW_WINDOW :
            o.type === "PIT" ? this.y < PERFECT_PIT_MAX_Y :
            o.type === "HIGH" ? this.slideTimer > SLIDE_SECS * PERFECT_SLIDE_FRAC :
            false;
          if (perfect) { this.perfects++; this.score += PERFECT_POINTS * this.flowMult * gain; this.addFlow(); }
          this.addFlow(); // dodged in-lane = a clean action
        } else if (Math.abs(o.lane - this.lane) === 1) {
          this.nearMisses++;
          this.score += NEAR_MISS_POINTS * this.flowMult * gain;
          this.addFlow();
        }
      }
      for (const e of seg.energy) {
        if (this.resolved.has(e.id) || e.z > z + PLAYER_DEPTH) continue;
        this.resolved.add(e.id);
        if (e.lane === this.lane && this.laneAligned() && Math.abs(this.y - e.y) < 0.95) {
          this.collected++;
          this.energy += ENERGY_VALUE;
          this.score += ENERGY_VALUE * this.flowMult * gain;
          this.addFlow();
        }
      }
    }
  }

  private addFlow(): void { this.flow += FLOW_PER_ACTION; }

  /** Crossing a flip gate in the flip lane commits the player to the flip stretch. */
  private checkFlipGate(prevDist: number, z: number): void {
    const consider = (s: number): void => {
      if (s < 0 || this.flipArmedSeg === s || !isFlipGateSegment(s)) return;
      const gateZ = s * SEGMENT_LEN + FLIP_GATE_OFFSET;
      if (prevDist < gateZ && z >= gateZ) {
        this.flipArmedSeg = s; // this gate is now spent, whatever the choice
        if (this.lane === flipLaneFor(this.seed, s)) {
          this.flipActive = true;
          this.flipEndZ = s * SEGMENT_LEN + FLIP_LEN_SEGS * SEGMENT_LEN;
        }
      }
    };
    const sPrev = Math.floor(prevDist / SEGMENT_LEN);
    consider(sPrev);
    consider(sPrev + 1);
  }

  /** Upcoming flip gates in render range (for drawing the gate marker only). */
  flipGatesInView(): { z: number; lane: number }[] {
    const out: { z: number; lane: number }[] = [];
    const start = Math.max(0, Math.floor((this.distance - 4) / SEGMENT_LEN));
    for (let s = start; s <= start + 4; s++) {
      if (isFlipGateSegment(s)) out.push({ z: s * SEGMENT_LEN + FLIP_GATE_OFFSET, lane: flipLaneFor(this.seed, s) });
    }
    return out;
  }

  private end(_capped: boolean): void {
    this.alive = false;
    this.phase = "ended";
  }

  /** Objects within a render window ahead of the player (for drawing only). */
  view(): { obstacles: Obstacle[]; energy: Energy[] } {
    const z = this.distance;
    const obstacles: Obstacle[] = [];
    const energy: Energy[] = [];
    for (const seg of this.segs.values()) {
      for (const o of seg.obstacles) if (o.z > z - 4 && o.z < z + 60) obstacles.push(o);
      for (const e of seg.energy) if (!this.resolved.has(e.id) && e.z > z - 2 && e.z < z + 60) energy.push(e);
    }
    return { obstacles, energy };
  }
}
