/**
 * Character selection + wallet-linked profile. Identity is the wallet address; the
 * name is presentation. Characters are cosmetic (no gameplay effect). Persistence is
 * exercised with a tiny in-memory localStorage.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

// Minimal localStorage so the persistence paths actually run under node:test.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: () => null, length: 0,
} as unknown as Storage;

const { selectedCharacterId, selectCharacter, selectedCharacterColor, CHARACTERS } = await import("../src/game/characters.ts");
const { getProfile, createProfile, saveProfile } = await import("../src/game/profile.ts");

const PALETTE = new Set([0x33e1ff, 0x3ad17a, 0xff5bd1, 0x9b6bff, 0xffd54a, 0xff6b3b, 0x5bff9b]);

test("there are exactly two characters and Arch Pepe is the orange default", () => {
  assert.equal(CHARACTERS.length, 2);
  assert.equal(selectedCharacterId(), "arch_pepe");
  assert.equal(selectedCharacterColor(), 0xff7a1a);
});

test("selecting Random Runner persists a palette colour; Arch Pepe restores orange", () => {
  selectCharacter("random_runner");
  assert.equal(selectedCharacterId(), "random_runner");
  const c = selectedCharacterColor();
  assert.ok(PALETTE.has(c), `random colour ${c.toString(16)} must be from the palette`);
  assert.equal(selectedCharacterColor(), c, "colour is stable between runs (persisted)");
  selectCharacter("arch_pepe");
  assert.equal(selectedCharacterColor(), 0xff7a1a);
  selectCharacter("not_a_character"); // ignored
  assert.equal(selectedCharacterId(), "arch_pepe");
});

test("profile keys off the wallet address and persists the name + character", () => {
  const addr = "tb1pexampleaddress";
  assert.equal(getProfile(addr), null);
  const p = createProfile(addr, "  Harshad  ", "random_runner");
  assert.equal(p.walletAddress, addr);
  assert.equal(p.displayName, "Harshad", "name is trimmed");
  assert.equal(p.characterId, "random_runner");
  const loaded = getProfile(addr);
  assert.equal(loaded?.displayName, "Harshad");
  // Reconnect = same address → same profile, name NOT asked again.
  assert.equal(getProfile(addr)?.walletAddress, addr);
  // Rename updates presentation, identity unchanged.
  saveProfile({ ...loaded!, displayName: "SpeedDemon" });
  assert.equal(getProfile(addr)?.displayName, "SpeedDemon");
  assert.equal(getProfile(addr)?.walletAddress, addr);
  // Empty name falls back.
  assert.equal(createProfile("tb1pother", "   ", "arch_pepe").displayName, "RUNNER");
});
