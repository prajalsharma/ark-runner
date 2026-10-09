/**
 * signer — the ONLY bridge to the settlement-authority key. It never loads the secret into
 * this Node process; it spawns the `arch-settle` Rust binary (arch_sdk 0.12, the v0.12-correct
 * client) as a child process and forwards `ARCH_SETTLEMENT_AUTHORITY_SECRET` through the child's
 * environment (a file path is preferred, so the secret is never an argv entry). The binary
 * prints a single JSON line on stdout; stderr carries diagnostics. This keeps the signing
 * surface tiny, auditable, and identical to the path that E2E-verified the economy on testnet.
 */
import { spawn } from "node:child_process";

const BIN = process.env.ARCH_SETTLE_BIN
  ?? new URL("./arch-settle/target/release/arch-settle", import.meta.url).pathname;

export type CreateMatchResult = { txid: string; matchId: number; matchPda: string; vault: string };
export type SettleResultJson = { txid: string; matchId: number; joined: number; pot: number; winners: string[]; resultHash: string };
export type SeedResult = { players: string[] };

function run<T>(args: string[], timeoutMs = 180_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const secret = process.env.ARCH_SETTLEMENT_AUTHORITY_SECRET;
    if (!secret) return reject(new Error("ARCH_SETTLEMENT_AUTHORITY_SECRET is not set (server-side only)"));
    const child = spawn(BIN, args, {
      env: { ...process.env, ARCH_SETTLEMENT_AUTHORITY_SECRET: secret },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`arch-settle ${args[0]} timed out`)); }, timeoutMs);
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`cannot spawn arch-settle (${BIN}): ${e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim() || `arch-settle exited ${code}`));
      const line = out.trim().split("\n").filter(Boolean).pop() ?? "";
      try { resolve(JSON.parse(line) as T); }
      catch { reject(new Error(`arch-settle gave non-JSON output: ${out.slice(0, 400)}`)); }
    });
  });
}

export function createMatch(matchId: string, maxPlayers: number): Promise<CreateMatchResult> {
  return run<CreateMatchResult>(["create-match", matchId, String(maxPlayers)]);
}

/** rankings: player indices into Match.players, best first (length == joined). */
export function settle(matchId: string, rankings: number[], resultHashHex?: string): Promise<SettleResultJson> {
  const args = ["settle", matchId, rankings.join(",")];
  if (resultHashHex) args.push(resultHashHex);
  return run<SettleResultJson>(args, 240_000);
}

/** TEST helper: create + self-join N funded players so a settle can be driven E2E. */
export function seedPlayers(matchId: string, count: number): Promise<SeedResult> {
  return run<SeedResult>(["seed-players", matchId, String(count)], 300_000);
}
