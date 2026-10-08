/**
 * Prize math — integer sats only, and never invent money: a distribution sums to
 * EXACTLY the pool (remainder to 1st place), and the solvency invariant is checked
 * before any payout. See docs/economics.md.
 */
import type { Sats, Payout } from "../chain/types.ts";

/** Prize structures in basis points (must sum to 10000). */
export const STRUCTURE_A = [7000, 2000, 1000];             // 70 / 20 / 10
export const STRUCTURE_TOP5 = [5000, 2500, 1200, 800, 500]; // 50/25/12/8/5

export function feeOf(amount: Sats, feeRateBps: number): Sats {
  return (amount * BigInt(feeRateBps)) / 10_000n; // floor; rest goes to the prize reserve
}

/** Split `pool` by weights (bps). Floors each share, then gives the remainder to
 *  index 0, so `sum(result) === pool` exactly — no sats created or destroyed. */
export function splitExact(pool: Sats, weightsBps: number[]): Sats[] {
  const total = weightsBps.reduce((a, b) => a + b, 0);
  if (total !== 10_000) throw new Error(`weights must sum to 10000 bps, got ${total}`);
  const shares = weightsBps.map((w) => (pool * BigInt(w)) / 10_000n);
  const assigned = shares.reduce((a, b) => a + b, 0n);
  if (shares.length > 0) shares[0] = shares[0]! + (pool - assigned); // remainder to 1st
  return shares;
}

/** Build payouts for ranked winners from a pool + structure. */
export function distribute(pool: Sats, winners: string[], weightsBps: number[]): Payout[] {
  const n = Math.min(winners.length, weightsBps.length);
  if (n === 0) return [];
  // Renormalise if fewer winners than prize slots so we still pay out the whole pool.
  const used = weightsBps.slice(0, n);
  const scale = 10_000 / used.reduce((a, b) => a + b, 0);
  const normalised = used.map((w) => Math.round(w * scale));
  normalised[0] += 10_000 - normalised.reduce((a, b) => a + b, 0); // fix rounding to exactly 10000
  const shares = splitExact(pool, normalised);
  return winners.slice(0, n).map((player, i) => ({ player, amount: shares[i]! }));
}

/** Solvency invariant: you can never distribute more than the verified reserve. */
export function assertSolvent(distributable: Sats, prizeReserve: Sats): void {
  if (distributable > prizeReserve) {
    throw new Error(`INSOLVENT: distributable ${distributable} > prizeReserve ${prizeReserve}`);
  }
}
