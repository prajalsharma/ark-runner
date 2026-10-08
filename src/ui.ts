/** In-run HUD + result overlay + transient toasts + pause screen. Plain DOM — the
 *  canvas owns the frame budget. The toast lives outside #hud so the per-frame
 *  HUD rewrite never clobbers it. */
import type { RunSim } from "./game/sim.ts";

const bestKey = "archrunner.best.v1";
const readBest = (): number => { try { return Number(localStorage.getItem(bestKey) || 0); } catch { return 0; } };
const writeBest = (v: number): void => { try { localStorage.setItem(bestKey, String(v)); } catch { /* ephemeral */ } };

export class HUD {
  private shownResult = false;
  private toastEl: HTMLElement;
  private toastTimer = 0;

  constructor(private hud: HTMLElement, private overlay: HTMLElement) {
    this.toastEl = document.createElement("div");
    this.toastEl.id = "toast";
    (document.getElementById("app") ?? document.body).appendChild(this.toastEl);
  }

  update(sim: RunSim): void {
    if (sim.phase === "ended") return;
    const hyper = sim.hyperFlow ? " hyper" : "";
    const block = sim.blockRun ? `<div class="stat block"><span class="k">BLOCK RUN</span><span class="v">×2</span></div>` : "";
    this.hud.innerHTML = `
      <div class="stat"><span class="k">SCORE</span><span class="v">${Math.floor(sim.score).toLocaleString()}</span></div>
      <div class="stat flow${hyper}"><span class="k">FLOW</span><span class="v">×${sim.flowMult.toFixed(1)}</span></div>
      <div class="stat"><span class="k">DIST</span><span class="v">${(sim.distance / 100).toFixed(2)} KM</span></div>
      ${block}
    `;
  }

  /** Brief centered flash, e.g. PERFECT / BLOCK RUN. */
  toast(text: string, cls: string): void {
    this.toastEl.textContent = text;
    this.toastEl.className = cls; // reset classes
    // restart the animation
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add("show");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), 850);
  }

  showPause(onResume: () => void): void {
    this.overlay.innerHTML = `
      <div class="card">
        <div class="eyebrow">PAUSED</div>
        <button id="resume" class="btn">RESUME</button>
        <div class="hint">ESC / P RESUME · M MUTE</div>
      </div>`;
    this.overlay.classList.add("show");
    (this.overlay.querySelector("#resume") as HTMLButtonElement).onclick = () => onResume();
  }

  hidePause(): void {
    this.overlay.classList.remove("show");
    this.overlay.innerHTML = "";
  }

  showResult(sim: RunSim, onRetry: () => void): void {
    if (this.shownResult) return;
    this.shownResult = true;
    const score = Math.floor(sim.score);
    const best = Math.max(readBest(), score);
    writeBest(best);
    const secs = sim.elapsed.toFixed(1);
    const isBest = score >= best && score > 0;
    this.overlay.innerHTML = `
      <div class="card">
        <div class="eyebrow">${isBest ? "NEW BEST" : "RUN COMPLETE"}</div>
        <div class="big">${score.toLocaleString()}</div>
        <div class="sub">SURVIVED ${secs}s · ${(sim.distance / 100).toFixed(2)} KM</div>
        <div class="stats-grid">
          <div><span class="n">${sim.collected}</span><span class="l">ENERGY</span></div>
          <div><span class="n">${sim.perfects}</span><span class="l">PERFECT</span></div>
          <div><span class="n">${sim.nearMisses}</span><span class="l">NEAR MISS</span></div>
          <div><span class="n">${sim.blockRuns}</span><span class="l">BLOCK RUN</span></div>
          <div><span class="n">×${sim.maxFlowMult.toFixed(1)}</span><span class="l">MAX FLOW</span></div>
        </div>
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
