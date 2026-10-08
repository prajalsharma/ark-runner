# ARCH RUNNER — Decision Log (ADRs)

Short, dated, append-only. Newest first.

## ADR-006 — Three.js for rendering (2026-08-30)
Mobile-first 3D with a tiny footprint and no engine lock-in. Three.js r0.169, pooled meshes, renderer
reads sim state read-only. Could swap to Babylon/WebGPU later without touching the sim.

## ADR-005 — Deterministic fixed-step sim is the whole architecture (2026-08-30)
`DT=1/60`, `SeededRandom` only, no wall-clock in gameplay, inputs recorded with their tick. One decision
buys fair shared-seed competition, server replay anti-cheat, and smooth interpolated rendering. **Accepted;**
enforced by `tests/sim.test.ts` + `tests/patterns.test.ts`.

## ADR-004 — Never trust client scores; validate by replay (2026-08-30)
Client submits `{seed, inputs}`; server re-runs the canonical sim for the official score. See `anti-cheat.md`.

## ADR-003 — Never invent money; entry-fee-funded prizes; integer sats (2026-08-30)
Every reward has an explicit source (entries + optional sponsorship), no assumed yield, no floats, and a
code-enforced solvency invariant `distributablePrize <= verifiedPrizeReserve`. See `economics.md`.

## ADR-002 — Blockchain isolated behind `GameSettlementProvider` (2026-08-30)
The engine never imports chain code. Two impls: `MockSettlementProvider` (dev/demo) and
`ArchSettlementProvider` (`@arch-network/arch-sdk`). Lets the game be fun-first and the chain swappable/testable.

## ADR-001 — Target chain is **Arch Network** (2026-08-30, reaffirmed 2026-10-08)
ARCH RUNNER settles on **Arch** — the same Bitcoin-native L2 as the sibling games Satoshi Scramble and
Arch Duel. Rationale: the escrow + program-signed payout + reclaim pattern is already **proven E2E on Arch
testnet**, aBTC/aUSD exist, BIP-322 wallets work, and the browser/SDK gotchas are already mapped
(`arch-capabilities.md`). No other chain or platform is involved. The only capability gap is verifiable
randomness (no VRF) → handled via commit-reveal over a future block hash. **Accepted.**
