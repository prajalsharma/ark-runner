/**
 * Optional client → API bridge. If a backend is configured (localStorage
 * `archrunner.api` or `window.ARCH_API`), a finished run is submitted for
 * server-side replay validation. With no backend, this is a silent no-op — the
 * game stays fully playable offline (degraded mode, by design).
 */
import type { RunSubmission, ValidationResult } from "../shared/contracts.ts";
import { RULESET } from "../game/constants.ts";
import type { RunSim } from "../game/sim.ts";

function apiBase(): string | null {
  const w = window as unknown as { ARCH_API?: string };
  try { return localStorage.getItem("archrunner.api") || w.ARCH_API || null; } catch { return w.ARCH_API ?? null; }
}

export async function submitRun(sim: RunSim, extra: { competitionId?: string; player?: string } = {}): Promise<ValidationResult | null> {
  const base = apiBase();
  if (!base) return null; // no backend → nothing to do
  const sub: RunSubmission = {
    seed: sim.seed,
    gameVersion: RULESET,
    inputs: sim.inputs.map((e) => ({ tick: e.tick, action: e.action })),
    clientScore: Math.floor(sim.score),
    ...extra,
  };
  try {
    const r = await fetch(`${base}/validate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub) });
    return r.ok ? ((await r.json()) as ValidationResult) : null;
  } catch { return null; } // network down → degrade, never block the UI
}
