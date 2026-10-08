# ARCH RUNNER — Arch Assumptions Log

Every architecture assumption about Arch, with a status. No production flow is built on an **UNVERIFIED**
assumption. Verified items cite the source + date. (Research pass: 2026-10-08, official sources only.)

## VERIFIED (2026-10-08)
- **A1 — Chain is Arch Network, Solana-style eBPF on Bitcoin.** Source: book.arch.network, blog.arch.network.
- **A2 — On-chain crate is `arch_program` 0.12.0; Rust client `arch_sdk` 0.12.0.** Source: crates.io/docs.rs.
- **A3 — Smart-contract framework is Satellite (Anchor fork), `arch-satellite-lang/apl` 0.31; program IDs are
  64-char hex, not base58.** Source: github.com/Arch-Network/satellite.
- **A4 — Official TS SDK is `@arch-network/arch-sdk` 0.0.28, a low-level RPC client** (no wallet/tx-builder).
  `@saturnbtcio/arch-sdk` is a third-party fork. Source: npm registry, book.arch.network.
- **A5 — Testnet RPC `https://rpc.testnet.arch.network` is live and keyless.** Verified by live call
  (block height ~337k, node ready).
- **A6 — APL Token Program + ATA program exist (SPL-equivalent).** Source: book.arch.network/docs/apl.
- **A7 — Arch has NO on-chain randomness/VRF/`slot_hashes`; only a deterministic `clock`.** Source:
  docs.rs/arch_program module list. ⇒ money-affecting randomness must be custom (commit-reveal).
- **A8 — Wallets are Bitcoin wallets (Xverse/UniSat/Leather/OKX) on testnet4, BIP-322 signing.** Source:
  Arch bitcoin-wallet-adapter. (First-party "Arch Wallet": not confirmed.)
- **A9 — Build with `cargo build-sbf`; deploy with `arch-kit` 0.1.8.** Source: crates.io/github Arch-Network.
- **A10 — Testnet is live (Bitcoin testnet4).** Verified.

## VERIFIED FROM OUR OWN PRIOR WORK (not a protocol feature)
- **A11 — The escrow + program-signed payout + reclaim settlement pattern works E2E on Arch testnet.**
  Source: our sibling project **Satoshi Scramble** (exact integer split settled on testnet). This is *our*
  application code, to be re-verified after porting to `arch_program` 0.12 / Satellite 0.31.

## UNVERIFIED — must confirm before production
- **U1 — `aBTC` / `aUSD` / `archUSD` are NOT official protocol assets.** No official source. Any such token is
  an app-level APL mint. **Action:** ARCH RUNNER mints & funds its **own** APL entry token; confirm the exact
  mint address and issuer of any token we reuse. Do not assume a public faucet.
- **U2 — Browser Buffer polyfill.** SDK deps are pure-JS (likely no polyfill needed), but no official statement.
  **Action:** confirm in a real Vite build; add the standard polyfill only if the bundler errors on `Buffer`.
- **U3 — Exact Bitcoin syscall signatures in 0.12.0** (`arch_get_bitcoin_tx`, `arch_set_transaction_to_sign`,
  `arch_validate_utxo_ownership`, `arch_get_network_xonly_pubkey`). **Action:** verify against docs.rs for 0.12.0
  before writing settlement code.
- **U4 — Hosted indexer REST base URL.** The `/api/*` routes are from the self-host `arch-indexer`; no official
  hosted base URL confirmed. **Action:** run our own indexer, or confirm a hosted endpoint.
- **U5 — Public mainnet availability.** Not confirmed. **Action:** build/demo on testnet; do not promise mainnet.
- **U6 — Per-transaction fee schedule.** Rent model confirmed; exact fee numbers not pinned. **Action:** measure
  on testnet before quoting costs to users.
- **U7 — Indexer WebSocket.** SDK has a node-RPC WS client; a separate indexer WS was not confirmed.
  **Action:** poll REST + `readAccountInfo` until a WS is confirmed.
