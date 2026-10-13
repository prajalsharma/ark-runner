/**
 * HeroPepeGLB — the ARCH PEPE hero as a textured GLB (from the owner's Tripo/Meshy model),
 * with the procedural RunnerRig as a guaranteed FALLBACK. Satisfies the exact Hero interface
 * render.ts drives (group / update / setColor / setColorObj / cutscenePose), so it is a
 * drop-in swap for either the procedural rig or the rigged HeroGLB.
 *
 * The model is a STATIC mesh baked in a running pose (no skeleton/clips), so there is no
 * AnimationMixer. Instead we read sim state and drive WHOLE-BODY procedural motion — a run
 * bob, a turn-lean, a jump arc (sim y) + squash/stretch, and a slide crouch — which reads as
 * a 3D runner because the pose is already mid-stride (the Subway-Surfers "always running" look).
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

export class HeroPepeGLB {
  readonly group = new THREE.Group();
  isGLB = false;

  private fallback: RunnerRig;
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
    this.fallback = new RunnerRig(color);
    this.group.add(this.fallback.group);
    this.load().catch(() => { /* stay on the procedural fallback */ });
  }

  static create(color: number): Promise<HeroPepeGLB> { return Promise.resolve(new HeroPepeGLB(color)); }

  private async load(): Promise<void> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder); // bundled inline-wasm decoder (the GLB is meshopt-packed)
    const gltf = await loader.loadAsync(HERO_URL);
    const root = gltf.scene;

    // Normalise: scale to the rig's height, centre on x/z, drop feet to y = 0.
    root.updateMatrixWorld(true);
    const box0 = new THREE.Box3().setFromObject(root);
    const size = box0.getSize(new THREE.Vector3());
    root.scale.setScalar(TARGET_HEIGHT / Math.max(1e-3, size.y));
    root.updateMatrixWorld(true);
    const box1 = new THREE.Box3().setFromObject(root);
    const c = box1.getCenter(new THREE.Vector3());
    root.position.x -= c.x; root.position.z -= c.z; root.position.y -= box1.min.y;

    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true; m.frustumCulled = false;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) if (mat instanceof THREE.MeshStandardMaterial) this.mats.push(mat);
    });

    this.inner.rotation.y = Math.PI; // the model faces +z; travel is −z, so show its back to the chase cam
    this.inner.add(root);
    this.group.remove(this.fallback.group);
    this.group.add(this.inner);
    this.isGLB = true;
  }

  setColor(hex: number): void { this.cTmp.set(hex); this.setColorObj(this.cTmp); }
  setColorObj(c: THREE.Color): void {
    this.color.copy(c);
    if (!this.isGLB) { this.fallback.setColorObj(c); return; }
    // The model keeps its baked textures; the player/Block/Flip colour rides as a subtle
    // EMISSIVE wash so the hero still "charges" with flow without repainting the art.
    for (const m of this.mats) m.emissive.copy(c);
  }

  /** Drive the pose. Mirrors RunnerRig.update's contract. */
  update(st: HeroState): void {
    if (!this.isGLB) { this.fallback.update(st); return; }

    const vx = this.havePrev ? clamp(st.x - this.prevX, -0.6, 0.6) : 0;
    const vy = this.havePrev ? clamp(st.y - this.prevY, -0.6, 0.6) : 0;
    this.prevX = st.x; this.prevY = st.y; this.havePrev = true;

    this.airF = lerp(this.airF, st.grounded ? 0 : 1, st.grounded ? 0.3 : 0.5);
    this.slideF = lerp(this.slideF, st.sliding ? 1 : 0, st.sliding ? 0.55 : 0.35);
    if (st.grounded && !this.prevGrounded) this.squash = 0.3;   // land
    if (!st.grounded && this.prevGrounded) this.stretch = 0.2;  // takeoff
    this.prevGrounded = st.grounded;
    this.squash = lerp(this.squash, 0, 0.22);
    this.stretch = lerp(this.stretch, 0, 0.3);

    const run = (1 - this.airF) * (1 - this.slideF);
    this.group.position.x = st.x;
    this.group.position.y = st.y + Math.abs(Math.sin(st.phase)) * 0.085 * run; // run bob

    // Turn-lean into a lane change (spring), killed while sliding.
    [this.leanZ, this.leanV] = spring(this.leanZ, this.leanV, -vx * 1.7, 0.22, 0.55);
    this.inner.rotation.z = this.leanZ * (1 - this.slideF);
    // Forward pitch: a slight running lean, a deep tuck on the slide, a reach-back on the jump rise.
    const riseF = clamp(0.5 + vy * 3.2, 0, 1);
    this.inner.rotation.x = -0.06 * run - this.slideF * 0.5 + this.airF * riseF * 0.12;

    // Slide = crouch (squish + lower); squash/stretch pop on land/takeoff.
    const baseY = lerp(1, 0.62, this.slideF);
    const sy = baseY * (1 - this.squash + this.stretch);
    const sxz = 1 + this.squash * 0.5 - this.stretch * 0.22;
    this.inner.scale.set(sxz, sy, sxz);

    // Flow/Block/Flip glow via emissive intensity (colour set by setColorObj).
    const ei = 0.04 + st.emissive * 0.16;
    for (const m of this.mats) m.emissiveIntensity = ei;
  }

  /** Cutscene standing beat — the static model has no arms to pose, so just present it upright
   *  and still (no run bob / lean). armUp/chew/grip/flinch are no-ops for the GLB hero. */
  cutscenePose(_armUp: number, _chew = 0, _grip = 0, _flinch = 0): void {
    if (!this.isGLB) { this.fallback.cutscenePose(_armUp, _chew, _grip, _flinch); return; }
    this.inner.rotation.set(0, Math.PI, 0);
    this.inner.scale.set(1, 1, 1);
    this.group.position.y = 0;
    this.airF = this.slideF = this.squash = this.stretch = 0;
    this.leanZ = this.leanV = 0; this.havePrev = false;
  }
}
