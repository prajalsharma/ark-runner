/**
 * RunnerLedger — the explicit financial accounting the economy requires. Four buckets
 * are kept strictly separate (the brief's §16.2):
 *   - PRINCIPAL  : each user's vault balance (their capital; withdrawable; a liability of the system)
 *   - PRIZE POOL : funds allocated to a competition's winners (per-competition)
 *   - RESERVE    : retained funds (rollover / solvency buffer)
 *   - PROTOCOL   : the fee the game keeps
 * Integer sats only (bigint — no floats). Every operation is atomic and conserves
 * money: the four buckets always sum to the assets actually held (CONSERVATION), and
 * a payout can never exceed its pool (SOLVENCY). Entry commits capital out of the
 * vault; winnings return to the vault (claim == withdraw). No yield is invented —
 * prizes are funded only by entries.
 */
import type { Sats } from "../chain/types.ts";

export type LedgerView = { assets: Sats; principalTotal: Sats; prizeTotal: Sats; reserve: Sats; protocolRevenue: Sats };
export type Payout = { user: string; amount: Sats };

export class RunnerLedger {
  private assets: Sats = 0n;                          // total real funds the system holds
  private principal = new Map<string, Sats>();        // user vaults (withdrawable)
  private prize = new Map<string, Sats>();            // competitionId -> allocated prize pool
  private entered = new Map<string, Set<string>>();   // competitionId -> users (duplicate-entry guard)
  private settled = new Set<string>();                // competitionId -> settled (idempotency)
  private reserve: Sats = 0n;
  private protocolRevenue: Sats = 0n;

  private get(m: Map<string, Sats>, k: string): Sats { return m.get(k) ?? 0n; }

  /** Deposit capital into the vault. Grows assets + the user's principal equally. */
  deposit(user: string, amount: Sats): void {
    if (amount <= 0n) throw new Error("deposit must be positive");
    this.principal.set(user, this.get(this.principal, user) + amount);
    this.assets += amount;
  }

  /** Withdraw from the vault (only withdrawable principal; entries are committed). */
  withdraw(user: string, amount: Sats): void {
    if (amount <= 0n) throw new Error("withdraw must be positive");
    const b = this.get(this.principal, user);
    if (amount > b) throw new Error("insufficient vault balance");
    this.principal.set(user, b - amount);
    this.assets -= amount;
  }

  /** Enter a competition from the vault. The fee splits into prize / reserve / protocol. */
  enter(competitionId: string, user: string, fee: Sats, opts: { feeRateBps?: number; reserveBps?: number } = {}): void {
    if (fee <= 0n) throw new Error("entry fee must be positive");
    if (this.settled.has(competitionId)) throw new Error("competition already settled");
    const users = this.entered.get(competitionId) ?? new Set<string>();
    if (users.has(user)) throw new Error("duplicate entry");
    const b = this.get(this.principal, user);
    if (fee > b) throw new Error("insufficient vault balance for entry");
    const feeRateBps = opts.feeRateBps ?? 500;
    const reserveBps = opts.reserveBps ?? 0;
    if (feeRateBps + reserveBps > 10_000) throw new Error("fee + reserve exceed 100%");
    const protocolCut = (fee * BigInt(feeRateBps)) / 10_000n;
    const reserveCut = (fee * BigInt(reserveBps)) / 10_000n;
    const prizeCut = fee - protocolCut - reserveCut;
    // move the committed fee out of the withdrawable vault into the other buckets (assets unchanged)
    this.principal.set(user, b - fee);
    this.prize.set(competitionId, this.get(this.prize, competitionId) + prizeCut);
    this.reserve += reserveCut;
    this.protocolRevenue += protocolCut;
    users.add(user);
    this.entered.set(competitionId, users);
  }

  /** Pay winners from the competition's prize pool back into their vaults. Idempotent + solvent. */
  settle(competitionId: string, payouts: Payout[]): void {
    if (this.settled.has(competitionId)) return; // never pay twice
    const pool = this.get(this.prize, competitionId);
    const total = payouts.reduce((s, p) => s + (p.amount > 0n ? p.amount : 0n), 0n);
    if (total > pool) throw new Error(`INSOLVENT: payout ${total} > prize pool ${pool}`);
    for (const p of payouts) if (p.amount > 0n) this.principal.set(p.user, this.get(this.principal, p.user) + p.amount);
    this.reserve += pool - total; // any undistributed remainder rolls into the reserve, never vanishes
    this.prize.set(competitionId, 0n);
    this.settled.add(competitionId);
  }

  balanceOf(user: string): Sats { return this.get(this.principal, user); }
  prizePool(competitionId: string): Sats { return this.get(this.prize, competitionId); }
  isSettled(competitionId: string): boolean { return this.settled.has(competitionId); }

  view(): LedgerView {
    let principalTotal = 0n; for (const v of this.principal.values()) principalTotal += v;
    let prizeTotal = 0n; for (const v of this.prize.values()) prizeTotal += v;
    return { assets: this.assets, principalTotal, prizeTotal, reserve: this.reserve, protocolRevenue: this.protocolRevenue };
  }

  /** CONSERVATION + SOLVENCY: the four buckets must always sum to the assets held. Throws if not. */
  assertSolvent(): void {
    const v = this.view();
    const liabilities = v.principalTotal + v.prizeTotal + v.reserve + v.protocolRevenue;
    if (liabilities !== v.assets) throw new Error(`INSOLVENT: buckets ${liabilities} != assets ${v.assets}`);
  }
}
