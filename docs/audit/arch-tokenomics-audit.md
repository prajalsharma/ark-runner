# ARCH RUNNER — Arch Tokenomics Audit

Honest classification of the economy against what Arch actually supports today, plus the chosen model and the
accounting rules that enforce solvency. No invented yield, no fake balances, no masquerading mocks.

## Capability matrix
Status: **LIVE** (works now) · **PARTIAL** · **MOCKED** (dev/demo, labelled) · **UNAVAILABLE** (not on Arch) ·
**NOT VERIFIED**.

| Capability | Status | Evidence / location |
|---|---|---|
| Arch testnet chain reads (block height, node, hash) | **LIVE** | `src/chain/rpc.ts` → `rpc.testnet.arch.network` (verified advancing, CORS-open). Shown on the in-game ARCH NETWORK screen. |
| Wallet connect + BIP-322 sign (UniSat/OKX) | **PARTIAL (connect real, untested in-CI)** | `src/wallet/arch.ts` — real injected APIs; needs a browser+extension to click-test. |
| Mainnet | **UNAVAILABLE** | No public Arch mainnet confirmed. The UI shows MAINNET = "not live, nothing here". |
| Economic asset (which token to denominate in) | **NOT VERIFIED** | No protocol-native `aBTC`/`archUSD`. A real mode would mint/fund our **own APL token** (`docs/arch-capabilities.md`). |
| Deposit / withdraw to an on-chain vault | **MOCKED** | Accounting is real (`src/economy/ledger.ts`); on-chain custody needs a deployed program. |
| Competition escrow + program-signed payout | **MOCKED** | `src/chain/mock.ts` (correct invariants) + `ArchSettlementProvider` **throws** (`NOT_WIRED`) rather than faking. |
| Prize accounting / solvency | **LIVE (logic)** | `src/economy/ledger.ts` + `src/economy/distribution.ts`, fully tested (conservation + solvency). |
| Verifiable randomness (raffle) | **UNAVAILABLE** | Arch has no VRF. A raffle, if ever added, must be commit-reveal; not implemented. No `Math.random` for money. |
| Real yield | **UNAVAILABLE** | No verified Arch yield primitive. **We do not claim or simulate yield.** |

## Chosen model — entry-funded skill competition (no yield)
Because no genuine Arch yield source is verifiable, the economy is **entry-funded** (the brief's §16.3 fallback),
with a **Runner Vault** for capital that stays the user's:

- **Free Run** and the **Daily Block** are playable **without paying** (default; zero financial risk).
- A player may **deposit** supported capital into their **vault** (principal — stays theirs, withdrawable).
- A **paid Daily competition** (optional, explicit opt-in) takes an **entry fee from the vault**. The fee
  splits into **prize pool / reserve / protocol** (configurable bps). Entries are **not** staking; committed
  entry funds are separate from withdrawable principal.
- Scores are **server-validated** (replay; never trust the client). Winners' prizes are paid **back into their
  vault** (claim == withdraw). Any undistributed remainder rolls into the **reserve**.
- **Skill decides rank; money only decides tier/eligibility** — no pay-to-win. Collected in-game coins are
  gameplay collectibles with **no monetary value**.

## Accounting rules (enforced in code — `src/economy/ledger.ts`, tested)
- **Four buckets kept separate:** principal (vaults) · prize pool (per competition) · reserve · protocol revenue.
- **Integer sats (bigint)** — no floating-point money.
- **Conservation + solvency invariant:** `principal + prize + reserve + protocol == assets held`, asserted after
  operations; a payout can never exceed its pool (`INSOLVENT` throw otherwise).
- **Idempotent settle** (never pay twice) · **duplicate-entry** and **overdraw** refused.
- `tests/ledger.test.ts` (+ `tests/economy.test.ts`, `tests/engine.test.ts`) prove all of the above;
  `src/economy/simulator.ts` stress-tests 100→100k players (money conserved).

## What must be deployed before a real-money mode
A **Satellite competition program** on Arch testnet (create/enter/finalize/settle/claim) holding escrow in a
PDA ATA with program-signed payouts + a reclaim path, denominated in a **minted+funded APL token**, plus the
server settlement-authority key and a hosted validator. Until then every financial path is **DEMO / testnet**
and labelled as such in the UI. **Legal review is required before any real-money mainnet mode.**
