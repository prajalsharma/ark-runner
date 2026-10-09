/**
 * HeroGLB — the Path B (premium, rigged-GLB) hero, with the procedural RunnerRig as a
 * guaranteed FALLBACK. Exposes the EXACT interface render.ts already drives on RunnerRig
 * (`group`, `update(st)`, `setColor`, `setColorObj`), so it is a drop-in swap.
 *
 * Why a wrapper, not a straight loader: a GLB is async and may never arrive (offline, bad
 * network, blocked by CSP, missing/invalid asset). The game must NEVER show an empty hero.
 * So the wrapper:
 *   1. instantiates the procedural RunnerRig IMMEDIATELY and shows it (hero visible on
 *      frame 1, same as before);
 *   2. kicks off an async GLB load from a SAME-ORIGIN url (served by the app via Vite's
 *      asset pipeline — never a blocked CDN, so it stays CSP-safe);
 *   3. on success, swaps the skinned GLB in and drives it with an AnimationMixer, crossfading
 *      between idle / run / jump / slide clips from sim state;
 *   4. on ANY failure, silently keeps the procedural rig forever.
 *
 * Animation follows the research doc (§3.1 Path B): one AnimationMixer, `crossFadeTo(…, true)`
 * with both actions live during the blend, `clampWhenFinished` on one-shots, and In-Place
 * clips (game code moves the character; the clip must not translate the root).
 *
 * Determinism is untouched: this is pure presentation. The sim is the authority; we only read
 * sim-derived state (grounded / sliding / phase / y) and play back animation.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RunnerRig } from "./runner-rig.ts";

export type HeroState = {
  x: number; y: number; sliding: boolean; grounded: boolean; phase: number; emissive: number;
};

/** Same-origin asset url (Vite rewrites this to a hashed file it serves itself — CSP-safe).
 *  If the file is absent, the fetch 404s and we fall back; the game still runs. */
const HERO_URL = new URL("../assets/hero-courier.glb", import.meta.url).href;

type Clip = "idle" | "run" | "jump" | "slide";

export class HeroGLB {
  readonly group = new THREE.Group();
  /** True once the skinned GLB is live; false means we are running the procedural fallback. */
  isGLB = false;

  private fallback: RunnerRig;
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Partial<Record<Clip, THREE.AnimationAction>> = {};
  private current: Clip = "run";
  private clock = new THREE.Clock();
  private suitMats: THREE.MeshStandardMaterial[] = [];
  private hoodMats: THREE.MeshStandardMaterial[] = [];
  private visorMats: THREE.MeshStandardMaterial[] = [];
  private pendingColor: THREE.Color | null = null;
  private prevPhase = 0;
  private lastDphase = 0.2;

  /** Construct synchronously: the procedural fallback is on screen immediately, and the GLB
   *  (if it loads) swaps in a few frames later. Load failure is swallowed → fallback stays. */
  constructor(color: number) {
    this.fallback = new RunnerRig(color);
    this.group.add(this.fallback.group);
    this.load(color).catch(() => { /* already on the procedural fallback */ });
  }

  /** Async convenience (used by test harnesses): same as `new HeroGLB`, returns a Promise. */
  static create(color: number): Promise<HeroGLB> { return Promise.resolve(new HeroGLB(color)); }

  private async load(color: number): Promise<void> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder); // bundled decoder (inline wasm) → no CDN fetch
    const gltf = await loader.loadAsync(HERO_URL);
    const root = gltf.scene;

    // Collect tintable materials by authored name so character colour still drives the suit.
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true; m.frustumCulled = false; // skinned bounds can be wrong → never cull the hero
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
        const name = (mat.name || "").toLowerCase();
        if (name.includes("hood")) this.hoodMats.push(mat);        // cowl → darker suit shade
        else if (name.includes("suit")) this.suitMats.push(mat);
        else if (name.includes("visor") || name.includes("core") || name.includes("accent")) this.visorMats.push(mat);
      }
    });

    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of gltf.animations) {
      const name = clip.name.toLowerCase() as Clip;
      if (name !== "idle" && name !== "run" && name !== "jump" && name !== "slide") continue;
      // In-Place safety: strip any residual root translation track so clips never teleport.
      clip.tracks = clip.tracks.filter((t) => !/\.position$/.test(t.name) || !/hips|root|armature/i.test(t.name));
      const action = this.mixer.clipAction(clip);
      if (name === "jump") { action.clampWhenFinished = true; action.loop = THREE.LoopOnce; }
      this.actions[name] = action;
    }
    if (!this.actions.run) throw new Error("hero GLB has no 'run' clip");

    // Swap the fallback out for the real thing. Face travel (−z) like the procedural rig so
    // the camera (behind) sees the back, not the face (otherwise it reads as running backwards).
    this.group.remove(this.fallback.group);
    root.rotation.y = Math.PI;
    this.group.add(root);
    this.actions.run.play();
    this.current = "run";
    this.clock.start(); // reset so the mixer's first delta isn't the whole load time
    this.isGLB = true;
    if (this.pendingColor) this.setColorObj(this.pendingColor);
    else this.applyColor(new THREE.Color(color));
  }

  setColor(hex: number): void { this.setColorObj(new THREE.Color(hex)); }

  setColorObj(c: THREE.Color): void {
    if (!this.isGLB) { this.fallback.setColorObj(c); return; }
    this.pendingColor = null;
    this.applyColor(c);
  }

  private applyColor(c: THREE.Color): void {
    for (const m of this.suitMats) { m.color.copy(c); m.emissive.copy(c).multiplyScalar(0.12); }
    for (const m of this.hoodMats) m.color.copy(c).multiplyScalar(0.42); // cowl stays a darker shade
  }

  /** Drive the pose. Mirrors RunnerRig.update's contract exactly. */
  update(st: HeroState): void {
    if (!this.isGLB || !this.mixer) { this.fallback.update(st); return; }

    this.group.position.x = st.x;
    this.group.position.y = st.y;

    // Match the run clip's playback speed to the gait phase (which advances with distance),
    // so the feet keep pace with the world instead of sliding.
    let dphase = st.phase - this.prevPhase;
    if (dphase < 0 || dphase > 2) dphase = this.lastDphase; // phase reset / big jump → hold
    this.lastDphase = dphase;
    this.prevPhase = st.phase;
    const runAction = this.actions.run;
    if (runAction) runAction.timeScale = THREE.MathUtils.clamp(dphase / 0.19, 0.5, 2.2);

    // State → clip, with a short crossfade (both actions live during the blend).
    const want: Clip = !st.grounded ? (this.actions.jump ? "jump" : "run")
      : st.sliding ? (this.actions.slide ? "slide" : "run")
      : "run";
    if (want !== this.current) this.crossFade(want);

    // Emissive accents track Flow, same as the procedural rig.
    for (const m of this.visorMats) m.emissiveIntensity = 1.2 + st.emissive * 0.4;

    this.mixer.update(this.clock.getDelta());
  }

  private crossFade(to: Clip): void {
    const next = this.actions[to]; const prev = this.actions[this.current];
    if (!next) return;
    next.enabled = true; next.setEffectiveWeight(1);
    if (to === "jump") next.reset();
    next.play();
    if (prev && prev !== next) prev.crossFadeTo(next, 0.16, true);
    this.current = to;
  }
}
