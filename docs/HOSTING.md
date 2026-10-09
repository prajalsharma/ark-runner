# ARCH RUNNER — Hosting the Settlement Service

**Agent I.** Date: **2026-10-09**. Chain: **Arch Network testnet** only.

How to deploy the off-chain settlement service (`server/`) + its Rust `arch-settle` signer so the
in-game economy can go LIVE. Until this is hosted and the client is pointed at it with
`VITE_MOCK_BLOCKCHAIN=false`, the game stays in **DEMO** (honest default). The on-chain program
and mint are already live and E2E-verified — see `docs/DEPLOYMENT_RESULT.md` and
`docs/BACKEND_SETTLEMENT.md`.

The service makes only **outbound** HTTPS to the Arch testnet RPC, needs **no inbound chain
access** and **no database** for this phase (scores are in-memory; swap `server/store.ts` for
Postgres for durability). The one native dependency is the compiled `arch-settle` binary.

---

## 1. The security boundary (read first)

- The **settlement-authority secret is never in the image, the repo, or the client bundle.** It is
  injected at run time via `ARCH_SETTLEMENT_AUTHORITY_SECRET`, which is **either a 64-hex secret or
  a path to a file holding it** — a **file path is preferred** so the secret never appears in the
  process table. Only the `arch-settle` child process ever reads it (`server/signer.ts`).
- `.gitignore` excludes `.env*` (except the example) and all Rust `target/`. `.dockerignore`
  excludes the same plus `node_modules` — scan before any build: there must be no key on disk in
  the build context.
- Players pay their **own** entry with their **own** wallet (`JoinMatch`, client-signed). The
  authority only ever signs `create_match` and `settle_match`.

---

## 2. Container build & run (generic — works on any Docker host)

```bash
# from the repo root (build context must include program/ and server/arch-settle/)
docker build -t arch-runner-settle .

# run — inject the authority secret as a MOUNTED FILE (preferred), never baked in
docker run -d --name settle -p 8790:8790 \
  -v /secure/authority.json:/run/secrets/authority.json:ro \
  -e ARCH_SETTLEMENT_AUTHORITY_SECRET=/run/secrets/authority.json \
  -e SETTLE_PORT=8790 \
  arch-runner-settle

# verify
curl -s localhost:8790/health          # {"ok":true,...,"authorityKeyLoaded":true}
curl -s localhost:8790/daily/current    # {"dateKey":...,"matchId":...,"state":"NOT_CREATED|OPEN|..."}
```

The image is multi-stage: stage 1 (`rust:1-bookworm`) compiles `arch-settle`; stage 2
(`node:20-slim`) runs `server/index.ts` via `tsx`, with the binary copied in and
`ARCH_SETTLE_BIN` pre-set. A `HEALTHCHECK` polls `/health`.

### Environment variables

| Var | Required | Meaning |
|---|---|---|
| `ARCH_SETTLEMENT_AUTHORITY_SECRET` | **yes (writes)** | 64-hex secret **or** a path to a file holding it (path preferred). Server-side only. Pinned pubkey `9sZMrF3N…`. |
| `SETTLE_PORT` | no (default 8790) | service port |
| `ARCH_SETTLE_BIN` | no (preset in image) | override the signer binary path |

Reads work without the key; `create_match` / `settle` fail with a clear error until it is set.

---

## 3. Free / managed hosts

Any Node-20 host that can also run a small native binary works. Two trivial options:

- **Fly.io** — `fly launch` (detects the Dockerfile), then set the secret as a file-ish secret:
  `fly secrets set ARCH_SETTLEMENT_AUTHORITY_SECRET=<64-hex>` (hex form; or mount a file via a
  Fly volume and pass its path). `fly deploy`. Expose port 8790 (`fly.toml` `internal_port = 8790`).
- **Railway / Render** — "Deploy from Dockerfile", add the env var `ARCH_SETTLEMENT_AUTHORITY_SECRET`
  in the dashboard (use the platform's **secret** store, not a plain var), set the service port to
  `8790`, enable the health check at `/health`.

For both, prefer the file-path form of the secret where the platform supports mounted secret files;
otherwise the 64-hex form in the platform secret store is acceptable (still never in git/image).

---

## 4. Point the client at it

Build the client with:

```
VITE_MOCK_BLOCKCHAIN=false
VITE_SETTLEMENT_SERVICE_URL=https://<your-settlement-host>
```

With both set, the Daily Block brief switches from `FREE · DEMO` to a real **ON-CHAIN** entry: the
player signs `JoinMatch` in their wallet (`src/chain/archTx.ts` builds it, the connected UniSat/OKX
wallet signs it BIP-322, it is submitted to the keyless RPC). Leave either unset → DEMO.

---

## 5. Day roll-over (cron)

The Daily Block match id is deterministic: `dailyMatchId(dateKey)` = Unix-seconds of that day's
00:00 UTC (`src/game/daily.ts`), and the client derives the **same** id, so no shared state is
needed. At roll-over:

```bash
# create today's match (idempotent per id; safe to retry)
curl -s -XPOST https://<host>/match/create -d "{\"matchId\":\"$(curl -s https://<host>/daily/current | jq -r .matchId)\",\"maxPlayers\":8}"
# …after the play window, rank validated scores and settle 70/20/10 (idempotent)
curl -s -XPOST https://<host>/match/settle -d "{\"matchId\":\"<id>\"}"
```

Both are idempotent and safe to retry; the on-chain program enforces the double-settle and refund
guards regardless. Use any scheduler (platform cron, GitHub Actions, a systemd timer).

---

## 6. Honesty boundary

- **Testnet only.** There is no Arch mainnet faucet and no protocol-native asset — mainnet stays
  N/A. Entry/prizes use our own decimals-0 APL token; "value" is testnet-only.
- Nothing is labelled live/paid in-game until a real `JoinMatch` confirms (`status == Processed`).
  `collectEntry` throws unless the tx confirms, so the UI can only ever show a truthful state.
