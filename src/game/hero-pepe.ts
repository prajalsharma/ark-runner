/**
 * HeroPepeGLB — the ARCH PEPE hero as a textured GLB (owner's Tripo/Meshy image-to-3D of the
 * reference art), with the procedural RunnerRig as a guaranteed FALLBACK. Satisfies the exact
 * Hero interface render.ts drives (group / update / setColor / setColorObj / cutscenePose).
 *
 * The model is a STATIC mesh baked in a running pose (no skeleton/clips). So there is no
 * AnimationMixer — instead we read sim state and drive a believable WHOLE-BODY run RHYTHM
 * (a footfall bob, a forward running lean, a stride pitch pulse and a weight-shift sway), plus
 * a jump arc + squash/stretch and a slide crouch. The pose is already mid-stride, so this reads
 * as "effortlessly running" rather than a frozen statue sliding.
 *
 * Load strategy (fixes the first-frame "old Pepe then swap" pop AND the mid-cutscene hitch):
 *   • the GLB is PARSED ONCE into a module cache and CLONED per renderer (the menu backdrop and
 *     the game use separate WebGL contexts, so each still uploads its own GPU buffers, but the
 *     expensive decode/parse happens a single time);
 *   • if the cache is already warm, the constructor mounts the model SYNCHRONOUSLY — the
 *     procedural fallback is never shown, so there is no swap flash;
 *   • otherwise the fallback shows until the (shared) load resolves, then swaps in;
 *   • on ANY failure we keep the procedural rig forever.
 * Call preloadPepe() early (app boot) so the cache is warm before the cutscene renders.
 *
 * Pure presentation: the sim is the authority; determinism is untouched.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RunnerRig } from "./runner-rig.ts";

export type HeroState = { x: number; y: number; sliding: boolean; grounded: boolean; phase: number; emissive: number };

const HERO_URL = new URL("../assets/arch-pepe.glb", import.meta.url).href;
const TARGET_HEIGHT = 1.9; // match the procedural rig's height so the camera framing is unchanged

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
function spring(val: number, vel: number, target: number, stiffness: number, damping: number): [number, number] {
  const a = (target - val) * stiffness - vel * damping; const nv = vel + a; return [val + nv, nv];
}

// ---- Shared parse cache: load + normalise ONCE, clone per renderer. ----
let cacheRoot: THREE.Group | null = null;       // normalised, ready to clone (null until loaded)
let cachePromise: Promise<THREE.Group> | null = null;

async function loadRoot(): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder); // the GLB is meshopt-packed; decoder is bundled inline
  const gltf = await loader.loadAsync(HERO_URL);
  const root = gltf.scene;
  // Normalise: scale to the rig height, centre on x/z, drop feet to y = 0.
  root.updateMatrixWorld(true);
  const box0 = new THREE.Box3().setFromObject(root);
  const size = box0.getSize(new THREE.Vector3());
  root.scale.setScalar(TARGET_HEIGHT / Math.max(1e-3, size.y));
  root.updateMatrixWorld(true);
  const box1 = new THREE.Box3().setFromObject(root);
  const c = box1.getCenter(new THREE.Vector3());
  root.position.x -= c.x; root.position.z -= c.z; root.position.y -= box1.min.y;
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } });
  return root;
}

/** Warm the shared cache (call once, early). Safe to call repeatedly. */
export function preloadPepe(): Promise<unknown> {
  if (!cachePromise) cachePromise = loadRoot().then((r) => { cacheRoot = r; return r; });
  return cachePromise;
}

export class HeroPepeGLB {
  readonly group = new THREE.Group();
  isGLB = false;

  private fallback: RunnerRig | null = null;
  private inner = new THREE.Group();          // holds the model, rotated to face travel (−z)
  private mats: THREE.MeshStandardMaterial[] = [];
  private color = new THREE.Color(0xe8701c);
  private readonly cTmp = new THREE.Color();

  // Secondary-motion state (render-only).
  private airF = 0; private slideF = 0;
  private prevX = 0; private prevY = 0; private havePrev = false;
  private leanZ = 0; private leanV = 0;
  private squash = 0; private stretch = 0; private prevGrounded = true;

  constructor(color: number) {
    this.color.set(color);
    if (cacheRoot) {
      this.mount(cacheRoot.clone(true)); // cache warm → mount instantly, no fallback flash
    } else {
      this.fallback = new RunnerRig(color);
      this.group.add(this.fallback.group);
      preloadPepe().then(() => { if (!this.isGLB && cacheRoot) this.swapIn(cacheRoot.clone(true)); }).catch(() => { /* keep fallback */ });
    }
  }

  static create(color: number): Promise<HeroPepeGLB> { return Promise.resolve(new HeroPepeGLB(color)); }

  private swapIn(root: THREE.Group): void {
    if (this.fallback) { this.group.remove(this.fallback.group); this.fallback = null; }
    this.mount(root);
  }

  private mount(root: THREE.Group): void {
    // Per-instance materials (clone so emissive/flow tint doesn't leak across renderers; the
    // texture maps are shared by reference, so this is cheap).
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const src = Array.isArray(m.material) ? m.material : [m.material];
      const cloned = src.map((mm) => (mm instanceof THREE.MeshStandardMaterial ? mm.clone() : mm));
      m.material = Array.isArray(m.material) ? cloned : cloned[0]!;
      for (const mm of cloned) if (mm instanceof THREE.MeshStandardMaterial) this.mats.push(mm);
    });
    this.inner.rotation.y = Math.PI; // the model faces +z; travel is −z, so show its back to the chase cam
    this.inner.add(root);
    this.group.add(this.inner);
    this.isGLB = true;
    this.setColorObj(this.color);
  }

  setColor(hex: number): void { this.cTmp.set(hex); this.setColorObj(this.cTmp); }
  setColorObj(c: THREE.Color): void {
    this.color.copy(c);
    if (!this.isGLB) { this.fallback?.setColorObj(c); return; }
    // Keep the baked textures; the player/Block/Flip colour rides as a subtle EMISSIVE wash so
    // the hero still "charges" with flow without repainting the art.
    for (const m of this.mats) m.emissive.copy(c);
  }

  /** Drive the pose. Mirrors RunnerRig.update's contract. */
  update(st: HeroState): void {
    if (!this.isGLB) { this.fallback?.update(st); return; }

    const vx = this.havePrev ? clamp(st.x - this.prevX, -0.6, 0.6) : 0;
    const vy = this.havePrev ? clamp(st.y - this.prevY, -0.6, 0.6) : 0;
    this.prevX = st.x; this.prevY = st.y; this.havePrev = true;

    this.airF = lerp(this.airF, st.grounded ? 0 : 1, st.grounded ? 0.3 : 0.5);
    this.slideF = lerp(this.slideF, st.sliding ? 1 : 0, st.sliding ? 0.55 : 0.35);
    if (st.grounded && !this.prevGrounded) this.squash = 0.32;   // land
    if (!st.grounded && this.prevGrounded) this.stretch = 0.22;  // takeoff
    this.prevGrounded = st.grounded;
    this.squash = lerp(this.squash, 0, 0.22);
    this.stretch = lerp(this.stretch, 0, 0.3);

    const run = (1 - this.airF) * (1 - this.slideF);
    const t = st.phase;
    // ---- RUN RHYTHM (sells motion on a pose-locked mesh) ----
    // Footfall bob: the body rises twice per stride (one bounce per foot plant).
    const bob = Math.abs(Math.sin(t)) * 0.12 * run;
    this.group.position.x = st.x;
    this.group.position.y = st.y + bob;

    // Turn-lean into a lane change (spring), killed while sliding.
    [this.leanZ, this.leanV] = spring(this.leanZ, this.leanV, -vx * 1.7, 0.22, 0.55);

    // Forward running LEAN + a stride pitch pulse; deep tuck on slide; reach-back on jump rise.
    const riseF = clamp(0.5 + vy * 3.2, 0, 1);
    const pitch = -0.16 * run + Math.sin(t * 2) * 0.05 * run - this.slideF * 0.5 + this.airF * riseF * 0.14;
    // Weight-shift SWAY (roll, once per stride) + the lane-change bank.
    const roll = this.leanZ * (1 - this.slideF) + Math.sin(t) * 0.07 * run;
    // Subtle torso YAW twist with the stride.
    const yaw = Math.sin(t) * 0.045 * run;
    this.inner.rotation.set(pitch, Math.PI + yaw, roll);

    // Slide = crouch (squish + lower); squash/stretch pop on land/takeoff.
    const baseY = lerp(1, 0.6, this.slideF);
    const sy = baseY * (1 - this.squash + this.stretch);
    const sxz = 1 + this.squash * 0.5 - this.stretch * 0.22;
    this.inner.scale.set(sxz, sy, sxz);

    // Flow/Block/Flip glow via emissive intensity (colour set by setColorObj).
    const ei = 0.04 + st.emissive * 0.16;
    for (const m of this.mats) m.emissiveIntensity = ei;
  }

  /** Cutscene standing beat — the static model has no arms to pose, so present it upright/still
   *  (no run rhythm). armUp/chew/grip/flinch are no-ops for the GLB hero. */
  cutscenePose(_armUp: number, _chew = 0, _grip = 0, _flinch = 0): void {
    if (!this.isGLB) { this.fallback?.cutscenePose(_armUp, _chew, _grip, _flinch); return; }
    this.inner.rotation.set(0, Math.PI, 0);
    this.inner.scale.set(1, 1, 1);
    this.group.position.y = 0;
    this.airF = this.slideF = this.squash = this.stretch = 0;
    this.leanZ = this.leanV = 0; this.havePrev = false;
  }
}
