# ARCH RUNNER — Forensic Audit (REAL vs SIMULATED)

**Method:** every claim traced in code + verified by grep/tests, not assumed. (One consolidated doc instead of
ten near-duplicate stubs — pairs with `current-state-audit.md`, `bug-register.md`, `security.md`, `economics.md`.)

**Headline:** nothing fake masquerades as live. Mocks exist and are **always labelled DEMO** in the UI. The
deterministic sim and the economy are genuinely pure. Wallet connect/sign is real code but **unverified
in-browser from here** (no extension/canvas in CI). On-chain settlement is honestly mocked (the real provider throws).

## Forensic grep evidence (2026-10-08)
- **Sim purity**: `grep Math.random|Date.now|performance.now` over `sim.ts`/`patterns.ts`/`constants.ts` → only a
  doc *comment*. The sim uses `SeededRandom` + fixed `DT` only. ✓
- **Economy purity**: no `Math.random` anywhere in `src/economy/` or `src/chain/`. ✓ (`simulator.ts` uses `SeededRandom`.)
- **`Math.random` only in non-financial presentation**: free-run seed generation (`game.ts`/`attract.ts`),
  cosmetic runner colour (`characters.ts`), particles + camera shake (`render.ts`). None touch money or the daily seed.
- **No timer-faked confirmations**: `setTimeout` appears only for UI toast/coach auto-dismiss. No "confirmed after 2s" fakery.
- **No fabricated economics in UI**: no APY/TVL/fake pool/fake player-count strings; the menu shows only real
  local data (best, today's best, run history). No false "confirmed/settled" strings in client UI.
- **Tests**: 38 tests / 123 assertions across 10 files (determinism, coins, patterns, daily, validate, competition,
  economy, engine, identity, wallet) — substantive, not trivially-passing.

## REAL vs SIMULATED capability matrix
| System | Status | Location | Evidence / caveat |
|---|---|---|---|
| Wallet detection | **REAL** | `wallet/arch.ts detectWallets` | Reads `window.unisat` / `okxwallet.bitcoin` / `XverseProviders` / `LeatherProvider`. Headless → `[]`. |
| Wallet connection | **REAL (UniSat, OKX)** / PARTIAL (Xverse, Leather) | `InjectedWalletProvider` | UniSat `requestAccounts`/`getPublicKey`; OKX `bitcoin.connect`. Xverse/Leather detected + guided, not faked. **Not click-tested here.** |
| Address / public key | **REAL** | same | Returned from the wallet; never fabricated. |
| Message signing (BIP-322) | **REAL** | `signMessage(..,"bip322-simple")` | UniSat/OKX real calls. Untested in-browser. |
| Network detection | **PARTIAL (honest)** | menu labels | Labels `BITCOIN TESTNET` (real wallet) vs `DEMO` (mock). We do **not** yet assert a chain id — stated gap, not a fake. |
| Transaction build/sign/submit | **SIMULATED** | `chain/mock.ts` | `MockSettlementProvider` in-memory; `ArchSettlementProvider` throws `NOT_WIRED` (no fake tx). UI never says "confirmed". |
| Arch submission / confirmation / BTC settlement | **NOT WIRED (honest)** | `chain/arch.ts` | Needs a deployed Satellite program + funded testnet; throws rather than pretends. |
| Competition entry / escrow / prize accounting / payout | **SIMULATED (correct math)** | `chain/mock.ts`, `economy/distribution.ts` | Integer sats, separated buckets, solvency invariant, idempotent settle, reclaim, exact splits — all tested. Labelled DEMO. |
| Leaderboard | **REAL-local / SIMULATED-global** | `daily.ts`, menu | Your real runs on this device; a shared global board needs the backend (not running). Labelled local. |
| Daily Block (world) | **REAL** | `daily.ts` | Shared UTC-date seed → identical world for all; deterministic. Competition *settlement* on top is simulated. |
| Score validation / replay / anti-cheat | **REAL (runnable, not deployed)** | `server/validate.ts`, `game/replay.ts` | Re-runs the canonical sim; `npm run serve` exposes `/validate`. Not hosted. |
| Profile / character | **REAL (local, UX-only)** | `profile.ts`, `characters.ts` | Wallet-address identity; localStorage is explicitly non-authoritative (security.md). |
| Economy numbers | **REAL where shown** | menu | Only real local values surface; simulator produces conserved (no invented) money. |
| Notifications / audio / narrative | **ABSENT** | — | Not built yet (build items, below). |

## Production gaps — ranked
- **P0 (game-breaking):** none open. (The coin-vanish bug GAME-001 was real and is fixed + tested.)
- **P1 (major quality):** narrative (opening cutscene + the Auditor); death replay + richer recap/"one more run"
  motivation; world depth (distinct zones, instanced buildings, more environmental motion); audio.
- **P2 (important):** progression/achievements; Daily Challenge *variants* (perfect-run / coin-storm / etc.);
  chain-id network verification; a hosted backend for a real global leaderboard.
- **P3 (polish):** post-processing/bloom, camera modes, mobile perf pass, more cosmetics.

**Note on honesty vs. the brief's mockups:** the brief shows a Daily Block screen with "PLAYERS 421 / TIME LEFT
03:21:42 / PRIZE POOL 12.4". Those are **not** implemented as fabricated numbers — showing them without a real
backend would violate the brief's own "no fake" rule. They surface only when a real competition backend provides them.
