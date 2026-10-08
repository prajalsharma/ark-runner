/**
 * The wallet seam: the Mock provider drives connect/sign deterministically for the
 * demo (no keys, no network), and the real Arch provider is honest — it throws
 * rather than faking a connection or a signature.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MockWalletProvider } from "../src/wallet/mock.ts";
import { ArchWalletProvider } from "../src/wallet/arch.ts";

test("mock wallet connects, signs, and is deterministic per label", async () => {
  const w = new MockWalletProvider("alice");
  const s = await w.connect();
  assert.match(s.address, /^tb1p/);
  assert.equal(s.pubkey.length, 64);
  assert.equal(await w.getAddress(), s.address);
  const sig = await w.signMessage("enter daily-99");
  assert.match(sig, /^mock-sig:/);
  assert.equal(sig, await w.signMessage("enter daily-99"), "same message → same stub sig");

  const w2 = await new MockWalletProvider("alice").connect();
  assert.equal(w2.address, s.address, "same label → same address");
  const bob = await new MockWalletProvider("bob").connect();
  assert.notEqual(bob.address, s.address, "different label → different address");
});

test("mock wallet refuses to sign before connecting; disconnect clears it", async () => {
  const w = new MockWalletProvider("carol");
  await assert.rejects(w.signMessage("x"), /connect first/);
  await w.connect();
  await w.disconnect();
  assert.equal(await w.getAddress(), null);
});

test("Arch wallet provider is honest (throws, never fakes)", async () => {
  const w = new ArchWalletProvider("xverse");
  await assert.rejects(w.connect(), /not wired/);
  await assert.rejects(w.signMessage(), /not wired/);
});
