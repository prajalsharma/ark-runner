# ARCH RUNNER

A mobile-first **3D endless runner** with an asynchronous competitive economy on **Arch Network**
(a Bitcoin-native L2). A real arcade game first, a blockchain app second.

Run the **ARCH** — a collapsing cybernetic Bitcoin city. Switch lanes, jump, slide, chain clean moves to
build **ARCH FLOW**, bank energy, and climb a skill leaderboard. Prizes (later phases) are entry-fee-funded
and paid out on Arch; the game itself is fully playable free, with no wallet required.

## Status
**Phases 1–6 cores shipped** (see `docs/roadmap.md`). A polished deterministic runner (Block Run, ARCH FLIP,
Flow, juice, procedural audio), Daily Block + Free Run with local records, cosmetics, and a share card — plus
the backend/economy layers that make it a competition: a **server-side replay validator** (never trusts a
client score), a **competition state machine + validated-only leaderboard**, the **economy** (integer sats,
solvency invariant, exact prize splits) behind a `GameSettlementProvider`, and the full **CompetitionEngine**
loop with an **economy simulator**. The real Arch settlement backend is an honest, un-wired skeleton (it throws
rather than faking a transaction) — wiring it needs a deployed program + live testnet. Blockchain stays fully
isolated; the game is 100% playable with no wallet.

## Quick start
```bash
npm install
npm run dev        # http://localhost:5180 — play (Daily Block / Free Run)
npm run build      # typecheck + production bundle
npm test           # 27 tests: determinism, anti-cheat, economy, competition
npm run serve      # anti-cheat API (POST /validate, GET /daily, /health)
npm run simulate   # economy simulation across 100→100k players
```

## Controls
Desktop: `A`/`D` or `←`/`→` move · `W`/`↑`/`Space` jump · `S`/`↓` slide.
Mobile: swipe left/right/up/down. One-handed.

## Why it's built this way
The simulation is **pure and deterministic** (seed + inputs + frozen constants ⇒ identical result). That one
decision gives fair shared-seed competition, server-side **replay anti-cheat** (the server re-runs your inputs
for the official score — client scores are never trusted), and smooth fixed-step rendering.

The economy **never invents money**: prizes are funded only by entry fees (+ optional sponsorship), tracked in
integer sats with a code-enforced solvency invariant. Settlement runs on Arch behind a `GameSettlementProvider`
abstraction (Mock for dev, `ArchSettlementProvider` for real), reusing an escrow + program-signed payout +
reclaim pattern already proven end-to-end on Arch testnet.

## Docs
- `docs/product.md` — game design & modes
- `docs/architecture.md` — engine, backend, blockchain isolation
- `docs/economics.md` — prize funding, solvency, legal flags
- `docs/anti-cheat.md` — replay validation
- `docs/arch-capabilities.md` — Arch Network capability matrix (what's verified vs. custom)
- `docs/decision-log.md` — ADR log · `docs/roadmap.md` — phases
- `DEMO.md` — how to show it

## Legal
Real-money competition mixing money + chance + prizes carries regulatory risk and **requires professional
legal review before launch**. Free and demo modes carry no such risk and are the default.
