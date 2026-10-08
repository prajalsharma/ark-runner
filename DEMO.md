# ARK RUNNER — Demo Script

~2 minutes. Goal: prove it's a *fun game* first, then that the architecture is ready for Arch.

## Setup
```bash
npm install && npm run dev   # open http://localhost:5180 (use a phone or narrow window)
```

## Run it (60s)
1. Title → **RUN THE ARK**.
2. Move with `A`/`D` (or swipe), `Space`/swipe-up to jump, `S`/swipe-down to slide.
3. Chain clean dodges and near-misses → watch **FLOW** climb and the world intensify, speed ramp up.
4. Die → result card (score, distance, energy, near-miss, best) → **RUN IT AGAIN**.

## Talking points (the "why it's more than a demo")
- **Deterministic engine.** Same seed + same inputs = identical run. `npm test` proves a recorded input
  stream replays to the exact score, and that every generated segment is beatable (no cheap deaths).
- **This is the anti-cheat.** In competition, the server issues the seed and re-runs your inputs for the
  official score — the client never submits a trusted number.
- **Fair daily competition for free:** one shared daily seed → everyone runs the same world.
- **Chain-ready, chain-isolated.** The game doesn't import any blockchain code. Settlement sits behind a
  `GameSettlementProvider`; the Arch implementation reuses escrow + program-signed payout + reclaim already
  proven on Arch testnet (aBTC/aUSD, BIP-322 wallets).
- **Never invents money.** Prizes are entry-fee-funded, integer sats, with a solvency invariant in code.

## What's next (one line)
Phase 2 juice + Block Run + ARK FLIP → MVP daily challenge → backend replay validation → Arch competitions.
See `docs/roadmap.md`.
