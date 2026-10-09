# ARCH RUNNER — Backend Settlement Service

**Agent G (backend + security).** Date: **2026-10-09**. Chain: **Arch Network testnet** only.

This is the off-chain service that moves the Daily Block economy from DEMO to **live**. The
escrow/competition program is already deployed and E2E-verified (`docs/DEPLOYMENT_RESULT.md`);
this service holds the settlement-authority key server-side, validates competitive runs, and
drives real on-chain `create_match` / `settle_match` transactions. A full match was created,
scored, and **settled on testnet with an exact 70/20/10 payout** — tx hashes in §6.

---

## 1. Architecture (why it is shaped this way)

```
 browser client (NO key)                 settlement service (Node)            Arch testnet
 ─────────────────────────               ──────────────────────────           ────────────
 src/chain/archRead.ts   ── read_account_info (JSON-RPC) ─────────────────────▶  config / match / ATA
 src/chain/arch.ts
   • pool() / balanceOf() ── RPC reads (client-safe) ──────────────────────────▶  (no key)
   • settle()/openComp()  ── HTTP POST ──▶ server/index.ts
   • submitRunToService() ── HTTP POST ──▶   │
                                             ├─ /run/submit  → validate + record (no chain)
                                             ├─ /match/create┐
                                             └─ /match/settle┘→ server/signer.ts
                                                                   │ spawn child (key via env)
                                                                   ▼
                                                        server/arch-settle (Rust, arch_sdk 0.12)
                                                        build+sign+send+wait  ───────────────────▶ create_match / settle_match
```

**The key split.** Signing an Arch transaction needs BIP-322 over the exact `ArchMessage`
hash. The proven, node-v0.12-correct path for that is the Rust `arch_sdk 0.12` client (the same
toolchain the deploy used; the older TS SDK `0.0.28` predates node v0.12 and risks the exact
`rollback_status` skew that blocked the prior attempt — see `docs/DEPLOYMENT_RESULT.md §2`). So:

- **Node/TS** owns HTTP, run validation (the deterministic replay is TS), scoring, idempotency,
  and all **reads** (pure JSON-RPC + manual borsh decode in `src/chain/archRead.ts`, verified
  byte-exact against the live chain — it reproduces the config PDA, match PDA and vault ATA).
- **Rust `arch-settle`** is the *only* component that loads the authority secret and signs. It
  is invoked as a short-lived child process and prints one JSON line. This keeps the signing
  surface tiny and identical to the verified deploy path.

Reads need PDA/ATA derivation; Arch's scheme is `sha256(seed₀‖…‖bump‖program_id)` (no
`"ProgramDerivedAddress"` marker; a 32-byte digest is always off-curve so the bump is 255).
This is implemented in TS and verified against the deployed addresses, so the browser reads
on-chain state with **no key and no native dependency**.

---

## 2. Files

| Path | Role |
|---|---|
| `server/index.ts` | HTTP service (node:http, no framework). Endpoints in §3. |
| `server/runValidate.ts` | Daily-run validation: seed + rule-version + optional authoritative replay. |
| `server/store.ts` | In-memory validated-score book per match (duplicate guard + per-player best). |
| `server/signer.ts` | Spawns the Rust signer; forwards the key via env only. |
| `server/arch-settle/` | Rust CLI (`arch_sdk 0.12`): `create-match`, `settle`, `seed-players` (test). |
| `src/chain/archRead.ts` | Client-safe reads + verified PDA/ATA derivation + borsh decoders. |
| `src/chain/arch.ts` | `ArchSettlementProvider`: real reads; authority writes delegated to the service. |

---

## 3. Endpoints

| Method / path | Auth | Purpose |
|---|---|---|
| `GET /health` | — | liveness + whether the authority key is loaded |
| `GET /config` | — (read) | live config PDA (authority, mint, entry, timeouts) |
| `GET /match/:id` | — (read) | live match PDA (joined, state, players) + its validated leaderboard |
| `POST /run/submit` | — | validate a Daily Block run, record the official score; returns `ACCEPTED` / `REJECTED` / `DUPLICATE` |
| `POST /match/create` | admin/cron | `create_match` on-chain (authority-signed) → `{ txid, matchId, vault }` |
| `POST /match/settle` | admin/cron | rank validated scores, `settle_match` on-chain (70/20/10), idempotent → `{ txid, payouts }` |
| `POST /match/seed-players` | test only | create + self-join N funded players so a settle can be driven E2E |

### Payloads

```jsonc
// POST /run/submit   (every field is untrusted; the server derives the score)
{ "matchId":"1791527042026", "player":"<64-hex on-chain pubkey>", "dateKey":"2026-10-09",
  "seed":577595816, "clientScore":9000, "dist":300, "flips":1, "blockRuns":1,
  "versions": { "gameVersion":"1.0.0", "physicsVersion":"ARCHRUN_V2", "scoringVersion":"1.0.0" },
  "inputs": [ { "tick":12, "action":"jump" } ]   // optional; if present it is RE-SIMULATED
}
// POST /match/create   { "maxPlayers": 4 }                 (matchId optional → epoch-ms)
// POST /match/settle   { "matchId": "1791527042026" }      (resultHash optional 32-byte hex)
```

**Validation rules (`/run/submit`):** (1) `seed === dailySeed(dateKey)`; (2) rule versions must
equal `DAILY_RULES`; (3) if an `inputs` stream is sent it is re-simulated via the canonical
deterministic sim and the official score is derived (client score cross-checked); without a
stream the claimed score is recorded but flagged `replayVerified:false`; (4) an identical run
(same match/player/seed/score/dist) returns `DUPLICATE`. Only joined on-chain players can win.

**Settlement ranking.** At settle, the service reads `Match.players` on-chain and ranks each
joined player by their **best server-validated score** (ties broken by join order, deterministic).
That ordering becomes the `rankings` permutation the program uses; the program itself computes
the exact integer split and pays the winners' ATAs. The service never passes arbitrary amounts.

---

## 4. Run it

```bash
# 0. build the signer once (needs the Rust toolchain: ~/.cargo/bin)
npm run settle:build            # cargo build --release -> server/arch-settle/target/release/arch-settle

# 1. start the service (the secret is a FILE PATH here, not an argv/inline value)
SETTLE_PORT=8790 \
ARCH_SETTLEMENT_AUTHORITY_SECRET=/secure/path/authority.json \
  npm run settle:serve

# 2. drive it
curl -s localhost:8790/config
curl -s -XPOST localhost:8790/match/create  -d '{"maxPlayers":4}'
curl -s -XPOST localhost:8790/match/settle  -d '{"matchId":"<id>"}'
```

### Environment (`.env.example`)

| Var | Meaning |
|---|---|
| `SETTLE_PORT` | service port (default 8790) |
| `ARCH_SETTLEMENT_AUTHORITY_SECRET` | **server-side only.** 64-hex secret *or* a path to a file holding it (path preferred). Pinned pubkey `9sZMrF3N…` / hex `83d1…f3f5`. |
| `ARCH_SETTLE_BIN` | optional override of the signer binary path |
| `VITE_SETTLEMENT_SERVICE_URL` | client → service base URL (the client holds no key) |

The live program/mint hex ids are hard-wired in `src/chain/archRead.ts` and the Rust signer, so
reads and signing need no chain env beyond the key.

---

## 5. Client wiring

`src/chain/arch.ts` `ArchSettlementProvider` is **read + submit only**:

- `pool(id)` / `balanceOf(player)` → live JSON-RPC reads (browser-safe, no key).
- `openCompetition` / `settle` → delegated over HTTP to the service (which signs). The client
  cannot and must not settle itself; without a `serviceUrl` these throw an explicit error.
- `collectEntry` / `reclaim` → player-wallet-signed on-chain; in-browser wallet signing is not
  wired this phase, so they throw rather than fake a tx.
- `submitRunToService(url, body)` → POSTs a run to `/run/submit`.
- `makeSettlementProvider()` still **defaults to Mock**, so nothing fake ships until
  `MOCK_BLOCKCHAIN=false` + a real `serviceUrl` are set. DEMO labelling stays honest.

---

## 6. E2E result (real, on testnet — 2026-10-09)

Driven through the running service against `https://rpc.testnet.arch.network`
(match `1791527042026`, 4 players, entry 10, pot 40):

| Step | Result | Tx (status) |
|---|---|---|
| `POST /match/create` | match + vault created | `cf5e822eafa3fa7d3f421975bd508f736aa421cbcddd2d7ce6c1d4b7e4f8460a` **Processed** |
| 4 × `POST /run/submit` | all `ACCEPTED` (scores 9000/7000/5000/3000) | off-chain |
| duplicate re-submit | `DUPLICATE` | off-chain |
| wrong-seed submit | `REJECTED` (`SEED_MISMATCH`) | off-chain |
| `POST /match/settle` | **pot 40 → 28 / 8 / 4 / 0**, exact 70/20/10 | `71b39afbcc09b8a3c05333fc6d1b8aaba52addf4987ebb693b382fe3e575252e` **Processed** |
| on-chain verify | `match.state = SETTLED`, vault drained to **0**, winner ATAs = 28 / 8 / 4 / 0 | — |
| idempotent re-settle (service) | `{ alreadySettled: true }` (no new tx) | — |
| **double-settle (direct, bypassing the service)** | **rejected on-chain** | `a42a8a55bf290c969784e28302fa55b9a55f0af253b8e3f852c4e0e9f42ee154` **Failed** `custom program error: 0x8` = `MatchNotOpen` |

This is a **real server-authorized settlement**: the Node service, holding the authority key
server-side, signed and confirmed `settle_match` on testnet with the correct split, and the
program's terminal-state guard rejected a replayed settle. (The entry mint is decimals-0, so
"28/8/4" are whole tokens; the ratio is exactly 70/20/10.)

---

## 7. Security notes

- **Key isolation.** The authority secret lives only in the service process env and is handed
  solely to the `arch-settle` child via its environment — never on the command line (so it is
  not visible in the process table), never logged, never in a response, never in the client
  bundle or git. `src/chain/arch.ts`'s `ArchConfig` types `authoritySecret` as `never` so a key
  cannot be passed from client code. `.gitignore` excludes `.env*` (except the example) and the
  Rust `target/`.
- **No trusted client scores.** `/run/submit` derives the score server-side (replay when an
  input stream is given); the raw client claim is only ever a cross-check.
- **Settlement integrity.** Winners are computed from validated scores mapped to on-chain joined
  players; the program fixes the 70/20/10 split and the double-settle / refund guards — the
  service cannot pay arbitrary amounts or pay twice.
- **Idempotency in depth.** The service refuses to re-settle a `SETTLED` match and treats
  `REFUND` as terminal; the program enforces both regardless of what the service does.

---

## 8. Hosting / deploy

- **Host:** any Node 20+ box (Fly.io, Railway, a small VM) that can also run the compiled
  `arch-settle` binary (ship it alongside, or `cargo build --release` in the image; it is the
  only native dependency). The service makes outbound HTTPS to the Arch testnet RPC; it needs
  no inbound chain access and no database for this phase (scores are in-memory — swap
  `server/store.ts` for Postgres for durability).
- **Secret management:** inject `ARCH_SETTLEMENT_AUTHORITY_SECRET` as a mounted secret file and
  pass its path (preferred) via the platform's secret store; never bake it into the image.
- **Cron:** call `POST /match/create` at day roll-over and `POST /match/settle` after the join
  window; both are idempotent/safe to retry.
- **Remaining blocker:** none for testnet. Production durability (Postgres/Redis), the
  browser wallet-signed join/reclaim path, and a managed host for the service + secret are the
  next steps; mainnet is not possible (no Arch mainnet faucet / no protocol-native asset).
```
