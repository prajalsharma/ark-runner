/**
 * Wallet seam. The app talks to a WalletProvider, never a specific wallet SDK. The
 * real Arch impl authorises with BIP-322 over a Bitcoin wallet adapter (Xverse /
 * UniSat / Leather / OKX on testnet4 — see docs/arch-capabilities.md). A Mock impl
 * drives the onboarding/demo flow offline. The app NEVER handles seed phrases or
 * private keys — only a public address/pubkey and a signature come back.
 */
export type WalletSession = { address: string; pubkey: string };

export interface WalletProvider {
  connect(): Promise<WalletSession>;
  disconnect(): Promise<void>;
  getAddress(): Promise<string | null>;
  /** BIP-322 message signing in the real impl; identity proof for competition entry. */
  signMessage(message: string): Promise<string>;
}
