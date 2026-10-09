/**
 * RunnerLedger: four separated buckets, integer sats, conservation + solvency enforced,
 * entries funded from the vault, winnings back to the vault, no double-pay / double-entry,
 * no overdraw, no invented money.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { RunnerLedger } from "../src/economy/ledger.ts";

test("deposit/withdraw move principal and assets together; no overdraw", () => {
  const L = new RunnerLedger();
  L.deposit("alice", 10_000n);
  L.assertSolvent();
  assert.equal(L.balanceOf("alice"), 10_000n);
  L.withdraw("alice", 4_000n);
  assert.equal(L.balanceOf("alice"), 6_000n);
  L.assertSolvent();
  assert.throws(() => L.withdraw("alice", 999_999n), /insufficient/);
  assert.throws(() => L.deposit("alice", 0n), /positive/);
});

test("entry splits into prize/reserve/protocol and stays solvent", () => {
  const L = new RunnerLedger();
  for (const u of ["a", "b", "c"]) L.deposit(u, 10_000n);
  for (const u of ["a", "b", "c"]) L.enter("daily-1", u, 2_000n, { feeRateBps: 500, reserveBps: 1000 });
  L.assertSolvent();
  const v = L.view();
  // 3 entries of 2000: protocol 5% = 300, reserve 10% = 600, prize = 5100
  assert.equal(v.protocolRevenue, 300n);
  assert.equal(v.reserve, 600n);
  assert.equal(L.prizePool("daily-1"), 5_100n);
  // committed fees left each vault: 10000 - 2000 = 8000 each → 24000 total principal
  assert.equal(v.principalTotal, 24_000n);
  // conservation: assets = 30000 deposited; buckets sum to it
  assert.equal(v.assets, 30_000n);
  assert.equal(v.principalTotal + v.prizeTotal + v.reserve + v.protocolRevenue, v.assets);
});

test("duplicate entry and entry without funds are refused", () => {
  const L = new RunnerLedger();
  L.deposit("a", 3_000n);
  L.enter("c1", "a", 2_000n);
  assert.throws(() => L.enter("c1", "a", 500n), /duplicate/);
  L.deposit("b", 100n);
  assert.throws(() => L.enter("c1", "b", 2_000n), /insufficient/);
});

test("settle pays winners to their vaults, is idempotent, and never overpays", () => {
  const L = new RunnerLedger();
  for (const u of ["a", "b", "c"]) { L.deposit(u, 10_000n); L.enter("d", u, 2_000n, { feeRateBps: 0 }); }
  const pool = L.prizePool("d"); // 6000
  assert.equal(pool, 6_000n);
  assert.throws(() => L.settle("d", [{ user: "a", amount: 7_000n }]), /INSOLVENT/);
  L.settle("d", [{ user: "a", amount: 3_000n }, { user: "b", amount: 2_000n }]); // 5000 paid, 1000 remainder
  assert.equal(L.balanceOf("a"), 8_000n + 3_000n); // 8000 left in vault + 3000 prize
  assert.equal(L.prizePool("d"), 0n);
  assert.equal(L.view().reserve, 1_000n, "undistributed remainder rolls to reserve");
  L.assertSolvent();
  // idempotent: a second settle pays nothing more
  const before = L.balanceOf("a");
  L.settle("d", [{ user: "a", amount: 3_000n }]);
  assert.equal(L.balanceOf("a"), before);
  // winnings are withdrawable
  L.withdraw("a", 11_000n);
  assert.equal(L.balanceOf("a"), 0n);
  L.assertSolvent();
});

test("conservation holds across a full lifecycle", () => {
  const L = new RunnerLedger();
  L.deposit("a", 5_000n); L.deposit("b", 5_000n);
  L.enter("x", "a", 1_000n); L.enter("x", "b", 1_000n);
  L.settle("x", [{ user: "a", amount: L.prizePool("x") }]);
  L.withdraw("a", 1_000n);
  L.assertSolvent(); // the one true invariant — buckets == assets after everything
});
