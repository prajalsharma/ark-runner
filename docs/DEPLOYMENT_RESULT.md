# ARK RUNNER — Arch Testnet Deployment Result

**Agent F2 (Arch deploy engineer).** Date: **2026-10-09**. Chain: **Arch Network testnet** only (never Arkade).

**Status: LIVE on testnet.** A real escrow/competition program is deployed, an APL entry
token is minted, and a full deposit → settle economy ran end-to-end on-chain with exact
70/20/10 payouts. Every claim below is backed by a program ID, a mint address, and confirmed
transaction signatures. The version-skew blocker from the prior audit is **resolved**.

---

## 1. TL;DR — the live facts

| Thing | Value |
|---|---|
| RPC endpoint | `https://rpc.testnet.arch.network` (keyless; node v0.12.0; height ~741,312 at deploy) |
| **Program ID (base58)** | `8R9MfjGyBcduUTZAR91ruyyCDXX4BYAHSWCQzaR5duL5` |
| **Program ID (hex)** | `6e31324a4fc9d70d2ea0ed5417b9ed9208e8ea314ac46065eacb0af3441e0e42` |
| **Entry-token MINT (base58)** | `3rc7Mkh4vYT2LXKADeoQd8kTFMzdZxyHPSTV5KmWSMH2` |
| **Entry-token MINT (hex)** | `2a6c8835a36d6d4976e84553c9b3a0efb299658b608b34745764ae665f49d929` (decimals **0**) |
| Settlement authority (addr) | `9sZMrF3NLhpTG63LvKN2eRKDZu8H4AQwozUX5Ri31H5E` / hex `83d1…f3f5` — key SERVER-SIDE only |
| Config PDA (initialized) | `dc9ea90156bde1d13654945ce6403e04163d135c3cea87f9efc2ab89f49fe572` |
| APL Token Program | `TokenT4em53UrV4gSvZ3nCS2mZeHaqTLapwt6iZt6Mk` |
| APL Assoc-Token Program | `ATok9pxLsNzM5zJJ3UQpXBrMriHpZiY5Yio3GKYU4we3` |
| System program | `11111111111111111111111111111111` |

The config was initialized with **entry = 10 base units, join_timeout = 3600s,
settle_timeout = 7200s**, fee = 0% (prizes funded only by entries — no invented yield).

### Confirmed transaction signatures (all `status == Processed`)

- Mint creation: `1b7b91ab75be1b0aa3138897925876dabd930f667944db84ea6b81e2d30f50cc`
- `init_config`: `69f08b0ed4ed4b2bd138d6c1588c205e869649010cc0ebce9e5c5153d6b6c8fc`
- Program deploy: **157 ELF-write transactions** across 2 batches, all confirmed (arch-kit `ProgramDeployer`).
- E2E match (match_id `1791521107411`, pda `ba980d2f…80aec4`, vault `3cfd3936…518d49`):
  - `create_match` (+ vault ATA): `0f26934a296505f6b8bdb3456dbeeb8dc403e019882c899550768e5b653cf2f2`
  - joins P0..P3: `6d7a25d0…490ea9`, `2bee13d9…c71ff3`, `8f1d0e95…6c1ec507`, `bcc16c88…1a008a38`
  - `settle_match`: `1e8cdde4aa64a39275fc246d80bced1abaa1e5c2daf480f9d41d9cc5aa449338`
  - Result: pot 40 → **28 / 8 / 4 / 0** (exact 70/20/10, rank-3 remainder-safe), vault drained to **0**,
    match state = **SETTLED**, and a replayed `settle` was **rejected** (double-settle guard holds).

---

## 2. What was the blocker, and how it was fixed

The prior audit (`docs/ARCH_ECONOMY_AND_DEPLOYMENT.md`) pinned the blocker as a **client/node
version skew**: `arch-cli 0.8.6` (arch_sdk 0.8) deserializes the tx-status RPC into a struct that
still requires `rollback_status`, which **node v0.12.0 removed** — so every tx-wait died with
`missing field rollback_status`. The fix was to switch to the **0.12-compatible toolchain**:

1. Installed the maintained deployer: `cargo install arch-kit --locked` → **arch-kit 0.1.8**
   (targets `arch_sdk` / `apl-token` / `apl-associated-token-account` **0.12.0**). It uses
   `wait_for_processed_transaction` + `status == Processed` — the v0.12-correct path.
2. Ported the proven Scramble escrow to `arch_program`/APL **0.12.0** (see §3) and rebuilt the `.so`
   (the pre-reset `scramble.so` is not reusable).
3. Deployed + funded via the keyless faucet with arch-kit; ran the economy E2E with a small Rust
   client built on `arch_sdk 0.12` (same SDK arch-kit uses).

No external/credential/network prerequisite was missing — the testnet RPC and faucet are live.

---

## 3. The ported program (`program/`)

- `program/src/lib.rs` — native APL PDA-vault escrow, ported verbatim from the proven
  `~/hashplay-satoshi-scramble/programs/scramble/src/lib.rs`. The public 0.8→0.12 API
  (`AccountInfo`, `next_account_info`, `invoke_signed`, `get_clock`, `minimum_rent`,
  `system_instruction::create_account`, `apl_token::instruction::transfer`,
  `get_associated_token_address_and_bump_seed`) is **unchanged**, so no logic changes were
  needed — only a dependency bump and a cosmetic rename (`Scramble*`→`Escrow*`,
  env `SCRAMBLE_AUTHORITY`→`ARK_AUTHORITY`).
- `program/Cargo.toml` — crate `ark-runner-escrow`, deps pinned `=0.12.0` for `arch_program`,
  `apl-token`, `apl-associated-token-account`; `borsh 1.5.1`.
- Build artifact: `program/target/deploy/ark_runner_escrow.so` (156,448 bytes). `target/` is gitignored.

The program pins its InitConfig authority at build time (`ARK_AUTHORITY=<64-hex> cargo build-sbf`)
to prevent config squatting. Host unit tests (`payouts` exactness, borsh LENs) pass against 0.12.

### Instruction ABI (borsh enum `EscrowInstruction`, discriminant = variant index)

| # | Instruction | Payload | Accounts (in order) |
|---|---|---|---|
| 0 | `InitConfig` | `entry: u64, join_timeout_secs: i64, settle_timeout_secs: i64` | authority(s,w), config_pda(w), mint(r), settlement_authority(r), system(r) |
| 1 | `CreateMatch` | `match_id: u64, max_players: u8` | settlement_authority(s,w), config(r), match_pda(w), vault_ata(w), system(r) |
| 2 | `JoinMatch` | — | player(s), config(r), match_pda(w), player_ata(w), vault_ata(w), token_program(r) |
| 3 | `SettleMatch` | `result_hash: [u8;32], rankings: [u8;8]` | settlement_authority(s), config(r), match_pda(w), vault_ata(w), token_program(r), winner_ata(w) × k |
| 4 | `ReclaimEntry` | — | player(s), config(r), match_pda(w), vault_ata(w), player_ata(w), token_program(r) |

- `k` = `joined >= 4 ? 3 : 1`; winner ATAs are passed in rank order (`players[rankings[0..k]]`).
- PDAs: config = `find_program_address(["config"], program_id)`;
  match = `find_program_address(["match", match_id.to_le_bytes()], program_id)`.
- Vault = ATA(match_pda, mint); player/winner = ATA(owner, mint), under the APL ATA program above.
- Match state byte layout for a quick read: offset 16 = `max_players`, 17 = `joined`, 18 = `state`
  (0 OPEN / 1 SETTLED / 2 REFUND).

---

## 4. Exact commands run (reproducible)

```bash
# 0. 0.12 deployer
cargo install arch-kit --locked            # -> ~/.cargo/bin/arch-kit (0.1.8)

# 1. keys (secrets live OUTSIDE the repo; refer to addresses only)
arch-kit --bitcoin-network testnet keygen <keys>/program.json <keys>/authority.json
arch-kit --bitcoin-network testnet keygen <keys>/mint.json
#   program   -> 8R9MfjGyBcduUTZAR91ruyyCDXX4BYAHSWCQzaR5duL5
#   authority -> 9sZMrF3NLhpTG63LvKN2eRKDZu8H4AQwozUX5Ri31H5E (hex 83d1…f3f5)
#   mint      -> 3rc7Mkh4vYT2LXKADeoQd8kTFMzdZxyHPSTV5KmWSMH2

# 2. build the .so, pinning the authority into the binary
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"  # cargo build-sbf (platform-tools 3.1.10)
cd program
ARK_AUTHORITY=83d11ff4c988b7cb33479ddda42e4c1af203b1a347b7c0cf2b943ecbccbcf3f5 cargo build-sbf

# 3. deploy to testnet (faucet-funds the authority, then uploads the ELF)
arch-kit --rpc-url https://rpc.testnet.arch.network --bitcoin-network testnet deploy \
  --elf target/deploy/ark_runner_escrow.so \
  --program-key <keys>/program.json \
  --authority  <keys>/authority.json \
  --fund-authority
#   -> Program ID 8R9MfjGyBcduUTZAR91ruyyCDXX4BYAHSWCQzaR5duL5  (157 ELF txs confirmed)

# 4. mint our own APL entry token (no protocol-native asset exists)
arch-kit --rpc-url https://rpc.testnet.arch.network --bitcoin-network testnet create-mint \
  --mint-signer <keys>/mint.json --signer <keys>/authority.json --decimals 0
#   -> Mint 3rc7Mkh4vYT2LXKADeoQd8kTFMzdZxyHPSTV5KmWSMH2  (tx 1b7b91ab…f50cc)

# 5. economy E2E (init_config, create_match, 4 joins, settle, double-settle guard)
#    Rust harness on arch_sdk 0.12 — source archived in the scratchpad (not committed):
#    scratchpad/e2e/{Cargo.toml,src/main.rs}
```

Tool versions: arch-kit 0.1.8 · arch_sdk/apl 0.12.0 · host cargo/rustc 1.96.0 ·
platform-tools `cargo build-sbf` 3.1.10 · borsh 1.5.1. Testnet node v0.12.0.

> Build note: `cargo build-sbf` prints a non-fatal `Stack offset … exceeded` line for the
> transitive host dep `bitcode` (pulled by arch-titan types); it is **not** on our program's
> call path, the build finishes, and the `.so` is produced. Our program does not use `bitcode`.

---

## 5. How to wire `src/chain/arch.ts` (do NOT fake — this is the real seam)

`ArchSettlementProvider` in `src/chain/arch.ts` currently throws `NOT_WIRED` on every method and
`makeSettlementProvider` defaults to Mock. To go live, implement the methods against the deployed
program using **`@arch-network/arch-sdk` 0.0.28** (low-level RPC + tx build/sign). Keep the
settlement-authority key **server-side only** (`src/server/`), never in client bundles.

### 5.1 Constants to fill in (`ArchConfig` / env)

```ts
const arch: ArchConfig = {
  rpcUrl:   "https://rpc.testnet.arch.network",
  programId:"6e31324a4fc9d70d2ea0ed5417b9ed9208e8ea314ac46065eacb0af3441e0e42",
  mint:     "2a6c8835a36d6d4976e84553c9b3a0efb299658b608b34745764ae665f49d929",
  authoritySecret: process.env.ARCH_SETTLEMENT_AUTHORITY_SECRET, // server only; pubkey 83d1…f3f5
};
makeSettlementProvider({ mock: false, arch });
```

Set the same in `.env` (`MOCK_BLOCKCHAIN=false`): `ARCH_SETTLEMENT_PROGRAM_ID=6e3132…0e42`,
`ARCH_ENTRY_MINT=2a6c88…d929`, **`ARCH_ENTRY_DECIMALS=0`** (the deployed mint is decimals-0 — the
`.env.example` default of 8 does not match; either change env to 0 or mint a fresh decimals-8 token).

Program/token constants the client code needs:
`TOKEN_PROGRAM_ID = TokenT4em53UrV4gSvZ3nCS2mZeHaqTLapwt6iZt6Mk`,
`ASSOCIATED_TOKEN_PROGRAM_ID = ATok9pxLsNzM5zJJ3UQpXBrMriHpZiY5Yio3GKYU4we3`,
`SYSTEM_PROGRAM_ID = 11111111111111111111111111111111`.

### 5.2 Method-by-method mapping (GameSettlementProvider → on-chain)

- **`openCompetition(id, {feeRateBps})`** → send `CreateMatch { match_id, max_players }`, signed by
  the settlement authority, *preceded in the same tx by* `createAssociatedTokenAccountIdempotent`
  for the vault = ATA(match_pda, mint). Map the string `id` → a `u64` match_id (e.g. a counter or
  epoch-ms). **`InitConfig` is a one-time global** (already done on-chain); do not call it per
  competition. NOTE: the on-chain fee is **fixed at 0%** and the split is **fixed 70/20/10**;
  `feeRateBps` is not honored on-chain — enforce any protocol fee off-chain or redeploy a variant.
- **`collectEntry(id, player, amount)`** → player-signed `JoinMatch`. `amount` MUST equal the
  config `entry` (currently 10 base units); the program escrows exactly `entry` from the player ATA
  into the vault ATA. Pre-create the player ATA (idempotent) if needed.
- **`settle(id, payouts)`** → settlement-authority-signed `SettleMatch { result_hash, rankings }`.
  The program computes the exact split itself from `rankings` (a permutation of `0..joined`, best
  first); it does **not** accept arbitrary payout amounts. Convert your `Payout[]` ordering into
  `rankings` and pass the rank-1..k winner ATAs as trailing writable accounts. `result_hash` is a
  32-byte attestation of the canonical result. Return `{ txRef: <txid>, paid }`.
- **`reclaim(id, player)`** → player-signed `ReclaimEntry`, valid only after `settle_deadline`;
  refunds the player's `entry` and permanently blocks late settlement for that match.
- **`pool(id)`** → read the match PDA (decode `joined`, `state`, `entry`) + the vault ATA amount
  (u64 LE at byte offset 64 of the token account) to populate `PoolView`.
- **`balanceOf(player)`** → read ATA(player, mint) token amount (same offset-64 u64 LE).

### 5.3 Tx mechanics (from the verified Rust flow, mirror in TS)

Build each instruction as borsh `{ variant_index, ...payload }` with the account order in §3.
Message = `ArchMessage(instructions, payer, recent_blockhash)` where blockhash =
`get_best_finalized_block_hash`; sign with BIP-322 over the message hash; `send_transaction`;
then poll `wait_for_processed_transaction` and require `status == "Processed"`.

**Stale-read gotcha (verified):** balances read immediately after `settle` lag across RPC read
replicas. Poll the vault ATA until it reads 0 (all transfers propagated), then wait ~2s before
asserting winner balances. The harness does exactly this.

---

## 6. Honesty boundary — what is and isn't live

**LIVE (verified on-chain today):** the settlement program, the APL entry mint, and the full
deposit→settle→payout economy with exact 70/20/10 and the double-settle + reclaim guards.

**Still DEMO until the TS seam is wired:** the game itself still runs on
`MockSettlementProvider` because `src/chain/arch.ts` throws `NOT_WIRED`. Wiring it per §5 (no
`src/` edits were made by this agent) flips the game to the live program. **Mainnet: nothing** —
there is no Arch mainnet faucet and no protocol-native asset; this is testnet-only, entry-funded.

**Config is immutable once set:** `InitConfig` is one-shot (re-init returns `AlreadyInitialized`),
so the live entry is fixed at 10 base units. A different entry/decimals needs a fresh `--program-key`
deploy + new `InitConfig` (and a matching mint). The authority is pinned into the `.so`, so a
re-deploy with a new authority also requires a rebuild with the new `ARK_AUTHORITY`.
