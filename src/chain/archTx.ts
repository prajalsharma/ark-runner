/**
 * archTx — build, sign-delegate, and submit PLAYER-signed Arch transactions from the client.
 *
 * This is the write-side counterpart to the read-only archRead.ts. It constructs the exact
 * on-chain `JoinMatch` / `ReclaimEntry` instructions (ABI in docs/DEPLOYMENT_RESULT.md §3),
 * compiles them into an `ArchMessage` byte-for-byte the way `arch_sdk 0.12` does
 * (`CompiledKeys` account ordering + `ArchMessage::serialize`), computes the signing digest the
 * way the node does (`ArchMessage::hash` = double-SHA256 rendered as a 64-char hex STRING), and
 * assembles the `RuntimeTransaction` the node's `send_transaction` RPC expects.
 *
 * It holds NO private key. Signing is delegated to an `ArchSigner` — in the browser that is the
 * connected injected wallet (UniSat/OKX) doing BIP-322-simple signing over the digest; in tests
 * it can be a local test keypair. The signature scheme is exactly what the Rust SDK uses:
 *   build_and_sign_transaction() -> sign_message_bip322(signer, message.hash(), network)
 * and the node verifies it with verify_message_bip322(digest, xonly_pubkey, sig, …) — so the
 * wallet must be connected with the Taproot (x-only) key whose p2tr address signs the message.
 *
 * Construction is verified byte-exact against arch_sdk 0.12 by tests/archtx.test.ts.
 */
import {
  RPC_URL, PROGRAM_ID_HEX, MINT_HEX, TOKEN_PROGRAM_HEX, ATA_PROGRAM_HEX,
  hexToBytes, bytesToHex,
  deriveConfigPda, deriveMatchPda, deriveAta,
} from "./archRead.ts";

/** System program id = base58 "111…1" = 32 zero bytes. */
export const SYSTEM_PROGRAM_HEX = "00".repeat(32);

/** Borsh enum discriminants of EscrowInstruction (variant index). */
const IX_JOIN = 2;
const IX_RECLAIM = 4;
/** ATA program "create idempotent" instruction data (SPL-equivalent: [] = create, [1] = idempotent). */
const ATA_CREATE_IDEMPOTENT = Uint8Array.of(1);

export type ArchAccountMeta = { pubkey: Uint8Array; isSigner: boolean; isWritable: boolean };
export type ArchInstruction = { programId: Uint8Array; accounts: ArchAccountMeta[]; data: Uint8Array };

/**
 * A signer that produces a 64-byte BIP-322-simple Schnorr signature over the message digest.
 * `pubkeyHex` is the 32-byte x-only Taproot pubkey (hex). `signDigest` receives the 64-char
 * lowercase-hex STRING that is `ArchMessage::hash()` and must return exactly 64 bytes.
 */
export type ArchSigner = { pubkeyHex: string; signDigest(digestHex: string): Promise<Uint8Array> };

// --- little-endian + concat helpers -------------------------------------------------
function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}
function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const enc = new TextEncoder();

type Subtle = { digest(a: string, d: ArrayBuffer): Promise<ArrayBuffer> };
async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  const subtle = (globalThis.crypto as { subtle?: Subtle } | undefined)?.subtle;
  if (!subtle) throw new Error("WebCrypto subtle unavailable (need Node 20+ or a browser)");
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  return new Uint8Array(await subtle.digest("SHA-256", buf));
}
/** sha256 rendered as a lowercase hex string — matches Rust `sha256::digest`. */
async function sha256Hex(data: Uint8Array): Promise<string> { return bytesToHex(await sha256Bytes(data)); }

// --- message compilation (mirrors arch_program CompiledKeys + ArchMessage::serialize) ----
type KeyMeta = { signer: boolean; writable: boolean };

type Compiled = {
  header: { numRequiredSignatures: number; numReadonlySigned: number; numReadonlyUnsigned: number };
  accountKeys: Uint8Array[];
  instructions: { programIdIndex: number; accounts: number[]; data: Uint8Array }[];
};

/** Lexicographic ascending compare of two 32-byte keys (BTreeMap<Pubkey> order). */
function cmpKey(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < 32; i++) { if (a[i]! !== b[i]!) return a[i]! - b[i]!; }
  return 0;
}

export function compileMessage(ixs: ArchInstruction[], payer: Uint8Array): Compiled {
  const metas = new Map<string, { key: Uint8Array; meta: KeyMeta }>();
  const touch = (key: Uint8Array): KeyMeta => {
    const h = bytesToHex(key);
    let e = metas.get(h);
    if (!e) { e = { key, meta: { signer: false, writable: false } }; metas.set(h, e); }
    return e.meta;
  };
  for (const ix of ixs) {
    touch(ix.programId); // invoked → present as (readonly, non-signer) unless flagged elsewhere
    for (const a of ix.accounts) {
      const m = touch(a.pubkey);
      m.signer = m.signer || a.isSigner;
      m.writable = m.writable || a.isWritable;
    }
  }
  const payerMeta = touch(payer);
  payerMeta.signer = true; payerMeta.writable = true;

  const payerHex = bytesToHex(payer);
  const rest = [...metas.values()].filter((e) => bytesToHex(e.key) !== payerHex);
  const sortByKey = (arr: typeof rest): Uint8Array[] => arr.sort((x, y) => cmpKey(x.key, y.key)).map((e) => e.key);

  const writableSigners = [payer, ...sortByKey(rest.filter((e) => e.meta.signer && e.meta.writable))];
  const readonlySigners = sortByKey(rest.filter((e) => e.meta.signer && !e.meta.writable));
  const writableNonSigners = sortByKey(rest.filter((e) => !e.meta.signer && e.meta.writable));
  const readonlyNonSigners = sortByKey(rest.filter((e) => !e.meta.signer && !e.meta.writable));

  const accountKeys = [...writableSigners, ...readonlySigners, ...writableNonSigners, ...readonlyNonSigners];
  const index = (k: Uint8Array): number => {
    const h = bytesToHex(k);
    const i = accountKeys.findIndex((x) => bytesToHex(x) === h);
    if (i < 0) throw new Error("account key not found during compile");
    return i;
  };
  const instructions = ixs.map((ix) => ({
    programIdIndex: index(ix.programId),
    accounts: ix.accounts.map((a) => index(a.pubkey)),
    data: ix.data,
  }));
  return {
    header: {
      numRequiredSignatures: writableSigners.length + readonlySigners.length,
      numReadonlySigned: readonlySigners.length,
      numReadonlyUnsigned: readonlyNonSigners.length,
    },
    accountKeys,
    instructions,
  };
}

/** ArchMessage::serialize — header(3) ‖ u32 len ‖ keys ‖ blockhash(32) ‖ u32 len ‖ instrs. */
export function serializeMessage(c: Compiled, blockhash: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(Uint8Array.of(c.header.numRequiredSignatures, c.header.numReadonlySigned, c.header.numReadonlyUnsigned));
  parts.push(u32le(c.accountKeys.length));
  for (const k of c.accountKeys) parts.push(k);
  if (blockhash.length !== 32) throw new Error("blockhash must be 32 bytes");
  parts.push(blockhash);
  parts.push(u32le(c.instructions.length));
  for (const ix of c.instructions) {
    parts.push(Uint8Array.of(ix.programIdIndex));
    parts.push(u32le(ix.accounts.length));
    parts.push(Uint8Array.from(ix.accounts));
    parts.push(u32le(ix.data.length));
    parts.push(ix.data);
  }
  return concat(parts);
}

/** ArchMessage::hash — digest(digest(serialized)) where digest() renders lowercase hex; the
 *  result is the 64-char hex STRING that is BIP-322-signed (as its ASCII bytes). */
export async function messageDigestHex(serialized: Uint8Array): Promise<string> {
  const first = await sha256Hex(serialized);            // 64-char hex string
  return sha256Hex(enc.encode(first));                  // 64-char hex string → the signing message
}

// --- instruction builders (ABI: docs/DEPLOYMENT_RESULT.md §3) ------------------------
/** JoinMatch (player-signed): escrows exactly `entry` from the player ATA into the vault ATA.
 *  Prefixed with an idempotent create of the player's own ATA (no-op if it already exists). */
export async function buildJoinInstructions(playerHex: string, matchId: bigint): Promise<ArchInstruction[]> {
  assertXonly(playerHex);
  const player = hexToBytes(playerHex);
  const program = hexToBytes(PROGRAM_ID_HEX);
  const token = hexToBytes(TOKEN_PROGRAM_HEX);
  const ataProgram = hexToBytes(ATA_PROGRAM_HEX);
  const system = hexToBytes(SYSTEM_PROGRAM_HEX);
  const mint = hexToBytes(MINT_HEX);
  const config = await deriveConfigPda();
  const matchPda = await deriveMatchPda(matchId);
  const playerAta = await deriveAta(playerHex, MINT_HEX);
  const vault = await deriveAta(bytesToHex(matchPda), MINT_HEX);

  const createAta: ArchInstruction = {
    programId: ataProgram,
    data: ATA_CREATE_IDEMPOTENT,
    accounts: [
      { pubkey: player, isSigner: true, isWritable: true },    // funder
      { pubkey: playerAta, isSigner: false, isWritable: true }, // associated token account
      { pubkey: player, isSigner: false, isWritable: false },  // wallet / owner
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: system, isSigner: false, isWritable: false },
      { pubkey: token, isSigner: false, isWritable: false },
    ],
  };
  const join: ArchInstruction = {
    programId: program,
    data: Uint8Array.of(IX_JOIN),
    accounts: [
      { pubkey: player, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: matchPda, isSigner: false, isWritable: true },
      { pubkey: playerAta, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: token, isSigner: false, isWritable: false },
    ],
  };
  return [createAta, join];
}

/** ReclaimEntry (player-signed): refund the player's entry after the settle deadline. */
export async function buildReclaimInstructions(playerHex: string, matchId: bigint): Promise<ArchInstruction[]> {
  assertXonly(playerHex);
  const player = hexToBytes(playerHex);
  const program = hexToBytes(PROGRAM_ID_HEX);
  const token = hexToBytes(TOKEN_PROGRAM_HEX);
  const config = await deriveConfigPda();
  const matchPda = await deriveMatchPda(matchId);
  const playerAta = await deriveAta(playerHex, MINT_HEX);
  const vault = await deriveAta(bytesToHex(matchPda), MINT_HEX);
  const reclaim: ArchInstruction = {
    programId: program,
    data: Uint8Array.of(IX_RECLAIM),
    accounts: [
      { pubkey: player, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: matchPda, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: playerAta, isSigner: false, isWritable: true },
      { pubkey: token, isSigner: false, isWritable: false },
    ],
  };
  return [reclaim];
}

function assertXonly(hex: string): void {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("expected a 32-byte x-only pubkey as 64-hex");
}

// --- JSON-RPC (write path) ----------------------------------------------------------
async function rpc<T>(rpcUrl: string, method: string, params: unknown, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "archrunner", method, params }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`RPC ${res.status}`);
    const json = (await res.json()) as { result?: T; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    return json.result as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function getBestFinalizedBlockHash(rpcUrl: string = RPC_URL): Promise<Uint8Array> {
  const hex = await rpc<string>(rpcUrl, "get_best_finalized_block_hash", []);
  const b = hexToBytes(hex);
  if (b.length !== 32) throw new Error(`unexpected blockhash length ${b.length}`);
  return b;
}

export type TxStatus =
  | { state: "processed"; txid: string }
  | { state: "failed"; txid: string; error: string }
  | { state: "queued"; txid: string }
  | { state: "pending"; txid: string };

type ProcessedStatus = string | { type?: string; message?: string; Failed?: string } | null;
function readStatus(txid: string, status: ProcessedStatus): TxStatus {
  if (status == null) return { state: "pending", txid };
  if (typeof status === "string") {
    if (/^processed$/i.test(status)) return { state: "processed", txid };
    if (/^queued$/i.test(status)) return { state: "queued", txid };
    return { state: "failed", txid, error: status };
  }
  if (typeof status.Failed === "string") return { state: "failed", txid, error: status.Failed };
  const t = (status.type ?? "").toLowerCase();
  if (t === "processed") return { state: "processed", txid };
  if (t === "queued") return { state: "queued", txid };
  if (t === "failed") return { state: "failed", txid, error: status.message ?? "failed" };
  return { state: "pending", txid };
}

/** Poll get_processed_transaction until the node reports a terminal state (or timeout). */
export async function waitForProcessed(txid: string, rpcUrl: string = RPC_URL, timeoutMs = 60000): Promise<TxStatus> {
  const deadline = Date.now() + timeoutMs;
  let last: TxStatus = { state: "pending", txid };
  while (Date.now() < deadline) {
    const r = await rpc<{ status?: ProcessedStatus } | null>(rpcUrl, "get_processed_transaction", txid).catch(() => null);
    last = readStatus(txid, r?.status ?? null);
    if (last.state === "processed" || last.state === "failed") return last;
    await new Promise((res) => setTimeout(res, 1500));
  }
  return last;
}

/** Serialize a RuntimeTransaction into the JSON shape the node's send_transaction expects
 *  (serde: Signature -> byte array, Pubkey/Hash -> byte array). */
export function runtimeTxJson(c: Compiled, blockhash: Uint8Array, signatures: Uint8Array[]): unknown {
  return {
    version: 0,
    signatures: signatures.map((s) => Array.from(s)),
    message: {
      header: {
        num_required_signatures: c.header.numRequiredSignatures,
        num_readonly_signed_accounts: c.header.numReadonlySigned,
        num_readonly_unsigned_accounts: c.header.numReadonlyUnsigned,
      },
      account_keys: c.accountKeys.map((k) => Array.from(k)),
      recent_blockhash: Array.from(blockhash),
      instructions: c.instructions.map((ix) => ({
        program_id_index: ix.programIdIndex,
        accounts: ix.accounts,
        data: Array.from(ix.data),
      })),
    },
  };
}

export type SubmitResult = { txid: string; status: TxStatus; digestHex: string };

/** Build → digest → delegate-sign (single signer = payer) → submit → poll. */
export async function buildSignSubmit(
  ixs: ArchInstruction[],
  signer: ArchSigner,
  rpcUrl: string = RPC_URL,
  opts: { wait?: boolean } = {},
): Promise<SubmitResult> {
  assertXonly(signer.pubkeyHex);
  const payer = hexToBytes(signer.pubkeyHex);
  const compiled = compileMessage(ixs, payer);
  if (compiled.header.numRequiredSignatures !== 1) {
    throw new Error(`player path expects exactly one signer (the player), got ${compiled.header.numRequiredSignatures}`);
  }
  const blockhash = await getBestFinalizedBlockHash(rpcUrl);
  const serialized = serializeMessage(compiled, blockhash);
  const digestHex = await messageDigestHex(serialized);
  const sig = await signer.signDigest(digestHex);
  if (sig.length !== 64) throw new Error(`signer returned ${sig.length} bytes, expected 64`);
  const tx = runtimeTxJson(compiled, blockhash, [sig]);
  const txid = await rpc<string>(rpcUrl, "send_transaction", tx);
  const status = (opts.wait === false) ? ({ state: "pending", txid } as TxStatus) : await waitForProcessed(txid, rpcUrl);
  return { txid, status, digestHex };
}
