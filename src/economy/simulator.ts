/**
 * Economy simulator — stress the prize model across population sizes and behaviours
 * (participation, multi-entry, whales) and report the money metrics the design must
 * answer (docs/economics.md). Pure + deterministic given a seed. Money is bigint sats;
 * conservation (deposits == revenue + prizes paid) is guaranteed by construction, so
 * the sim can never "invent money".
 */
import { SeededRandom } from "../engine/rng.ts";
import { feeOf, splitExact } from "./distribution.ts";

export type SimParams = {
  players: number;
  entryAmount: bigint;
  feeRateBps: number;
  structureBps: number[];
  participation: number;      // 0..1 probability a given player enters
  maxEntriesPerPlayer: number;
  whaleFraction?: number;     // 0..1 of players who always enter the max
  seed?: number;
};

export type SimResult = {
  players: number;
  participants: number;
  totalEntries: number;
  totalDeposits: bigint;
  protocolRevenue: bigint;
  prizeReserve: bigint;
  prizesPaid: bigint;
  reserveLeftover: bigint;
  netMargin: bigint;           // == protocolRevenue in the entry-funded model
  capitalEfficiencyPct: number; // prizesPaid / totalDeposits
  topPrizeSharePct: number;     // 1st place / prizesPaid
};

export function simulate(p: SimParams): SimResult {
  const rng = new SeededRandom((p.seed ?? 12345) >>> 0);
  const whaleCount = Math.floor(p.players * (p.whaleFraction ?? 0));
  let participants = 0;
  let totalEntries = 0;

  for (let i = 0; i < p.players; i++) {
    const isWhale = i < whaleCount;
    if (!isWhale && !rng.chance(p.participation)) continue;
    participants++;
    totalEntries += isWhale ? p.maxEntriesPerPlayer : rng.int(1, p.maxEntriesPerPlayer);
  }

  const totalDeposits = p.entryAmount * BigInt(totalEntries);
  const protocolRevenue = feeOf(p.entryAmount, p.feeRateBps) * BigInt(totalEntries);
  const prizeReserve = totalDeposits - protocolRevenue;

  // Full-payout model: the whole prize reserve is distributed (remainder to 1st).
  const shares = participants > 0 && prizeReserve > 0n ? splitExact(prizeReserve, p.structureBps) : [];
  const prizesPaid = shares.reduce((a, b) => a + b, 0n);
  const reserveLeftover = prizeReserve - prizesPaid;

  return {
    players: p.players,
    participants,
    totalEntries,
    totalDeposits,
    protocolRevenue,
    prizeReserve,
    prizesPaid,
    reserveLeftover,
    netMargin: protocolRevenue,
    capitalEfficiencyPct: totalDeposits > 0n ? Number((prizesPaid * 10_000n) / totalDeposits) / 100 : 0,
    topPrizeSharePct: prizesPaid > 0n ? Number((shares[0]! * 10_000n) / prizesPaid) / 100 : 0,
  };
}
