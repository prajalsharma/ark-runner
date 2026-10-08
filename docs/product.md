# ARK RUNNER — Product Spec

**One game.** A polished, mobile-first 3D endless runner with an asynchronous competitive
economy powered by Arch Network (Bitcoin L2). A real arcade game first, a blockchain app second.

## Fantasy
You are an **Ark Runner** carrying settlement energy through **THE ARK** — a cybernetic
Bitcoin city collapsing behind you. Run forward, dodge, chain perfect movements, bank energy.

## Core loop
Title → (optional wallet) → free run → **jump / slide / lane-change / collect** → build **Flow**
→ speed rises → near-miss bonuses → death → score + rank → **one more run**. The pull of
"I could've survived that" must be stronger than any reward.

## Modes
- **Free** — unlimited practice, no wallet, fresh seed each run. (Shipped: greybox.)
- **Daily Challenge** — one shared **daily seed** → everyone runs the *same* world; best valid run counts.
- **Hourly competitions** — async time windows; enter, play, submit; no opponent need be online.
- **Weekly championship** — sum of your top N daily scores (prevents brute-forcing by volume).

## Signature mechanics
- **ARK FLOW** — consecutive clean actions / near-misses raise a score multiplier; one hit resets it.
  At 10 actions you hit **Hyper Flow** (intensified world/music/score).
- **Block Run** *(Phase 2)* — a periodic high-speed Bitcoin-block tunnel: denser obstacles + rewards.
- **ARK FLIP** *(Phase 2, the "wow")* — at high Flow a gateway offers **SAFE EXIT** (bank your run) or
  **ARK FLIP** (a dangerous high-speed sequence: succeed → massive multiplier, fail → lose the multiplier).
  Skill-based, never arbitrary gambling.

## Controls
Desktop: A/D or ←/→ move · W/↑/Space jump · S/↓ slide · Esc pause. Mobile: swipe. One-handed.

## Run structure (competition)
~60–180s soft cap. Phase 1 onboarding (slow) → Flow → Danger → Frenzy. Difficulty ramps with
distance; every obstacle is beatable (tests enforce it). The player should never feel randomly killed.

## Scoring
`score += speed·dt · flowMult` (distance), `+ energy·flowMult`, `+ nearMiss·flowMult`.
`flowMult = min(4, 1 + flow·0.15)`. Purchased cosmetics never affect score — the leaderboard measures skill.

## Non-goals
No PvP combat. No per-movement on-chain tx. No speculative token. No pay-to-win. No DeFi dashboard.

## Definition of MVP
Open → play free → score → replay → connect Arch wallet → enter competition → submit a
**server-validated** score → see leaderboard + pool → win → receive a reward → verify settlement → play again.
