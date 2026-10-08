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

## Landing / Main Menu ✅ (shipped — P1)
A real front page, not a dev dashboard: a **live 3D attract scene** (the real renderer + sim with an autopilot
that weaves/jumps/slides) runs behind a hero — title, "RUN THE BLOCK · MASTER THE FLOW", **PLAY DAILY BLOCK #N**
+ FREE RUN, real best/today stats. Nav to **HOW IT WORKS** (7 plain-language cards: Perfect, Flow, Arch Flip,
Coins, Block Run, Daily Block, Competition & Arch), a **local LEADERBOARD** (today's best + recent runs, honestly
labelled local until the backend), and **RUNNER** select. Attract runs on its own canvas; the game renderer is
disposed on stop so WebGL contexts don't leak across menu↔game. Build clean, tests 33/33. (Visual feel pending a
human `npm run dev` playtest — can't render a canvas in CI.)

## Phase 2c — Polish + wallet seam ✅ (partially shipped)
Shipped: **particle bursts** (collect / perfect / flip-bank / death, render-only, reduced-motion aware),
**first-run tutorial coach** (auto-dismiss, once per device), and the **WalletProvider seam**
(`src/wallet/`): interface + a working **MockWalletProvider** (connect / sign / deterministic demo address,
no keys, no network) + an **honest ArchWalletProvider skeleton** (BIP-322 over Xverse/UniSat/Leather/OKX;
throws rather than faking). Title has a clearly-labelled **CONNECT WALLET (DEMO)** flow. Tests cover the
wallet seam. Deferred: settings panel, colorblind-safe palette, adjustable sensitivity, a second environment
theme, mid-tier-mobile perf pass.

## Externally blocked (needs infra, not code)
Wiring the **real Arch settlement + wallet** — a deployed Satellite program on testnet, a minted+funded APL
token, and live BIP-322 signing — can't be completed here; the providers are honest skeletons ready for it.
And the **legal review gate** before any real-money mode is a human/legal step, not an engineering one.

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

## Phase 5 — Economy behind the settlement provider ✅ (core shipped; chain wiring deferred)
Shipped and tested: the `GameSettlementProvider` seam (`src/chain/types.ts`) the game talks to instead of any
chain code; a correct in-memory **MockSettlementProvider** (`src/chain/mock.ts`) enforcing the real rules —
separated buckets (entryFees / prizeReserve / protocolRevenue), **integer sats (`bigint`, no floats)**, the
**solvency invariant**, **idempotent settle** (no double-pay), and **reclaim** (refund before settlement);
exact prize math (`src/economy/distribution.ts`) that sums to the pool with no sats created/destroyed; and an
**honest `ArchSettlementProvider` skeleton** (`src/chain/arch.ts`) that throws rather than faking a tx — each
method documents its mapping to the proven escrow flow. Default factory returns Mock, so nothing fake ships.
Deferred (needs live chain): wire the Arch provider over `@arch-network/arch-sdk` 0.0.28 + a deployed
**Satellite** program (`arch-satellite-*` 0.31, `arch_program` 0.12, `cargo build-sbf`, `arch-kit`), reusing the
Scramble escrow pattern (per-competition PDA ATA, program-signed payout to forced ATAs, reclaim/timeout),
BIP-322 wallet connect, `requestAirdrop` for rent, entries/prizes in **our own APL token** (no protocol-native asset).

## Phase 6 — Competitions live ✅ (core shipped; infra + UI deferred)
Shipped and tested: **CompetitionEngine** (`src/server/engine.ts`) — the full async loop wired end to end
(enter → pay into pot → submit server-validated run on the shared seed → leaderboard → finalize → distribute
the whole prize reserve to the ranked board → settle, solvent + exact + once; wrong-seed runs rejected; empty
competitions settle cleanly). **Economy simulator** (`src/economy/simulator.ts` + `npm run simulate`) across
100→100k players with participation, multi-entry, and whales, reporting deposits / revenue / prizes / capital
efficiency — money conservation guaranteed (deposits = revenue + prizes), proven deterministic in tests.
Deferred: hourly/weekly scheduling, optional commit-reveal lucky-runner (needs the block-hash source),
settlement-verification UI, live solvency monitoring, and the **legal review gate before any real-money mode**.
Free + demo modes always default.
