/**
 * Full async-competition loop end to end: players pay entries into the pot, submit
 * server-validated runs on the shared seed, and at close the whole prize reserve is
 * distributed to the leaderboard and settled — solvent, exact, once. Plus the economy
 * simulator's money-conservation guarantee across population sizes.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CompetitionEngine } from "../src/server/engine.ts";
import { MockSettlementProvider } from "../src/chain/mock.ts";
import { RunSim, type Action } from "../src/game/sim.ts";
import { RULESET, MATCH_SECONDS } from "../src/game/constants.ts";
import { MAX_REPLAY_TICKS } from "../src/game/replay.ts";
import { STRUCTURE_A } from "../src/economy/distribution.ts";
import { simulate } from "../src/economy/simulator.ts";
import type { RunSubmission } from "../src/shared/contracts.ts";

/** An honest submission on `seed`, varying inputs by `salt` so players differ. */
function run(seed: number, salt: number): RunSubmission {
  const a = new RunSim(seed, { cap: MATCH_SECONDS });
  const script: Array<[number, Action]> = [[10 + salt, "jump"], [40 + salt, "right"], [80, "slide"], [120, "left"]];
  let si = 0;
  for (let t = 0; a.alive && t < MAX_REPLAY_TICKS; t++) {
    while (si < script.length && script[si]![0] === a.tick) { a.input(script[si]![1]); si++; }
    a.step();
  }
  return { seed, gameVersion: RULESET, inputs: a.inputs.map((e) => ({ tick: e.tick, action: e.action })), clientScore: Math.floor(a.score) };
}

test("competition: enter → validate → leaderboard → settle (solvent, exact, once)", async () => {
  const provider = new MockSettlementProvider();
  const eng = new CompetitionEngine("daily-99", 20260830, provider, 500); // 5% fee
  await eng.open();
  for (const [i, p] of ["alice", "bob", "carol"].entries()) {
    await eng.enter(p, 10_000n);
    const r = eng.submit(p, run(eng.seed, i * 7));
    assert.equal(r.accepted, true, JSON.stringify(r.flags));
  }
  // Wrong-seed submission is rejected and never recorded.
  assert.equal(eng.submit("mallory", run(1, 0)).accepted, false);

  const poolBefore = await provider.pool("daily-99");
  assert.equal(poolBefore.prizeReserve, 28_500n); // 3 × 9500

  const res = await eng.finalizeAndSettle(STRUCTURE_A);
  assert.equal(eng.state, "SETTLED");
  const totalPaid = res.paid.reduce((s, x) => s + x.amount, 0n);
  assert.equal(totalPaid, 28_500n, "the whole prize reserve is paid, exactly");
  assert.equal((await provider.pool("daily-99")).prizeReserve, 0n);
  // Winners' balances sum to the pool, and the top entry is the leaderboard #1.
  const top = eng.leaderboard()[0]!.player;
  assert.equal(await provider.balanceOf(top), res.paid[0]!.amount);
});

test("a competition with no valid entries still settles cleanly (pays nothing)", async () => {
  const eng = new CompetitionEngine("empty", 5, new MockSettlementProvider(), 0);
  await eng.open();
  const res = await eng.finalizeAndSettle(STRUCTURE_A);
  assert.equal(eng.state, "SETTLED");
  assert.equal(res.paid.length, 0);
});

test("simulator conserves money across population sizes", () => {
  for (const players of [100, 1_000, 10_000, 100_000]) {
    const r = simulate({ players, entryAmount: 2_000n, feeRateBps: 500, structureBps: STRUCTURE_A, participation: 0.6, maxEntriesPerPlayer: 5, whaleFraction: 0.02, seed: 2026 });
    assert.equal(r.protocolRevenue + r.prizeReserve, r.totalDeposits, "deposits = revenue + reserve");
    assert.equal(r.prizesPaid + r.reserveLeftover, r.prizeReserve, "reserve fully accounted");
    assert.equal(r.netMargin, r.protocolRevenue);
    assert.ok(r.prizesPaid <= r.prizeReserve, "never pays more than the reserve (solvent)");
    assert.ok(r.participants > 0 && r.participants <= players);
  }
});

test("simulator is deterministic for a given seed", () => {
  const params = { players: 5_000, entryAmount: 1_000n, feeRateBps: 300, structureBps: STRUCTURE_A, participation: 0.5, maxEntriesPerPlayer: 4, seed: 777 };
  assert.deepEqual(simulate(params), simulate(params));
});
