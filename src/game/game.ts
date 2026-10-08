/** Orchestrator: fixed-step sim + interpolated render + HUD. Deterministic core,
 *  smooth presentation. Free play uses a fresh seed per run; daily/competition
 *  mode (Phase 4) will pass a fixed seed so everyone gets the same world. */
import { DT } from "./constants.ts";
import { RunSim } from "./sim.ts";
import { Renderer } from "./render.ts";
import { HUD } from "../ui.ts";
import { attachInput } from "../engine/input.ts";

export type GameOpts = { seed?: number; cap?: number; onEnd?: (sim: RunSim) => void };

export class Game {
  sim: RunSim;
  private renderer: Renderer;
  private hud: HUD;
  private detach: () => void;
  private acc = 0;
  private lastT = 0;
  private raf = 0;
  private cap: number;
  private onEnd?: (sim: RunSim) => void;
  private ended = false;

  constructor(canvas: HTMLCanvasElement, hudEl: HTMLElement, overlayEl: HTMLElement, opts: GameOpts = {}) {
    this.cap = opts.cap ?? 0;
    this.onEnd = opts.onEnd;
    this.sim = new RunSim(opts.seed ?? this.freshSeed(), { cap: this.cap });
    this.renderer = new Renderer(canvas);
    this.hud = new HUD(hudEl, overlayEl);
    this.detach = attachInput((a) => this.sim.input(a));
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  private freshSeed(): number { return ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0) || 1; }

  private loop(now: number): void {
    if (!this.lastT) this.lastT = now;
    let frame = (now - this.lastT) / 1000;
    this.lastT = now;
    if (frame > 0.1) frame = 0.1; // clamp after a tab switch
    this.acc += frame;
    while (this.acc >= DT) { this.sim.step(); this.acc -= DT; }

    this.renderer.render(this.sim, now);
    this.hud.update(this.sim);

    if (this.sim.phase === "ended" && !this.ended) {
      this.ended = true;
      this.onEnd?.(this.sim);
      this.hud.showResult(this.sim, () => this.restart());
    }
    this.raf = requestAnimationFrame(this.loop);
  }

  restart(seed?: number): void {
    this.sim = new RunSim(seed ?? this.freshSeed(), { cap: this.cap });
    this.ended = false;
    this.hud.hideResult();
  }

  stop(): void { cancelAnimationFrame(this.raf); this.detach(); }
}
