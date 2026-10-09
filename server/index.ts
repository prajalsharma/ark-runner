/**
 * ARCH RUNNER — settlement service (Node, node:http, no web framework).
 *
 * Moves the Daily Block economy from DEMO to live on Arch testnet. It:
 *   - reads live on-chain state (config / match) over JSON-RPC  — GET /config, GET /match/:id
 *   - validates competitive runs and records the verified score — POST /run/submit
 *   - creates the day's on-chain match (authority-signed)        — POST /match/create
 *   - settles on-chain with the exact 70/20/10 split, idempotent — POST /match/settle
 *
 * SECURITY: the settlement-authority secret lives ONLY in this process's environment
 * (ARCH_SETTLEMENT_AUTHORITY_SECRET) and is handed solely to the `arch-settle` child
 * process that signs. It is never logged, never returned, and never shipped to a client.
 * Reads hold no key and are safe to expose. Run: `npm run settle:serve`.
 */
import http from "node:http";
import { readConfig, readMatch, STATE_SETTLED, STATE_REFUND } from "../src/chain/archRead.ts";
import { validateRun, type SubmitBody } from "./runValidate.ts";
import { isDuplicate, record, leaderboard } from "./store.ts";
import * as signer from "./signer.ts";

const PORT = Number(process.env.SETTLE_PORT ?? process.env.PORT ?? 8790);
const MAX_BODY = 1 << 20; // 1 MiB (input streams can be large)

function jsonSafe(_k: string, v: unknown): unknown { return typeof v === "bigint" ? v.toString() : v; }

function send(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body, jsonSafe));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "", size = 0;
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error("body too large")); req.destroy(); } else data += c; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/** Rank the joined on-chain players by their best server-validated score, best first.
 *  Returns indices into Match.players (length == joined) — exactly what settle needs. */
function rankingsFor(matchId: string, players: string[], joined: number): { rankings: number[]; order: { idx: number; player: string; score: number }[] } {
  const scoreOf = new Map(leaderboard(matchId).map((r) => [r.player, r.officialScore] as const));
  const rows = players.slice(0, joined).map((p, idx) => ({ idx, player: p, score: scoreOf.get(p) ?? 0 }));
  rows.sort((a, b) => (b.score - a.score) || (a.idx - b.idx)); // ties resolve by join order (deterministic)
  return { rankings: rows.map((r) => r.idx), order: rows };
}

function expectedSplit(pot: number, joined: number): number[] {
  if (joined < 4) return [pot];
  const p1 = Math.floor((pot * 70) / 100), p2 = Math.floor((pot * 20) / 100);
  return [p1, p2, pot - p1 - p2];
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    if (req.method === "GET" && path === "/health") {
      return send(res, 200, { ok: true, service: "arch-runner-settlement", network: "testnet" });
    }

    // ---- reads (no key; client-safe) ----
    if (req.method === "GET" && path === "/config") {
      const cfg = await readConfig();
      if (!cfg) return send(res, 404, { error: "config not initialised" });
      return send(res, 200, cfg);
    }

    if (req.method === "GET" && path.startsWith("/match/")) {
      const id = path.slice("/match/".length);
      if (!/^\d+$/.test(id)) return send(res, 400, { error: "match id must be a u64 decimal" });
      const m = await readMatch(BigInt(id));
      if (!m) return send(res, 404, { error: "match not found" });
      const stateName = m.state === STATE_SETTLED ? "SETTLED" : m.state === STATE_REFUND ? "REFUND" : "OPEN";
      return send(res, 200, { ...m, stateName, leaderboard: leaderboard(id) });
    }

    // ---- POST endpoints ----
    if (req.method === "POST" && path === "/run/submit") {
      const b = JSON.parse(await readBody(req)) as SubmitBody;
      if (!b || !b.matchId) return send(res, 400, { error: "matchId required" });
      const verdict = validateRun(b);
      if (verdict.status === "REJECTED") return send(res, 200, verdict);
      const key = { matchId: b.matchId, player: b.player, dateKey: b.dateKey, seed: b.seed, officialScore: verdict.officialScore, dist: b.dist | 0, flips: b.flips | 0, blockRuns: b.blockRuns | 0 };
      if (isDuplicate(key)) return send(res, 200, { ...verdict, status: "DUPLICATE", detail: "identical run already recorded" });
      record({ ...key, ts: Date.now(), replayVerified: verdict.replayVerified });
      return send(res, 200, verdict);
    }

    if (req.method === "POST" && path === "/match/create") {
      const b = JSON.parse((await readBody(req)) || "{}") as { matchId?: string; maxPlayers?: number };
      const matchId = b.matchId && /^\d+$/.test(b.matchId) ? b.matchId : String(Date.now());
      const maxPlayers = b.maxPlayers && b.maxPlayers >= 2 && b.maxPlayers <= 8 ? b.maxPlayers : 4;
      const r = await signer.createMatch(matchId, maxPlayers);
      return send(res, 200, { ...r, maxPlayers });
    }

    // TEST helper (self-joins funded players so a settle can be driven E2E).
    if (req.method === "POST" && path === "/match/seed-players") {
      const b = JSON.parse((await readBody(req)) || "{}") as { matchId?: string; count?: number };
      if (!b.matchId || !/^\d+$/.test(b.matchId)) return send(res, 400, { error: "matchId required" });
      const r = await signer.seedPlayers(b.matchId, Math.max(1, Math.min(8, b.count ?? 4)));
      return send(res, 200, r);
    }

    if (req.method === "POST" && path === "/match/settle") {
      const b = JSON.parse((await readBody(req)) || "{}") as { matchId?: string; resultHash?: string };
      if (!b.matchId || !/^\d+$/.test(b.matchId)) return send(res, 400, { error: "matchId required" });
      const m = await readMatch(BigInt(b.matchId));
      if (!m) return send(res, 404, { error: "match not found" });
      // Idempotency / guard honoured off-chain too (the program enforces it on-chain regardless).
      if (m.state === STATE_SETTLED) return send(res, 200, { alreadySettled: true, state: "SETTLED", matchId: b.matchId });
      if (m.state === STATE_REFUND) return send(res, 409, { error: "match is in REFUND; settlement is permanently blocked", state: "REFUND" });
      if (m.joined === 0) return send(res, 409, { error: "no players joined; nothing to settle" });

      const { rankings, order } = rankingsFor(b.matchId, m.players, m.joined);
      const pot = Number(m.entry) * m.joined;
      const split = expectedSplit(pot, m.joined);
      const result = await signer.settle(b.matchId, rankings, b.resultHash);
      const payouts = result.winners.map((w, i) => ({ player: w, amount: split[i] ?? 0 }));
      return send(res, 200, { txid: result.txid, matchId: b.matchId, joined: m.joined, pot, split, payouts, rankings, order, resultHash: result.resultHash, status: "SETTLED" });
    }

    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 400, { error: String(e instanceof Error ? e.message : e) });
  }
});

server.listen(PORT, () => {
  const haveKey = Boolean(process.env.ARCH_SETTLEMENT_AUTHORITY_SECRET);
  console.log(`ARCH RUNNER settlement service on http://localhost:${PORT}`);
  console.log(`  reads: GET /config, GET /match/:id   writes: POST /match/create, /match/settle, /run/submit`);
  console.log(`  authority key loaded: ${haveKey ? "yes (server-side)" : "NO — write endpoints will fail until ARCH_SETTLEMENT_AUTHORITY_SECRET is set"}`);
});
