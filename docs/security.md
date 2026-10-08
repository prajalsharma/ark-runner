# ARCH RUNNER — Security & Trust Model

## Trust model (stated plainly — no fake decentralization)
| Layer | What it is trusted for | What it is NOT trusted for |
|---|---|---|
| **Client (browser)** | Rendering, input capture, local practice | **Nothing financial.** Never trusted for score, time, or balance |
| **Backend** | Issuing seeds, replay-validating runs, computing leaderboards, signing settlement as the pinned authority | Custody of user principal; it cannot mint funds or pay beyond the verified pool |
| **Arch Network** | Holding the escrowed pot (PDA/ATA), executing program-signed payouts, enforcing deadlines/reclaim | Game simulation, randomness (no VRF) |
| **Bitcoin** | Underlying settlement assurances of Arch | Low-latency gameplay |

**Centralized today:** seed issuance, replay validation, leaderboard, and the settlement-authority key. We
do **not** market the game as "fully decentralized." If our backend disappears, free play still works; paid
competitions pause and escrowed funds remain reclaimable on-chain via the timeout path.

## Never-do list (enforced in review)
- No client-trusted score / distance / multiplier — server derives them from `{seed, inputs}`.
- No floating-point money — integer base units only; every asset declares `decimals`.
- No private keys / seed phrases requested from users, ever. The settlement-authority key is server-side only.
- No double settlement, no double claim — idempotency keys + terminal competition states.
- No fake transaction/settlement/yield/randomness states shown to users.
- No pay-to-win: purchases are cosmetic only and never touch the score path.
- No blockchain call inside the render/sim loop (gameplay must survive RPC outage).

## Anti-cheat
See `anti-cheat.md`. Core: the client submits an input stream, the server re-runs the canonical deterministic
sim for the official score, and a mismatch is rejected. Fraud flags use confidence levels, not instant bans.

## Financial safety — every value-moving function must answer
Who can call it? · What can they control? · What state changes? · What value moves? · Can it run twice
(idempotent)? · What happens on half-failure? · Can the recipient be changed (no — forced ATAs)? · Can the
amount be manipulated (no — exact integer split)?

## Solvency invariant (asserted before any settlement)
```
distributablePrize <= verifiedPrizeReserve
claimed + remaining + reserved == verifiedPool    (integer base units)
remaining >= 0
```
If the invariant fails → **do not settle**; enter an explicit `SETTLEMENT_FAILED` state for investigation.
Never silently overdraw.

## Competition state machine (no arbitrary transitions)
`CREATED → OPEN → LOCKED → VALIDATING → FINALIZED → SETTLING → SETTLED`, with failure branch
`SETTLEMENT_FAILED`. Submissions after `LOCKED` are rejected using authoritative server/chain time (never
`Date.now()` from the client); windows are UTC internally, localized for display.

## Transaction state (never claim success early)
`CREATED → SUBMITTED → PROCESSING → CONFIRMED` (failure: `FAILED`). "Confirmed" requires on-chain
verification — a wallet saying "sent" is not confirmation. "SETTLED ON BITCOIN" is shown only after the
relevant state is actually verified.

## Pre-production security checklist
- [ ] No Arkade code or terminology anywhere (audited: `grep -ri arkade` is clean)
- [ ] No invented Arch / wallet / program APIs (every imported symbol verified against `arch-capabilities.md`)
- [ ] No fake transactions / settlement / yield / randomness
- [ ] No client-trusted scores · deterministic replay validation tested
- [ ] No double claim / double settlement · idempotency tested
- [ ] No floating-point money · decimals defined per asset
- [ ] No private keys in client
- [ ] No pay-to-win scoring
- [ ] Competition state machine + solvency invariant tested
- [ ] Mobile performance tested · production config separated from testnet/local
- [ ] Legal review complete before any real-money, chance-based mode (see `economics.md`)
