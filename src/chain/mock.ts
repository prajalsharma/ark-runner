/**
 * MockSettlementProvider — a correct, in-memory implementation of the settlement
 * contract for dev/demo/tests. It enforces the real invariants (separated buckets,
 * integer sats, solvency, idempotent settle, reclaim) so switching to the Arch
 * provider changes the backend, not the rules.
 */
import type { GameSettlementProvider, Payout, PoolView, SettleResult, Sats } from "./types.ts";
import { feeOf, assertSolvent } from "../economy/distribution.ts";

type Entry = { player: string; gross: Sats };
type Pot = {
  feeRateBps: number;
  entries: Entry[];
  prizeReserve: Sats;
  protocolRevenue: Sats;
  entryFees: Sats;
  settled: boolean;
  txRef?: string;
  paid?: Payout[];
};

export class MockSettlementProvider implements GameSettlementProvider {
  private pots = new Map<string, Pot>();
  private balances = new Map<string, Sats>();

  async openCompetition(id: string, opts: { feeRateBps: number }): Promise<void> {
    if (this.pots.has(id)) throw new Error(`competition ${id} already exists`);
    if (opts.feeRateBps < 0 || opts.feeRateBps > 10_000) throw new Error("feeRateBps out of range");
    this.pots.set(id, { feeRateBps: opts.feeRateBps, entries: [], prizeReserve: 0n, protocolRevenue: 0n, entryFees: 0n, settled: false });
  }

  async collectEntry(id: string, player: string, amount: Sats): Promise<void> {
    const pot = this.get(id);
    if (pot.settled) throw new Error("competition already settled");
    if (amount <= 0n) throw new Error("entry must be positive");
    const fee = feeOf(amount, pot.feeRateBps);
    pot.entryFees += amount;
    pot.protocolRevenue += fee;
    pot.prizeReserve += amount - fee;
    pot.entries.push({ player, gross: amount });
  }

  async settle(id: string, payouts: Payout[]): Promise<SettleResult> {
    const pot = this.get(id);
    if (pot.settled) return { txRef: pot.txRef!, paid: pot.paid! }; // idempotent: never pay twice
    const total = payouts.reduce((a, p) => a + p.amount, 0n);
    assertSolvent(total, pot.prizeReserve); // cannot pay more than the reserve
    for (const p of payouts) {
      if (p.amount <= 0n) continue;
      this.balances.set(p.player, (this.balances.get(p.player) ?? 0n) + p.amount);
    }
    pot.prizeReserve -= total;
    pot.settled = true;
    pot.txRef = `mock-settle-${id}-${Date.now()}`;
    pot.paid = payouts;
    return { txRef: pot.txRef, paid: payouts };
  }

  async reclaim(id: string, player: string): Promise<Sats> {
    const pot = this.get(id);
    if (pot.settled) throw new Error("cannot reclaim after settlement");
    let refunded = 0n;
    pot.entries = pot.entries.filter((e) => {
      if (e.player !== player) return true;
      refunded += e.gross;
      const fee = feeOf(e.gross, pot.feeRateBps);
      pot.protocolRevenue -= fee;
      pot.prizeReserve -= e.gross - fee;
      pot.entryFees -= e.gross;
      return false;
    });
    this.balances.set(player, (this.balances.get(player) ?? 0n) + refunded);
    return refunded;
  }

  async pool(id: string): Promise<PoolView> {
    const pot = this.get(id);
    return { entrants: new Set(pot.entries.map((e) => e.player)).size, entryFees: pot.entryFees, prizeReserve: pot.prizeReserve, protocolRevenue: pot.protocolRevenue, settled: pot.settled };
  }

  async balanceOf(player: string): Promise<Sats> { return this.balances.get(player) ?? 0n; }

  private get(id: string): Pot {
    const pot = this.pots.get(id);
    if (!pot) throw new Error(`no competition ${id}`);
    return pot;
  }
}
