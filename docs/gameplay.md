# ARCH RUNNER — Gameplay Spec

The game must be fun **before** any wallet appears. This is the design contract for the runner itself.

## Player & world
You are a runner sprinting through **THE ARCH** — a collapsing, luminous Bitcoin-native megacity.
Auto-forward motion; the player controls lateral movement and verticality. One recognizable runner first
(strong silhouette; run / jump / slide / stumble / death / victory animations), not twenty characters.

## Controls (target < 100ms perceived latency)
| Intent | Desktop | Mobile |
|---|---|---|
| Move left / right | `A`/`D` or `←`/`→` | swipe L / R |
| Jump | `W`/`↑`/`Space` | swipe up |
| Slide | `S`/`↓` | swipe down |
| Pause (Phase 2) | `Esc` | button |

Three lanes (`LANES = [-1, 0, 1]`). Lane change interpolates (not teleport). No required UI taps mid-run.

## Obstacles (all readable & reactable — no unavoidable deaths)
`WALL` (change lane), `LOW` (jump it), `HIGH` (slide under), `PIT` (jump the gap). By construction a `WALL`
or `PIT` never spans all three lanes, and `LOW`+`HIGH` are never coincident in one lane — so every segment
has a survivable line. `tests/patterns.test.ts` enforces this across 10k segments / 20 seeds.

## Intensity phases within a run (~60–180s)
1. **Learning** — slow, sparse, teaches the verbs.
2. **Momentum** — faster, combos start mattering.
3. **Pressure** — complex patterns, near-misses, risk routes.
4. **Block Run** *(Phase 2)* — extreme speed, transformed environment, dense reward, big multiplier.
5. **Survival** — hardest, maximum score ceiling.
Difficulty ramps with distance (`index/60` in the generator), never with unfair randomness.

## Signature mechanic — ARCH FLOW
Flow = momentum/mastery, built by clean dodges, near-misses, lane transitions, jump/slide chains, and held
speed; **one hit resets it**. Flow raises the score multiplier:
`flowMult = min(FLOW_MULT_MAX=4, 1 + flow·FLOW_MULT_STEP=0.15)`; `FLOW_HYPER_AT=10` triggers **Hyper Flow**
(intensified world/music/score). High Flow should *feel dangerous* — safe vs. aggressive is a live choice.

- **Perfect Dodge** — avoided at a narrow timing window → Flow + bonus + VFX/sound. *(Phase 2)*
- **Near Miss** — narrow avoid → smaller bonus (already in sim as `nearMisses`).

## ARCH FLIP *(Phase 2 — the "wow", skill not gambling)*
At procedural moments a gateway offers **SAFE** (bank, smaller score) vs **ARCH FLIP** (a harder high-speed
sequence: succeed → large multiplier, fail → lose the multiplier / possibly end the run). The player always
understands they *chose* risk for a better score. Never arbitrary.

## Block Run *(Phase 2)*
A periodic high-speed "block tunnel": speed up, music/camera shift, denser obstacles, more valuable Flow and
collectibles. The game's signature spectacle.

## Scoring (versioned — `SCORING_VERSION` / `RULESET = "ARCHRUN_V1"`)
Per tick in the current sim:
```
score += speed·DT·flowMult            (distance, the base)
score += ENERGY_VALUE·flowMult         (on collect)
score += nearMissBonus·flowMult        (on near-miss)
```
Later terms (Phase 2): perfect-dodge bonus, risk-route multiplier, Block-Run multiplier. **No single action
may dominate** — the best player must survive, move efficiently, hold Flow, and take calculated risk.
The scoring version is stored with every competition entry so historical competitions never change retroactively.

## Determinism (the backbone)
Fixed `DT = 1/60`; gameplay randomness only from `SeededRandom` (mulberry32); no `Math.random`, no wall-clock
in the sim. `seed + inputs + gameVersion + scoringVersion ⇒ identical score`. This one property powers fair
shared-seed competition, server replay anti-cheat, and smooth fixed-step rendering. See `anti-cheat.md`.

## Modes (build order)
**Free** (practice, no wallet, fresh seed) → **Daily Block** (one shared daily seed, skill decides) →
Hourly → Weekly championship. Build the Daily Block first; do not build all windows at once.

## Game-feel quality bar (Gate 1 — must pass before any blockchain work)
Movement satisfying · lane switch responsive · jump satisfying · obstacles readable · speed exciting ·
Flow rewarding · risk meaningful · death fair · **"one more run" is reflexive**. If any answer is "no", stop
and fix the game — a wallet cannot rescue boring gameplay.

## Accessibility (Phase 2)
Reduced motion, adjustable sensitivity, color-independent obstacle cues, readable text, audio cues, L/R-handed.
Readability always beats spectacle: VFX must never obscure an obstacle, and the collision box must match the visual.
