/**
 * Deterministic replay runner — the single engine both the client (to play) and the
 * server (to validate) use. Feed a seed + a recorded input stream and it reproduces
 * the exact run. A hard tick ceiling guards the server against unbounded input.
 */
import { RunSim, type Action } from "./sim.ts";
import { MATCH_SECONDS, TICK_HZ } from "./constants.ts";

/** Upper bound on how long any replay may run (competition cap + a small margin). */
export const MAX_REPLAY_TICKS = Math.ceil(MATCH_SECONDS * TICK_HZ) + TICK_HZ;

export function replayRun(
  seed: number,
  inputs: ReadonlyArray<{ tick: number; action: string }>,
  cap = MATCH_SECONDS,
): RunSim {
  const s = new RunSim(seed, { cap });
  let k = 0;
  for (let t = 0; t < MAX_REPLAY_TICKS; t++) {
    while (k < inputs.length && inputs[k]!.tick === s.tick) { s.input(inputs[k]!.action as Action); k++; }
    s.step();
    if (!s.alive) break;
  }
  return s;
}
