/** In-run HUD + result overlay + transient toasts + pause screen. Plain DOM — the
 *  canvas owns the frame budget. The toast lives outside #hud so the per-frame
 *  HUD rewrite never clobbers it. */
import type { RunSim } from "./game/sim.ts";
import type { Mode } from "./game/daily.ts";

export type ResultMeta = {
  mode: Mode;
  dailyNo?: number;
  dailyBest?: number;
  onRetry: () => void;
  onShare: () => void;
  onMenu?: () => void;
  unlocked?: string[];
  level?: number;
  leveledUp?: boolean;
  challenge?: { name: string; goal: string; met: boolean };
  compStatus?: "ACCEPTED" | "REJECTED" | "DUPLICATE"; // Daily Block submission outcome
  compDetail?: string;
};

const bestKey = "archrunner.best.v1";
const readBest = (): number => { try { return Number(localStorage.getItem(bestKey) || 0); } catch { return 0; } };
const writeBest = (v: number): void => { try { localStorage.setItem(bestKey, String(v)); } catch { /* ephemeral */ } };

export class HUD {
  private shownResult = false;
  private toastEl: HTMLElement;
  private coachEl: HTMLElement;
  private coinsEl: HTMLElement;
  private coinsNumEl: HTMLElement;
  private debugEl: HTMLElement;
  private shareEl: HTMLElement;
  private flashEl!: HTMLElement;
  private toastTimer = 0;
  private coachTimer = 0;
  private lastCoins = 0;

  constructor(private hud: HTMLElement, private overlay: HTMLElement) {
    const app = document.getElementById("app") ?? document.body;
    this.toastEl = document.createElement("div");
    this.toastEl.id = "toast";
    app.appendChild(this.toastEl);
    this.coachEl = document.createElement("div");
    this.coachEl.id = "coach";
    app.appendChild(this.coachEl);
    this.coinsEl = document.createElement("div");
    this.coinsEl.id = "coins";
    this.coinsEl.innerHTML = `<span class="btcico">₿</span><span class="num">0</span>`;
    app.appendChild(this.coinsEl);
    this.coinsNumEl = this.coinsEl.querySelector(".num") as HTMLElement;
    this.debugEl = document.createElement("div");
    this.debugEl.id = "debug";
    app.appendChild(this.debugEl);
    this.shareEl = document.createElement("div");
    this.shareEl.id = "sharepop";
    app.appendChild(this.shareEl);
    this.flashEl = document.createElement("div");
    this.flashEl.id = "impactflash";
    app.appendChild(this.flashEl);
    // Subtle vignette over the 3D (below the HUD/menu DOM) — a finishing frame for the scene.
    if (!document.getElementById("vignette")) {
      const vg = document.createElement("div"); vg.id = "vignette"; app.appendChild(vg);
    }
  }

  /** A quick red impact vignette on a fatal hit — reads as a controlled, legible death. */
  flashImpact(): void {
    this.flashEl.classList.remove("fire");
    void this.flashEl.offsetWidth; // restart the animation
    this.flashEl.classList.add("fire");
  }

  /** Custom in-app share card (never the native OS share sheet). */
  showShare(text: string, url: string): void {
    this.shareEl.innerHTML = `
      <div class="sharecard">
        <div class="eyebrow">SHARE YOUR RUN</div>
        <pre class="sharetext">${text}\n${url}</pre>
        <button id="sh-copy" class="btn">COPY</button>
        <div class="row">
          <button id="sh-x" class="btn ghost">POST TO X</button>
          <button id="sh-close" class="btn ghost">CLOSE</button>
        </div>
      </div>`;
    this.shareEl.classList.add("show");
    const q = (s: string) => this.shareEl.querySelector(s) as HTMLButtonElement;
    q("#sh-copy").onclick = () => { void navigator.clipboard?.writeText(`${text}\n${url}`).then(() => this.toast("COPIED", "perfect")).catch(() => undefined); };
    q("#sh-x").onclick = () => { window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank", "noopener"); };
    q("#sh-close").onclick = () => this.shareEl.classList.remove("show");
  }

  /** Dev-only F3 overlay. */
  setDebug(line: string | null): void {
    if (line === null) { this.debugEl.classList.remove("show"); return; }
    this.debugEl.textContent = line;
    this.debugEl.classList.add("show");
  }

  /** First-run onboarding banner; auto-dismisses. */
  coach(): void {
    this.coachEl.innerHTML = `<b>DODGE</b> the hazards · <b>↑ JUMP</b> the low bars · <b>↓ SLIDE</b> under the high ones · chain clean moves to build <b>FLOW</b>`;
    this.coachEl.classList.add("show");
    window.clearTimeout(this.coachTimer);
    this.coachTimer = window.setTimeout(() => this.coachEl.classList.remove("show"), 5200);
  }

  update(sim: RunSim): void {
    if (sim.phase === "ended") return;
    const hyper = sim.hyperFlow ? " hyper" : "";
    const block = sim.blockRun ? `<div class="stat block"><span class="k">BLOCK RUN</span><span class="v">×2</span></div>` : "";
    const flip = sim.flipActive ? `<div class="stat flip"><span class="k">ARCH FLIP</span><span class="v">×3</span></div>` : "";
    this.hud.innerHTML = `
      <div class="stat"><span class="k">SCORE</span><span class="v">${Math.floor(sim.score).toLocaleString()}</span></div>
      <div class="stat flow${hyper}"><span class="k">FLOW</span><span class="v">×${sim.flowMult.toFixed(1)}</span></div>
      <div class="stat"><span class="k">DIST</span><span class="v">${(sim.distance / 100).toFixed(2)} KM</span></div>
      ${block}${flip}
    `;
    // Persistent coins counter (top-right) — pops when it increases.
    this.coinsEl.classList.add("show");
    if (sim.collected !== this.lastCoins) {
      this.coinsNumEl.textContent = String(sim.collected);
      if (sim.collected > this.lastCoins) {
        this.coinsEl.classList.remove("pop"); void this.coinsEl.offsetWidth; this.coinsEl.classList.add("pop");
      }
      this.lastCoins = sim.collected;
    }
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

  showResult(sim: RunSim, meta: ResultMeta): void {
    if (this.shownResult) return;
    this.shownResult = true;
    this.coinsEl.classList.remove("show"); // the in-run counter hides on the result card
    const score = Math.floor(sim.score);
    const prevBest = readBest();
    const best = Math.max(prevBest, score);
    writeBest(best);
    const secs = sim.elapsed.toFixed(1);
    const isBest = score > prevBest && score > 0;
    const eyebrow = isBest ? "NEW BEST"
      : meta.mode === "daily" ? `DAILY BLOCK #${meta.dailyNo ?? ""}`
      : "RUN COMPLETE";
    const bestLine = meta.mode === "daily"
      ? `TODAY'S BEST ${Math.max(meta.dailyBest ?? 0, score).toLocaleString()}`
      : `BEST ${best.toLocaleString()}`;
    // Why the run ended + a "one more run" hook.
    const deathLine = sim.deathCause ? `<div class="death">${sim.deathCause}</div>` : "";
    const motiv = isBest
      ? `<div class="motiv best">🏆 NEW PERSONAL BEST!</div>`
      : prevBest - score > 0
        ? `<div class="motiv">${(prevBest - score).toLocaleString()} to beat your best — one more run?</div>`
        : "";
    const chal = meta.challenge
      ? `<div class="challenge-result ${meta.challenge.met ? "met" : "miss"}">${meta.challenge.met ? "✓ CHALLENGE COMPLETE" : "✗ " + meta.challenge.goal} · ${meta.challenge.name}</div>`
      : "";
    // Newly-earned badges. Cap the list so a big first run doesn't dump a green wall;
    // the full set lives in PROFILE (so every badge named here has a real home).
    const got = meta.unlocked ?? [];
    const shown = got.slice(0, 3).map((t) => `<div class="unlock">★ ${t}</div>`).join("");
    const more = got.length > 3 ? `<div class="unlock more">+${got.length - 3} more — see PROFILE</div>` : got.length ? `<div class="unlock more">view all in PROFILE</div>` : "";
    const unlocks = shown + more;
    const levelUp = meta.leveledUp ? `<div class="unlock lvl">▲ RUNNER LEVEL ${meta.level}</div>` : "";
    // Daily Block: show the TRUTHFUL competitive-record outcome (provisional until the
    // server validator is live — never claim a client score is "secure"/"settled").
    const comp = meta.mode === "daily" && meta.compStatus
      ? meta.compStatus === "ACCEPTED"
        ? `<div class="compstat ok">✓ RECORDED TO DAILY BLOCK · provisional (server validation pending)</div>`
        : meta.compStatus === "DUPLICATE"
          ? `<div class="compstat dup">• ALREADY RECORDED — your best run for today stands</div>`
          : `<div class="compstat bad">✗ NOT COUNTED${meta.compDetail ? ` — ${meta.compDetail}` : ""}</div>`
      : "";
    this.overlay.innerHTML = `
      <div class="card">
        <div class="eyebrow">${eyebrow}</div>
        ${deathLine}
        <div class="big">${score.toLocaleString()}</div>
        <div class="sub">SURVIVED ${secs}s · ${(sim.distance / 100).toFixed(2)} KM</div>
        ${motiv}
        <div class="stats-grid">
          <div><span class="n"><span class="btcico sm">₿</span> ${sim.collected}</span><span class="l">COINS</span></div>
          <div><span class="n">${sim.perfects}</span><span class="l">PERFECT</span></div>
          <div><span class="n">${sim.nearMisses}</span><span class="l">NEAR MISS</span></div>
          <div><span class="n">${sim.blockRuns}</span><span class="l">BLOCK RUN</span></div>
          <div><span class="n">${sim.flips}</span><span class="l">ARCH FLIP</span></div>
          <div><span class="n">×${sim.maxFlowMult.toFixed(1)}</span><span class="l">MAX FLOW</span></div>
        </div>
        <div class="coinnote">coins add to your score — more coins, bigger score</div>
        <div class="best">${bestLine}</div>
        ${comp}${chal}${levelUp}${unlocks}
        <button id="retry" class="btn">RUN IT AGAIN</button>
        <div class="row">
          <button id="share" class="btn ghost">SHARE</button>
          ${meta.onMenu ? `<button id="menu" class="btn ghost">MENU</button>` : ""}
        </div>
        <div class="hint">← → MOVE · ↑/SPACE JUMP · ↓ SLIDE · (SWIPE ON MOBILE)</div>
      </div>`;
    this.overlay.classList.add("show");
    (this.overlay.querySelector("#retry") as HTMLButtonElement).onclick = () => meta.onRetry();
    (this.overlay.querySelector("#share") as HTMLButtonElement).onclick = () => meta.onShare();
    const menuBtn = this.overlay.querySelector("#menu") as HTMLButtonElement | null;
    if (menuBtn && meta.onMenu) menuBtn.onclick = () => meta.onMenu!();
  }

  hideResult(): void {
    this.shownResult = false;
    this.overlay.classList.remove("show");
    this.overlay.innerHTML = "";
  }
}
