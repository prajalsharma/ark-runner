# Arch Network — Capability Matrix (ARCH RUNNER)

**Target chain: Arch Network** (arch.network) — a Bitcoin-native smart-contract L2 with an
eBPF/Solana-style VM and BIP-322 (Taproot) authorization. Same chain as the sibling games
Satoshi Scramble and Arch Duel, so most of this is **session-verified on testnet**, not assumed.
ARCH RUNNER's entire economy and settlement layer runs on Arch — no other chain or platform.

Stack: `@arch-network/arch-sdk` **0.0.28** (pinned; 0.0.27 is a broken empty publish) · Rust
`arch_program` 0.8.x · `arch-cli` 0.8.6 (`cargo build-sbf`, Agave 3.1.10) · node v0.8.8.
Testnet RPC `https://rpc.testnet.arch.network` (keyless) · keyless REST indexer
`https://explorer.arch.network/api/v1/testnet`.

| Feature | Status | Evidence | Notes |
|---|---|---|---|
| TypeScript SDK | **SUPPORTED** | npm `@arch-network/arch-sdk` 0.0.28 | sub-1.0; pin it. Derives PDAs/ATAs with Node `Buffer` → **browser needs a Buffer polyfill** |
| Wallet (BIP-322) | **SUPPORTED, VERIFIED** | this session (Scramble/Duel) | Taproot x-only pubkey = identity. Arch Wallet (hosted hub — relay-popup gotcha), **UniSat/Xverse (inline, smoothest)**, Phantom, Leather |
| Native gas / rent | **SUPPORTED, VERIFIED** | live `request_airdrop` | **No metered per-tx fee**; native lamports = Solana-style **rent** funded at account creation. Faucet = `request_airdrop` (keyless, ~3s) |
| Fungible asset (APL token) | **SUPPORTED, VERIFIED** | aBTC `1d46e0dd…` 8dp; aUSD `55c6ce…` 6dp | APL token program (`TokenT4em…`) + ATA program. Integer base units |
| Escrow (PDA vault) | **SUPPORTED, PROVEN E2E** | Scramble settlement, testnet | Pot held in a **match-PDA associated token account**; program verifies vault = `ATA(pda, mint)` |
| Program-signed payout | **SUPPORTED, PROVEN E2E** | Scramble `settle_match` | PDA-signed transfer to winners' **forced** ATAs (caller can't redirect). Exact integer split; terminal-state double-settle guard |
| Refund / reclaim escape hatch | **SUPPORTED, PROVEN E2E** | Scramble `reclaim_entry` | After a settle deadline a participant reclaims their entry — funds never stuck |
| Deadlines / timeouts | **SUPPORTED** | `get_clock().unix_timestamp` | Join / settle deadlines on-chain |
| Settlement authority model | **CUSTOM (ours)** | Scramble server = settlement authority | Program pins an `EXPECTED_AUTHORITY`; our server signs settlement after validating the run. Key is **server-side only** |
| Verifiable randomness | **UNSUPPORTED (no primitive)** | arch-coinflip-escrow note | Arch has **no VRF / slot_hashes**. Any money-affecting randomness = **commit-reveal seeded by a future Bitcoin/Arch block hash**, never client RNG |
| Testnet + faucet | **SUPPORTED, VERIFIED** | live | `request_airdrop` funds native rent; **aBTC/aUSD have no public faucet** — acquire/transfer (we denominate small entries + check balance, no stranding) |
| Explorer WebSocket | **ABSENT** | verified | No WS on the indexer; poll REST + `read_account_info` |

## What this means for ARCH RUNNER
- **Entry fees + prizes in an APL token (aBTC or aUSD).** Reuse the **proven Scramble escrow**:
  a per-competition PDA holds the pot in its ATA; the program pays winners' ATAs on settlement;
  a reclaim/timeout path guarantees no stuck funds.
- **Server = settlement authority.** The server validates each run by **deterministic replay** (see
  `anti-cheat.md`), then submits the on-chain payout. Only the chain moves money; the server attests the result.
- **Randomness is the gap.** No VRF on Arch. A lucky-runner bonus (if used) is **commit-reveal over a
  future block hash**; otherwise the prize is pure-skill leaderboard. Never client RNG for money.
- **Browser gotchas carried over:** polyfill `Buffer`; recommend **UniSat/Xverse** for inline signing
  (the Arch Wallet hosted "Connect" relay popup lingers up to ~90s — a known extension issue, not ours).

## Classification key
SUPPORTED/VERIFIED = tested live this session · PROVEN E2E = full on-chain run validated ·
CUSTOM = we build it · UNSUPPORTED = not available, redesign around it.
