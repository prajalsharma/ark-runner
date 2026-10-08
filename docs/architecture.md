# ARK RUNNER — Architecture

## Principle: deterministic core, thin presentation, isolated blockchain
The simulation is **pure and deterministic** (seed + inputs + frozen constants ⇒ identical result).
This single decision powers three things at once: **fair competition** (same daily seed = same world),
**replay/anti-cheat** (server re-runs inputs), and **smooth rendering** (fixed-step sim, interpolated draw).

```
InputSystem ─▶ RunSim (deterministic, fixed DT) ─▶ Renderer (Three.js, read-only)
                     │                                   │
                     └── records InputEvent[] ──▶ (Phase 4) server replay → official score
```

## Current code (Phase 1 — greybox, shipped)
- `src/engine/rng.ts` — `SeededRandom` (mulberry32) + `seedFromString` (daily seeds).
- `src/game/constants.ts` — frozen `ARKRUN_V1` tuning (speed, gravity, flow, scoring).
- `src/game/patterns.ts` — `SegmentGenerator` + pattern library; every pattern beatable (tested).
- `src/game/sim.ts` — `RunSim`: player state, input, collision, energy, near-miss, flow, score, death.
  Pure; records `inputs[]` for replay.
- `src/game/render.ts` — `Renderer`: pooled Three.js meshes, Arch palette, camera follow. No gameplay.
- `src/engine/input.ts` — keyboard + swipe → actions.
- `src/game/game.ts` — orchestrator: fixed-step accumulator loop + HUD + restart.
- `src/ui.ts` — HUD + result overlay (DOM). `src/main.ts` — title → run.

## Eventual engine systems (Phases 2–3)
`DifficultySystem · FlowSystem (in sim) · BlockRun · ArkFlip · CameraSystem · AudioSystem · VFXSystem · ReplaySystem`.
Keep React (if added for menus) out of the per-frame path; the engine is framework-free TS.

## Backend (Phases 4–6) — hackathon-friendly, not microservice soup
`apps/web` (menus, leaderboard, wallet UI) · `apps/game` (this engine) · `apps/api` (one service, modular):
Auth · Player · Run · Score(validate via replay) · Competition(state machine) · Leaderboard · AntiCheat ·
Economy · **Arch** · Settlement · Scheduler. **PostgreSQL** (authoritative, financial tables strongly
consistent) + **Redis** (live leaderboards, rate limits, job queues — never the ledger).

## Blockchain isolation
`packages/arch` wraps the SDK behind a `GameSettlementProvider` interface with two impls:
`MockSettlementProvider` (dev/demo — `MOCK_BLOCKCHAIN=true`) and `ArchSettlementProvider`
(`@arch-network/arch-sdk`). The engine never imports Arch. See `arch-capabilities.md`, `settlement-design.md`.

## Determinism rules (enforced)
Fixed `DT = 1/60`; no `Math.random` in gameplay (only `SeededRandom`); no wall-clock in the sim
(`elapsed` accrues from DT); inputs are the only nondeterminism and are recorded with their tick.
`tests/sim.test.ts` proves replay reproduces the exact score; `tests/patterns.test.ts` proves no
impossible segment.
