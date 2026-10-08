# ARCH RUNNER — Roadmap

Fun first, chain second. Each phase is independently shippable.

## Phase 1 — Greybox ✅ (shipped)
Deterministic `RunSim`, seeded `SegmentGenerator` (all patterns beatable), 3-lane move/jump/slide,
collision, energy, near-miss, **ARCH FLOW** multiplier, score, death, result overlay, Three.js render,
keyboard + swipe input, title → run. Tests: replay-reproduces-score + no-impossible-segment, both passing.

## Phase 2a — Feel + first "wow" ✅ (shipped)
**Block Run** (deterministic periodic high-speed band: ×1.3 speed, ×2 score, denser-but-beatable patterns,
world recolour + FOV kick + speed streaks). **Perfect Dodge** (tight same-lane clearance → bonus + extra flow).
Juice: FOV ramps with speed, camera shake on impact/near-miss/death, **Hyper Flow** glow, Block Run tint.
Procedural **audio** (WebAudio synth: event blips + speed-tracking engine hum, mute). **Pause** (Esc/P), mute
(M / button), reduced-motion respected. Richer result card (perfects, block runs, max flow). Tests: Block Run +
all new counters reproduce exactly on replay; pattern-fairness still holds. Determinism preserved (sim stays pure;
feedback is counter-diffed in the orchestrator).

## Phase 2b — Remaining vertical-slice work
**ARCH FLIP** (lane-choice risk/reward gateway, deterministic + replay-safe). Tutorial onboarding. Settings,
colorblind-safe palette, adjustable sensitivity. A second environment theme. Particles. Perf budget on mid-tier mobile.

## Phase 3 — MVP game (no money yet)
Daily Challenge on a shared **daily seed**, local leaderboards, cosmetics (non-pay-to-win), run history,
share card. Ship as a genuinely good free game before any wallet appears.

## Phase 4 — Backend + anti-cheat
`apps/api` (modular monolith): Auth, Player, Run, **Score (replay-validated)**, Competition state machine,
Leaderboard, AntiCheat, Scheduler. PostgreSQL (authoritative) + Redis (live boards, rate limits, queues).
Server owns seeds; client submits `{seed, inputs}`. See `anti-cheat.md`.

## Phase 5 — Arch economy (behind the provider)
`packages/arch` implements `ArchSettlementProvider` over `@arch-network/arch-sdk` 0.0.28, with the settlement
program written in **Satellite** (`arch-satellite-*` 0.31, `arch_program` 0.12, `cargo build-sbf`, deploy via
`arch-kit`), reusing the **escrow pattern proven E2E in our prior Scramble work**: per-competition PDA holds the
pot in its ATA; program-signed payout to winners' forced ATAs; reclaim/timeout escape hatch. BIP-322 Bitcoin
wallet connect (Xverse/UniSat/Leather/OKX); `requestAirdrop` for account rent. Entry fees + prizes in **our own
APL token** (we mint + fund it — no protocol-native asset). Economy simulations pick the prize structure.

## Phase 6 — Competitions live
Hourly/weekly windows, prize pools, optional commit-reveal lucky-runner, settlement verification UI,
solvency monitoring, legal review gate before any real-money mode. Free + demo modes always default.
