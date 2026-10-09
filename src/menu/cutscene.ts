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
  run?: boolean;   // false = standing bakery pose (hold/bite donut); default true = run cycle
  armUp?: number;  // 0..1 raise the donut hand to the mouth (standing pose)
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
    // The donut is HELD in the right hand (−z front). `held(y, s)` places it at a height
    // with a given size; as the arm raises (armUp 0→1) the donut rises hand→mouth and the
    // scale shrinks (chomp). Prop base torus ~1.6u, so scale ~0.2 → a ~0.3u handheld bite.
    const held = (y: number, s: number): Donut => ({ x: 0.2, y, z: -0.34, scale: s });
    return [
      // 0 — ESTABLISH: a wide push through the neon Mempool. SAT stands outside the bakery.
      { dur: 2100, cap: `<div class="c3-big">THE MEMPOOL</div><div class="c3-sub">3 AM · nothing here is confirmed</div>`,
        a: { cam: [7, 10, 15], look: [0, 2.6, -6], bakery: true, drift: 1.5, run: false, armUp: 0.05 },
        b: { cam: [2.8, 3.4, 5], look: [0, 1.7, -2.6], bakery: true, drift: 1.5, run: false, armUp: 0.08 } },
      // 1 — THE GRAB: SAT lifts the Satoshi Donut off the counter toward his mouth.
      { dur: 2000, cap: `<div class="c3-line">THE SATOSHI DONUT</div><div class="c3-sub">last one in the shop</div>`,
        a: { cam: [1.9, 1.75, -3.1], look: [0, 1.45, -0.3], bakery: true, drift: 0, run: false, armUp: 0.15, donut: held(1.2, 0.3) },
        b: { cam: [1.5, 1.85, -2.8], look: [0, 1.5, -0.32], bakery: true, drift: 0, run: false, armUp: 0.95, donut: held(1.52, 0.24) } },
      // 2 — THE BITE: he takes it without paying. Terminal flags the tab PENDING.
      { dur: 1900, cap: `<div class="c3-term">TAB: PENDING — payment not settled</div>`,
        vo: "Eh. It'll confirm.", voRole: "you",
        a: { cam: [1.3, 1.85, -2.7], look: [0, 1.5, -0.3], bakery: true, drift: 0, run: false, armUp: 1.0, donut: held(1.55, 0.18) },
        b: { cam: [1.1, 1.9, -2.5], look: [0, 1.55, -0.28], bakery: true, drift: 0, run: false, armUp: 0.85, donut: held(1.52, 0.1) } },
      // 3 — CAUGHT: the Auditor's eye ignites overhead — it prunes anything unconfirmed.
      { dur: 1800, cap: `<div class="c3-siren"></div><div class="c3-aud"><b>AUDITOR:</b> Unsettled transaction detected.</div>`,
        vo: "Unsettled transaction detected.", voRole: "auditor",
        a: { cam: [1.2, 2.0, -2.8], look: [0, 2.6, 1.4], drone: drone(0, 10, 4.5, 1.0), bakery: true, drift: 0, run: false, armUp: 0.5 },
        b: { cam: [0.9, 2.6, -2.4], look: [0, 4.0, 2.4], drone: drone(0, 5.6, 3.8, 2.7), bakery: true, drift: 0, run: false, armUp: 0.2 } },
      // 4 — THE WORD: the Auditor bears down — YOU are the unconfirmed asset now.
      { dur: 2000, cap: `<div class="c3-aud"><b>AUDITOR:</b> You ate an asset that never cleared. Prepare for pruning.</div>`,
        vo: "You ate an asset that never cleared. Prepare for pruning.", voRole: "auditor",
        a: { cam: [-1.9, 2.4, -1.6], look: [0, 3.8, 2.2], drone: drone(0, 5.3, 2.6, 2.9), bakery: true, drift: 0, run: false, armUp: 0.1 },
        b: { cam: [-1.3, 2.3, -1.2], look: [0, 3.4, 1.8], drone: drone(0.4, 4.7, 1.8, 3.0), bakery: true, drift: 0, run: false, armUp: 0.08 } },
      // 5 — THE REACTION: SAT, cheeks full, unbothered.
      { dur: 1500, cap: `<div class="c3-you"><b>YOU:</b> That seems negotiable.</div>`,
        vo: "That seems negotiable.", voRole: "you",
        a: { cam: [1.0, 1.8, -2.6], look: [0, 1.5, -0.3], drone: drone(0.2, 4.6, 2.0, 3.0), bakery: true, drift: 0, run: false, armUp: 0.12 },
        b: { cam: [0.9, 1.82, -2.4], look: [0, 1.5, -0.3], drone: drone(-0.2, 4.5, 1.8, 3.0), bakery: true, drift: 0, run: false, armUp: 0.1 } },
      // 6 — BOLT: CUT behind; SAT flees down the street, the Auditor swoops over (voiced).
      { dur: 1700, cap: `<div class="c3-big" style="font-size:40px">RUN!</div>`,
        vo: "I'll confirm it myself.", voRole: "you",
        a: { cam: [0, 2.0, 6], look: [0, 1.4, -3], drone: drone(0, 7, 7.5, 2.9), drift: 8, fov: 56, run: true },
        b: { cam: [0, 4.4, 8.4], look: [0, 1.4, -9], drone: drone(0, 5.6, -2, 2.6), drift: 26, fov: 60, run: true } },
      // 7 — hand-off: settle to the exact gameplay camera, GO.
      { dur: 1300, cap: ``, hint: true,
        a: { cam: [0, 4.4, 8.4], look: [0, 1.4, -9], drone: drone(0, 5.6, -2, 2.6), drift: 28, fov: 60, run: true },
        b: { cam: PLAY_CAM, look: PLAY_LOOK, drone: drone(0, 9, -20, 1.7), drift: 32, fov: 58, run: true } },
    ];
  }

  // The STORY button (watch-only) shows the full polished cinematic — the same coherent
  // standing-bite sequence as the run-opener (grab the donut → TAB: PENDING → the Auditor
  // prunes the unconfirmed → bolt). Kept as one source of truth so the two never drift and
  // the old floating-donut / run-in-place cut can't resurface.
  private storyShots(): Shot[] {
    return this.quickShots();
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
      runnerRun: a.run ?? true,
      armUp: lerp(a.armUp ?? 1, b.armUp ?? 1, k),
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
