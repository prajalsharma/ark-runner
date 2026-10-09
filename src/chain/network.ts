/**
 * Network mode switch: TESTNET (live) vs MAINNET (not live — nothing runs there yet).
 * Persisted per device. Testnet points at the real, keyless Arch testnet RPC
 * (verified live + CORS-open). Mainnet is intentionally empty until there's something real.
 */
export type NetworkMode = "testnet" | "mainnet";

export const TESTNET_RPC = "https://rpc.testnet.arch.network";
export const TESTNET_EXPLORER = "https://explorer.arch.network";

const KEY = "archrunner.network.v1";

export function getNetwork(): NetworkMode {
  try { return localStorage.getItem(KEY) === "mainnet" ? "mainnet" : "testnet"; } catch { return "testnet"; }
}
export function setNetwork(m: NetworkMode): void {
  try { localStorage.setItem(KEY, m); } catch { /* ephemeral */ }
}
