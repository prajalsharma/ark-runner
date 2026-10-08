/**
 * ARK RUNNER — frozen gameplay constants (ARKRUN_V1). The simulation is
 * deterministic: same seed + same inputs + these constants ⇒ same result,
 * on the client and on the server replay.
 */
export const RULESET = "ARKRUN_V1";

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
