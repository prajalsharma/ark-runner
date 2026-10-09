/**
 * Real Arch testnet RPC client — plain JSON-RPC 2.0 over fetch to the keyless public
 * endpoint. These are LIVE values straight off the chain (verified: get_block_count,
 * is_node_ready, get_best_block_hash all return real data; CORS is open). No mock, no
 * fallback number — a failed call surfaces as an error the UI shows honestly.
 */
import { TESTNET_RPC } from "./network.ts";

async function call<T>(method: string, params: unknown[] = [], timeoutMs = 8000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(TESTNET_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`RPC ${res.status}`);
    const json = (await res.json()) as { result?: T; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    return json.result as T;
  } finally {
    clearTimeout(timer);
  }
}

export type TestnetStatus = { blockCount: number; nodeReady: boolean; bestHash: string; latencyMs: number };

/** One round-trip of real, live Arch testnet state. Throws on network/RPC failure. */
export async function fetchTestnetStatus(): Promise<TestnetStatus> {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const [blockCount, nodeReady, bestHash] = await Promise.all([
    call<number>("get_block_count"),
    call<boolean>("is_node_ready"),
    call<string>("get_best_block_hash"),
  ]);
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return { blockCount, nodeReady, bestHash, latencyMs: Math.round(t1 - t0) };
}
