/**
 * MockWalletProvider — drives the connect → sign → enter flow for dev/demo with NO
 * real wallet and NO private keys. The "address" and "signature" are deterministic
 * stubs derived from a label (clearly non-cryptographic, demo only). Swap in the
 * real BIP-322 Bitcoin-wallet provider for production.
 */
import type { WalletProvider, WalletSession } from "./provider.ts";
import { seedFromString } from "../engine/rng.ts";

function hex(n: number, len: number): string {
  let s = (n >>> 0).toString(16);
  while (s.length < len) s = s + ((seedFromString(s) >>> 0).toString(16));
  return s.slice(0, len);
}

export class MockWalletProvider implements WalletProvider {
  private session: WalletSession | null = null;

  constructor(private readonly label = "demo-player") {}

  async connect(): Promise<WalletSession> {
    const pubkey = hex(seedFromString(`pk-${this.label}`), 64);          // 32-byte x-only pubkey shape
    const address = `tb1p${hex(seedFromString(`addr-${this.label}`), 38)}`; // taproot-ish testnet address shape
    this.session = { address, pubkey };
    return this.session;
  }

  async disconnect(): Promise<void> { this.session = null; }

  async getAddress(): Promise<string | null> { return this.session?.address ?? null; }

  async signMessage(message: string): Promise<string> {
    if (!this.session) throw new Error("connect first");
    // Deterministic, clearly-fake signature — NOT a real BIP-322 signature.
    return `mock-sig:${hex(seedFromString(this.session.pubkey + message), 32)}`;
  }
}
