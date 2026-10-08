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

## Phase 2b — ARCH FLIP ✅ (shipped)
**ARCH FLIP**: the opt-in risk/reward gateway, deterministic + replay-safe. A glowing gate appears in one
seed-chosen lane; entering that lane commits you to a short, harder stretch at **×3 score**, banking a
flow-scaled bonus if you survive it (die and you lose it — that's the risk). The choice, not the world, is
the only variable, so replays reproduce exactly (tested). Gold world tint + gate markers + riser/chime SFX +
HUD chip + toasts. Never coincides with a Block Run.

## Phase 2c — Remaining vertical-slice polish (deferred)
Tutorial onboarding. Settings, colorblind-safe palette, adjustable sensitivity. A second environment theme.
Particles. Perf budget on mid-tier mobile. (Picked up after the MVP/backend phases.)

## Phase 3 — MVP game (no money yet) ✅ (shipped)
**Daily Block** on a shared UTC-date seed (same world for everyone that day; bounded by MATCH_SECONDS so
scores compare), with a **DAILY BLOCK #N** counter. **Free Run** mode. Local records: today's daily best +
last-20 run history (localStorage, degrades cleanly). **Cosmetic skins** (earned by all-time best, never
pay-to-win, never touch score) selectable on the title. **Share card** (native share / clipboard). Title
screen with mode select + skins + recent runs; result card shows mode, daily #, today's best, SHARE + MENU.
Tests: daily seed is a pure function of the date and gives everyone the same world.

## Phase 4 — Backend + anti-cheat ✅ (core shipped; infra deferred)
Shipped and tested: **server-side replay validator** (`src/server/validate.ts`) — never trusts a client
score; re-runs the canonical deterministic sim for the official score, with version pinning, input sanity
(monotonic ticks, valid actions), a bot rate-limit, and fraud flags. **Competition state machine**
(`src/server/competition.ts`) with guarded transitions (CREATED→…→SETTLED, + SETTLEMENT_FAILED retry) and a
**validated-only leaderboard** (best-per-player, sorted). Shared **contracts** (`src/shared/contracts.ts`), a
shared **replay runner** (`src/game/replay.ts`), a dependency-free **HTTP API** (`npm run serve`: `/validate`,
`/daily`, `/health`), and an **optional client submit** that degrades to offline when no backend is set.
Tests: honest run validates to its exact score; tampered score / wrong ruleset / impossible input rejected;
illegal transitions throw; leaderboard takes only validated runs. Deferred: PostgreSQL + Redis persistence,
auth, scheduler, horizontal scale.

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
