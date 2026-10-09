/**
 * Opening cinematic — "The Unconfirmed Donut". A REAL in-scene 3D cutscene in the Temple
 * Run / Subway Surfers mould: a scripted camera moves through the live city, the runner
 * grabs the Satoshi donut, the AUDITOR drone descends and lights up — then the runner
 * BOLTS, STUMBLES (nearly caught, the signature trip), RECOVERS, and the camera settles
 * onto the exact gameplay chase position and hands you control. No "RUN" button; it flows
 * straight into the run like the games it's modelled on. Skippable at any point.
 */
import type { Attract } from "./attract.ts";
import type { CineState } from "../game/render.ts";

type V3 = [number, number, number];
type Drone = { x: number; y: number; z: number; eye: number };
type Donut = { x: number; y: number; z: number; scale: number };
type Key = {
  cam: V3; look: V3; drift: number;
  drone?: Drone; donut?: Donut;
  ry?: number;     // runner vertical (trip dip)
  pitch?: number;  // runner forward lean — the stumble
  shake?: number;  // camera shake (near-catch impact)
  fov?: number;
};
type Shot = { dur: number; cap: string; a: Key; b: Key; title?: boolean; hint?: boolean };

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const ease = (t: number): number => t * t * (3 - 2 * t); // smoothstep

// The exact gameplay camera (render.ts): position (0,5.4,9) looking (0,1.4,-10). The last
// cutscene frame lands here so the hand-off into the real run is a seamless match-cut.
const PLAY_CAM: V3 = [0, 5.4, 9];
const PLAY_LOOK: V3 = [0, 1.4, -10];

export class Cutscene {
  private raf = 0;
  private t0 = 0;
  private distance = 0;
  private lastShot = -1;

  constructor(private attract: Attract, private overlay: HTMLElement, private onPlay: () => void, private onSkip: () => void) {}

  private shots(): Shot[] {
    const drone = (x: number, y: number, z: number, eye: number): Drone => ({ x, y, z, eye });
    const donut = (s: number): Donut => ({ x: 0, y: 2.2, z: -2.6, scale: s });
    return [
      // 0 — establish the city
      { dur: 3800, cap: `<div class="c3-big">THE ARCH CITY</div><div class="c3-sub">3 AM · you want exactly one thing</div>`,
        a: { cam: [9, 14, 26], look: [0, 2.5, -8], drift: 2.5 }, b: { cam: [3.5, 8, 16], look: [0, 2.5, -6], drift: 2.5 } },
      // 1 — the donut, payment pending
      { dur: 3000, cap: `<div class="c3-line">THE LEGENDARY SATOSHI DONUT</div><div class="c3-sub">PAYMENT: PENDING…</div>`,
        a: { cam: [2.2, 2.6, 3.4], look: [0, 2.2, -2.6], donut: donut(1.0), drift: 1 }, b: { cam: [1.1, 2.4, 2.7], look: [0, 2.2, -2.6], donut: donut(1.08), drift: 1 } },
      // 2 — *CRUNCH*
      { dur: 2000, cap: `<div class="c3-you"><b>YOU:</b> …it's basically confirmed.</div><div class="c3-big" style="font-size:40px">*CRUNCH*</div>`,
        a: { cam: [1.1, 2.4, 2.7], look: [0, 2.2, -2.6], donut: donut(1.0), drift: 1 }, b: { cam: [1.3, 2.5, 2.9], look: [0, 2.2, -2.6], donut: donut(0.72), drift: 1 } },
      // 3 — siren: the Auditor descends
      { dur: 2600, cap: `<div class="c3-siren"></div><div class="c3-alert">UNSETTLED PASTRY DETECTED.</div>`,
        a: { cam: [0, 4, 9], look: [0, 9, -6], drone: drone(0, 17, -6, 1.2), donut: donut(0.72), drift: 2 }, b: { cam: [0, 4, 8], look: [0, 7, -6], drone: drone(0, 8, -6, 2.6), drift: 2 } },
      // 4 — the standoff
      { dur: 3400, cap: `<div class="c3-aud"><b>AUDITOR:</b> That pastry never reached finality.</div><div class="c3-you"><b>YOU:</b> It reached my mouth. That's finality.</div>`,
        a: { cam: [-2.2, 2.2, 5], look: [0, 5.5, -5], drone: drone(0, 8, -5.5, 2.6), drift: 2 }, b: { cam: [1.6, 2.4, 4.8], look: [0, 5, -5], drone: drone(0.4, 8.2, -5.5, 2.6), drift: 2 } },
      // 5 — BOLT: the runner takes off, camera swings behind, speed builds
      { dur: 2000, cap: `<div class="c3-you"><b>YOU:</b> Catch me, ledger-boy.</div><div class="c3-big" style="font-size:40px">BOLT!</div>`,
        a: { cam: [1.6, 2.4, 4.8], look: [0, 3, -6], drone: drone(0.4, 8.2, -5.5, 2.8), drift: 6, fov: 53 },
        b: { cam: [0.4, 4.2, 8], look: [0, 1.6, -9], drone: drone(0, 7, -12, 2.6), drift: 30, fov: 60 } },
      // 6 — THE STUMBLE: trips, drone lunges down — nearly caught
      { dur: 1700, cap: `<div class="c3-big" style="font-size:38px">*STUMBLE*</div><div class="c3-sub">…almost.</div>`,
        a: { cam: [0.4, 4.2, 8], look: [0, 1.6, -9], drone: drone(0, 7, -12, 2.6), drift: 30, ry: 0, pitch: 0.12, shake: 0, fov: 60 },
        b: { cam: [-0.4, 3.3, 6.8], look: [0, 1.0, -7], drone: drone(0, 2.9, -3.6, 3.0), drift: 20, ry: -0.12, pitch: 0.95, shake: 0.5, fov: 62 } },
      // 7 — RECOVER + HAND-OFF: steadies, camera settles to the exact gameplay chase cam
      { dur: 2000, cap: ``, hint: true,
        a: { cam: [-0.4, 3.3, 6.8], look: [0, 1.0, -7], drone: drone(0, 2.9, -3.6, 3.0), drift: 20, ry: -0.12, pitch: 0.95, shake: 0.5, fov: 62 },
        b: { cam: PLAY_CAM, look: PLAY_LOOK, drone: drone(0, 9, -22, 1.6), drift: 32, ry: 0, pitch: 0.05, shake: 0, fov: 58 } },
    ];
  }

  play(): void {
    this.t0 = 0; this.distance = 0; this.lastShot = -1;
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  private loop(now: number): void {
    if (!this.t0) this.t0 = now;
    const shots = this.shots();
    const total = shots.reduce((s, sh) => s + sh.dur, 0);
    const elapsed = now - this.t0;

    // find current shot
    let acc = 0, idx = 0, local = 0;
    for (let i = 0; i < shots.length; i++) { if (elapsed < acc + shots[i]!.dur) { idx = i; local = elapsed - acc; break; } acc += shots[i]!.dur; idx = i; local = shots[i]!.dur; }
    const sh = shots[idx]!;
    const k = ease(Math.min(1, local / sh.dur));
    this.distance += lerp(sh.a.drift, sh.b.drift, k) * 0.016;

    this.attract.renderCine(now, this.frame(sh, k));

    if (idx !== this.lastShot) { this.lastShot = idx; this.renderCaption(sh); }

    if (elapsed >= total) { this.finish(this.onPlay); return; } // seamless hand-off into the run
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Build the renderer state for a shot at interpolation k. */
  private frame(sh: Shot, k: number): CineState {
    const a = sh.a, b = sh.b;
    const bothDrone = a.drone && b.drone;
    const bothDonut = a.donut && b.donut;
    return {
      cam: lerp3(a.cam, b.cam, k),
      look: lerp3(a.look, b.look, k),
      distance: this.distance,
      runnerX: 0,
      runnerPhase: this.distance * 1.4,
      runnerY: lerp(a.ry ?? 0, b.ry ?? 0, k),
      runnerPitch: lerp(a.pitch ?? 0, b.pitch ?? 0, k),
      shake: lerp(a.shake ?? 0, b.shake ?? 0, k),
      fov: lerp(a.fov ?? 52, b.fov ?? 52, k),
      drone: bothDrone ? { x: lerp(a.drone!.x, b.drone!.x, k), y: lerp(a.drone!.y, b.drone!.y, k), z: lerp(a.drone!.z, b.drone!.z, k), eye: lerp(a.drone!.eye, b.drone!.eye, k) } : null,
      donut: bothDonut ? { x: 0, y: 2.2, z: -2.6, scale: lerp(a.donut!.scale, b.donut!.scale, k) } : null,
    };
  }

  private renderCaption(sh: Shot): void {
    this.overlay.className = "cutscene3d";
    const body = sh.title
      ? `<div class="c3-titlewrap"><div class="title"><span class="accent">ARCH</span> RUNNER</div><div class="c3-sub">RUN THE BLOCK · BREAK THE SCORE</div></div>`
      : sh.hint
        ? `<div class="c3-hint">←&nbsp;→ MOVE&nbsp;&nbsp;·&nbsp;&nbsp;↑ JUMP&nbsp;&nbsp;·&nbsp;&nbsp;↓ SLIDE<div class="c3-hintsub">swipe on mobile — GO!</div></div>`
        : `<div class="c3-caption">${sh.cap}</div>`;
    this.overlay.innerHTML = `${body}<button id="c3-skip" class="c3-skip">SKIP ›</button>`;
    (this.overlay.querySelector("#c3-skip") as HTMLButtonElement).onclick = () => this.finish(this.onSkip);
  }

  private finish(cb: () => void): void {
    cancelAnimationFrame(this.raf);
    this.overlay.className = "";
    this.overlay.innerHTML = "";
    cb();
  }
}
