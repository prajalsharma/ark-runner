/**
 * CompetitionEngine — the full async-competition loop wired together: entries are
 * collected into the settlement pot, runs are server-validated before they count,
 * and at close the prize reserve is distributed to the leaderboard and settled
 * (solvency-checked, idempotent). This is the orchestration over the state machine
 * (competition.ts), the validator (validate.ts), and a GameSettlementProvider.
 */
import { Competition } from "./competition.ts";
import { validateSubmission } from "./validate.ts";
import { distribute } from "../economy/distribution.ts";
import type { GameSettlementProvider, Payout, Sats, SettleResult } from "../chain/types.ts";
import type { RunSubmission, ValidationResult } from "../shared/contracts.ts";

export class CompetitionEngine {
  readonly comp: Competition;

  constructor(
    id: string,
    readonly seed: number,
    private readonly provider: GameSettlementProvider,
    private readonly feeRateBps: number,
  ) {
    this.comp = new Competition(id, seed);
  }

  get state(): string { return this.comp.state; }

  async open(): Promise<void> {
    await this.provider.openCompetition(this.comp.id, { feeRateBps: this.feeRateBps });
    this.comp.open();
  }

  /** Pay the entry fee into the pot (must be before submitting a run). */
  async enter(player: string, amount: Sats): Promise<void> {
    await this.provider.collectEntry(this.comp.id, player, amount);
  }

  /** Validate a run against the competition's own seed, then record it if clean. */
  submit(player: string, sub: RunSubmission): ValidationResult {
    if (sub.seed !== this.seed) {
      return { accepted: false, officialScore: 0, stats: { distance: 0, collected: 0, perfects: 0, blockRuns: 0, flips: 0, elapsed: 0 }, flags: [{ code: "INVALID_REPLAY", detail: "wrong competition seed" }] };
    }
    const result = validateSubmission(sub);
    if (result.accepted) this.comp.submit(player, result);
    return result;
  }

  leaderboard(): { player: string; score: number }[] { return this.comp.leaderboard(); }

  /** Close, distribute the prize reserve to the ranked leaderboard, and settle. */
  async finalizeAndSettle(structureBps: number[]): Promise<SettleResult> {
    this.comp.lock();
    this.comp.transition("VALIDATING");
    this.comp.transition("FINALIZED");
    const { prizeReserve } = await this.provider.pool(this.comp.id);
    const winners = this.comp.leaderboard().map((e) => e.player);
    const payouts: Payout[] = winners.length ? distribute(prizeReserve, winners, structureBps) : [];
    this.comp.transition("SETTLING");
    try {
      const res = await this.provider.settle(this.comp.id, payouts);
      this.comp.transition("SETTLED");
      return res;
    } catch (e) {
      this.comp.transition("SETTLEMENT_FAILED"); // explicit failure state for investigation
      throw e;
    }
  }
}
