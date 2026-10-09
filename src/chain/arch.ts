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
import {
  type ArchSigner, buildJoinInstructions, buildReclaimInstructions, buildSignSubmit,
} from "./archTx.ts";

export type ArchConfig = {
  rpcUrl: string;          // https://rpc.testnet.arch.network (keyless)
  programId: string;       // 64-hex settlement program
  mint: string;            // our own APL token mint
  serviceUrl?: string;     // settlement service base URL (holds the authority key, server-side)
  signer?: ArchSigner;     // the connected PLAYER's wallet signer (join/reclaim) — never an authority key
  authoritySecret?: never; // the client MUST NOT carry a key — typed away so it can't be passed
};

const NO_SERVICE = "no settlement service configured (set serviceUrl) — the client cannot and must not settle itself";
const NO_SIGNER = "connect a Bitcoin (Taproot) wallet to sign this on-chain action";

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
  private signer?: ArchSigner;
  constructor(private readonly cfg: ArchConfig) {
    if (!cfg.rpcUrl || !cfg.programId || !cfg.mint) throw new Error("ArchConfig requires rpcUrl, programId, mint");
    this.signer = cfg.signer;
  }

  private get rpc(): string { return this.cfg.rpcUrl || RPC_URL; }
  private service(): string {
    if (!this.cfg.serviceUrl) throw new Error(NO_SERVICE);
    return this.cfg.serviceUrl.replace(/\/$/, "");
  }

  /** Attach / detach the connected player's wallet signer (set on connect, cleared on disconnect). */
  setPlayerSigner(signer: ArchSigner | undefined): void { this.signer = signer; }
  hasSigner(): boolean { return !!this.signer; }

  /** Authority-only → delegated to the settlement service (keyless from the client's side). */
  async openCompetition(id: string, opts: { feeRateBps: number }): Promise<void> {
    void opts; // the on-chain fee is fixed 0%; feeRateBps is not honoured on-chain
    await postJson(`${this.service()}/match/create`, { matchId: id });
  }

  /**
   * Player-signed on-chain JOIN. The connected wallet signs a `JoinMatch` tx (BIP-322 over the
   * ArchMessage digest); the program escrows exactly the config `entry` from the player's ATA
   * into the match vault. No authority key is involved. Throws unless the tx confirms
   * (status == Processed) so the UI can only ever show a truthful state.
   */
  async collectEntry(id: string, player: string, amount: Sats): Promise<void> {
    void amount; // the on-chain entry is fixed by config; the program transfers exactly `entry`
    if (!this.signer) throw new Error(NO_SIGNER);
    if (player && /^[0-9a-f]{64}$/.test(player) && player !== this.signer.pubkeyHex) {
      throw new Error("connected wallet does not match the entering player");
    }
    const ixs = await buildJoinInstructions(this.signer.pubkeyHex, matchIdOf(id));
    const { txid, status } = await buildSignSubmit(ixs, this.signer, this.rpc);
    if (status.state !== "processed") {
      throw new Error(`join not confirmed (tx ${txid}: ${status.state}${status.state === "failed" ? ` — ${status.error}` : ""})`);
    }
  }

  /** Authority-only → delegated to the settlement service, which signs the on-chain settle. */
  async settle(id: string, payouts: Payout[]): Promise<SettleResult> {
    void payouts; // winners are derived server-side from VALIDATED scores; the program fixes the split
    const r = await postJson<{ txid: string; payouts?: { player: string; amount: number }[] }>(
      `${this.service()}/match/settle`, { matchId: id },
    );
    return { txRef: r.txid, paid: (r.payouts ?? []).map((p) => ({ player: p.player, amount: BigInt(p.amount) })) };
  }

  /**
   * Player-signed on-chain REFUND (`ReclaimEntry`), valid only after the settle deadline. Returns
   * the refunded amount (the config `entry`) on a confirmed tx; throws otherwise.
   */
  async reclaim(id: string, player: string): Promise<Sats> {
    if (!this.signer) throw new Error(NO_SIGNER);
    if (player && /^[0-9a-f]{64}$/.test(player) && player !== this.signer.pubkeyHex) {
      throw new Error("connected wallet does not match the reclaiming player");
    }
    const m = await readMatch(matchIdOf(id), this.rpc);
    if (!m) throw new Error(`match ${id} not found on-chain`);
    const ixs = await buildReclaimInstructions(this.signer.pubkeyHex, matchIdOf(id));
    const { txid, status } = await buildSignSubmit(ixs, this.signer, this.rpc);
    if (status.state !== "processed") {
      throw new Error(`reclaim not confirmed (tx ${txid}: ${status.state}${status.state === "failed" ? ` — ${status.error}` : ""})`);
    }
    return m.entry;
  }

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
