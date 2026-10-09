/**
 * Menu backdrop — a STILL 3D scene (the runner at the start line inside the city),
 * not a self-playing run. Earlier this auto-piloted a live run behind the menu, which
 * read as distracting "the game is playing itself" motion; now it renders a single
 * static frame (re-painted only on resize / character change). Own canvas to avoid a
 * second WebGL context on the game's.
 */
import { RunSim } from "../game/sim.ts";
import { Renderer } from "../game/render.ts";
import { selectedCharacterColor } from "../game/characters.ts";

export class Attract {
  readonly canvas: HTMLCanvasElement;
  private renderer: Renderer;
  private sim: RunSim;
  private running = false;
  private readonly onResize: () => void;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "attract";
    (document.getElementById("app") ?? document.body).appendChild(this.canvas);
    this.renderer = new Renderer(this.canvas, selectedCharacterColor());
    this.sim = new RunSim(1); // start line, never stepped → no motion
    this.onResize = () => { if (this.running) this.paint(); };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.canvas.classList.add("show");
    window.addEventListener("resize", this.onResize);
    this.paint();
  }

  stop(): void {
    this.running = false;
    this.canvas.classList.remove("show");
    window.removeEventListener("resize", this.onResize);
  }

  /** Live-recolour the backdrop runner (character preview). */
  setColor(hex: number): void { this.renderer.setPlayerColor(hex); if (this.running) this.paint(); }

  /** Paint one static frame (the sim is never advanced, so nothing moves). */
  private paint(): void { this.renderer.render(this.sim, 0); }
}
