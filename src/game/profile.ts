/**
 * Wallet-linked player profile. Identity is the WALLET ADDRESS; the display name is
 * a mutable presentation field (never the identity). Persisted per device for UX
 * convenience ONLY.
 *
 * SECURITY: localStorage here is never authoritative for ownership, scores, prizes,
 * or competition rights — those are decided by the wallet signature + the server
 * (docs/security.md). A tampered profile can change what a name looks like, nothing more.
 */
export type PlayerProfile = {
  walletAddress: string;   // the identity
  displayName: string;     // presentation only
  characterId: string;
  createdAt: number;
  updatedAt: number;
};

const KEY = "archrunner.profiles.v1"; // { [address]: PlayerProfile }

function readAll(): Record<string, PlayerProfile> {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, PlayerProfile>; } catch { return {}; }
}
function writeAll(map: Record<string, PlayerProfile>): void {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* ephemeral */ }
}

export function getProfile(address: string): PlayerProfile | null {
  return readAll()[address] ?? null;
}

export function saveProfile(p: PlayerProfile): void {
  const map = readAll();
  map[p.walletAddress] = { ...p, updatedAt: Date.now() };
  writeAll(map);
}

/** Create a first-time profile for a freshly connected wallet. */
export function createProfile(address: string, displayName: string, characterId: string): PlayerProfile {
  const now = Date.now();
  const p: PlayerProfile = { walletAddress: address, displayName: displayName.trim().slice(0, 20) || "RUNNER", characterId, createdAt: now, updatedAt: now };
  saveProfile(p);
  return p;
}
