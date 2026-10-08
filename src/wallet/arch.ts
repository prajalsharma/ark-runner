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
