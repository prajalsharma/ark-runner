/**
 * ArchWalletProvider — real wallet auth on Arch via a Bitcoin wallet adapter
 * (Xverse / UniSat / Leather / OKX, testnet4) using BIP-322 message signing. HONEST
 * skeleton: throws rather than pretending to connect/sign, because wiring needs the
 * injected wallet APIs verified at integration time (docs/arch-assumptions.md U?).
 * The app never sees a private key — only the x-only pubkey/address and a signature.
 */
import type { WalletProvider, WalletSession } from "./provider.ts";

export type ArchWalletKind = "xverse" | "unisat" | "leather" | "okx";

const NOT_WIRED = "ArchWalletProvider is not wired yet — use MockWalletProvider for the demo flow. Real wiring needs the injected Bitcoin-wallet adapter + BIP-322 signing; see docs/arch-capabilities.md.";

export class ArchWalletProvider implements WalletProvider {
  constructor(readonly kind: ArchWalletKind) {}
  async connect(): Promise<WalletSession> { throw new Error(NOT_WIRED); }
  async disconnect(): Promise<void> { throw new Error(NOT_WIRED); }
  async getAddress(): Promise<string | null> { throw new Error(NOT_WIRED); }
  async signMessage(): Promise<string> { throw new Error(NOT_WIRED); }
}
