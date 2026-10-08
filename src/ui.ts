/** In-run HUD + result overlay. Plain DOM — the canvas owns the frame budget. */
import type { RunSim } from "./game/sim.ts";

const bestKey = "arkrunner.best.v1";
const readBest = (): number => { try { return Number(localStorage.getItem(bestKey) || 0); } catch { return 0; } };
const writeBest = (v: number): void => { try { localStorage.setItem(bestKey, String(v)); } catch { /* ephemeral */ } };

export class HUD {
  private shownResult = false;
  constructor(private hud: HTMLElement, private overlay: HTMLElement) {}

  update(sim: RunSim): void {
    if (sim.phase === "ended") return;
    const hyper = sim.hyperFlow ? " hyper" : "";
    this.hud.innerHTML = `
      <div class="stat"><span class="k">SCORE</span><span class="v">${Math.floor(sim.score).toLocaleString()}</span></div>
      <div class="stat flow${hyper}"><span class="k">FLOW</span><span class="v">×${sim.flowMult.toFixed(1)}</span></div>
      <div class="stat"><span class="k">DIST</span><span class="v">${(sim.distance / 100).toFixed(2)} KM</span></div>
    `;
  }

  showResult(sim: RunSim, onRetry: () => void): void {
    if (this.shownResult) return;
    this.shownResult = true;
    const score = Math.floor(sim.score);
    const best = Math.max(readBest(), score);
    writeBest(best);
    const secs = sim.elapsed.toFixed(1);
    this.overlay.innerHTML = `
      <div class="card">
        <div class="eyebrow">RUN COMPLETE</div>
        <div class="big">${score.toLocaleString()}</div>
        <div class="sub">SURVIVED ${secs}s · ${(sim.distance / 100).toFixed(2)} KM · ${sim.collected} ENERGY · ${sim.nearMisses} NEAR MISS</div>
        <div class="best">BEST ${best.toLocaleString()}</div>
        <button id="retry" class="btn">RUN IT AGAIN</button>
        <div class="hint">← → MOVE · ↑/SPACE JUMP · ↓ SLIDE · (SWIPE ON MOBILE)</div>
      </div>`;
    this.overlay.classList.add("show");
    (this.overlay.querySelector("#retry") as HTMLButtonElement).onclick = () => { onRetry(); };
  }

  hideResult(): void {
    this.shownResult = false;
    this.overlay.classList.remove("show");
    this.overlay.innerHTML = "";
  }
}
