/**
 * Cosmetic runner skins — purely visual, NEVER affect the score (anti-pay-to-win,
 * and here they're earned by skill, not bought). Unlocks key off the all-time best
 * score. Selection persists per device.
 */
export type Skin = { id: string; name: string; color: number; unlockScore: number };

export const SKINS: Skin[] = [
  { id: "ember", name: "EMBER", color: 0xff7a1a, unlockScore: 0 },
  { id: "cyan", name: "CYAN PULSE", color: 0x33e1ff, unlockScore: 5_000 },
  { id: "viridian", name: "VIRIDIAN", color: 0x3ad17a, unlockScore: 25_000 },
  { id: "gold", name: "SATOSHI GOLD", color: 0xffd54a, unlockScore: 100_000 },
];

const SEL_KEY = "archrunner.skin.v1";
const BEST_KEY = "archrunner.best.v1"; // shared with the HUD's all-time best

export function bestEver(): number {
  try { return Number(localStorage.getItem(BEST_KEY) || 0); } catch { return 0; }
}

export function isUnlocked(skin: Skin): boolean { return bestEver() >= skin.unlockScore; }

export function selectedSkin(): Skin {
  let id = "ember";
  try { id = localStorage.getItem(SEL_KEY) || "ember"; } catch { /* default */ }
  const skin = SKINS.find((s) => s.id === id) ?? SKINS[0]!;
  return isUnlocked(skin) ? skin : SKINS[0]!; // never run a locked skin
}

export function selectSkin(id: string): void {
  const skin = SKINS.find((s) => s.id === id);
  if (skin && isUnlocked(skin)) { try { localStorage.setItem(SEL_KEY, id); } catch { /* ephemeral */ } }
}
