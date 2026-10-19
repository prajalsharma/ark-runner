/**
 * Prize math — integer sats only, and never invent money: a distribution sums to
 * EXACTLY the pool (remainder to 1st place), and the solvency invariant is checked
 * before any payout. See docs/economics.md.
 */
import type { Sats, Payout } from "../chain/types.ts";

/** Prize structures in basis points (must sum to 10000). */
export const STRUCTURE_A = [7000, 2000, 1000];             // 70 / 20 / 10
export const STRUCTURE_TOP5 = [5000, 2500, 1200, 800, 500]; // 50/25/12/8/5

/** Dynamic-risk daily stake tiers (the amount a player commits for the day). A bigger stake is a
 *  bigger slice of the shared pool IF they place — and a bigger loss if they don't (the stake is
 *  forfeited to the pool). Amounts are sats. See distributeWeighted() + docs/economics.md. */
export const RISK_TIERS = [
  { id: "low", name: "LOW", stake: 1_000n, note: "Small stake, small risk — a modest slice if you place." },
  { id: "med", name: "MEDIUM", stake: 5_000n, note: "Balanced — a solid slice of the pool for a good run." },
  { id: "high", name: "HIGH", stake: 25_000n, note: "Big stake, big risk — the largest slice if you place up top." },
] as const;
export type RiskTierId = (typeof RISK_TIERS)[number]["id"];
export const DEFAULT_TIER: RiskTierId = "med";
export function stakeForTier(id: RiskTierId): Sats {
  return (RISK_TIERS.find((t) => t.id === id) ?? RISK_TIERS[1]!).stake;
}

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

/** Split `pool` by arbitrary non-negative bigint weights. Floors each share proportionally, then
 *  gives the whole remainder to index 0 (the top rank by convention), so sum(result) === pool
 *  EXACTLY — no sats created or destroyed. All-zero weights → an even split (remainder to 0). */
export function splitByWeights(pool: Sats, weights: bigint[]): Sats[] {
  const n = weights.length;
  if (n === 0) return [];
  const total = weights.reduce((a, b) => a + (b > 0n ? b : 0n), 0n);
  if (total === 0n) {
    const base = pool / BigInt(n);
    const out = new Array<Sats>(n).fill(base);
    out[0] = out[0]! + (pool - base * BigInt(n));
    return out;
  }
  const shares = weights.map((w) => (w > 0n ? (pool * w) / total : 0n));
  const assigned = shares.reduce((a, b) => a + b, 0n);
  shares[0] = shares[0]! + (pool - assigned); // remainder to the top rank
  return shares;
}

/** A ranked entrant and the stake they committed for the day (leaderboard order: best first). */
export type RankedStake = { player: string; stake: Sats };

/** DYNAMIC-RISK payout: the shared pool is split among the top-ranked entrants, each winner's slice
 *  weighted by rankWeight × their own stake. So skill GATES who gets paid (only the top `rankWeightsBps.length`
 *  ranks), and within that, risking more earns a bigger slice; entrants who miss the paid ranks
 *  forfeit their stake to the pool. Sums to the pool exactly (integer sats). */
export function distributeWeighted(pool: Sats, ranked: RankedStake[], rankWeightsBps: number[]): Payout[] {
  const n = Math.min(ranked.length, rankWeightsBps.length);
  if (n === 0 || pool <= 0n) return [];
  const top = ranked.slice(0, n);
  const weights = top.map((r, i) => BigInt(rankWeightsBps[i]!) * (r.stake > 0n ? r.stake : 0n));
  const shares = splitByWeights(pool, weights);
  return top.map((r, i) => ({ player: r.player, amount: shares[i]! }));
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
