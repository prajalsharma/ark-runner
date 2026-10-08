/**
 * CLI: run the economy simulator across population sizes and print a table.
 * `npm run simulate`. Defaults: 2000-sat entry, 5% fee, 70/20/10, 60% participation.
 */
import { simulate, type SimParams } from "./simulator.ts";
import { STRUCTURE_A } from "./distribution.ts";

const base: Omit<SimParams, "players"> = {
  entryAmount: 2_000n,
  feeRateBps: 500,
  structureBps: STRUCTURE_A,
  participation: 0.6,
  maxEntriesPerPlayer: 5,
  whaleFraction: 0.02,
  seed: 2026,
};

const sats = (n: bigint): string => n.toLocaleString();

console.log("ARCH RUNNER — economy simulation (entry 2000 sats, fee 5%, 70/20/10)\n");
console.log("players  parts   entries   deposits      revenue     prizes       cap.eff  top%");
for (const players of [100, 1_000, 10_000, 100_000]) {
  const r = simulate({ ...base, players });
  console.log(
    `${String(r.players).padStart(7)}  ${String(r.participants).padStart(5)}  ${String(r.totalEntries).padStart(7)}  ` +
    `${sats(r.totalDeposits).padStart(12)}  ${sats(r.protocolRevenue).padStart(10)}  ${sats(r.prizesPaid).padStart(11)}  ` +
    `${r.capitalEfficiencyPct.toFixed(1).padStart(6)}%  ${r.topPrizeSharePct.toFixed(0).padStart(3)}%`,
  );
}
console.log("\nConservation holds by construction: deposits = revenue + prizes (no money invented).");
