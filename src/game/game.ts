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
import { selectedCharacterColor } from "./characters.ts";
import { submitRun } from "../net/api.ts";
import { recordRunStats } from "./achievements.ts";

export type GameOpts = { mode?: Mode; seed?: number; onEnd?: (sim: RunSim) => void; onMenu?: () => void };

type Snapshot = { collected: number; nearMisses: number; perfects: number; blockRuns: number; flips: number; flipActive: boolean; grounded: boolean; alive: boolean };

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
  private debug = false;
  private prev: Snapshot;
  private auditorAt = 260;   // next distance (world units) to drop an Auditor quip
  private auditorN = 0;
  private dateKey = dateKeyUTC();

  constructor(canvas: HTMLCanvasElement, hudEl: HTMLElement, overlayEl: HTMLElement, opts: GameOpts = {}) {
    this.mode = opts.mode ?? "free";
    this.onEnd = opts.onEnd;
    this.onMenu = opts.onMenu;
    this.cap = this.mode === "daily" ? MATCH_SECONDS : 0;
    this.sim = new RunSim(opts.seed ?? this.newSeed(), { cap: this.cap });
    this.prev = this.snapshot();
    this.renderer = new Renderer(canvas, selectedCharacterColor());
    this.hud = new HUD(hudEl, overlayEl);
    this.audio.resume(); // we're inside the run-button gesture → allowed to start audio
    this.audio.startMusic();

    this.detach = attachInput((a) => {
      if (!this.sim.alive || this.paused) return;
      if (a === "jump" && this.sim.grounded) this.audio.play("jump");
      else if (a === "slide" && this.sim.grounded) this.audio.play("slide");
      this.sim.input(a);
    });

    this.sysbar = this.buildSysbar();
    this.detachKeys = this.attachSysKeys();
    this.maybeCoach();

    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Daily Block replays the same shared seed all day; Free Run is fresh each time. */
  private newSeed(): number {
    return this.mode === "daily" ? dailySeed(this.dateKey) : (((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0) || 1);
  }

  /** Show the control coach once per device. */
  private maybeCoach(): void {
    const key = "archrunner.coached.v1";
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); } catch { /* show anyway */ }
    this.hud.coach();
  }

  private snapshot(): Snapshot {
    const s = this.sim;
    return { collected: s.collected, nearMisses: s.nearMisses, perfects: s.perfects, blockRuns: s.blockRuns, flips: s.flips, flipActive: s.flipActive, grounded: s.grounded, alive: s.alive };
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
    if (this.debug) this.hud.setDebug(this.sim.debugLine());
    this.maybeAuditor();

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
    // Progression: cumulative stats, XP/level, achievements (once per run).
    const prog = recordRunStats({ score: Math.floor(s.score), coins: s.collected, distance: s.distance, perfects: s.perfects, maxFlowMult: s.maxFlowMult, archFlips: s.flips, blockRuns: s.blockRuns });
    if (prog.unlocked.length || prog.leveledUp) this.audio.play("perfect");

    // Beat your prior best → a little fanfare (reads the old best before the card writes it).
    let prevBest = 0;
    try { prevBest = Number(localStorage.getItem("archrunner.best.v1") || 0); } catch { /* ephemeral */ }
    if (prevBest > 0 && Math.floor(s.score) > prevBest) this.audio.play("record");

    this.onEnd?.(s);
    // Daily runs are submitted for server-side validation when a backend is set
    // (no-op offline). The official score is the server's, not ours.
    if (this.mode === "daily") {
      void submitRun(s).then((r) => { if (r?.accepted) this.hud.toast("VERIFIED ✓", "perfect"); });
    }
    const meta: ResultMeta = {
      mode: this.mode,
      dailyNo: this.mode === "daily" ? dailyNumber(this.dateKey) : undefined,
      dailyBest: this.mode === "daily" ? dailyBest(this.dateKey) : undefined,
      onRetry: () => this.restart(),
      onShare: () => this.share(),
      onMenu: this.onMenu ? () => { this.onMenu?.(); } : undefined,
      unlocked: prog.unlocked.map((a) => a.title),
      level: prog.level,
      leveledUp: prog.leveledUp,
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
    if (s.grounded && !p.grounded) this.audio.play("land");
    if (s.collected > p.collected) { this.audio.play("collect"); this.renderer.burst("collect"); }
    if (s.nearMisses > p.nearMisses) { this.audio.play("nearmiss"); this.renderer.addShake(0.12); }
    if (s.perfects > p.perfects) { this.audio.play("perfect"); this.renderer.addShake(0.06); this.renderer.burst("perfect"); this.hud.toast("PERFECT", "perfect"); }
    if (s.blockRuns > p.blockRuns) { this.audio.play("blockstart"); this.hud.toast("BLOCK RUN", "block"); }
    if (s.flipActive && !p.flipActive) { this.audio.play("flip"); this.hud.toast("ARCH FLIP ×3", "flip"); }
    if (s.flips > p.flips) { this.audio.play("flipbank"); this.hud.toast("FLIP BANKED", "flip"); this.renderer.addShake(0.1); this.renderer.burst("flip"); }
    if (!s.alive && p.alive) { this.audio.play("death"); this.renderer.addShake(1.0); this.renderer.burst("death"); }
    this.prev = this.snapshot();
  }

  private static AUDITOR_LINES = [
    "PLEASE STOP RUNNING.",
    "YOUR VELOCITY IS SUSPICIOUS.",
    "THAT WAS AN UNAUTHORIZED JUMP.",
    "YOU HAVE COLLECTED TOO MANY COINS.",
    "THIS IS NOW A COMPLIANCE ISSUE.",
    "I CALCULATED YOUR ESCAPE ODDS. ANNOYING.",
  ];

  /** The Auditor heckles the runner at distance milestones (presentation only). */
  private maybeAuditor(): void {
    if (!this.sim.alive || this.sim.distance < this.auditorAt) return;
    this.hud.toast(`⚠ AUDITOR: ${Game.AUDITOR_LINES[this.auditorN % Game.AUDITOR_LINES.length]}`, "auditor");
    this.audio.play("nearmiss");
    this.auditorN++;
    this.auditorAt += 640;
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
      else if (e.key === "F3") { this.debug = !this.debug; if (!this.debug) this.hud.setDebug(null); e.preventDefault(); }
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
    this.auditorAt = 260;
    this.auditorN = 0;
    this.hud.hideResult();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.audio.stopMusic();
    this.detach();
    this.detachKeys();
    this.sysbar.remove();
    this.hud.hideResult();
    this.hud.setDebug(null);
    this.renderer.dispose();
  }
}
