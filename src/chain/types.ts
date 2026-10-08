/**
 * The seam between the GAME world and the BLOCKCHAIN world. The game never imports
 * chain code directly — it talks to a GameSettlementProvider. Two impls exist: an
 * in-memory Mock (dev/demo/tests) and an Arch one (real settlement). Money is always
 * an integer count of base units (sats) as a bigint — never a float.
 */
export type Sats = bigint;
export type Payout = { player: string; amount: Sats };

export type PoolView = {
  entrants: number;
  entryFees: Sats;        // gross collected
  prizeReserve: Sats;     // earmarked for payouts
  protocolRevenue: Sats;  // the fee the game keeps
  settled: boolean;
};

export type SettleResult = { txRef: string; paid: Payout[] };

export interface GameSettlementProvider {
  /** Create a competition pot. feeRateBps is taken from each entry as protocol revenue. */
  openCompetition(id: string, opts: { feeRateBps: number }): Promise<void>;
  /** Collect one entry fee into the pot. */
  collectEntry(id: string, player: string, amount: Sats): Promise<void>;
  /** Pay winners from the prize reserve. Must be solvent; idempotent (no double pay). */
  settle(id: string, payouts: Payout[]): Promise<SettleResult>;
  /** Escape hatch: refund a player's entry before settlement so funds never stick. */
  reclaim(id: string, player: string): Promise<Sats>;
  pool(id: string): Promise<PoolView>;
  balanceOf(player: string): Promise<Sats>;
}
