# Arch Network — Capability Matrix (ARCH RUNNER)

**Target chain: Arch Network only** (arch.network) — never Arkade/ArkadeOS. Arch is a **Bitcoin-native
smart-contract layer** with a Solana-style **eBPF/SBF VM ("ArchVM")**, Taproot/FROST settlement to Bitcoin,
and BIP-322 wallet auth.

Verified **2026-10-08** against official sources only: `docs.arch.network`, `book.arch.network`,
`github.com/Arch-Network`, `crates.io`, the npm registry, and a **live test of the testnet RPC**. Results for
"Arc Network" (Circle) and Arch Linux were discarded. Where our own prior work (the sibling game **Satoshi
Scramble**) proved something E2E on testnet, it is marked as such and separated from protocol-native claims.

## Confirmed package names & versions (pin these)
- npm: **`@arch-network/arch-sdk` 0.0.28** (official; low-level RPC client). ⚠️ `@saturnbtcio/arch-sdk` is a
  third-party fork — do **not** mistake it for official.
- crates: **`arch_program` 0.12.0** (on-chain), **`arch_sdk` 0.12.0** (Rust client),
  **`arch-satellite-lang` / `arch-satellite-apl` 0.31** (Satellite = Anchor fork, ~95% compat).
- tooling: **`arch-kit` 0.1.8** (`arch-kit faucet`, `arch-kit deploy`); build with **`cargo build-sbf`** → eBPF ELF.
  (`arch-cli` is the older, superseded repo.)
- endpoints: testnet RPC **`https://rpc.testnet.arch.network`** (keyless, JSON-RPC 2.0 — verified live),
  explorer **`https://explorer.arch.network`**, local node `http://localhost:9002`.

## Evidence table
Status key: **CONFIRMED** · **CONFIRMED BUT LIMITED** · **EXPERIMENTAL** · **REQUIRES CUSTOM IMPLEMENTATION** ·
**EXTERNAL DEPENDENCY** · **NOT CURRENTLY SUPPORTED** · **UNKNOWN**.

| Capability | Status | Official Source | Exact API / Mechanism | Environment | Game Usage | Confidence |
|---|---|---|---|---|---|---|
| ArchVM / execution | CONFIRMED | book.arch.network; blog.arch.network/bitcoin-programmability | eBPF/SBF VM (Solana-derived toolchain) + Bitcoin UTXO syscalls | on-chain | Settlement program host | HIGH |
| Rust programs | CONFIRMED | crates.io/crates/arch_program (0.12.0); docs.rs/arch_program | `entrypoint!`; modules `account/instruction/program/syscalls/utxo/clock/rent/stake` | on-chain | Competition escrow + payout program | HIGH |
| Anchor-style framework | CONFIRMED BUT LIMITED | github.com/Arch-Network/satellite | **Satellite** (Anchor fork), `arch-satellite-lang/apl` 0.31; IDs are 64-char hex; `anchor-to-satellite` migrator | on-chain | Write the program in Satellite, not vanilla Anchor | HIGH |
| TypeScript SDK | CONFIRMED | npm `@arch-network/arch-sdk` 0.0.28; book.arch.network/docs/sdk/typescript | `RpcConnection` (low-level RPC only — no wallet/tx-builder); pure-JS deps (borsh, @scure, @noble); WS client | browser + backend | Read chain state, submit signed txs | HIGH |
| Rust client SDK | CONFIRMED | crates.io/crates/arch_sdk 0.12.0 | Native Bitcoin integration client | backend | Server settlement signer | HIGH |
| RPC (testnet) | CONFIRMED | live test of https://rpc.testnet.arch.network | Keyless JSON-RPC: `readAccountInfo`, `requestAirdrop`, `createAccountWithFaucet`, `sendTransaction`, `getProcessedTransaction`, `getBlock` (live: height ~337k, node ready) | browser + backend | Entry, settlement, state reads | HIGH |
| Explorer / indexer | CONFIRMED BUT LIMITED | explorer.arch.network; github.com/Arch-Network/arch-indexer | Hosted explorer UI; **self-host** REST indexer `/api/blocks`, `/api/transactions`, `/api/network-stats`, `/api/search` | backend | Our own indexer for leaderboard/settlement tracking | MEDIUM (no documented hosted REST base URL) |
| Bitcoin UTXO syscalls | CONFIRMED | docs.rs/arch_program/utxo; satellite; whitepaper | `arch_get_bitcoin_tx`, `arch_set_transaction_to_sign`, `arch_validate_utxo_ownership`, `arch_get_network_xonly_pubkey`; FROST/Taproot network signing | on-chain | (Later) Bitcoin-anchored prize settlement | HIGH exist / MEDIUM exact 0.12 signatures |
| Wallets | CONFIRMED BUT LIMITED | Arch bitcoin-wallet-adapter | **Xverse / UniSat / Leather / OKX** on Bitcoin **testnet4**; **BIP-322** signing; no confirmed first-party "Arch Wallet" | browser | Connect + sign entry/claim | MEDIUM |
| APL token + ATA | CONFIRMED | book.arch.network/docs/apl | APL **Token Program** (mint/transfer/approve/burn/freeze/mintTo/close/multisig) + **ATA** program (deterministic derivation) — SPL-equivalent | on-chain | Entry fees + prize pool in an APL token | HIGH |
| Fee / rent | CONFIRMED BUT LIMITED | docs.rs/arch_program `rent`; whitepaper | Solana-style account **rent** (lamports); settlement also pays **Bitcoin network fees**. No single doc pins a per-tx fee schedule | on-chain | Fund account rent via `requestAirdrop`; budget BTC settlement cost | MEDIUM |
| archUSD / aUSD / aBTC | **NOT CURRENTLY SUPPORTED as protocol assets** | — (no official source found) | Not protocol-native. Any such token is an **app-level APL mint** someone created; **no official public faucet** | app-level | **We mint & fund our own APL entry token**; never assume a native stablecoin/BTC asset | HIGH they are NOT official |
| Randomness / VRF | **REQUIRES CUSTOM IMPLEMENTATION** | docs.rs/arch_program (module list) | **No VRF, no `slot_hashes`, no randomness.** Only a deterministic `clock` module | on-chain | Money-affecting randomness via **commit-reveal over a future block hash**, else pure-skill | HIGH |
| CLI / build | CONFIRMED | crates.io/crates/arch-kit 0.1.8; github.com/Arch-Network/arch-kit | `arch-kit faucet` / `arch-kit deploy`; `cargo build-sbf` → eBPF ELF. Prereqs: Rust, Docker, Solana CLI, Node 19+ | dev | Build/deploy the settlement program | HIGH |
| Network status | CONFIRMED (testnet) | live RPC + explorer | **Testnet LIVE** (Bitcoin testnet4). **Mainnet NOT confirmed** public | — | Build + demo on testnet only | HIGH testnet / MEDIUM mainnet |

## What this means for ARCH RUNNER
- **Own the money asset.** There is **no** protocol-native aBTC/archUSD. We create and fund our **own APL
  token** (Token Program + ATA) for entries and prizes, and never promise a faucet we don't control.
- **Escrow + payout program in Satellite.** Reuse the **pattern proven E2E in our Satoshi Scramble project on
  Arch testnet** (per-match PDA holds the pot in its ATA; program-signed payout to winners' forced ATAs;
  reclaim/timeout escape hatch; exact integer split; double-settle guard) — ported to `arch-satellite-*` 0.31
  and `arch_program` 0.12. *That pattern is our own verified work; it is not a protocol feature.*
- **Server is the settlement authority** (a server-side key the program pins). The server validates each run
  by deterministic replay (`anti-cheat.md`), then submits the on-chain payout. Only the chain moves money.
- **Randomness is a true gap.** No VRF. Lucky-runner (if used) = commit-reveal over a future block hash;
  otherwise prizes are pure-skill leaderboard. Never client RNG for money.
- **Browser:** `@arch-network/arch-sdk` 0.0.28 is low-level (we build our own tx/wallet layer on top) and its
  deps are pure-JS, so a `Buffer` polyfill is **likely not required** — add the standard Vite polyfill only if
  the bundler actually complains. Wallet connect via the Bitcoin wallet adapter (BIP-322).

See `arch-assumptions.md` for the open items that still need human confirmation before production.
