/**
 * Player settings — sound, reduced motion, graphics quality. Persisted per device.
 * Graphics/quality affect presentation only (particle budget, city density, effects)
 * and NEVER change gameplay or the deterministic sim. Sound mirrors the audio mute key.
 */
export type Quality = "low" | "high";

const SOUND_KEY = "archrunner.muted.v1"; // shared with AudioManager ("1" = muted)
const MOTION_KEY = "archrunner.reducedmotion.v1";
const QUALITY_KEY = "archrunner.quality.v1";
const HERO_KEY = "archrunner.hero.v2"; // v2: retire any stale "procedural" override so everyone gets the animated Pepe GLB

function read(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function write(key: string, v: string): void { try { localStorage.setItem(key, v); } catch { /* ephemeral */ } }

export function soundOn(): boolean { return read(SOUND_KEY) !== "1"; }
export function setSound(on: boolean): void { write(SOUND_KEY, on ? "0" : "1"); }

/** User override OR the OS preference. */
export function reducedMotion(): boolean {
  if (read(MOTION_KEY) === "1") return true;
  if (read(MOTION_KEY) === "0") return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
export function setReducedMotion(on: boolean): void { write(MOTION_KEY, on ? "1" : "0"); }

export function quality(): Quality { return read(QUALITY_KEY) === "low" ? "low" : "high"; }
export function setQuality(q: Quality): void { write(QUALITY_KEY, q); }

/** Hero model source (presentation only). "pepe" = the ARCH PEPE textured GLB (HeroPepeGLB —
 *  the default now); "procedural" = the authored jointed RunnerRig (the guaranteed fallback,
 *  also used if the GLB fails to load); "glb" = the older rigged Path-B courier (HeroGLB).
 *  Every GLB hero falls back to procedural on load failure. Overridable via ?hero=… for testing. */
export type HeroModel = "pepe" | "procedural" | "glb";
export function heroModel(): HeroModel {
  try {
    const q = new URLSearchParams(location.search).get("hero");
    if (q === "glb" || q === "procedural" || q === "pepe") return q;
  } catch { /* no location (SSR/tests) */ }
  const stored = read(HERO_KEY);
  if (stored === "procedural" || stored === "glb") return stored;
  return "pepe"; // the Arch Pepe GLB is the default hero
}
export function setHeroModel(m: HeroModel): void { write(HERO_KEY, m); }
