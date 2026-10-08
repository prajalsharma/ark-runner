/**
 * Runner characters — exactly two, per the brief. Cosmetic ONLY: a character sets
 * the runner's colour and nothing else (same physics, hitbox, and scoring — no
 * pay-to-win, no hidden edge). Selection persists per device.
 *
 *  - ORANGE ARCH PEPE: the signature orange runner (always available).
 *  - RANDOM RUNNER: a fresh random colour each time you pick it; the chosen colour
 *    then persists between runs until you pick it again (documented behaviour).
 */
export type Character = { id: string; name: string };

export const CHARACTERS: Character[] = [
  { id: "arch_pepe", name: "ORANGE ARCH PEPE" },
  { id: "random_runner", name: "RANDOM RUNNER" },
];

const ARCH_ORANGE = 0xff7a1a;
const RANDOM_PALETTE = [0x33e1ff, 0x3ad17a, 0xff5bd1, 0x9b6bff, 0xffd54a, 0xff6b3b, 0x5bff9b];

const SEL_KEY = "archrunner.character.v1";
const RAND_KEY = "archrunner.randomcolor.v1";

function read(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function write(key: string, v: string): void { try { localStorage.setItem(key, v); } catch { /* ephemeral */ } }

export function selectedCharacterId(): string {
  const id = read(SEL_KEY);
  return id && CHARACTERS.some((c) => c.id === id) ? id : "arch_pepe";
}

function storedRandomColor(): number {
  const v = read(RAND_KEY);
  if (v) { const n = Number(v); if (Number.isFinite(n)) return n; }
  return rerollRandomColor();
}

function rerollRandomColor(): number {
  const c = RANDOM_PALETTE[Math.floor(Math.random() * RANDOM_PALETTE.length)]!;
  write(RAND_KEY, String(c));
  return c;
}

/** Pick a character. Picking RANDOM RUNNER rolls a new colour (persists until next pick). */
export function selectCharacter(id: string): void {
  if (!CHARACTERS.some((c) => c.id === id)) return;
  write(SEL_KEY, id);
  if (id === "random_runner") rerollRandomColor();
}

/** The runner colour the renderer should use. */
export function selectedCharacterColor(): number {
  return selectedCharacterId() === "random_runner" ? storedRandomColor() : ARCH_ORANGE;
}

/** Swatch colour to show for a character in the picker (random shows its current roll). */
export function characterSwatch(id: string): number {
  return id === "random_runner" ? storedRandomColor() : ARCH_ORANGE;
}
