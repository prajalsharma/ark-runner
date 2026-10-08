/**
 * Minimal ARCH RUNNER API — zero external deps (node:http). It exposes the
 * anti-cheat validator and the canonical daily seed. A real deployment adds
 * PostgreSQL (runs/leaderboards/settlements) + Redis; the validation + competition
 * logic it calls is already final and tested. Run: `npm run serve`.
 */
import http from "node:http";
import { validateSubmission } from "./validate.ts";
import { RULESET } from "../game/constants.ts";
import { dailySeed, dailyNumber, dateKeyUTC } from "../game/daily.ts";
import type { RunSubmission } from "../shared/contracts.ts";

const PORT = Number(process.env.PORT ?? 8788);
const MAX_BODY = 512 * 1024; // 512KB cap on a submission

function send(res: http.ServerResponse, code: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(json);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "", size = 0;
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error("body too large")); req.destroy(); } else data += c; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  const url = req.url ?? "/";

  if (req.method === "GET" && url === "/health") return send(res, 200, { ok: true, ruleset: RULESET });

  if (req.method === "GET" && url === "/daily") {
    const key = dateKeyUTC();
    return send(res, 200, { dateKey: key, seed: dailySeed(key), number: dailyNumber(key) });
  }

  if (req.method === "POST" && url === "/validate") {
    try {
      const sub = JSON.parse(await readBody(req)) as RunSubmission;
      return send(res, 200, validateSubmission(sub));
    } catch (e) {
      return send(res, 400, { error: String(e instanceof Error ? e.message : e) });
    }
  }

  return send(res, 404, { error: "not found" });
});

server.listen(PORT, () => console.log(`ARCH RUNNER API on http://localhost:${PORT} (ruleset ${RULESET})`));
