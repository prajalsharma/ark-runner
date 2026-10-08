/**
 * ARCH RUNNER — frozen gameplay constants (ARCHRUN_V1). The simulation is
 * deterministic: same seed + same inputs + these constants ⇒ same result,
 * on the client and on the server replay.
 */
export const RULESET = "ARCHRUN_V1";

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

// Lanes: -1 (left), 0 (center), 1 (right).
export const LANES = [-1, 0, 1] as const;
export const LANE_WIDTH = 2.2;
export const LANE_SWITCH_SPEED = 12; // units/sec the runner slides between lanes

// Forward motion. Speed ramps with distance travelled.
export const START_SPEED = 14; // units/sec
export const MAX_SPEED = 42;
export const SPEED_RAMP = 0.22; // speed gained per second
export const PLAYER_DEPTH = 0.9; // collision half-length along Z

// Jump / slide.
export const GRAVITY = 52;
export const JUMP_V = 15.5;
export const JUMP_CLEAR_Y = 1.1; // must be above this to clear a LOW obstacle / PIT
export const SLIDE_SECS = 0.6;

// Obstacles.
export type ObstacleType = "WALL" | "LOW" | "HIGH" | "PIT";
export const OBSTACLE_H = { WALL: 2.4, LOW: 0.9, HIGH: 2.6, PIT: 0.1 } as const;

// Collectibles.
export const ENERGY_VALUE = 10;
export const ENERGY_AIR_Y = 1.6; // some orbs float — jump to grab

// Scoring.
export const DIST_PER_POINT = 1; // 1 point per unit of distance
export const NEAR_MISS_DIST = 0.7; // passing an obstacle in an adjacent lane this close = near miss
export const NEAR_MISS_POINTS = 25;

// Flow (signature mechanic). Each clean action adds flow; a hit resets it.
export const FLOW_PER_ACTION = 1;
export const FLOW_HYPER_AT = 10; // actions to reach Hyper Flow
export const FLOW_MULT_STEP = 0.15; // multiplier gained per flow point (capped)
export const FLOW_MULT_MAX = 4;

// Segment generation.
export const SEGMENT_LEN = 24; // world units per generated segment
export const SPAWN_AHEAD = 6; // keep this many segments generated ahead
export const MATCH_SECONDS = 180; // competition-mode soft cap (endless otherwise)

// Block Run — periodic high-speed spectacle. Driven purely by segment index, so
// it is deterministic and reproduces exactly on the server replay.
export const BLOCK_START_SEG = 8;    // no block runs during the learning phase
export const BLOCK_PERIOD_SEGS = 16; // one block run per this many segments
export const BLOCK_LEN_SEGS = 3;     // how many segments a block run lasts
export const BLOCK_SPEED_MULT = 1.3; // speed boost while in a block run
export const BLOCK_SCORE_MULT = 2;   // all points doubled during a block run

/** True when segment `index` falls inside a Block Run band. Pure + deterministic. */
export function isBlockRunSegment(index: number): boolean {
  if (index < BLOCK_START_SEG) return false;
  return (index % BLOCK_PERIOD_SEGS) >= (BLOCK_PERIOD_SEGS - BLOCK_LEN_SEGS);
}

// ARCH FLIP — opt-in risk/reward. At a flip gate the player chooses by lane: enter
// the flip lane to commit to a short, harder stretch at a big multiplier, banking a
// bonus if they survive it. Deterministic (gate + lane derive from seed + index), so
// the choice — not the world — is the only variable, and replays reproduce exactly.
export const FLIP_START_SEG = 6;
export const FLIP_PERIOD_SEGS = 11; // a flip gate roughly this often
export const FLIP_GATE_OFFSET = 4;  // z within the segment where the gate triggers
export const FLIP_LEN_SEGS = 2;     // how long the flip stretch lasts
export const FLIP_SCORE_MULT = 3;   // points multiplier while a flip is live
export const FLIP_BONUS_BASE = 400; // banked (× flowMult) on surviving the stretch

// Perfect Dodge — tight clearance of a same-lane hazard (skill reward).
export const PERFECT_LOW_WINDOW = 0.5;  // cleared a LOW by <= this margin above JUMP_CLEAR_Y
export const PERFECT_PIT_MAX_Y = 0.95;  // cleared a PIT this low = barely made it
export const PERFECT_SLIDE_FRAC = 0.72; // slid under a HIGH within the first part of the slide = last-moment
export const PERFECT_POINTS = 60;

// Presentation only (render/audio) — never read by the sim, so it can't affect scores.
export const FOV_BASE = 62;
export const FOV_MAX = 73;   // approached at MAX_SPEED
export const FOV_BLOCK = 6;  // extra FOV while in a block run
