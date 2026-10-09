/**
 * archRead — CLIENT-SAFE, read-only view of the live ARCH RUNNER escrow on Arch testnet.
 *
 * This module holds NO private key and signs NOTHING. It only derives the program's
 * PDAs / ATAs and reads account state over plain JSON-RPC (`read_account_info`). It runs
 * unchanged in the browser and in Node (uses WebCrypto `crypto.subtle` for SHA-256 and
 * `fetch`), so both the client provider and the settlement service share one decoder and
 * can never drift from the on-chain byte layout.
 *
 * Derivation is verified byte-exact against the deployed program (docs/DEPLOYMENT_RESULT.md):
 *   - config PDA  == dc9ea9…fe572
 *   - match PDA   (id 1791521107411) == ba980d2f…80aec4
 *   - vault ATA   == 3cfd3936…518d49
 * Arch PDA = sha256(seed0 ‖ … ‖ bump ‖ program_id); off-curve check on a 32-byte digest is
 * always false, so the canonical bump is 255 (confirmed on-chain for every seed we use).
 */

// --- live deployment constants (hex; public — no secrets here) ----------------------
export const RPC_URL = "https://rpc.testnet.arch.network";
export const PROGRAM_ID_HEX = "6e31324a4fc9d70d2ea0ed5417b9ed9208e8ea314ac46065eacb0af3441e0e42";
export const MINT_HEX = "2a6c8835a36d6d4976e84553c9b3a0efb299658b608b34745764ae665f49d929";
/** APL Token program + Associated-Token program (hex of the base58 ids in the deploy doc). */
export const TOKEN_PROGRAM_HEX = "06ddf6e1b9ea84412c10b8df021c100fc8871907c309c33535de209c341763bf";
export const ATA_PROGRAM_HEX = "8c97231184927b77b5f180118fcc683414b77c521e5a77081cf71d5f606a5384";

export const STATE_OPEN = 0;
export const STATE_SETTLED = 1;
export const STATE_REFUND = 2;

// --- hex helpers --------------------------------------------------------------------
export function hexToBytes(h: string): Uint8Array {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  if (s.length % 2 !== 0) throw new Error("odd-length hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}
export function bytesToHex(b: Uint8Array | number[]): string {
  const a = b instanceof Uint8Array ? b : Uint8Array.from(b);
  let s = "";
  for (const x of a) s += x.toString(16).padStart(2, "0");
  return s;
}

type MinimalSubtle = { digest(algorithm: string, data: ArrayBuffer): Promise<ArrayBuffer> };
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const subtle = (globalThis.crypto as { subtle?: MinimalSubtle } | undefined)?.subtle;
  if (!subtle) throw new Error("WebCrypto subtle unavailable (need Node 20+ or a browser)");
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const digest = await subtle.digest("SHA-256", buf);
  return new Uint8Array(digest);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/**
 * Arch create_program_address. is_on_curve on a 32-byte digest is always false (a secp256k1
 * public key is 33/65 bytes), so the search terminates at bump 255 on the first iteration —
 * matching the off-chain SDK and every on-chain-stored bump we verified. The loop is kept
 * for fidelity to the algorithm.
 */
export async function findProgramAddress(seeds: Uint8Array[], programIdHex: string): Promise<{ address: Uint8Array; bump: number }> {
  const program = hexToBytes(programIdHex);
  for (let bump = 255; bump >= 0; bump--) {
    const hash = await sha256(concat([...seeds, Uint8Array.of(bump), program]));
    // off-curve (always true for a 32-byte digest) → valid PDA
    return { address: hash, bump };
  }
  throw new Error("no viable program address");
}

export async function deriveConfigPda(): Promise<Uint8Array> {
  return (await findProgramAddress([new TextEncoder().encode("config")], PROGRAM_ID_HEX)).address;
}

export async function deriveMatchPda(matchId: bigint): Promise<Uint8Array> {
  const idLe = new Uint8Array(8);
  new DataView(idLe.buffer).setBigUint64(0, matchId, true);
  return (await findProgramAddress([new TextEncoder().encode("match"), idLe], PROGRAM_ID_HEX)).address;
}

/** ATA = find_program_address([wallet, apl_token_id, mint], ata_program) — verified exact. */
export async function deriveAta(ownerHex: string, mintHex: string = MINT_HEX): Promise<Uint8Array> {
  const seeds = [hexToBytes(ownerHex), hexToBytes(TOKEN_PROGRAM_HEX), hexToBytes(mintHex)];
  return (await findProgramAddress(seeds, ATA_PROGRAM_HEX)).address;
}

// --- JSON-RPC read ------------------------------------------------------------------
export type RawAccount = { lamports: number; owner: number[]; data: number[]; is_executable: boolean };

/** read_account_info(pubkey) — params is the 32 pubkey bytes passed directly (verified). */
export async function readAccountInfo(pubkey: Uint8Array, rpcUrl: string = RPC_URL, timeoutMs = 8000): Promise<RawAccount | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "read_account_info", params: Array.from(pubkey) }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`RPC ${res.status}`);
    const json = (await res.json()) as { result?: RawAccount; error?: { message: string } };
    if (json.error) {
      // a never-initialised account reads as an error on this node; treat as "absent"
      if (/not found|does not exist|unknown|invalid/i.test(json.error.message)) return null;
      throw new Error(json.error.message);
    }
    return json.result ?? null;
  } finally {
    clearTimeout(timer);
  }
}

// --- decoders (manual, fixed borsh layouts — see program/src/lib.rs) ----------------
export type ConfigState = {
  authority: string; settlementAuthority: string; mint: string;
  entry: bigint; joinTimeoutSecs: bigint; settleTimeoutSecs: bigint; bump: number;
};

export function decodeConfig(data: number[] | Uint8Array): ConfigState {
  const b = data instanceof Uint8Array ? data : Uint8Array.from(data);
  if (b.length < 121) throw new Error(`config too short: ${b.length}`);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return {
    authority: bytesToHex(b.slice(0, 32)),
    settlementAuthority: bytesToHex(b.slice(32, 64)),
    mint: bytesToHex(b.slice(64, 96)),
    entry: dv.getBigUint64(96, true),
    joinTimeoutSecs: dv.getBigInt64(104, true),
    settleTimeoutSecs: dv.getBigInt64(112, true),
    bump: b[120]!,
  };
}

export type MatchState = {
  matchId: bigint; entry: bigint; maxPlayers: number; joined: number; state: number;
  refundClaimed: number; createdAt: bigint; joinDeadline: bigint; settleDeadline: bigint;
  players: string[]; resultHash: string; bump: number;
};

export function decodeMatch(data: number[] | Uint8Array): MatchState {
  const b = data instanceof Uint8Array ? data : Uint8Array.from(data);
  if (b.length < 333) throw new Error(`match too short: ${b.length}`);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const joined = b[17]!;
  const players: string[] = [];
  for (let i = 0; i < 8; i++) players.push(bytesToHex(b.slice(44 + i * 32, 44 + i * 32 + 32)));
  return {
    matchId: dv.getBigUint64(0, true),
    entry: dv.getBigUint64(8, true),
    maxPlayers: b[16]!,
    joined,
    state: b[18]!,
    refundClaimed: b[19]!,
    createdAt: dv.getBigInt64(20, true),
    joinDeadline: dv.getBigInt64(28, true),
    settleDeadline: dv.getBigInt64(36, true),
    players,
    resultHash: bytesToHex(b.slice(300, 332)),
    bump: b[332]!,
  };
}

/** Token (ATA) amount is a u64 LE at byte offset 64. */
export function decodeTokenAmount(data: number[] | Uint8Array): bigint {
  const b = data instanceof Uint8Array ? data : Uint8Array.from(data);
  if (b.length < 72) return 0n;
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getBigUint64(64, true);
}

// --- high-level reads ---------------------------------------------------------------
export async function readConfig(rpcUrl: string = RPC_URL): Promise<ConfigState | null> {
  const acc = await readAccountInfo(await deriveConfigPda(), rpcUrl);
  return acc && acc.data.length ? decodeConfig(acc.data) : null;
}

export async function readMatch(matchId: bigint, rpcUrl: string = RPC_URL): Promise<MatchState | null> {
  const acc = await readAccountInfo(await deriveMatchPda(matchId), rpcUrl);
  return acc && acc.data.length >= 333 ? decodeMatch(acc.data) : null;
}

export async function readTokenBalance(ownerHex: string, mintHex: string = MINT_HEX, rpcUrl: string = RPC_URL): Promise<bigint> {
  const acc = await readAccountInfo(await deriveAta(ownerHex, mintHex), rpcUrl);
  return acc ? decodeTokenAmount(acc.data) : 0n;
}

export async function readVaultBalance(matchId: bigint, rpcUrl: string = RPC_URL): Promise<bigint> {
  const vault = await deriveAta(bytesToHex(await deriveMatchPda(matchId)), MINT_HEX);
  const acc = await readAccountInfo(vault, rpcUrl);
  return acc ? decodeTokenAmount(acc.data) : 0n;
}
