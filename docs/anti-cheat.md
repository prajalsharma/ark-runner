# ARK RUNNER — Anti-Cheat (determinism as the foundation)

**Core rule: never trust a client score.** The client reports an *input stream*, not a number.
The server owns the truth.

## How it works
1. Every competition run uses a **server-issued seed** (daily seed is shared; hourly/weekly are per-entry
   but server-generated and committed before the window).
2. The client runs the **deterministic `RunSim`** (fixed `DT=1/60`, `SeededRandom` only, no wall-clock)
   and records `InputEvent[]` = `{tick, action}`.
3. On submit, the client sends `{seed, inputs, clientScore, buildVersion}` — **not** a trusted score.
4. The server **re-runs the exact same sim** with the same seed + inputs and computes the **official score**.
   `tests/sim.test.ts` already proves a recorded input stream reproduces the identical score.
5. If `serverScore !== clientScore` beyond a zero tolerance → reject (flag, don't pay).

## What this catches
- **Score injection** — client can't fake a number; only inputs count, and inputs must *legally* produce it.
- **Impossible worlds** — seed is server-owned; the client can't pick an easy map. `patterns.test.ts` proves
  every generated segment is beatable, so a legit world is never an excuse.
- **Modified physics** — a tampered client produces an input stream that, replayed on the canonical sim,
  yields a *different* (usually fatal) result → rejected.

## Additional layers (Phase 4+)
- **Input sanity**: max actions/sec, no two actions on the same tick, monotonic ticks, bounded run length.
- **Statistical outliers**: score/time percentile, superhuman reaction cadence, near-miss rate → shadow review.
- **Rate limits & one-run-per-window** on competition entries (Redis), idempotent submit keys.
- **Build pinning**: `buildVersion` must match the canonical sim version for that competition; constants are
  frozen (`ARKRUN_V1`) and versioned so replays stay valid.
- **Replay audit trail**: every paid run's `{seed, inputs}` is stored; any payout is reproducible on demand.

## Randomness & money
Gameplay randomness is fine (seeded, deterministic). **Money-affecting** randomness (lucky-runner) is **not**
client-side — it uses **commit-reveal over a future Bitcoin/Arch block hash** (Arch has no VRF; see
`arch-capabilities.md`). If no secure source is available, the feature is off and prizes are pure-skill.
