/**
 * Competition lifecycle as an explicit state machine with guarded transitions — no
 * arbitrary jumps (a late submission, a double-settle, etc. are structurally
 * impossible). Only server-VALIDATED runs enter the leaderboard. In-memory here;
 * Phase 4+ swaps the store for PostgreSQL without changing this logic.
 */
import type { ValidationResult } from "../shared/contracts.ts";

export type CompState =
  | "CREATED" | "OPEN" | "LOCKED" | "VALIDATING"
  | "FINALIZED" | "SETTLING" | "SETTLED" | "SETTLEMENT_FAILED";

const NEXT: Record<CompState, CompState[]> = {
  CREATED: ["OPEN"],
  OPEN: ["LOCKED"],
  LOCKED: ["VALIDATING"],
  VALIDATING: ["FINALIZED"],
  FINALIZED: ["SETTLING"],
  SETTLING: ["SETTLED", "SETTLEMENT_FAILED"],
  SETTLED: [],
  SETTLEMENT_FAILED: ["SETTLING"], // retry after investigation
};

export type Entry = { player: string; score: number };

export class Competition {
  state: CompState = "CREATED";
  private entries: Entry[] = [];

  constructor(readonly id: string, readonly seed: number) {}

  transition(to: CompState): void {
    if (!NEXT[this.state].includes(to)) throw new Error(`illegal transition ${this.state} → ${to}`);
    this.state = to;
  }

  open(): void { this.transition("OPEN"); }
  lock(): void { this.transition("LOCKED"); }

  /** Record a run. Only while OPEN, and only if the server validated it. */
  submit(player: string, result: ValidationResult): void {
    if (this.state !== "OPEN") throw new Error(`competition ${this.id} is ${this.state}, not accepting entries`);
    if (!result.accepted) throw new Error("refusing to record an unvalidated run");
    const existing = this.entries.find((e) => e.player === player);
    if (existing) existing.score = Math.max(existing.score, result.officialScore); // best run counts
    else this.entries.push({ player, score: result.officialScore });
  }

  leaderboard(): Entry[] {
    return [...this.entries].sort((a, b) => b.score - a.score);
  }
}
