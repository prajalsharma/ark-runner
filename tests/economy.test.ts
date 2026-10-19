/**
 * Money rules (docs/economics.md): integer sats only, never invent money — a
 * distribution sums to EXACTLY the pool, the solvency invariant holds, settlement
 * is idempotent (no double pay), and reclaim returns funds. Entries fund the prize
 * reserve + protocol revenue with nothing lost.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MockSettlementProvider } from "../src/chain/mock.ts";
import { ArchSettlementProvider, makeSettlementProvider } from "../src/chain/arch.ts";
import { splitExact, distribute, distributeWeighted, splitByWeights, stakeForTier, RISK_TIERS, STRUCTURE_A, assertSolvent } from "../src/economy/distribution.ts";

test("splitExact sums to the pool exactly, remainder to 1st", () => {
  assert.deepEqual(splitExact(100n, STRUCTURE_A), [70n, 20n, 10n]);
  const s = splitExact(101n, STRUCTURE_A); // 70.7/20.2/10.1 → floor then remainder to 1st
  assert.deepEqual(s, [71n, 20n, 10n]);
  assert.equal(s.reduce((a, b) => a + b, 0n), 101n);
  assert.throws(() => splitExact(100n, [5000, 4000]), /sum to 10000/);
});

test("entries fund prize reserve + protocol revenue with nothing lost", async () => {
  const p = new MockSettlementProvider();
  await p.openCompetition("c", { feeRateBps: 500 }); // 5% fee
  for (const player of ["a", "b", "c"]) await p.collectEntry("c", player, 10_000n);
  const pool = await p.pool("c");
  assert.equal(pool.entryFees, 30_000n);
  assert.equal(pool.protocolRevenue, 1_500n);      // 3 × 500
  assert.equal(pool.prizeReserve, 28_500n);         // 3 × 9500
  assert.equal(pool.protocolRevenue + pool.prizeReserve, pool.entryFees); // conservation
  assert.equal(pool.entrants, 3);
});

test("settlement pays the whole reserve, is solvent, and never double-pays", async () => {
  const p = new MockSettlementProvider();
  await p.openCompetition("c", { feeRateBps: 0 });
  for (const player of ["a", "b", "c"]) await p.collectEntry("c", player, 10_000n);
  const { prizeReserve } = await p.pool("c");
  const payouts = distribute(prizeReserve, ["a", "b", "c"], STRUCTURE_A);
  assert.equal(payouts.reduce((s, x) => s + x.amount, 0n), prizeReserve, "pays exactly the pool");

  const r1 = await p.settle("c", payouts);
  assert.equal(await p.balanceOf("a"), payouts[0]!.amount);
  const r2 = await p.settle("c", payouts); // idempotent
  assert.equal(r2.txRef, r1.txRef);
  assert.equal(await p.balanceOf("a"), payouts[0]!.amount, "balance unchanged on re-settle");
  assert.equal((await p.pool("c")).prizeReserve, 0n);
});

test("insolvent payouts are refused", async () => {
  const p = new MockSettlementProvider();
  await p.openCompetition("c", { feeRateBps: 0 });
  await p.collectEntry("c", "a", 1_000n);
  await assert.rejects(p.settle("c", [{ player: "a", amount: 2_000n }]), /INSOLVENT/);
  assert.throws(() => assertSolvent(5n, 4n), /INSOLVENT/);
});

test("reclaim refunds the entry before settlement and never after", async () => {
  const p = new MockSettlementProvider();
  await p.openCompetition("c", { feeRateBps: 1_000 }); // 10%
  await p.collectEntry("c", "a", 10_000n);
  await p.collectEntry("c", "b", 10_000n);
  const refunded = await p.reclaim("c", "a");
  assert.equal(refunded, 10_000n);
  assert.equal(await p.balanceOf("a"), 10_000n);
  const pool = await p.pool("c");
  assert.equal(pool.entrants, 1);
  assert.equal(pool.prizeReserve, 9_000n); // only b's 9000 remains
  await p.settle("c", [{ player: "b", amount: 9_000n }]);
  await assert.rejects(p.reclaim("c", "b"), /after settlement/);
});

test("the default provider is Mock; Arch is honest (reads real, never settles without the server)", async () => {
  assert.ok(makeSettlementProvider() instanceof MockSettlementProvider);
  // No serviceUrl → the client cannot settle itself (the authority key lives server-side only).
  const arch = new ArchSettlementProvider({ rpcUrl: "https://rpc.testnet.arch.network", programId: "abc", mint: "xyz" });
  await assert.rejects(arch.settle("1", []), /no settlement service/);
  // Player-signed money moves require a connected wallet signer — never faked, never an authority key.
  assert.equal(arch.hasSigner(), false);
  await assert.rejects(arch.collectEntry("1", "", 10n), /wallet/i);
  await assert.rejects(arch.reclaim("1", ""), /wallet/i);
});

// ---- Dynamic risk: stake-weighted, skill-gated distribution ----

test("splitByWeights sums to the pool exactly, remainder to the top", () => {
  assert.deepEqual(splitByWeights(100n, [3n, 1n]), [75n, 25n]);
  const s = splitByWeights(100n, [1n, 1n, 1n]); // 33/33/33 → remainder to index 0
  assert.deepEqual(s, [34n, 33n, 33n]);
  assert.equal(s.reduce((a, b) => a + b, 0n), 100n);
  assert.deepEqual(splitByWeights(50n, [0n, 0n]), [25n, 25n]); // all-zero → even split
  assert.deepEqual(splitByWeights(0n, [5n, 1n]), [0n, 0n]);
});

test("distributeWeighted pays the whole pool exactly (no sats invented)", () => {
  const ranked = [
    { player: "a", stake: 10_000n },
    { player: "b", stake: 1_000n },
    { player: "c", stake: 5_000n },
  ];
  const payouts = distributeWeighted(100_000n, ranked, STRUCTURE_A);
  assert.equal(payouts.reduce((s, p) => s + p.amount, 0n), 100_000n);
  assert.equal(payouts.length, 3);
});

test("more stake at the SAME rank earns a bigger slice", () => {
  // two identical leaderboards, only the winner's stake differs
  const small = distributeWeighted(100_000n, [{ player: "w", stake: 1_000n }, { player: "x", stake: 5_000n }, { player: "y", stake: 5_000n }], STRUCTURE_A);
  const big = distributeWeighted(100_000n, [{ player: "w", stake: 20_000n }, { player: "x", stake: 5_000n }, { player: "y", stake: 5_000n }], STRUCTURE_A);
  const wSmall = small.find((p) => p.player === "w")!.amount;
  const wBig = big.find((p) => p.player === "w")!.amount;
  assert.ok(wBig > wSmall, `bigger stake should win more: ${wBig} !> ${wSmall}`);
});

test("better rank earns more than a lower rank at equal stake", () => {
  const payouts = distributeWeighted(90_000n, [
    { player: "first", stake: 5_000n },
    { player: "second", stake: 5_000n },
    { player: "third", stake: 5_000n },
  ], STRUCTURE_A);
  const [a, b, c] = ["first", "second", "third"].map((id) => payouts.find((p) => p.player === id)!.amount);
  assert.ok(a > b && b > c, `rank must dominate at equal stake: ${a}/${b}/${c}`);
});

test("a big staker OUTSIDE the paid ranks forfeits their stake (gets nothing)", () => {
  // 3 paid ranks (STRUCTURE_A); the whale ranks 4th → no payout, its stake stays in the pool
  const ranked = [
    { player: "p1", stake: 2_000n },
    { player: "p2", stake: 2_000n },
    { player: "p3", stake: 2_000n },
    { player: "whale", stake: 50_000n },
  ];
  const payouts = distributeWeighted(56_000n, ranked, STRUCTURE_A);
  assert.equal(payouts.find((p) => p.player === "whale"), undefined, "whale outside top-3 is not paid");
  assert.equal(payouts.reduce((s, p) => s + p.amount, 0n), 56_000n, "whole pool still distributed");
});

test("fewer entrants than prize slots still pays the whole pool", () => {
  const payouts = distributeWeighted(10_000n, [{ player: "solo", stake: 3_000n }], STRUCTURE_A);
  assert.equal(payouts.length, 1);
  assert.equal(payouts[0]!.amount, 10_000n);
});

test("risk tiers are ordered and resolvable", () => {
  assert.ok(stakeForTier("low") < stakeForTier("med"));
  assert.ok(stakeForTier("med") < stakeForTier("high"));
  assert.equal(RISK_TIERS.length, 3);
});
