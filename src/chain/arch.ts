/**
 * ArchSettlementProvider — the real settlement backend on Arch testnet, honestly wired.
 *
 * The client is READ + SUBMIT only. It never holds the settlement-authority key and never
 * signs a payout:
 *   - READS  (pool, balanceOf, config/match) go straight to the keyless JSON-RPC via
 *     `src/chain/archRead.ts` — safe to run in the browser.
 *   - WRITES that require the authority (openCompetition→create_match, settle) are DELEGATED
 *     over HTTP to the settlement service (`serviceUrl`), which holds the key server-side.
 *   - Player-signed actions (collectEntry→join, reclaim) require the player's own wallet
 *     signature; in-browser wallet signing is not wired in this phase, so they throw an
 *     explicit error rather than faking a transaction.
 *
 * The default provider remains Mock (see makeSettlementProvider), so nothing fake ships until
 * a real service URL is configured and MOCK_BLOCKCHAIN=false.
 */
import type { GameSettlementProvider, Payout, PoolView, SettleResult, Sats } from "./types.ts";
import { MockSettlementProvider } from "./mock.ts";
import {
  RPC_URL, PROGRAM_ID_HEX, MINT_HEX,
  readMatch, readTokenBalance, readVaultBalance, STATE_SETTLED, STATE_REFUND,
} from "./archRead.ts";

export type ArchConfig = {
  rpcUrl: string;          // https://rpc.testnet.arch.network (keyless)
  programId: string;       // 64-hex settlement program
  mint: string;            // our own APL token mint
  serviceUrl?: string;     // settlement service base URL (holds the authority key, server-side)
  authoritySecret?: never; // the client MUST NOT carry a key — typed away so it can't be passed
};

const NO_SERVICE = "no settlement service configured (set serviceUrl) — the client cannot and must not settle itself";
const PLAYER_SIGNED = "this action is player-wallet-signed on-chain; in-browser wallet signing is not wired in this phase";

function matchIdOf(id: string): bigint {
  if (!/^\d+$/.test(id)) throw new Error(`on-chain match id must be a u64 decimal string, got "${id}"`);
  return BigInt(id);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok || (json as { error?: string }).error) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
  return json;
}

export class ArchSettlementProvider implements GameSettlementProvider {
  constructor(private readonly cfg: ArchConfig) {
    if (!cfg.rpcUrl || !cfg.programId || !cfg.mint) throw new Error("ArchConfig requires rpcUrl, programId, mint");
  }

  private get rpc(): string { return this.cfg.rpcUrl || RPC_URL; }
  private service(): string {
    if (!this.cfg.serviceUrl) throw new Error(NO_SERVICE);
    return this.cfg.serviceUrl.replace(/\/$/, "");
  }

  /** Authority-only → delegated to the settlement service (keyless from the client's side). */
  async openCompetition(id: string, opts: { feeRateBps: number }): Promise<void> {
    void opts; // the on-chain fee is fixed 0%; feeRateBps is not honoured on-chain
    await postJson(`${this.service()}/match/create`, { matchId: id });
  }

  /** Player-signed on-chain join — requires the player's wallet, not wired this phase. */
  async collectEntry(): Promise<void> { throw new Error(PLAYER_SIGNED); }

  /** Authority-only → delegated to the settlement service, which signs the on-chain settle. */
  async settle(id: string, payouts: Payout[]): Promise<SettleResult> {
    void payouts; // winners are derived server-side from VALIDATED scores; the program fixes the split
    const r = await postJson<{ txid: string; payouts?: { player: string; amount: number }[] }>(
      `${this.service()}/match/settle`, { matchId: id },
    );
    return { txRef: r.txid, paid: (r.payouts ?? []).map((p) => ({ player: p.player, amount: BigInt(p.amount) })) };
  }

  /** Player-signed on-chain refund — requires the player's wallet, not wired this phase. */
  async reclaim(): Promise<Sats> { throw new Error(PLAYER_SIGNED); }

  /** Live read of the match PDA + vault — no key, browser-safe. */
  async pool(id: string): Promise<PoolView> {
    const m = await readMatch(matchIdOf(id), this.rpc);
    if (!m) throw new Error(`match ${id} not found on-chain`);
    const gross = m.entry * BigInt(m.joined); // fee is fixed 0% on-chain → all of it is prize
    return {
      entrants: m.joined,
      entryFees: gross,
      prizeReserve: await readVaultBalance(matchIdOf(id), this.rpc),
      protocolRevenue: 0n,
      settled: m.state === STATE_SETTLED,
    };
  }

  /** Live read of a wallet's entry-token balance — no key, browser-safe. */
  async balanceOf(player: string): Promise<Sats> {
    if (!/^[0-9a-f]{64}$/.test(player)) throw new Error("balanceOf expects a 64-hex on-chain pubkey");
    return readTokenBalance(player, this.cfg.mint || MINT_HEX, this.rpc);
  }

  programId(): string { return this.cfg.programId; }
}

/** Factory: defaults to Mock so nothing fake ships; the Arch provider is used only when
 *  mock is explicitly off AND an ArchConfig is supplied. */
export function makeSettlementProvider(opts: { mock?: boolean; arch?: ArchConfig } = {}): GameSettlementProvider {
  if (opts.mock === false && opts.arch) return new ArchSettlementProvider(opts.arch);
  return new MockSettlementProvider();
}

export const ARCH_STATE = { SETTLED: STATE_SETTLED, REFUND: STATE_REFUND } as const;
export const ARCH_DEFAULTS = { rpcUrl: RPC_URL, programId: PROGRAM_ID_HEX, mint: MINT_HEX } as const;

/** Submit a validated-run request to the settlement service (the client's "submit runs" path). */
export async function submitRunToService(serviceUrl: string, body: unknown): Promise<unknown> {
  return postJson(`${serviceUrl.replace(/\/$/, "")}/run/submit`, body);
}
