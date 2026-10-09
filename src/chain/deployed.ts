/**
 * Public identifiers of the live ARCH RUNNER escrow/competition deployment on Arch Network
 * TESTNET (full facts + ABI in docs/DEPLOYMENT_RESULT.md). These are PUBLIC program/mint
 * addresses only — the settlement authority key lives server-side and is never shipped to
 * the browser, so in-game settlement stays DEMO until a settlement service runs.
 *
 * The program itself is REAL and E2E-verified on testnet: a deposit → settle match ran
 * on-chain with exact 70/20/10 payouts and the double-settle guard held.
 */
export const ARCH_DEPLOYMENT = {
  network: "testnet" as const,
  rpc: "https://rpc.testnet.arch.network",
  programId: "8R9MfjGyBcduUTZAR91ruyyCDXX4BYAHSWCQzaR5duL5",
  entryMint: "3rc7Mkh4vYT2LXKADeoQd8kTFMzdZxyHPSTV5KmWSMH2",
  entryDecimals: 0,
  split: "70 / 20 / 10",
  feeBps: 0,
  verified: true, // deposit→settle verified on-chain; double-settle guard holds
} as const;

export const shortId = (s: string): string => `${s.slice(0, 6)}…${s.slice(-4)}`;
