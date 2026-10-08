# ARK RUNNER — Roadmap

Fun first, chain second. Each phase is independently shippable.

## Phase 1 — Greybox ✅ (shipped)
Deterministic `RunSim`, seeded `SegmentGenerator` (all patterns beatable), 3-lane move/jump/slide,
collision, energy, near-miss, **ARK FLOW** multiplier, score, death, result overlay, Three.js render,
keyboard + swipe input, title → run. Tests: replay-reproduces-score + no-impossible-segment, both passing.

## Phase 2 — Vertical slice (feel + wow)
Juice: camera shake/FOV on speed, hit feedback, particles, audio, **Hyper Flow** intensity.
**Block Run** (block-tunnel burst) and **ARK FLIP** (skill-based bank-or-flip gateway). Tutorial onboarding.
Settings, pause, accessibility (reduced motion, colorblind-safe palette). Perf budget on mid-tier mobile.

## Phase 3 — MVP game (no money yet)
Daily Challenge on a shared **daily seed**, local leaderboards, cosmetics (non-pay-to-win), run history,
share card. Ship as a genuinely good free game before any wallet appears.

## Phase 4 — Backend + anti-cheat
`apps/api` (modular monolith): Auth, Player, Run, **Score (replay-validated)**, Competition state machine,
Leaderboard, AntiCheat, Scheduler. PostgreSQL (authoritative) + Redis (live boards, rate limits, queues).
Server owns seeds; client submits `{seed, inputs}`. See `anti-cheat.md`.

## Phase 5 — Arch economy (behind the provider)
`packages/arch` implements `ArchSettlementProvider` over `@arch-network/arch-sdk` 0.0.28, reusing the
**proven Scramble escrow**: per-competition PDA holds the pot in its ATA; program-signed payout to winners'
forced ATAs; reclaim/timeout escape hatch. BIP-322 wallet connect (UniSat/Xverse inline), Buffer polyfill,
`request_airdrop` for rent. Entry fees + prizes in aBTC/aUSD. Economy simulations pick the prize structure.

## Phase 6 — Competitions live
Hourly/weekly windows, prize pools, optional commit-reveal lucky-runner, settlement verification UI,
solvency monitoring, legal review gate before any real-money mode. Free + demo modes always default.
