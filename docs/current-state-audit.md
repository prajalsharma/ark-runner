# ARCH RUNNER — Current-State Audit

Honest inventory of what exists in this repo right now (the takeover brief assumed an earlier Arkade-era
prototype; this codebase is further along and already Arch-only). Pairs with `bug-register.md`.

## Works (keep)
- **Deterministic sim** (`src/game/sim.ts`): fixed `DT=1/60`, seeded RNG, no wall-clock. 3-lane move/jump/slide,
  collision, coins, near-miss, Perfect Dodge, Flow, Block Run, ARCH FLIP, jump buffer. Pure + replay-safe.
- **Designed procedural content** (`src/game/patterns.ts`): scripted opening, pacing phrases, anti-repetition,
  reaction-time spacing, richer pattern library. Every segment beatable (tested).
- **Renderer** (`src/game/render.ts`): pooled Three.js meshes, FOV ramp, camera shake, Block Run / flip tint,
  speed streaks, particles, Hyper Flow glow, reduced-motion aware. No per-frame allocation; disposes its context.
- **Modes**: Daily Block (shared UTC-date seed) + Free Run; local records/history; share card.
- **Backend** (`src/server/`): replay validator (never trusts client score), competition state machine,
  validated-only leaderboard, CompetitionEngine, dependency-free HTTP API.
- **Economy** (`src/chain/`, `src/economy/`): `GameSettlementProvider` seam, working Mock (integer sats,
  separated buckets, solvency invariant, idempotent settle, reclaim), exact prize splits, economy simulator.
- **Menu**: live 3D attract hero, How It Works, local leaderboard, runner select, DEMO wallet + profile.
- **Characters** (`src/game/characters.ts`) + **profile** (`src/game/profile.ts`): 2 cosmetic runners,
  wallet-address identity, persistent name.
- **Tests**: 37 across sim/patterns/daily/validate/competition/economy/engine/wallet/identity/coins.

## Mock / honest-skeleton (clearly labelled, not faked)
- **Wallet**: `MockWalletProvider` drives the demo flow; `ArchWalletProvider` is an honest skeleton that throws
  rather than faking a connection/signature.
- **Settlement**: `MockSettlementProvider` is fully functional in-memory; `ArchSettlementProvider` throws
  (`NOT_WIRED`) — no fake transactions.
- Both surfaced in UI as **DEMO / ARCH TESTNET** so nothing misleads.

## Recently added
- **Procedural 3D character** (`src/game/runner-rig.ts`): jointed figure (head/torso/arms/legs/feet) with a
  real run cycle, jump tuck, and slide crouch, blended smoothly. Replaces the box. Live-recolours for character select.
- **Real wallet connect** (`src/wallet/arch.ts` `InjectedWalletProvider`): UniSat + OKX fully wired (BIP-322);
  Xverse/Leather detected + guided. DEMO is an explicit fallback.

## Missing (from the takeover brief — build items, not bugs)
- **Narrative**: opening cutscene, the Auditor antagonist + dialogue, an Auditor-chase set-piece.
- **World depth**: distinct city zones, instanced buildings/towers, more environmental motion.
- **Real Arch settlement**: deployed Satellite competition program + on-chain entry/payout. **Infra-blocked**
  here (needs a deployed program + funded testnet). Wallet connect + BIP-322 signing already work client-side.

## Dangerous / to watch
- `nextId` in `patterns.ts` is module-global (reset per generator). Fine today because the sim generates each
  segment once in increasing order; do not call `generate()` for the same index twice expecting stable ids.
- WebGL contexts: a new `Game` creates a renderer per play; `stop()` disposes it. Attract owns a second,
  persistent context. Keep this to two.

## Deleted / obsolete
- No Arkade anywhere (`grep -ri "arkade\|vtxo"` clean except the deliberate "never Arkade" guard-rails).
- `src/game/cosmetics.ts` skins are superseded by `characters.ts` for runner selection; `bestEver()` is still
  used for the best-score readout. (Skins no longer surfaced in the menu.)
