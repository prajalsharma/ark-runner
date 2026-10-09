/** Network mode switch defaults to testnet and persists the choice. */
import { strict as assert } from "node:assert";
import { test } from "node:test";

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear(), key: () => null, length: 0,
} as unknown as Storage;

const { getNetwork, setNetwork, TESTNET_RPC } = await import("../src/chain/network.ts");

test("network defaults to testnet and persists", () => {
  localStorage.clear();
  assert.equal(getNetwork(), "testnet");
  setNetwork("mainnet");
  assert.equal(getNetwork(), "mainnet");
  setNetwork("testnet");
  assert.equal(getNetwork(), "testnet");
  assert.match(TESTNET_RPC, /^https:\/\/rpc\.testnet\.arch\.network$/);
});
