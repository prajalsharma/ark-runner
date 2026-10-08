/**
 * ArchSettlementProvider — the real settlement backend on Arch Network. This is a
 * HONEST skeleton: it declares the exact shape and maps each method to the escrow
 * pattern proven E2E in our Scramble work, but the on-chain calls are NOT yet wired,
 * so every method throws rather than faking a transaction or a settlement. Wiring it
 * requires `@arch-network/arch-sdk` 0.0.28 + a deployed Satellite program + the
 * server-side settlement-authority key (see docs/arch-capabilities.md / arch-assumptions.md).
 */
import type { GameSettlementProvider, PoolView, SettleResult, Sats } from "./types.ts";
import { MockSettlementProvider } from "./mock.ts";

export type ArchConfig = {
  rpcUrl: string;          // https://rpc.testnet.arch.network (keyless)
  programId: string;       // 64-hex Satellite settlement program
  mint: string;            // our own APL token mint (no protocol-native asset exists)
  authoritySecret?: string; // settlement-authority key — SERVER-SIDE ONLY, never shipped
};

const NOT_WIRED = "ArchSettlementProvider is not wired yet — use MockSettlementProvider (MOCK_BLOCKCHAIN=true). Wiring needs @arch-network/arch-sdk + a deployed program; see docs/arch-capabilities.md.";

export class ArchSettlementProvider implements GameSettlementProvider {
  constructor(private readonly cfg: ArchConfig) {
    if (!cfg.rpcUrl || !cfg.programId || !cfg.mint) throw new Error("ArchConfig requires rpcUrl, programId, mint");
  }

  // Each maps to the proven on-chain flow, intentionally unimplemented (no fakery):
  // openCompetition  → initialise a competition PDA + its ATA for `mint`
  // collectEntry     → APL transfer from player ATA into the pot PDA's ATA
  // settle           → authority-signed program instruction paying winners' forced ATAs (exact integer split)
  // reclaim          → participant-signed refund instruction after the settle deadline
  async openCompetition(): Promise<void> { throw new Error(NOT_WIRED); }
  async collectEntry(): Promise<void> { throw new Error(NOT_WIRED); }
  async settle(): Promise<SettleResult> { throw new Error(NOT_WIRED); }
  async reclaim(): Promise<Sats> { throw new Error(NOT_WIRED); }
  async pool(): Promise<PoolView> { throw new Error(NOT_WIRED); }
  async balanceOf(): Promise<Sats> { throw new Error(NOT_WIRED); }

  programId(): string { return this.cfg.programId; }
}

/** Factory: pick the provider from config. Defaults to Mock so nothing fake ships —
 *  the Arch provider is used only when mock is explicitly off AND config is present. */
export function makeSettlementProvider(opts: { mock?: boolean; arch?: ArchConfig } = {}): GameSettlementProvider {
  if (opts.mock === false && opts.arch) return new ArchSettlementProvider(opts.arch);
  return new MockSettlementProvider();
}
