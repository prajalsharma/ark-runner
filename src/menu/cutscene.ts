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
import { soundOn } from "../game/settings.ts";

/** Free, no-dependency voiceover via the browser's Web Speech API. The Auditor gets a low,
 *  slow robotic read; SAT a quicker higher one. Respects the sound setting; silent if the
 *  engine/voices are unavailable (e.g. some mobile browsers) — captions always carry the line. */
function speakLine(text: string, role: "auditor" | "you"): void {
  try {
    if (!soundOn() || typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (role === "auditor") { u.pitch = 0.25; u.rate = 0.88; u.volume = 0.95; }
    else { u.pitch = 1.15; u.rate = 1.06; u.volume = 0.9; }
    speechSynthesis.speak(u);
  } catch { /* TTS unavailable — captions still show */ }
}

type V3 = [number, number, number];
type Drone = { x: number; y: number; z: number; eye: number };
type Donut = { x: number; y: number; z: number; scale: number };
type Key = {
  cam: V3; look: V3; drift: number;
  drone?: Drone; donut?: Donut; bakery?: boolean;
  ry?: number;     // runner vertical (trip dip)
  pitch?: number;  // runner forward lean — the stumble
  shake?: number;  // camera shake (near-catch impact)
  fov?: number;
};
type Shot = { dur: number; cap: string; a: Key; b: Key; title?: boolean; hint?: boolean; vo?: string; voRole?: "auditor" | "you" };

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const ease = (t: number): number => t * t * (3 - 2 * t); // smoothstep

// The exact gameplay camera (render.ts): position (0,5.4,9) looking (0,1.4,-10). The last
// cutscene frame lands here so the hand-off into the real run is a seamless match-cut.
const PLAY_CAM: V3 = [0, 5.4, 9];
const PLAY_LOOK: V3 = [0, 1.4, -10];

export class Cutscene {
  private raf = 0;
  private elapsed = 0;   // ms into the cutscene, accumulated from CLAMPED frame deltas
  private lastNow = 0;
  private distance = 0;
  private lastShot = -1;

  constructor(private attract: Attract, private overlay: HTMLElement, private onPlay: () => void, private onSkip: () => void, private variant: "story" | "quick" = "story") {}

  private shots(): Shot[] {
    return this.variant === "quick" ? this.quickShots() : this.storyShots();
  }

  /** The per-run cold-open (~11s, skippable, VOICED): establish the Mempool → bite the donut
   *  → PENDING + the Auditor ignites → "prepare for pruning" / "negotiable" → bolt → hand-off.
   *  SAT faces −z, so the front (bite/reveal) cameras sit on the −z side looking back. */
  private quickShots(): Shot[] {
    const drone = (x: number, y: number, z: number, eye: number): Drone => ({ x, y, z, eye });
    // Held at the mouth (−z front), small enough to read as a snack, not a ring over the head.
    // The prop's base torus is ~1.6u across, so scale ~0.3 → a ~0.5u handheld donut.
    const bite = (s: number): Donut => ({ x: 0.17, y: 1.54, z: -0.42, scale: s });
    return [
      // 0 — ESTABLISH: a wide push through the neon Mempool
      { dur: 1900, cap: `<div class="c3-big">THE MEMPOOL</div><div class="c3-sub">3 AM · everything is pending</div>`,
        a: { cam: [7, 10, 15], look: [0, 2.6, -6], bakery: true, drift: 1.5 }, b: { cam: [2.8, 3.6, 5], look: [0, 1.9, -3], bakery: true, drift: 1.5 } },
      // 1 — THE BITE: close on SAT taking the Satoshi donut (the crime)
      { dur: 1800, cap: `<div class="c3-line">THE SATOSHI DONUT</div>`,
        a: { cam: [1.9, 1.9, -3.3], look: [0, 1.55, -0.4], donut: bite(0.33), bakery: true, drift: 0 },
        b: { cam: [1.5, 1.95, -2.9], look: [0, 1.55, -0.4], donut: bite(0.22), bakery: true, drift: 0 } },
      // 2 — CAUGHT: terminal still PENDING; the Auditor's eye ignites, descending behind
      { dur: 1700, cap: `<div class="c3-siren"></div><div class="c3-term">PAYMENT: PENDING</div>`,
        a: { cam: [1.4, 2.0, -3.0], look: [0, 2.4, 1.2], donut: bite(0.22), drone: drone(0, 10, 4.5, 1.0), bakery: true, drift: 0 },
        b: { cam: [1.0, 2.6, -2.6], look: [0, 4.0, 2.4], drone: drone(0, 5.6, 3.8, 2.7), bakery: true, drift: 0 } },
      // 3 — THE WORD: the Auditor bears down (voiced, deadpan)
      { dur: 1900, cap: `<div class="c3-aud"><b>AUDITOR:</b> Unsettled pastry. Prepare for pruning.</div>`,
        vo: "Unsettled pastry. Prepare for pruning.", voRole: "auditor",
        a: { cam: [-1.9, 2.4, -1.6], look: [0, 3.8, 2.2], drone: drone(0, 5.3, 2.6, 2.9), bakery: true, drift: 0 },
        b: { cam: [-1.3, 2.3, -1.2], look: [0, 3.4, 1.8], drone: drone(0.4, 4.7, 1.8, 3.0), bakery: true, drift: 0 } },
      // 4 — THE REACTION: SAT, cheeks full (voiced)
      { dur: 1500, cap: `<div class="c3-you"><b>YOU:</b> That seems negotiable.</div>`,
        vo: "That seems negotiable.", voRole: "you",
        a: { cam: [1.0, 1.85, -2.6], look: [0, 1.55, -0.3], drone: drone(0.2, 4.6, 2.0, 3.0), bakery: true, drift: 0 },
        b: { cam: [0.9, 1.86, -2.4], look: [0, 1.55, -0.3], drone: drone(-0.2, 4.5, 1.8, 3.0), bakery: true, drift: 0 } },
      // 5 — BOLT: CUT behind; SAT flees down the street, the Auditor swoops over (voiced)
      { dur: 1700, cap: `<div class="c3-big" style="font-size:40px">RUN!</div>`,
        vo: "Confirm this.", voRole: "you",
        a: { cam: [0, 2.0, 6], look: [0, 1.4, -3], drone: drone(0, 7, 7.5, 2.9), drift: 8, fov: 56 },
        b: { cam: [0, 4.4, 8.4], look: [0, 1.4, -9], drone: drone(0, 5.6, -2, 2.6), drift: 26, fov: 60 } },
      // 6 — hand-off: settle to the exact gameplay camera, GO
      { dur: 1300, cap: ``, hint: true,
        a: { cam: [0, 4.4, 8.4], look: [0, 1.4, -9], drone: drone(0, 5.6, -2, 2.6), drift: 28, fov: 60 },
        b: { cam: PLAY_CAM, look: PLAY_LOOK, drone: drone(0, 9, -20, 1.7), drift: 32, fov: 58 } },
    ];
  }

  private storyShots(): Shot[] {
    const drone = (x: number, y: number, z: number, eye: number): Drone => ({ x, y, z, eye });
    // ~4.2s cold-open (skippable), the donut-heist gag in five cuts: the crime (bite +
    // PENDING terminal) → the reveal (Auditor drops in) → the reaction ("that seems
    // negotiable") → the chase (bolt, Auditor swoops) → seamless hand-off into the run.
    // Front angles (0-2) then a CUT to the low behind-tracking chase (3-4), so the camera
    // never flies through the runner. The runner faces +z; the bakery is behind at +z.
    return [
      // 0 — THE CRIME: close on the exaggerated bite; the terminal still reads PENDING.
      { dur: 900, cap: `<div class="c3-term">PAYMENT: PENDING</div><div class="c3-big" style="font-size:40px">*CRUNCH*</div>`,
        a: { cam: [1.9, 1.95, -2.7], look: [0, 1.55, 0.6], donut: { x: 0.12, y: 1.66, z: 0.5, scale: 1.0 }, bakery: true, drift: 0 },
        b: { cam: [1.4, 1.95, -2.2], look: [0, 1.55, 0.5], donut: { x: 0.12, y: 1.62, z: 0.5, scale: 0.66 }, bakery: true, drift: 0 } },
      // 1 — THE REVEAL: camera lifts past the runner to the Auditor dropping in; eye ignites.
      { dur: 850, cap: `<div class="c3-siren"></div><div class="c3-aud"><b>AUDITOR:</b> Unsettled pastry detected.</div>`,
        a: { cam: [1.2, 2.1, -2.4], look: [0, 2.2, 1.6], drone: drone(0, 9, 5, 1.2), bakery: true, drift: 0 },
        b: { cam: [0.4, 3.0, -3.2], look: [0, 4.6, 3.8], drone: drone(0, 5.2, 4, 2.6), bakery: true, drift: 0 } },
      // 2 — THE REACTION: cut to the runner's face; a frozen beat; the one-liner.
      { dur: 850, cap: `<div class="c3-you"><b>YOU:</b> That seems negotiable.</div>`,
        a: { cam: [0.8, 1.85, -1.7], look: [0, 1.55, 0.4], drone: drone(0, 4.8, 4, 2.6), bakery: true, drift: 0 },
        b: { cam: [0.72, 1.86, -1.62], look: [0, 1.55, 0.4], drone: drone(0.3, 4.7, 3.8, 2.6), bakery: true, drift: 0 } },
      // 3 — THE CHASE: CUT to a low behind-tracking shot; the runner bolts, the Auditor
      // swoops over into frame, the camera rises toward the gameplay angle.
      { dur: 1000, cap: `<div class="c3-big" style="font-size:40px">RUN!</div>`,
        a: { cam: [0, 2.0, 6], look: [0, 1.4, -3], drone: drone(0, 7, 7.5, 2.9), drift: 8, fov: 56 },
        b: { cam: [0, 4.4, 8.4], look: [0, 1.4, -9], drone: drone(0, 5.6, -2, 2.6), drift: 26, fov: 60 } },
      // 4 — HAND-OFF: settle to the EXACT gameplay camera; control hint; auto-start the run.
      { dur: 600, cap: ``, hint: true,
        a: { cam: [0, 4.4, 8.4], look: [0, 1.4, -9], drone: drone(0, 5.6, -2, 2.6), drift: 28, fov: 60 },
        b: { cam: PLAY_CAM, look: PLAY_LOOK, drone: drone(0, 9, -20, 1.7), drift: 32, fov: 58 } },
    ];
  }

  play(): void {
    this.elapsed = 0; this.lastNow = 0; this.distance = 0; this.lastShot = -1;
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  private loop(now: number): void {
    // Accumulate from a CLAMPED delta so a slow first frame (shader compile) or any hitch
    // can't fast-forward past the whole cutscene — it just plays a touch slower.
    if (!this.lastNow) this.lastNow = now;
    const dtMs = Math.min(100, now - this.lastNow);
    this.lastNow = now;
    this.elapsed += dtMs;
    const shots = this.shots();
    const total = shots.reduce((s, sh) => s + sh.dur, 0);
    const elapsed = this.elapsed;

    // find current shot
    let acc = 0, idx = 0, local = 0;
    for (let i = 0; i < shots.length; i++) { if (elapsed < acc + shots[i]!.dur) { idx = i; local = elapsed - acc; break; } acc += shots[i]!.dur; idx = i; local = shots[i]!.dur; }
    const sh = shots[idx]!;
    const k = ease(Math.min(1, local / sh.dur));
    this.distance += lerp(sh.a.drift, sh.b.drift, k) * (dtMs / 1000);

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
      bakery: !!(a.bakery || b.bakery),
      drone: bothDrone ? { x: lerp(a.drone!.x, b.drone!.x, k), y: lerp(a.drone!.y, b.drone!.y, k), z: lerp(a.drone!.z, b.drone!.z, k), eye: lerp(a.drone!.eye, b.drone!.eye, k) } : null,
      donut: bothDonut ? { x: lerp(a.donut!.x, b.donut!.x, k), y: lerp(a.donut!.y, b.donut!.y, k), z: lerp(a.donut!.z, b.donut!.z, k), scale: lerp(a.donut!.scale, b.donut!.scale, k) } : null,
    };
  }

  private renderCaption(sh: Shot): void {
    this.overlay.className = "cutscene3d";
    const body = sh.title
      ? `<div class="c3-titlewrap"><div class="title stacked"><span class="accent">ARCH</span><span class="word">RUNNER</span></div><div class="c3-sub">RUN THE BLOCK · BREAK THE SCORE</div></div>`
      : sh.hint
        ? `<div class="c3-hint">OUTRUN THE PRUNE<div class="c3-hintsub">←&nbsp;→ move&nbsp;·&nbsp;↑ jump&nbsp;·&nbsp;↓ slide&nbsp;·&nbsp;swipe on mobile</div></div>`
        : `<div class="c3-caption">${sh.cap}</div>`;
    this.overlay.innerHTML = `${body}<button id="c3-skip" class="c3-skip">SKIP ›</button>`;
    (this.overlay.querySelector("#c3-skip") as HTMLButtonElement).onclick = () => this.finish(this.onSkip);
    if (sh.vo) speakLine(sh.vo, sh.voRole ?? "you"); // free TTS voiceover of the line
  }

  private finish(cb: () => void): void {
    cancelAnimationFrame(this.raf);
    try { if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); } catch { /* ignore */ }
    this.overlay.className = "";
    this.overlay.innerHTML = "";
    cb();
  }
}
