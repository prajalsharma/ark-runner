# ARCH RUNNER — Gameplay Polish Audit

Honest audit of the **actual** code (not assumed names), root causes, fixes, tests, status.
Baseline before this pass: 30/30 tests, build ~500KB, Arch untouched, no Arkade.

| # | Problem (observed in code) | Root cause | Fix | Test | Status |
|---|---|---|---|---|---|
| 1 | **Flow from the "wrong side".** `resolveWorld` near-miss branch (`Math.abs(o.lane - lane) === 1`) awards Flow + points for *any* adjacent-lane obstacle of *any* type, no matter how far the player's `laneX` actually is. Running down center farms near-miss Flow off obstacles on both sides every segment. | Near-miss had no proximity test and no threat-type test, so Flow became a distance timer, not skill. | Near-miss now requires a **solid WALL** in an adjacent lane AND the player's `laneX` within `NEAR_MISS_X` of that lane (a genuine close pass, usually mid lane-change). All other adjacent obstacles grant nothing. | `sim.test.ts`: center run past side walls grants **no** near-miss/Flow; a real cut-close does. | FIXED (Phase C) |
| 2 | **Flow is a meaningless number.** Only ever grows; every passed obstacle added Flow. | Same as #1 + no documented source list. | Flow sources are now explicit: perfect dodge, in-lane hazard clear (LOW/HIGH/PIT survived), genuine WALL near-miss, coin. Resets on death (a hit ends the run). Documented in `gameplay.md`. | covered by #1 | FIXED (Phase C) |
| 3 | **Coins vs score conflated in UI.** `collected` (count) and `energy` (score value) both surfaced as "ENERGY". | Player-facing copy mixed the collectible count with its score contribution. | UI renames to **COINS** (count, top-right, with pop) and shows coins' score contribution separately on the result card. Sim unchanged (coins still add to score, now labelled). | manual + HUD | FIXED (Phase C) |
| 4 | **Jump responsiveness.** A jump pressed a few frames before landing is dropped. | `apply("jump")` only fires when already `grounded`; airborne presses are lost. | **Jump buffer**: an airborne jump press is remembered for `JUMP_BUFFER_SECS` and auto-fires on landing. Deterministic (tick-derived), replay-safe. | `sim.test.ts`: buffered jump reproduces on replay. | FIXED (Phase B) |
| 5 | **Coyote time** requested. | N/A — the runner only leaves the ground by jumping (no ledges to walk off; PITs are jumped). | Documented as **not applicable** rather than faked. | — | N/A (honest) |
| 6 | **Frame-rate independence** requested. | Already correct: the sim is a fixed `DT=1/60` deterministic step; the render loop accumulates real time and steps the sim in fixed increments. | No change; confirmed by the determinism tests. | `sim.test.ts` (existing) | ALREADY OK |
| 7 | **Obstacle spacing / reaction time** can be too tight across segment boundaries at top speed. | Patterns place hazards at fixed z per 24u segment with no cross-segment min-gap; a late hazard then an early one can be <0.2s apart at Block-Run speed. | Physics contract (`PHYS` constants incl. derived `maxJumpDistance`); generator enforces a **minimum reaction gap** between required-action hazards. | `patterns.test.ts`: reaction-gap check. | Phase D |
| 8 | **Repetition / "boring after 20s".** ~9 base patterns, no anti-repetition memory, no pacing. | Each segment picks a pattern from a pool independently; no history, no phrases, no scripted opening. | Expanded pattern library (moving/gates/multi-lane/coin-trail), **anti-repetition memory**, a **difficulty director** with pacing phrases, and a scripted first-90s onboarding. | `patterns.test.ts`: no 3-in-a-row identical; still beatable. | Phase D |
| 9 | **Debug visibility** for diagnosing lane/Flow bugs. | None. | **F3 debug overlay**: lane, laneX, y, flow, last Flow source; dev-only. | manual | FIXED (Phase C) |

## Confirmed healthy (do not "fix")
- Deterministic fixed-step sim + replay validation (anti-cheat) — keep.
- Block Run and ARCH FLIP are real deterministic mechanics, not UI labels — keep.
- Lane model is already single-owned: `lane ∈ {-1,0,1}`, `laneX` interpolates to `lane*LANE_WIDTH`, every system derives world-x from that. No dual lane state. (The prompt worried about this; it isn't present.)
- Chain stays isolated behind `GameSettlementProvider`; no Arch call in the frame loop; no Arkade.

## Remaining (later phases, tracked in roadmap)
Landing page / How-to-Play (P1), character select + wallet-linked profile name (P1), richer VFX/Block-Run
spectacle (P2), environment variation (P2), mobile perf pass (P3).
