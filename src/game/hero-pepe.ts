/**
 * HeroPepeGLB — the ARCH PEPE hero as a textured GLB (owner's image-to-3D of the reference art),
 * with the procedural RunnerRig as a guaranteed FALLBACK. Satisfies the Hero interface render.ts
 * drives (group / update / setColor / setColorObj / cutscenePose).
 *
 * THE MODEL HAS NO SKELETON (single fused mesh baked mid-stride). Two earlier attempts to add a
 * SkinnedMesh + bones in code collapsed the mesh (vertices bound to origin → invisible). So instead
 * of rigging, we ANIMATE THE LEGS ON THE GPU: a tiny injection in each material's vertex shader
 * (onBeforeCompile) rotates the lower-body vertices about a hip pivot (and a knee pivot), left and
 * right legs in opposition, weighted smoothly by height so the torso stays rigid and the legs
 * curve from the hip. No skeleton, no skin binding, no mesh splitting — it cannot go invisible and
 * it leaves no seams. Combined with a whole-body run rhythm (footfall bob, forward lean, stride
 * pitch, weight-shift sway) the hero reads as EFFORTLESSLY RUNNING, not a statue sliding.
 *
 * To make the shader math simple and identical across instances, loadRoot() bakes every mesh's
 * world transform into its geometry and flattens the hierarchy, so all vertices live in one
 * "character space" (feet at y≈0, height = TARGET_HEIGHT, centred on x/z). The hip/knee pivot
 * planes are measured once from that baked bbox and compiled into the shader as constants; only
 * the per-frame swing/knee angles are uniforms.
 *
 * Load strategy (fixes the first-frame "old Pepe then swap" pop AND the mid-cutscene hitch):
 *   • the GLB is PARSED + BAKED ONCE into a module cache and CLONED per renderer (menu backdrop and
 *     game use separate WebGL contexts, so each uploads its own GPU buffers, but the expensive
 *     decode/parse/bake happens a single time; the baked geometry is shared by reference);
 *   • if the cache is warm, the constructor mounts SYNCHRONOUSLY — no fallback flash;
 *   • otherwise the procedural fallback shows until the shared load resolves, then swaps in;
 *   • on ANY failure we keep the procedural rig forever (which already has real jointed legs).
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

// Hip/knee pivot planes (character space), measured once from the baked bbox and compiled into
// the leg-bend shader as constants. Null until the model is baked.
type LegParams = {
  hipY: number; hipBand: number; kneeY: number; kneeBand: number; cx: number; cz: number;
  shoulderY: number; waistY: number; armInner: number; armOuter: number; // arm-swing pivot + lateral mask
};
let LEG: LegParams | null = null;

// ---- Shared parse cache: load + normalise + bake ONCE, clone per renderer. ----
let cacheRoot: THREE.Group | null = null;       // baked + flattened, ready to clone (null until loaded)
let cachePromise: Promise<THREE.Group> | null = null;

/** Bake a mesh's world transform into a fresh, de-quantized, non-interleaved geometry (identity
 *  transform), so the leg-bend shader can work in one consistent character space. Reads vertices
 *  via getX/Y/Z so meshopt-quantized / interleaved attributes dequantize correctly. */
function bakeMeshWorld(m: THREE.Mesh): THREE.Mesh {
  const src = m.geometry as THREE.BufferGeometry;
  const pos = src.getAttribute("position");
  const n = pos.count;
  m.updateMatrixWorld(true);
  const mw = m.matrixWorld;
  const nrmMat = new THREE.Matrix3().getNormalMatrix(mw);
  const g = new THREE.BufferGeometry();

  const outP = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mw); outP[i * 3] = v.x; outP[i * 3 + 1] = v.y; outP[i * 3 + 2] = v.z; }
  g.setAttribute("position", new THREE.BufferAttribute(outP, 3));

  const nrm = src.getAttribute("normal");
  if (nrm) {
    const outN = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { v.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).applyMatrix3(nrmMat).normalize(); outN[i * 3] = v.x; outN[i * 3 + 1] = v.y; outN[i * 3 + 2] = v.z; }
    g.setAttribute("normal", new THREE.BufferAttribute(outN, 3));
  }
  const uv = src.getAttribute("uv");
  if (uv) {
    const outU = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { outU[i * 2] = uv.getX(i); outU[i * 2 + 1] = uv.getY(i); }
    g.setAttribute("uv", new THREE.BufferAttribute(outU, 2));
  }
  if (src.index) g.setIndex(Array.from(src.index.array as ArrayLike<number>));
  if (!nrm) g.computeVertexNormals();

  const nm = new THREE.Mesh(g, m.material);
  nm.castShadow = true; nm.receiveShadow = false; nm.frustumCulled = false;
  return nm;
}

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
  root.updateMatrixWorld(true);

  // BAKE: fold each mesh's world transform into its geometry and flatten into one group with
  // identity transforms, so every vertex is in a single consistent "character space". This is
  // what lets the leg-bend shader use one set of pivot planes for the whole body.
  // NB: the GLB is meshopt/KHR_mesh_quantization packed — positions are quantized, often
  // interleaved. geometry.applyMatrix4() mangles those (collapses axes), so we read each vertex
  // through getX/Y/Z (which dequantizes) into a fresh Float32 buffer and transform it by hand.
  const baked = new THREE.Group();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    baked.add(bakeMeshWorld(m));
  });

  // Measure the hip/knee pivot planes from the baked bounds (same for every clone → shared).
  const bb = new THREE.Box3().setFromObject(baked);
  const h = Math.max(1e-3, bb.max.y - bb.min.y);
  const w = Math.max(1e-3, bb.max.x - bb.min.x);
  const cx = (bb.min.x + bb.max.x) / 2;
  LEG = {
    hipY: bb.min.y + h * 0.50,   // swing the legs from just below mid-body
    hipBand: h * 0.16,           // smooth ramp so the torso stays rigid and the leg curves in
    kneeY: bb.min.y + h * 0.27,  // knee flex pivot
    kneeBand: h * 0.14,
    cx,
    cz: (bb.min.z + bb.max.z) / 2,
    shoulderY: bb.min.y + h * 0.82, // arms pivot from the shoulders
    waistY: bb.min.y + h * 0.46,    // arm influence fades out below the waist (so it never fights the legs)
    armInner: w * 0.15,             // |x-cx| inside this = torso (rigid); outside = arm (swings)
    armOuter: w * 0.30,
  };
  return baked;
}

/** Warm the shared cache (call once, early). Safe to call repeatedly. */
export function preloadPepe(): Promise<unknown> {
  if (!cachePromise) cachePromise = loadRoot().then((r) => { cacheRoot = r; return r; });
  return cachePromise;
}

/** Build the vertex-shader run-cycle injection (constants baked in from LEG). Rotates the lower
 *  body about the hip + knee (legs) and the outer upper body about the shoulders (arms), all about
 *  the X axis so limbs swing in the travel plane; left/right opposed, arms counter-phase to legs. */
function bendChunk(p: LegParams): string {
  const f = (n: number): string => n.toFixed(5);
  const legSep = (p.hipBand); // lateral half-gap: keep the inseam/crotch rigid, swing the outer leg mass
  return `#include <begin_vertex>
  {
    float side = step(${f(p.cx)}, transformed.x) * 2.0 - 1.0;   // -1 = left, +1 = right

    // ---- LEGS: hip swing + knee flex (lower body) ----
    float heightW = 1.0 - smoothstep(${f(p.hipY - p.hipBand)}, ${f(p.hipY)}, transformed.y);
    // Lateral mask: vertices near the midline (the shared crotch) barely move, so opposite-swinging
    // legs don't tear the mesh between them; the outer leg mass takes the full swing.
    float lateral = smoothstep(0.0, ${f(legSep)}, abs(transformed.x - ${f(p.cx)}));
    float legW = heightW * lateral;
    float hipAng = uSwing * side * legW;
    float yy = transformed.y - ${f(p.hipY)};
    float zz = transformed.z - ${f(p.cz)};
    float ca = cos(hipAng), sa = sin(hipAng);
    transformed.y = ${f(p.hipY)} + yy * ca - zz * sa;
    transformed.z = ${f(p.cz)} + yy * sa + zz * ca;
    float kneeW = (1.0 - smoothstep(${f(p.kneeY - p.kneeBand)}, ${f(p.kneeY)}, transformed.y)) * lateral;
    float kneeFactor = max(0.0, -uSwing * side);                 // the trailing leg flexes
    float kneeAng = uKnee * kneeFactor * kneeW;
    float yk = transformed.y - ${f(p.kneeY)};
    float zk = transformed.z - ${f(p.cz)};
    float ck = cos(kneeAng), sk = sin(kneeAng);
    transformed.y = ${f(p.kneeY)} + yk * ck - zk * sk;
    transformed.z = ${f(p.cz)} + yk * sk + zk * ck;

    // ---- ARMS: shoulder swing (outer upper body only) ----
    // Mask: outer-lateral (arms, not torso) AND above the waist (so it never grabs the legs).
    float armLat = smoothstep(${f(p.armInner)}, ${f(p.armOuter)}, abs(transformed.x - ${f(p.cx)}));
    float armUp = smoothstep(${f(p.waistY)}, ${f(p.shoulderY)}, transformed.y);
    float armW = armLat * armUp;
    // uArm is counter-phase to uSwing, so each arm opposes the same-side leg (natural run).
    float armAng = uArm * side * armW;
    float ya = transformed.y - ${f(p.shoulderY)};
    float za = transformed.z - ${f(p.cz)};
    float cA = cos(armAng), sA = sin(armAng);
    transformed.y = ${f(p.shoulderY)} + ya * cA - za * sA;
    transformed.z = ${f(p.cz)} + ya * sA + za * cA;
  }`;
}

export class HeroPepeGLB {
  readonly group = new THREE.Group();
  isGLB = false;

  private fallback: RunnerRig | null = null;
  private inner = new THREE.Group();          // holds the model, rotated to face travel (−z)
  private mats: THREE.MeshStandardMaterial[] = [];
  private color = new THREE.Color(0xe8701c);
  private readonly cTmp = new THREE.Color();

  // Per-instance run-cycle uniforms (shared into every cloned material's shader).
  private readonly uSwing = { value: 0 }; // hip swing
  private readonly uKnee = { value: 0 };  // knee flex
  private readonly uArm = { value: 0 };   // shoulder swing (counter-phase to the legs)

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
    const bend = LEG ? bendChunk(LEG) : null;
    // Per-instance materials (clone so emissive/flow tint + the leg-bend uniforms don't leak
    // across renderers; the texture maps are shared by reference, so this is cheap).
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const src = Array.isArray(m.material) ? m.material : [m.material];
      const cloned = src.map((mm) => {
        if (!(mm instanceof THREE.MeshStandardMaterial)) return mm;
        const c = mm.clone();
        if (bend) {
          // Inject the GPU leg bend. The uniform objects are shared per instance so update()
          // can drive every material from one write.
          c.onBeforeCompile = (shader) => {
            shader.uniforms.uSwing = this.uSwing;
            shader.uniforms.uKnee = this.uKnee;
            shader.uniforms.uArm = this.uArm;
            shader.vertexShader = "uniform float uSwing;\nuniform float uKnee;\nuniform float uArm;\n" + shader.vertexShader
              .replace("#include <begin_vertex>", bend);
          };
        }
        return c;
      });
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

    // ---- LEG CYCLE (GPU vertex bend) ----
    // Legs swing from the hip in opposition (side flips the sign in the shader); the trailing
    // leg flexes its knee. Amplitude falls to ~0 when airborne/sliding so the legs don't flail.
    this.uSwing.value = Math.sin(t) * 0.5 * run;   // hip drive (lateral mask lets us push harder without tearing)
    this.uKnee.value = 0.6 * run;                  // knee flex on the trailing leg
    this.uArm.value = -Math.sin(t) * 0.6 * run;    // arms pump counter-phase to the legs

    // ---- RUN RHYTHM (whole-body; sells weight on top of the leg cycle) ----
    // Footfall bob: the body rises twice per stride (one bounce per foot plant).
    const bob = Math.abs(Math.sin(t)) * 0.1 * run;
    this.group.position.x = st.x;
    this.group.position.y = st.y + bob;

    // Turn-lean into a lane change (spring), killed while sliding.
    [this.leanZ, this.leanV] = spring(this.leanZ, this.leanV, -vx * 1.7, 0.22, 0.55);

    // Forward running LEAN + a stride pitch pulse; deep tuck on slide; reach-back on jump rise.
    const riseF = clamp(0.5 + vy * 3.2, 0, 1);
    const pitch = -0.14 * run + Math.sin(t * 2) * 0.04 * run - this.slideF * 0.5 + this.airF * riseF * 0.14;
    // Weight-shift SWAY (roll, once per stride) + the lane-change bank.
    const roll = this.leanZ * (1 - this.slideF) + Math.sin(t) * 0.06 * run;
    // Subtle torso YAW twist with the stride.
    const yaw = Math.sin(t) * 0.04 * run;
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

  /** Cutscene standing beat (used only by shots with runnerRun:false). Present upright/still with
   *  the legs at rest. armUp/chew/grip/flinch are no-ops for the GLB hero (no posable arms). */
  cutscenePose(_armUp: number, _chew = 0, _grip = 0, _flinch = 0): void {
    if (!this.isGLB) { this.fallback?.cutscenePose(_armUp, _chew, _grip, _flinch); return; }
    this.uSwing.value = 0; this.uKnee.value = 0; this.uArm.value = 0;
    this.inner.rotation.set(0, Math.PI, 0);
    this.inner.scale.set(1, 1, 1);
    this.group.position.y = 0;
    this.airF = this.slideF = this.squash = this.stretch = 0;
    this.leanZ = this.leanV = 0; this.havePrev = false;
  }
}
