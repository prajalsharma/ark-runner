# ARCH RUNNER — Economy & Arch Deployment Audit

**Agent F (Arch & Bitcoin Engineer) — factual capability + deployment-blocker audit.**
Date: **2026-10-09**. Target chain: **Arch Network** (arch.network) only — never Arkade/ArkadeOS/VTXO.
Read-only investigation; no game source was modified and no deploy was attempted.

Evidence is from: direct reads of the repo source; local toolchain probes; a live JSON-RPC test of
`https://rpc.testnet.arch.network`; a live read test with the installed `arch-cli`; and official Arch
sources (`book.arch.network`, `github.com/Arch-Network`). Dates and URLs cited inline.

---

## 1. Current implementation (real vs mock)

| File | What it does | Real or mock |
|---|---|---|
| `src/chain/types.ts` | Defines the `GameSettlementProvider` seam + money types (`Sats` = bigint). Pure interface. | Design contract (N/A) |
| `src/chain/mock.ts` | `MockSettlementProvider` — in-memory pots, enforces the real invariants (separated buckets, integer sats, solvency, idempotent settle, reclaim). | **MOCK** (correct logic, no chain). Dev/demo/tests. |
| `src/chain/arch.ts` | `ArchSettlementProvider` — HONEST skeleton. Every method (`openCompetition/collectEntry/settle/reclaim/pool/balanceOf`) **throws `NOT_WIRED`**. Factory `makeSettlementProvider` **defaults to Mock** and only returns Arch when `mock===false && arch` config present. | **NOT WIRED** (throws, never fakes). |
| `src/chain/network.ts` | testnet/mainnet mode switch, persisted per device. `TESTNET_RPC = https://rpc.testnet.arch.network`. Mainnet intentionally empty. | Real config constants. |
| `src/chain/rpc.ts` | Live JSON-RPC 2.0 client over `fetch`. `fetchTestnetStatus()` calls `get_block_count`, `is_node_ready`, `get_best_block_hash`. No fallback numbers — failures surface as errors. | **REAL + LIVE** (read-only chain state). Verified live today. |
| `src/wallet/provider.ts` | `WalletProvider` seam; never handles seeds/keys. | Design contract (N/A) |
| `src/wallet/arch.ts` | `InjectedWalletProvider` — UniSat/OKX connect + BIP-322 `signMessage` (genuine, works with a real extension). Xverse/Leather detected but throw "not wired". No private keys requested. | **REAL connect + signing** (needs a real browser extension). Settlement still mocked. |
| `src/economy/ledger.ts` | `RunnerLedger` — four strictly-separated buckets (PRINCIPAL/PRIZE/RESERVE/PROTOCOL), integer sats, CONSERVATION + SOLVENCY invariants, idempotent settle. **No yield invented** — prizes funded only by entries. | **REAL logic**, in-memory. |
| `src/economy/distribution.ts` | Prize math: `splitExact` (floor shares, remainder to 1st, sum === pool exactly), `distribute`, `feeOf`, `assertSolvent`. | **REAL logic**. |
| `src/server/engine.ts` | `CompetitionEngine` — orchestrates open→enter→validate→finalize→settle over an injected provider + state machine. | Real orchestration; money path is only as real as the injected provider (**currently Mock**). |

**Bottom line:** The entire money/settlement layer is **MOCK** — the logic is correct and
invariant-checked, but no funds move on any chain. The only genuinely **LIVE on-chain** things in the
codebase are (a) read-only testnet status (`rpc.ts`) and (b) wallet connect + BIP-322 signature
(`wallet/arch.ts`, UniSat/OKX). The code is honestly labeled: `arch.ts` throws rather than faking a tx.

---

## 2. Arch capability facts (cited)

- **How you deploy today.** Build the program with `cargo build-sbf` (provided by the Solana/Agave CLI)
  → an eBPF `.so`, then deploy with a client that matches the **current node version**. The official
  quick-start still shows `arch-cli deploy target/deploy/` + `arch-cli show <PROGRAM_ID>`
  (book.arch.network/docs/quick-start, accessed 2026-10-09), but the maintained path for a **v0.12.0
  node** is **`arch-kit`** (`arch-kit deploy --elf … --fund-authority`). Source: github.com/Arch-Network/arch-kit README (pinned `@v0.1.8`), accessed 2026-10-09.
- **Current compatible versions.** Testnet node = **v0.12.0** (post chain-reset). **arch-kit 0.1.8**
  targets `arch_sdk` / `apl-token` / `apl-associated-token-account` **0.12.0**; generated programs use
  **`arch-satellite-lang` 0.34.0** on **`arch_program` 0.12.0**. arch-kit ≤ 0.1.7 works only with
  pre-0.12 nodes. TS SDK: **`@arch-network/arch-sdk` 0.0.28** (official, low-level RPC). Sources:
  arch-kit README; arch-kit PRs #3 and #4 ("Move to arch_sdk/APL 0.12.0 for v0.12.0 nodes" /
  "migrate to Arch 0.12.0"), github.com/Arch-Network/arch-kit, accessed 2026-10-09.
- **Protocol-native aBTC / archUSD / stablecoin?** **NO.** No official source mentions any
  protocol-native BTC or stablecoin asset; the quick-start and APL docs describe only a generic APL
  **Token Program + ATA** (SPL-equivalent) that *you* mint. Any "aBTC"/"archUSD" is an app-level APL mint
  someone created, with no official public faucet. (book.arch.network APL docs + absence across all
  official pages, accessed 2026-10-09; matches repo `docs/arch-capabilities.md`.)
- **Deposits / withdrawals / signing / confirmation.** Accounts are funded for **rent/fees** via a
  testnet faucet (`arch-kit faucet --key …`, or the RPC `request_airdrop` / `createAccountWithFaucet`);
  **no faucet on mainnet**. Users/programs are Bitcoin/Taproot identities; wallet signing is **BIP-322**
  via Bitcoin wallet adapters (UniSat/Xverse/Leather/OKX) on **testnet4**. Value (entry fees, prizes)
  moves as **APL token transfers**. Confirmation: `arch-cli tx confirm <TXID>` / SDK
  `getProcessedTransaction`; on v0.12 success is simply **`status == Processed`** (the rolled-back state
  no longer exists — see §4). Sources: arch-kit README; arch-kit PR #4; book.arch.network, accessed
  2026-10-09.
- **Any genuine yield source?** **NONE found.** No native staking-yield or lending primitive for
  pooled app funds appears in any official doc. Prizes can only be funded by entry fees — which is
  exactly what `ledger.ts`/`distribution.ts` enforce (no invented yield). HIGH confidence there is no
  protocol yield to lean on.

---

## 3. Toolchain versions found (local, 2026-10-09)

**Arch / deploy tooling**
- `~/.local/bin/arch-cli` → **arch-cli 0.8.6** (23 MB binary; also `arch-cli-0.6.7.bak`). Not on default PATH.
- **`arch-kit` is NOT installed** (`which arch-kit` → not found; not in `~/.cargo/bin`).

**SBF build tools** (`~/.local/share/solana/install/active_release/bin`, not on default PATH)
- `solana-cargo-build-sbf` **3.1.10**, `solana-cli` **3.1.10 (Agave)**, platform-tools **v1.52**, SBF `rustc` **1.89.0**.

**Host toolchain** (all present — arch-kit install prereqs satisfied)
- `cargo` / `rustc` **1.96.0**, `rustup` **1.29.0**, `docker` **28.0.1**, `node` **v22.23.1**.

**Sibling program dependency pins** (for reuse assessment)
- `~/hashplay-satoshi-scramble/programs/scramble` → `arch_program` **0.8.6**, `apl-token`/`apl-associated-token-account` **0.8.6**.
- `~/coinup/programs/arch-duel` → `arch_program` **0.8.6**.
- `~/arch-coinflip-escrow/program` → `arch_program` **0.6.7**.

**Live tests run today**
- RPC `https://rpc.testnet.arch.network` (curl): `get_block_count` → **708005**; `is_node_ready` → **true**;
  `get_best_block_hash` → `6c304e57…10dea`; `get_block_height` → **error -32601 "Method not found"** (as expected — not a valid method).
- `arch-cli -n testnet get-block-height` → **"Current Block Height: 708309"** (read path **works** against the current node).
- `arch-cli -n testnet show <64-hex program id>` → **"Error: Invalid length"** (CLI expects a different pubkey encoding; arg-parsing, not RPC).

---

## 4. The exact deploy blocker

**Root cause: client/node version skew introduced by the v0.12.0 chain reset.**

Testnet runs **arch-node v0.12.0**. That release **removed the `rollback_status` field** from the
transaction-status RPC response. **arch-cli 0.8.6** (and the 0.8.x `arch_sdk` it embeds) deserializes
that response into a struct that still *requires* `rollback_status`, so **every command that waits for a
transaction** fails with **`missing field \`rollback_status\``**:
- `arch-cli deploy` (program-account assignment waits on the tx),
- `account airdrop` / `--fund-authority`,
- `tx confirm`, and IDL publish.

Pure read methods that don't deserialize a tx-status struct **still work** — confirmed empirically today:
`arch-cli get-block-height` returns 708309. So the prior report's blocker is **still real and unchanged**;
it is a version incompatibility, not a network outage or a credential problem.

Source: Arch-Network/arch-kit **PR #3** ("Move to arch_sdk/APL 0.12.0 for v0.12.0 nodes") and **PR #4**
("migrate to Arch 0.12.0") — both state v0.12.0 no longer returns `rollback_status`, that the error is
`missing field rollback_status` against a v0.12 node, and that **testnet is on v0.12.0**. Accessed
2026-10-09.

**Secondary blocker — the prebuilt binaries are not reusable.** `scramble.so` (and the coinup/coinflip
binaries) were compiled against `arch_program`/APL **0.8.6** (coinflip 0.6.7) for the **pre-reset** chain,
and those prior deployments were **wiped by the reset**. They are **not drop-in deployable** to a v0.12.0
node. The *source* is reusable; the compiled `.so` is not.

---

## 5. Viable path to a real testnet deploy

**Feasible now.** No external/network/credential blocker remains — the testnet RPC and faucet are live,
and the full host toolchain is installed. The only things missing are a 0.12-compatible deployer and a
program rebuilt against 0.12. Concrete steps:

1. **Install the 0.12-compatible deployer:** `cargo install arch-kit --locked` (host cargo 1.96 present)
   → arch-kit 0.1.8+. Ensure `~/.cargo/bin` is on PATH.
2. **Port the proven escrow program.** Reuse `~/hashplay-satoshi-scramble/programs/scramble/src/lib.rs`
   — a complete native APL escrow: per-match PDA holds the pot in its ATA, `invoke_signed` payout to
   winners' forced ATAs with exact rank split, reclaim/timeout, double-settle guard, `verify_vault`.
   **Bump deps** to `arch_program` 0.12.0 + `apl-token`/`apl-associated-token-account` 0.12.0 (optionally
   wrap in `arch-satellite-lang` 0.34) and fix any 0.8→0.12 API drift.
3. **Build:** `cargo build-sbf` (platform-tools 3.1.10 present) → a fresh `.so`.
4. **Deploy + fund:**
   `arch-kit deploy --elf target/deploy/<prog>.so --program-key ./keys/program.key --authority ./keys/authority.key --fund-authority --generate-if-missing`
   (faucet funds the authority on testnet). Record the 64-hex program id.
5. **Mint our own APL entry token** (no protocol-native asset): `arch-kit create-mint` + `mint-tokens`;
   set it as the game mint (the `mint` field in `ArchConfig`).
6. **Wire `src/chain/arch.ts`** `ArchSettlementProvider` with `@arch-network/arch-sdk` 0.0.28 to the
   proven flow (open → PDA+ATA, collectEntry → APL transfer, settle → authority-signed exact split,
   reclaim). Keep the settlement-authority key **server-side only** (`src/server/`).
7. **E2E verify** using the scramble harness as a template
   (`~/hashplay-satoshi-scramble/scripts/testnet-e2e.mts`). **Gotcha:** post-settle balance reads are
   stale on Arch testnet (RPC replica lag) — poll vault→0 before asserting (documented in prior work).

**Precise missing prerequisite:** arch-kit is not installed, and the escrow program has not been
ported/rebuilt against 0.12. That is bounded porting work (hours), not an external dependency.

---

## 6. What can / can't be labeled "live" today

**CAN be labeled LIVE (verified):**
- Testnet network status read — `rpc.ts` (`get_block_count`/`is_node_ready`/`get_best_block_hash`),
  confirmed live 2026-10-09.
- Wallet connect + BIP-322 signature — `wallet/arch.ts` (UniSat/OKX) with a real browser extension.

**MUST stay DEMO / MOCK (do not relabel):**
- **All money movement** — deposits, entry fees, prize pool, settlement, payouts, balances. These run on
  `MockSettlementProvider` + `RunnerLedger` (in-memory); `ArchSettlementProvider` throws.
- **No APL token is minted** and **no settlement program is deployed** (prior deployments were wiped by
  the chain reset).
- **Mainnet** — nothing. Not confirmed public; `network.ts` intentionally leaves it empty.

**Honesty status:** the code already labels all of this correctly and does not fake a deploy. Settlement
must remain labeled DEMO until steps 1–7 land and an E2E run passes on testnet with a freshly deployed
0.12 program and our own APL mint.
