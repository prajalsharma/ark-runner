/**
 * Deterministic seeded RNG — the backbone of fair competition (same daily seed
 * = same world for everyone) and of server-side replay validation. Never use
 * Math.random() for anything gameplay-critical.
 *
 * mulberry32: fast, well-distributed, fully reproducible from a 32-bit seed.
 */
export class SeededRandom {
  private s: number;
  constructor(seed: number) {
    this.s = (seed >>> 0) || 0x9e3779b9;
  }
  /** next float in [0,1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  /** pick one element. */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }
  /** true with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** Hash a string daily-seed label (e.g. "ARCH-2026-10-08") to a 32-bit number. */
export function seedFromString(label: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
