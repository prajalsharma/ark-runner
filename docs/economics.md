# ARCH RUNNER — Economics (draft; no real funds until simulated)

**Hard rule: never invent money.** Every reward has an explicit source. Denominated in **sats**
(integer base units; no floating-point money, ever).

## Separated balances (never commingle)
- `playerPrincipal` — not applicable in the entry-fee model (players don't deposit a bankroll; they pay per-entry).
- `entryFees` — collected per competition entry.
- `prizeReserve` — the portion of entry fees (and sponsorships) earmarked for payouts.
- `protocolRevenue` — the fee the game keeps.
- `jackpotReserve` — optional rolling pool.
- `operationalReserve` — covers L1 batch-settlement costs.

## Prize funding = entry fees (+ optional sponsorship)
A competition's distributable prize is funded **only** by that competition's collected entries,
minus a transparent fee, plus any pre-funded sponsor amount. No yield is assumed (Arch exposes
none — see `arch-capabilities.md`). Example per entry `E`:
`prizeReserve += E·(1 - feeRate)` ; `protocolRevenue += E·feeRate`.

## Solvency invariant (enforced in code)
```
distributablePrize <= verifiedPrizeReserve
claimed + remaining + reserved == verifiedPool    (integer sats)
remaining >= 0
```
Every financial op is **idempotent, atomic, auditable, replay-safe, race-safe**. A payout cannot run twice.

## Prize structures to simulate (choose by data, not vibes)
- A: 70/20/10 (1st/2nd/3rd).
- B: 60/20/10 + 10% random participant (lucky runner).
- C: skill leaderboard + lucky draw.
- D: skill-weighted raffle, `ticketWeight = score^0.7`.
Simulate 10 → 100k players, whales, bots, low/high participation, abandoned rewards, reserve depletion
(`scripts/economy-simulation`, `economics-simulation.md`). Pick on fairness · motivation · sustainability · anti-cheat · legal.

## Lucky-runner randomness
Any money-affecting randomness uses **commit-reveal seeded by a future Bitcoin block hash**
(published commitment before the block, revealed after) — never client RNG. No secure source → feature off.

## Revenue (documented separately from prize funding)
Competition fee (small, transparent) · sponsored competitions · non-pay-to-win cosmetics ·
seasonal passes (if legal). No token for speculation.

## Legal (flagged, not claimed)
Money + chance + prizes = real regulatory risk (gambling / prize-competition / skill-vs-chance / KYC/AML
/ prohibited jurisdictions). **Requires professional legal review before any real-money launch.** The
free and demo modes carry no such risk and are the default.
