# ARCH RUNNER — Economy: what's LIVE vs still-DEMO

**Agent I (Arch + backend).** Date: **2026-10-09**. Chain: **Arch Network testnet** only (never Arkade).

This is the honest status of the in-game economy after wiring browser **wallet-signed entry** and
packaging the settlement service for hosting. The rule we hold to: **nothing is labelled live/paid
in-game until a real on-chain tx confirms (`status == Processed`)**, and the client defaults to
**DEMO** until a settlement service is hosted + configured.

---

## 1. LIVE now (verified)

| Thing | Status | Evidence |
|---|---|---|
| Escrow/competition program on testnet | LIVE | `docs/DEPLOYMENT_RESULT.md` — program `8R9Mf…duL5`, full deposit→settle E2E, 70/20/10 |
| APL entry mint (decimals 0) | LIVE | mint `3rc7M…WSMH2` |
| Server-authorized settlement | LIVE | `docs/BACKEND_SETTLEMENT.md §6` — `settle_match` tx `71b39afb…5252e` **Processed** |
| Client **reads** (pool / balance / config / match) | LIVE | keyless JSON-RPC via `src/chain/archRead.ts` (byte-exact PDA/ATA) |
| Client **wallet-signed JOIN** construction | LIVE + VERIFIED | `src/chain/archTx.ts`; proven byte-exact vs `arch_sdk 0.12` (below) |
| Settlement service container + deploy guide | DELIVERED | `Dockerfile`, `.dockerignore`, `docs/HOSTING.md` |

### 1.1 The wallet-signed JOIN is real and byte-exact

`src/chain/archTx.ts` builds the `JoinMatch` transaction exactly the way the canonical Rust SDK
does — `CompiledKeys` account ordering, `ArchMessage::serialize`, and the signing digest
`ArchMessage::hash` (double-SHA256 rendered as a 64-char hex string). The connected UniSat/OKX
wallet signs that digest with **BIP-322-simple** and we extract the 64-byte Schnorr signature from
the witness — identical to the SDK's `build_and_sign_transaction` →
`sign_message_bip322(signer, message.hash())` path. No authority key is ever in the browser.

**Proof A — byte-exact vs arch_sdk 0.12 (deterministic, in CI).** `tests/archtx.test.ts` asserts the
TS-built message `serialize()` and signing `hash()` equal the real SDK output for a fixed
(player, match_id, blockhash). The golden was produced by the SDK itself via a keyless, network-free
construction subcommand added to the signer:

```
./server/arch-settle/target/release/arch-settle join-bytes \
  1111…11 (player x-only)  1791521107411 (match_id)  2222…22 (blockhash)
# -> serialize = 0100060a0000…0502010501000000 02   (395 bytes)
# -> hash      = 5b801657ad38c5462006b8a23f9d07640b4a459549c80f769c28b9a71b0509ca
```

**Proof B — the live testnet node accepts the wire format and reaches signature verification.** A
`JoinMatch` `RuntimeTransaction`, built entirely by `src/chain/archTx.ts` for a valid secp256k1
x-only key against the real match `1791521107411`, was POSTed to `https://rpc.testnet.arch.network`.
The node **fully parsed** the transaction (version, signatures, header, account_keys, blockhash,
instructions) and advanced to BIP-322 verification over `account_keys[0]`, returning:

```
"BIP322 signature verification failed: BIP322 verification failed: Invalid signature"
```

i.e. everything except the (placeholder) signature was accepted — the message serialization, the
RuntimeTransaction JSON shape, the blockhash, and the account layout are all correct against the
live node. A random (non-curve) key instead returns `XOnlyPublicKey … malformed public key`,
confirming the node reads `account_keys[0]` as the signer exactly as intended.

Together, Proof A (bytes == SDK) and Proof B (node parses + verifies against account_keys[0]) mean a
real wallet signature over that digest produces a transaction the node will accept.

---

## 2. Still DEMO (by design, until a service is hosted)

- **The game ships in DEMO.** `src/chain/clientConfig.ts` returns `MockSettlementProvider` unless
  **both** `VITE_MOCK_BLOCKCHAIN=false` **and** `VITE_SETTLEMENT_SERVICE_URL` are set. The Daily
  Block brief shows `FREE · DEMO` and the in-memory `RunnerLedger` until then.
- **No confirmed on-chain JOIN tx hash was produced here**, and none is claimed. A *fully executing*
  join needs two things that only the **server authority** provisions (never the client):
  1. an **OPEN match** for the day (`create_match`, authority-signed), and
  2. the player actually **holding the entry token** (minted by the authority).
  The authority secret is correctly **not** available to the client or to this build, so the
  end-to-end Processed JOIN is exercised once the service is hosted + a player is funded. The
  construction and submission path are already proven correct (§1.1).
- **Mainnet: N/A.** No Arch mainnet faucet, no protocol-native asset. Testnet only.

---

## 3. The exact LIVE flow (once configured)

1. Build the client with `VITE_MOCK_BLOCKCHAIN=false` + `VITE_SETTLEMENT_SERVICE_URL=https://…`.
2. Host the settlement service (`Dockerfile` + `docs/HOSTING.md`); set
   `ARCH_SETTLEMENT_AUTHORITY_SECRET` (mounted file preferred).
3. Day roll-over cron: `POST /match/create` with `matchId = dailyMatchId(today)` (the client derives
   the **same** id; `GET /daily/current` reports it).
4. Player connects a Taproot (BIP-86) wallet (UniSat/OKX) and opens **DAILY BLOCK**. The brief now
   reads **ON-CHAIN**. On *ENTER · PAY ENTRY ON-CHAIN*:
   - the client reads the match on-chain (must be OPEN) and the player's entry-token balance,
   - builds `JoinMatch` (`archTx`), the **wallet signs** it (BIP-322 over the digest),
   - submits to the keyless RPC and polls — UI shows **pending → confirmed (Processed) → run**, or a
     truthful failure (`ArchSettlementProvider.collectEntry` throws unless `Processed`).
5. After the window, cron `POST /match/settle` ranks validated scores and the **authority** signs
   `settle_match` (exact 70/20/10). Players can `reclaim` after the settle deadline if it never runs.

---

## 4. Precise remaining steps to flip fully live

1. **Host the service** (`docs/HOSTING.md`) with the authority secret injected as a mounted file.
2. **Configure the client** (`VITE_MOCK_BLOCKCHAIN=false`, `VITE_SETTLEMENT_SERVICE_URL`).
3. **Fund entry tokens**: decide distribution (faucet/airdrop of the decimals-0 APL mint) so players
   hold the entry token; the authority is the mint authority.
4. **Cron** `create` at roll-over and `settle` after the window.
5. **First real JOIN**: with (1)–(3) done, a player's wallet-signed `JoinMatch` will confirm
   (`status == Processed`) — capture that tx hash to flip the honesty label from "construction
   verified" to "paid live".
6. Optional durability: swap `server/store.ts` (in-memory) for Postgres.

Nothing above weakens the honesty rule: every new "live/paid" claim must be backed by a `Processed`
transaction signature.
