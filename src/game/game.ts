/** Orchestrator: fixed-step sim + interpolated render + HUD + feel (audio/juice).
 *  Deterministic core, smooth presentation. Free Run uses a fresh seed; Daily Block
 *  uses the shared daily seed (same world for everyone, bounded by MATCH_SECONDS) so
 *  scores are comparable. Gameplay events are detected by diffing sim counters here,
 *  so the sim itself stays pure (no callbacks, replay-safe). */
import { DT, MATCH_SECONDS } from "./constants.ts";
import { RunSim } from "./sim.ts";
import { Renderer } from "./render.ts";
import { HUD, type ResultMeta } from "../ui.ts";
import { AudioManager } from "../engine/audio.ts";
import { attachInput } from "../engine/input.ts";
import { type Mode, dailySeed, dateKeyUTC, dailyNumber, recordRun, dailyBest } from "./daily.ts";
import { selectedSkin } from "./cosmetics.ts";

export type GameOpts = { mode?: Mode; seed?: number; onEnd?: (sim: RunSim) => void; onMenu?: () => void };

type Snapshot = { collected: number; nearMisses: number; perfects: number; blockRuns: number; flips: number; flipActive: boolean; alive: boolean };

export class Game {
  sim: RunSim;
  readonly audio = new AudioManager();
  readonly mode: Mode;
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
  private onMenu?: () => void;
  private ended = false;
  private recorded = false;
  private paused = false;
  private prev: Snapshot;
  private dateKey = dateKeyUTC();

  constructor(canvas: HTMLCanvasElement, hudEl: HTMLElement, overlayEl: HTMLElement, opts: GameOpts = {}) {
    this.mode = opts.mode ?? "free";
    this.onEnd = opts.onEnd;
    this.onMenu = opts.onMenu;
    this.cap = this.mode === "daily" ? MATCH_SECONDS : 0;
    this.sim = new RunSim(opts.seed ?? this.newSeed(), { cap: this.cap });
    this.prev = this.snapshot();
    this.renderer = new Renderer(canvas, selectedSkin().color);
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

  /** Daily Block replays the same shared seed all day; Free Run is fresh each time. */
  private newSeed(): number {
    return this.mode === "daily" ? dailySeed(this.dateKey) : (((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0) || 1);
  }

  private snapshot(): Snapshot {
    const s = this.sim;
    return { collected: s.collected, nearMisses: s.nearMisses, perfects: s.perfects, blockRuns: s.blockRuns, flips: s.flips, flipActive: s.flipActive, alive: s.alive };
  }

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
      this.finishRun();
    }
    this.raf = requestAnimationFrame(this.loop);
  }

  private finishRun(): void {
    const s = this.sim;
    if (!this.recorded) {
      this.recorded = true;
      recordRun({ score: Math.floor(s.score), mode: this.mode, dateKey: this.dateKey, ts: Date.now(), dist: s.distance, flips: s.flips, blockRuns: s.blockRuns });
    }
    this.onEnd?.(s);
    const meta: ResultMeta = {
      mode: this.mode,
      dailyNo: this.mode === "daily" ? dailyNumber(this.dateKey) : undefined,
      dailyBest: this.mode === "daily" ? dailyBest(this.dateKey) : undefined,
      onRetry: () => this.restart(),
      onShare: () => this.share(),
      onMenu: this.onMenu ? () => { this.onMenu?.(); } : undefined,
    };
    this.hud.showResult(s, meta);
  }

  private share(): void {
    const s = this.sim;
    const head = this.mode === "daily" ? `ARCH RUNNER · DAILY BLOCK #${dailyNumber(this.dateKey)}` : "ARCH RUNNER · FREE RUN";
    const text = `${head}\nSCORE ${Math.floor(s.score).toLocaleString()}\n${(s.distance / 100).toFixed(2)} KM · FLOW ×${s.maxFlowMult.toFixed(1)} · ${s.blockRuns} BLOCK · ${s.flips} FLIP\nRun it: ${location.href}`;
    const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
    if (typeof nav.share === "function") { void nav.share({ text }).catch(() => undefined); }
    else { void navigator.clipboard?.writeText(text).then(() => this.hud.toast("COPIED", "perfect")).catch(() => undefined); }
  }

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
      if (e.key === "Escape" || e.key === "p" || e.key === "P") this.togglePause();
      else if (e.key === "m" || e.key === "M") this.audio.toggleMute();
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

  restart(): void {
    this.sim = new RunSim(this.newSeed(), { cap: this.cap });
    this.prev = this.snapshot();
    this.ended = false;
    this.recorded = false;
    this.paused = false;
    this.hud.hideResult();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.detach();
    this.detachKeys();
    this.sysbar.remove();
    this.hud.hideResult();
  }
}
