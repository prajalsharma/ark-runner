/**
 * Real wallet connection via an injected Bitcoin wallet extension. Arch authorises
 * with a Taproot (BIP-322) identity, so we connect to the user's Bitcoin wallet and
 * read its address/pubkey — a genuine connection, not a mock. On-chain *settlement*
 * still needs the deployed program (that part remains mocked); connecting + signing
 * is wallet-side and works today.
 *
 * Fully implemented: UniSat, OKX. Detected + guided: Xverse, Leather (their flows use
 * sats-connect / request APIs we add when wiring the live economy — we do NOT fake them).
 * No private keys are ever requested — only address, pubkey, and signatures.
 */
import type { WalletProvider, WalletSession } from "./provider.ts";
import type { ArchSigner } from "../chain/archTx.ts";

export type WalletKind = "unisat" | "okx" | "xverse" | "leather";

type UnisatApi = {
  requestAccounts(): Promise<string[]>;
  getPublicKey(): Promise<string>;
  getNetwork?(): Promise<string>;
  signMessage(msg: string, type?: string): Promise<string>;
  disconnect?(): Promise<void>;
};
type OkxBtcApi = {
  connect(): Promise<{ address: string; publicKey?: string; compressedPublicKey?: string }>;
  signMessage(msg: string, type?: string): Promise<string>;
};
type Win = {
  unisat?: UnisatApi;
  okxwallet?: { bitcoin?: OkxBtcApi; bitcoinTestnet?: OkxBtcApi };
  XverseProviders?: unknown;
  LeatherProvider?: unknown;
};

function win(): Win | null {
  return typeof window === "undefined" ? null : (window as unknown as Win);
}

/** Which wallets are installed in this browser right now. */
export function detectWallets(): WalletKind[] {
  const w = win();
  if (!w) return [];
  const out: WalletKind[] = [];
  if (w.unisat) out.push("unisat");
  if (w.okxwallet?.bitcoin) out.push("okx");
  if (w.XverseProviders) out.push("xverse");
  if (w.LeatherProvider) out.push("leather");
  return out;
}

export const WALLET_LABEL: Record<WalletKind, string> = {
  unisat: "UniSat", okx: "OKX", xverse: "Xverse", leather: "Leather",
};

export class InjectedWalletProvider implements WalletProvider {
  private address: string | null = null;
  constructor(readonly kind: WalletKind) {}

  async connect(): Promise<WalletSession> {
    const w = win();
    if (!w) throw new Error("no-window");
    if (this.kind === "unisat") {
      if (!w.unisat) throw new Error("UniSat not found");
      const accounts = await w.unisat.requestAccounts();
      const address = accounts?.[0];
      if (!address) throw new Error("No account authorised");
      const pubkey = await w.unisat.getPublicKey().catch(() => "");
      this.address = address;
      return { address, pubkey };
    }
    if (this.kind === "okx") {
      const p = w.okxwallet?.bitcoin;
      if (!p) throw new Error("OKX wallet not found");
      const r = await p.connect();
      if (!r?.address) throw new Error("No account authorised");
      this.address = r.address;
      return { address: r.address, pubkey: r.publicKey ?? r.compressedPublicKey ?? "" };
    }
    // Xverse/Leather use sats-connect / request APIs we wire with the live economy.
    throw new Error(`${WALLET_LABEL[this.kind]} connect is not wired yet — use UniSat or OKX, or continue in DEMO mode.`);
  }

  async disconnect(): Promise<void> {
    this.address = null;
    try { await win()?.unisat?.disconnect?.(); } catch { /* not all wallets expose disconnect */ }
  }

  async getAddress(): Promise<string | null> { return this.address; }

  /** BIP-322 message signing — proves control of the address for competition entry. */
  async signMessage(message: string): Promise<string> {
    const w = win();
    if (!w || !this.address) throw new Error("connect first");
    if (this.kind === "unisat") return w.unisat!.signMessage(message, "bip322-simple");
    if (this.kind === "okx") return w.okxwallet!.bitcoin!.signMessage(message, "bip322-simple");
    throw new Error("signing not wired for this wallet");
  }
}

// --- wallet → Arch transaction signer -----------------------------------------------
/** Decode base64 (browser atob or Node Buffer). */
export function base64ToBytes(b64: string): Uint8Array {
  const g = globalThis as { atob?: (s: string) => string; Buffer?: { from(s: string, enc: string): Uint8Array } };
  if (typeof g.atob === "function") {
    const bin = g.atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  if (g.Buffer) return Uint8Array.from(g.Buffer.from(b64, "base64"));
  throw new Error("no base64 decoder available");
}

/** Read a Bitcoin compact-size integer at `off`; returns [value, nextOffset]. */
function readCompactSize(b: Uint8Array, off: number): [number, number] {
  const first = b[off]!;
  if (first < 0xfd) return [first, off + 1];
  if (first === 0xfd) return [b[off + 1]! | (b[off + 2]! << 8), off + 3];
  throw new Error("witness element too large to parse");
}

/**
 * Extract the 64-byte Schnorr signature from a wallet BIP-322-simple signature.
 * Wallets return base64 of the witness stack; a Taproot key-spend witness is a single element
 * (the 64-byte Schnorr sig, optionally + 1 sighash byte). Mirrors the Rust SDK, which takes the
 * first 64 bytes of the first witness element (sign_message_bip322 → witness[0][..64]).
 */
export function extractSchnorrSignature(walletSig: string): Uint8Array {
  const raw = base64ToBytes(walletSig.trim());
  // Some wallets return the bare signature rather than a wrapped witness.
  if (raw.length === 64 || raw.length === 65) return raw.slice(0, 64);
  // Otherwise parse a witness stack: [count][len][element…]…
  const [count, afterCount] = readCompactSize(raw, 0);
  if (count < 1) throw new Error("empty witness in wallet signature");
  const [elemLen, afterLen] = readCompactSize(raw, afterCount);
  if (elemLen < 64) throw new Error(`witness element too short (${elemLen}) for a Schnorr signature`);
  const elem = raw.slice(afterLen, afterLen + elemLen);
  if (elem.length < 64) throw new Error("truncated witness signature element");
  return elem.slice(0, 64);
}

/** Normalise a wallet pubkey to the 32-byte x-only (Taproot) hex Arch uses. */
export function toXOnlyHex(pubkey: string): string {
  const h = pubkey.trim().toLowerCase().replace(/^0x/, "");
  if (/^[0-9a-f]{64}$/.test(h)) return h;                 // already x-only
  if (/^[0-9a-f]{66}$/.test(h)) return h.slice(2);        // compressed (02/03 prefix) → drop it
  throw new Error(`cannot derive x-only pubkey from "${pubkey}"`);
}

/**
 * Build an ArchSigner backed by a connected injected wallet. The wallet must be connected with
 * its Taproot (BIP-86) address so that p2tr(xonly) — the address the node reconstructs for
 * BIP-322 verification — matches the submitted x-only pubkey.
 */
export function makeWalletSigner(provider: WalletProvider, session: WalletSession): ArchSigner {
  const pubkeyHex = toXOnlyHex(session.pubkey);
  return {
    pubkeyHex,
    async signDigest(digestHex: string): Promise<Uint8Array> {
      const walletSig = await provider.signMessage(digestHex); // BIP-322-simple over the 64-char hex digest
      return extractSchnorrSignature(walletSig);
    },
  };
}
