# ARCH RUNNER — Hallucination Risk Report

The brief's #1 rule: never implement an Arch feature from memory, and never confuse Arch with Arkade. This
report separates what we *know* from what we *think*, and names what a 2026-10-08 official-source pass actually
corrected in our earlier (memory-based) notes.

## What we KNOW (official source or live test, 2026-10-08)
- Arch = Solana-style eBPF chain on Bitcoin. `arch_program` 0.12 / `arch_sdk` 0.12 / Satellite 0.31.
- Official TS SDK `@arch-network/arch-sdk` 0.0.28 (low-level RPC). Testnet RPC live + keyless.
- APL Token Program + ATA exist. Wallets are Bitcoin wallets + BIP-322. Build `cargo build-sbf`, deploy `arch-kit`.
- **No on-chain randomness/VRF.** Testnet live; mainnet unconfirmed.
(See `arch-capabilities.md` for the sourced table.)

## What we THINK (reasonable, not fully confirmed)
- SDK likely needs no browser Buffer polyfill (pure-JS deps) — confirm in a real build.
- Our Satoshi Scramble escrow/settlement pattern will port cleanly to 0.12/Satellite 0.31 — re-verify after porting.
- Bitcoin syscall names are stable — confirm exact signatures for 0.12.0.

## What we DON'T KNOW (must verify before production)
Official status of any `aBTC`/`archUSD`/`aUSD` token · exact per-tx fees · hosted indexer REST/WS URLs ·
public mainnet availability. (All tracked in `arch-assumptions.md` as U1–U7.)

## Corrections this pass made to earlier memory-based notes
| Earlier (from memory) | Corrected (sourced 2026-10-08) |
|---|---|
| `arch_program` 0.8.x, `arch-cli` 0.8.6 | **`arch_program` 0.12.0**, tooling **`arch-kit` 0.1.8** |
| Anchor used directly | **Satellite** (Anchor fork), `arch-satellite-*` 0.31; IDs are 64-hex |
| SDK needs a Buffer polyfill | Pure-JS deps → **likely no polyfill**; add only if bundler errors |
| `aBTC`/`aUSD` are standard Arch assets with mints | **NOT protocol assets** — app-level APL mints; we mint our own |
| First-party "Arch Wallet" extension with a relay-popup | Not confirmed; it's a **Bitcoin-wallet-adapter** model |
| Indexer at `explorer.arch.network/api/v1/testnet` | Unconfirmed; indexer is **self-host** `arch-indexer` `/api/*` |

## Arkade contamination check
`grep -ri "arkade\|arkadeos\|vtxo"` over the repo (excluding node_modules) → **clean**. No Arkade concepts,
terminology, SDK, operator, or VTXO model anywhere. Re-run this before every blockchain PR.

## API-existence rule (enforced at PR time)
For every imported Arch symbol: does it exist, where is it documented, which version, which package,
client/server/on-chain, testnet-compatible? Record it. No fake imports, no fake program/wallet/settlement APIs.
