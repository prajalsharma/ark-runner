# ARCH RUNNER

A mobile-first **3D endless runner** with an asynchronous competitive economy on **Arch Network**
(a Bitcoin-native L2). A real arcade game first, a blockchain app second.

Run the **ARCH** — a collapsing cybernetic Bitcoin city. Switch lanes, jump, slide, chain clean moves to
build **ARCH FLOW**, bank energy, and climb a skill leaderboard. Prizes (later phases) are entry-fee-funded
and paid out on Arch; the game itself is fully playable free, with no wallet required.

## Status
A genuinely playable, polished arcade game — fun first, blockchain second. Shipped:

- **Game**: deterministic 3-lane runner — move/jump/slide, **ARCH FLOW**, **Perfect Dodge**, **Block Run**,
  **ARCH FLIP** (opt-in risk gate), jump buffer, fair reaction-spaced procedural levels (phrases +
  anti-repetition + scripted opening).
- **World & feel**: a scrolling **Bitcoin city** (towers + Arch ring-gates), a **procedural 3D character**
  (run/jump/slide), particles, camera FOV/shake, **dynamic procedural audio**, a **death moment** (slow-mo
  camera + why-you-died + "one more run" hook).
- **Narrative**: skippable opening cutscene ("The Block Bandit") + **the Auditor** antagonist with in-run quips.
- **Modes & meta**: **Daily Block** (shared UTC-date seed + a daily challenge theme/goal) and **Free Run**;
  **2 characters** (cosmetic only), **wallet-linked profile** (name persists), **progression + 9 achievements**,
  **settings** (sound / reduced-motion / graphics), **adaptive performance**, local leaderboard + share card.
- **Competition backend** (runnable, not hosted): server-side **replay validator** (never trusts a client
  score), **competition state machine + validated-only leaderboard**, **CompetitionEngine** end-to-end, and an
  **economy** (integer sats, separated buckets, solvency invariant, exact prize splits) + **simulator**.
- **Wallet**: **real** connect for **UniSat / OKX** (BIP-322 sign); Xverse/Leather detected + guided; an
  explicit **DEMO** fallback so it's playable with no extension.

**Honestly simulated / not yet live:** on-chain settlement (the `ArchSettlementProvider` *throws* rather than
faking a tx — needs a deployed Satellite program + funded testnet), and a hosted global leaderboard. All mocks
are labelled **DEMO** in the UI; nothing fake is shown as real (see `docs/FORENSIC_AUDIT.md`). Blockchain is
fully isolated — the game is 100% playable with no wallet.

## Quick start
```bash
npm install
npm run dev        # http://localhost:5180 — cutscene → Daily Block / Free Run
npm run build      # typecheck + production bundle
npm test           # 44 tests: determinism, coins, anti-cheat, economy, competition, identity, achievements…
npm run serve      # anti-cheat API (POST /validate, GET /daily, /health)
npm run simulate   # economy simulation across 100→100k players
```
> Note: the *feel* (3D, audio, real wallet handshake) needs a real browser — run `npm run dev`, and install
> UniSat or OKX to test a real wallet connect. CI can't render a canvas or drive an extension.

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
- `docs/FORENSIC_AUDIT.md` — REAL vs SIMULATED matrix (what's genuinely wired, grep-verified)
- `docs/current-state-audit.md` · `docs/bug-register.md` — honest state + bug verdicts
- `docs/product.md` · `docs/gameplay.md` — game design & mechanics
- `docs/architecture.md` — engine, backend, blockchain isolation
- `docs/economics.md` — prize funding, solvency, legal flags
- `docs/anti-cheat.md` — replay validation · `docs/security.md` — trust model
- `docs/arch-capabilities.md` / `docs/arch-assumptions.md` — Arch capability matrix (verified vs. needs-confirmation)
- `docs/decision-log.md` — ADR log · `docs/roadmap.md` — phases · `DEMO.md` — how to show it

## Legal
Real-money competition mixing money + chance + prizes carries regulatory risk and **requires professional
legal review before launch**. Free and demo modes carry no such risk and are the default.
