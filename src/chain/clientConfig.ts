/**
 * Client-side settlement configuration. DEMO is the default and the ONLY thing that ships until
 * a real settlement service is hosted and `VITE_MOCK_BLOCKCHAIN=false` + `VITE_SETTLEMENT_SERVICE_URL`
 * are set at build time. This keeps every "live/paid" claim honest: no service URL → Mock provider,
 * no on-chain entry UI.
 *
 * Reads are always live (archRead hits the keyless RPC directly); only the WRITE provider is gated.
 */
import type { GameSettlementProvider } from "./types.ts";
import { MockSettlementProvider } from "./mock.ts";
import { ArchSettlementProvider, ARCH_DEFAULTS } from "./arch.ts";
import type { ArchSigner } from "./archTx.ts";

function env(key: string): string | undefined {
  // Vite injects import.meta.env at build; fall back to process.env under Node/tests.
  const vi = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const fromVite = vi ? vi[key] : undefined;
  const fromNode = typeof process !== "undefined" ? process.env?.[key] : undefined;
  return fromVite ?? fromNode;
}

/** Service base URL (holds the authority key, server-side). Empty string when unset. */
export function settlementServiceUrl(): string {
  return (env("VITE_SETTLEMENT_SERVICE_URL") ?? "").trim().replace(/\/$/, "");
}

/** Live settlement is OFF unless explicitly enabled AND a service URL is configured. */
export function isLiveConfigured(): boolean {
  return env("VITE_MOCK_BLOCKCHAIN") === "false" && settlementServiceUrl().length > 0;
}

/**
 * Build the settlement provider for the client. Defaults to Mock; returns the real Arch provider
 * (reads live, authority writes delegated to the service, player writes signed by `signer`) only
 * when live is configured. Pass the connected player's wallet signer to enable on-chain join/reclaim.
 */
export function makeClientSettlement(signer?: ArchSigner): GameSettlementProvider {
  if (!isLiveConfigured()) return new MockSettlementProvider();
  return new ArchSettlementProvider({
    rpcUrl: ARCH_DEFAULTS.rpcUrl,
    programId: ARCH_DEFAULTS.programId,
    mint: ARCH_DEFAULTS.mint,
    serviceUrl: settlementServiceUrl(),
    signer,
  });
}
