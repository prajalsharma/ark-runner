/**
 * Attract mode — a live 3D background for the menu. It reuses the real Renderer +
 * RunSim with a lightweight autopilot that weaves, jumps and slides so the city
 * scrolls convincingly behind the UI. Runs on its OWN canvas (not the game's) to
 * avoid a second WebGL context on one element. Cheap: one sim, no HUD, no audio.
 */
import { DT } from "../game/constants.ts";
import { RunSim, type Action } from "../game/sim.ts";
import { Renderer } from "../game/render.ts";
import { selectedSkin } from "../game/cosmetics.ts";

/** Heuristic autopilot: dodge walls, jump lows/pits, slide highs. Just needs to look alive. */
function decide(sim: RunSim): Action | null {
  const d = sim.distance;
  const LOOK = 13;
  let inLane: { type: string; rel: number } | null = null;
  const blockedSoon = new Set<number>();
  for (const o of sim.view().obstacles) {
    const rel = o.z - d;
    if (rel < 1.2 || rel > LOOK) continue;
    if ((o.type === "WALL" || o.type === "PIT") && rel < 9) blockedSoon.add(o.lane);
    if (o.lane === sim.lane && (!inLane || rel < inLane.rel)) inLane = { type: o.type, rel };
  }
  if (inLane) {
    if (inLane.type === "LOW" && sim.grounded) return "jump";
    if (inLane.type === "PIT" && sim.grounded && inLane.rel < 6.5) return "jump";
    if (inLane.type === "HIGH" && sim.grounded && !sim.sliding) return "slide";
    if (inLane.type === "WALL") {
      for (const L of [sim.lane - 1, sim.lane + 1]) if (L >= -1 && L <= 1 && !blockedSoon.has(L)) return L < sim.lane ? "left" : "right";
    }
  }
  return null;
}

export class Attract {
  readonly canvas: HTMLCanvasElement;
  private renderer: Renderer;
  private sim: RunSim;
  private raf = 0;
  private acc = 0;
  private lastT = 0;
  private running = false;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "attract";
    (document.getElementById("app") ?? document.body).appendChild(this.canvas);
    this.renderer = new Renderer(this.canvas, selectedSkin().color);
    this.sim = new RunSim(this.freshSeed());
    this.loop = this.loop.bind(this);
  }

  private freshSeed(): number { return ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0) || 1; }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.canvas.classList.add("show");
    this.lastT = 0; this.acc = 0;
    this.raf = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.canvas.classList.remove("show");
  }

  private loop(now: number): void {
    if (!this.running) return;
    if (!this.lastT) this.lastT = now;
    let frame = (now - this.lastT) / 1000;
    this.lastT = now;
    if (frame > 0.1) frame = 0.1;
    this.acc += frame;
    while (this.acc >= DT) {
      if (!this.sim.alive) { this.sim = new RunSim(this.freshSeed()); }
      const a = decide(this.sim);
      if (a) this.sim.input(a);
      this.sim.step();
      this.acc -= DT;
    }
    this.renderer.render(this.sim, now);
    this.raf = requestAnimationFrame(this.loop);
  }
}
