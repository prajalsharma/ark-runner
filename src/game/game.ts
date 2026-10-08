/** Orchestrator: fixed-step sim + interpolated render + HUD + feel (audio/juice).
 *  Deterministic core, smooth presentation. Free play uses a fresh seed per run;
 *  daily/competition mode (Phase 4) will pass a fixed seed so everyone gets the
 *  same world. Gameplay events are detected by diffing sim counters here, so the
 *  sim itself stays pure (no callbacks, replay-safe). */
import { DT } from "./constants.ts";
import { RunSim } from "./sim.ts";
import { Renderer } from "./render.ts";
import { HUD } from "../ui.ts";
import { AudioManager } from "../engine/audio.ts";
import { attachInput } from "../engine/input.ts";

export type GameOpts = { seed?: number; cap?: number; onEnd?: (sim: RunSim) => void };

type Snapshot = { collected: number; nearMisses: number; perfects: number; blockRuns: number; flips: number; flipActive: boolean; alive: boolean };

export class Game {
  sim: RunSim;
  readonly audio = new AudioManager();
  private renderer: Renderer;
  private hud: HUD;
  private detach: () => void;
  private detachKeys: () => void;
  private sysbar: HTMLElement;
  private acc = 0;
  private lastT = 0;
  private raf = 0;
  private cap: number;
  private onEnd?: (sim: RunSim) => void;
  private ended = false;
  private paused = false;
  private prev: Snapshot;

  constructor(canvas: HTMLCanvasElement, hudEl: HTMLElement, overlayEl: HTMLElement, opts: GameOpts = {}) {
    this.cap = opts.cap ?? 0;
    this.onEnd = opts.onEnd;
    this.sim = new RunSim(opts.seed ?? this.freshSeed(), { cap: this.cap });
    this.prev = this.snapshot();
    this.renderer = new Renderer(canvas);
    this.hud = new HUD(hudEl, overlayEl);
    this.audio.resume(); // we're inside the run-button gesture → allowed to start audio

    this.detach = attachInput((a) => {
      if (!this.sim.alive || this.paused) return;
      if (a === "jump" && this.sim.grounded) this.audio.play("jump");
      else if (a === "slide" && this.sim.grounded) this.audio.play("slide");
      this.sim.input(a);
    });

    this.sysbar = this.buildSysbar();
    this.detachKeys = this.attachSysKeys();

    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  private snapshot(): Snapshot {
    const s = this.sim;
    return { collected: s.collected, nearMisses: s.nearMisses, perfects: s.perfects, blockRuns: s.blockRuns, flips: s.flips, flipActive: s.flipActive, alive: s.alive };
  }

  private freshSeed(): number { return ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0) || 1; }

  private loop(now: number): void {
    if (!this.lastT) this.lastT = now;
    let frame = (now - this.lastT) / 1000;
    this.lastT = now;
    if (this.paused) { this.raf = requestAnimationFrame(this.loop); return; }
    if (frame > 0.1) frame = 0.1; // clamp after a tab switch
    this.acc += frame;
    while (this.acc >= DT) { this.sim.step(); this.acc -= DT; }

    this.reactToEvents();
    this.audio.setDrive(this.sim.speed, this.sim.blockRun);
    this.renderer.render(this.sim, now);
    this.hud.update(this.sim);

    if (this.sim.phase === "ended" && !this.ended) {
      this.ended = true;
      this.onEnd?.(this.sim);
      this.hud.showResult(this.sim, () => this.restart());
    }
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Turn sim-counter deltas into feedback (sound + shake + toast). Keeps sim pure. */
  private reactToEvents(): void {
    const s = this.sim, p = this.prev;
    if (s.collected > p.collected) this.audio.play("collect");
    if (s.nearMisses > p.nearMisses) { this.audio.play("nearmiss"); this.renderer.addShake(0.12); }
    if (s.perfects > p.perfects) { this.audio.play("perfect"); this.renderer.addShake(0.06); this.hud.toast("PERFECT", "perfect"); }
    if (s.blockRuns > p.blockRuns) { this.audio.play("blockstart"); this.hud.toast("BLOCK RUN", "block"); }
    if (s.flipActive && !p.flipActive) { this.audio.play("flip"); this.hud.toast("ARCH FLIP ×3", "flip"); }
    if (s.flips > p.flips) { this.audio.play("flipbank"); this.hud.toast("FLIP BANKED", "flip"); this.renderer.addShake(0.1); }
    if (!s.alive && p.alive) { this.audio.play("death"); this.renderer.addShake(1.0); }
    this.prev = this.snapshot();
  }

  private buildSysbar(): HTMLElement {
    const bar = document.createElement("div");
    bar.id = "sysbar";
    const mute = document.createElement("button");
    mute.className = "sysbtn";
    const paintMute = () => { mute.textContent = this.audio.muted ? "🔇" : "🔊"; mute.setAttribute("aria-label", this.audio.muted ? "Unmute" : "Mute"); };
    paintMute();
    mute.onclick = () => { this.audio.toggleMute(); paintMute(); };
    const pause = document.createElement("button");
    pause.className = "sysbtn";
    pause.textContent = "⏸";
    pause.setAttribute("aria-label", "Pause");
    pause.onclick = () => this.togglePause();
    bar.append(mute, pause);
    document.getElementById("app")?.appendChild(bar);
    return bar;
  }

  private attachSysKeys(): () => void {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "p" || e.key === "P") { this.togglePause(); }
      else if (e.key === "m" || e.key === "M") { this.audio.toggleMute(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }

  togglePause(): void {
    if (this.ended || !this.sim.alive) return;
    this.paused = !this.paused;
    if (this.paused) { this.audio.suspend(); this.hud.showPause(() => this.togglePause()); }
    else { this.audio.resume(); this.hud.hidePause(); this.lastT = 0; this.acc = 0; }
  }

  restart(seed?: number): void {
    this.sim = new RunSim(seed ?? this.freshSeed(), { cap: this.cap });
    this.prev = this.snapshot();
    this.ended = false;
    this.paused = false;
    this.hud.hideResult();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.detach();
    this.detachKeys();
    this.sysbar.remove();
  }
}
