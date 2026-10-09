# ARCH RUNNER — Gameplay Root-Cause Report

**Method:** real browser QA (Playwright driving the system Google Chrome against the live dev server),
with screenshots inspected, not guessed. Harness: `scripts/qa-playtest.mjs` (outputs to `qa-shots/`,
gitignored). Unit tests: `npm test` (45 passing).

## P0-1 — "Mysterious circle in the middle of gameplay" → ROOT CAUSE FOUND + FIXED (verified)
- **What it actually is:** the **Arch ring-gate** in `src/game/cityscape.ts` — a full `TorusGeometry`
  (radius 5.2, bright orange, high emissive) centred at y=2.4 (floating). Four of them scrolled with a 70-unit
  period, so **two overlapped on screen at once**, reading as big glowing rings/circles floating in the lane.
  Confirmed by screenshot (`qa-gameplay-1`): a bright orange ring dominating the corridor.
- **Not a pool/stale-transform bug** — it's an intentional decorative entity presented badly.
- **Fix:** replaced the full ring with a **half-torus (semicircular archway)** grounded at the floor with two
  pillars, dimmer/structural material (low emissive), 3 gates spaced on a 120-unit period (one in view at a
  time). It now reads as a stone gateway you run through. **Verified** by re-running the playtest — screenshot
  shows a clear archway, no floating circle.
- **Regression guard:** `cityscape.ts` gate geometry is a partial torus + pillars; the QA harness screenshots
  gameplay for visual re-check each run.

## P0-2 — "Collecting coins → run ends" → ALREADY FIXED (not reproduced)
- The earlier real bug (coins marked `resolved` on pass, hiding uncollected side coins) was fixed in commit
  `fc86f9d`; coins are now resolved only on collection, within a z-window. `tests/coins.test.ts` proves a
  side-lane coin never vanishes and the count is monotonic.
- In live QA the run ended **legitimately on a LOW bar** ("CAUGHT THE LOW BAR — jump it"), never on a coin.
  Coins and obstacles are separate loops in `RunSim.resolveWorld`; coin collection cannot call death logic.
  **Not reproduced.**

## P0-3 — "Random crashes / premature game over / instability" → NOT REPRODUCED (monitored)
- Playwright captured console + page errors across full run→death→result cycles: **no uncaught exceptions,
  no WebGL errors, no crash** — only two benign `404` resource logs (favicon/source-map).
- Death → death-cam → result card is stable and shows the real cause. No duplicate game-over.
- **Residual risk (documented, not yet reproduced):** each `new Game` creates a WebGL context and `stop()`
  disposes it (`forceContextLoss`); over *many* menu↔game cycles this could pressure context limits. A single
  reused renderer would be the hardening step. Not observed in QA.

## Observations (not P0) for later phases
- The world now has a city (side towers, floor grid, archway, character, coins) — **not** a black empty room,
  but the buildings are still basic flat slabs (world-depth pass is a P2/P3 polish item).
- The runner character renders as a recognizable jointed figure.
- The cinematic donut/Auditor cutscene and the full economy rebuild (from the latest brief) remain to do.

## Checks I could NOT perform here
- No real mobile-device testing (desktop Chrome via Playwright only).
- Long-session soak / FPS profiling under load not run (adaptive-perf logic exists but unmeasured here).
