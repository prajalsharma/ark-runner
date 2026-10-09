/**
 * Authors the rigged "hooded Arch courier" hero GLB used by src/game/hero-glb.ts (Path B).
 *
 * HONEST PROVENANCE: this is a PROCEDURALLY-AUTHORED asset (my own work, CC0) — NOT a pro /
 * Mixamo / scanned character. It exists to make the Path B pipeline real and testable without
 * any paid generator (TRIPO/GEMINI keys were absent) or a login-gated store. A true "premium"
 * hero still wants a pro rig + mocap clips; this is the drop-in slot for one.
 *
 * It builds a SkinnedMesh humanoid (bone skeleton + per-part skin weights, joint-cap spheres
 * to hide seams) with material zones (suit / gear / visor) and bakes four looping Animation
 * clips — idle, run, jump, slide — sampled from the same gait math as the procedural rig.
 * Exports a single binary .glb (clips bundled) to src/assets/.
 *
 * Run: node scripts/build-hero-glb.mjs   (uses three from the repo's node_modules)
 */
import * as THREE from "three";
// Minimal DOM shims so three's GLTFExporter runs headless in Node (it uses Blob + FileReader).
if (typeof globalThis.FileReader === "undefined") {
  globalThis.FileReader = class {
    constructor() { this._l = {}; }
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
    _fire(t) { const e = { target: this }; this[`on${t}`]?.(e); (this._l[t] || []).forEach((fn) => fn(e)); }
    _done() { this._fire("load"); this._fire("loadend"); }
    _fail(err) { this.error = err; this._fire("error"); this._fire("loadend"); }
    readAsArrayBuffer(blob) { blob.arrayBuffer().then((ab) => { this.result = ab; this._done(); }).catch((e) => this._fail(e)); }
    readAsDataURL(blob) { blob.arrayBuffer().then((ab) => { this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(ab).toString("base64")}`; this._done(); }).catch((e) => this._fail(e)); }
  };
}
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../src/assets/hero-courier.glb");

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;

// ---- Skeleton (bind pose). Positions are LOCAL to the parent bone. Forward = +z (matches
//      the procedural rig's chest/visor on +z). Material zone index per part: 0 suit,1 gear,2 visor.
const L1 = 0.38, L2 = 0.36; // thigh, shin — same lengths as the procedural IK contract
const bones = {};
function bone(name, parent, x, y, z) {
  const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z);
  if (parent) bones[parent].add(b); bones[name] = b; return b;
}
bone("hips", null, 0, 0.78, 0);
bone("spine", "hips", 0, 0.1, 0);
bone("chest", "spine", 0, 0.34, 0);
bone("head", "chest", 0, 0.34, 0);
bone("shL", "chest", -0.3, 0.22, 0); bone("elbowL", "shL", 0, -0.28, 0);
bone("shR", "chest", 0.3, 0.22, 0); bone("elbowR", "shR", 0, -0.28, 0);
bone("hipL", "hips", -0.15, -0.04, 0); bone("kneeL", "hipL", 0, -L1, 0);
bone("hipR", "hips", 0.15, -0.04, 0); bone("kneeR", "hipR", 0, -L1, 0);

const order = ["hips", "spine", "chest", "head", "shL", "elbowL", "shR", "elbowR", "hipL", "kneeL", "hipR", "kneeR"];
const boneArr = order.map((n) => bones[n]);
const boneIndex = Object.fromEntries(order.map((n, i) => [n, i]));

// World bind position of a bone (walk up the parent chain).
function worldPos(name) {
  let v = new THREE.Vector3(), b = bones[name];
  while (b && b.isBone) { v.add(b.position); b = b.parent; }
  return v;
}

// ---- Geometry: one part = one primitive rigidly weighted to a single bone, placed at its
//      world bind position. Joint caps (spheres on the child bone's origin) hide the seams.
const parts = []; // { geo, zone }
function addPart(geo, boneName, zone, offset = [0, 0, 0]) {
  const wp = worldPos(boneName);
  geo.translate(wp.x + offset[0], wp.y + offset[1], wp.z + offset[2]);
  const n = geo.attributes.position.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const bi = boneIndex[boneName];
  for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
  geo.setAttribute("skinIndex", new THREE.BufferAttribute(si, 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
  parts.push({ geo, zone });
}
function limb(boneName, rTop, rBot, len, zone) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, 10);
  g.translate(0, -len / 2, 0); // top at the bone origin, extends down the bone
  addPart(g, boneName, zone);
}
function cap(boneName, r, zone) { addPart(new THREE.SphereGeometry(r, 10, 8), boneName, zone); }

// Torso + hips
addPart(new THREE.CylinderGeometry(0.32, 0.2, 0.62, 14).scale(1, 1, 0.74).translate(0, 0.0, 0), "chest", 0, [0, -0.05, 0]);
addPart(new THREE.BoxGeometry(0.46, 0.17, 0.32), "hips", 1, [0, 0, 0]);
addPart(new THREE.BoxGeometry(0.42, 0.3, 0.1).scale(1, 1, 0.9), "chest", 1, [0, 0.08, 0.19]);        // chest plate
addPart(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 12).rotateX(Math.PI / 2), "chest", 2, [0, 0.1, 0.25]); // core
addPart(new THREE.BoxGeometry(0.1, 0.09, 0.03), "hips", 2, [0, 0, 0.18]);                               // buckle
// Ledger-pack (back)
addPart(new THREE.BoxGeometry(0.38, 0.44, 0.2), "chest", 1, [0, 0.02, -0.25]);
addPart(new THREE.BoxGeometry(0.26, 0.04, 0.02), "chest", 2, [0, 0.08, -0.36]);
addPart(new THREE.BoxGeometry(0.04, 0.3, 0.02), "chest", 2, [0, 0.0, -0.36]);
// Head + cowl + visor
addPart(new THREE.SphereGeometry(0.17, 14, 12).scale(0.95, 1, 0.95), "head", 1); // shadowed face (gear/dark)
addPart(new THREE.SphereGeometry(0.235, 18, 14, 0, TAU, 0, Math.PI * 0.86).scale(1.08, 1.12, 1.18), "head", 3, [0, 0.01, -0.02]); // cowl (hood zone → darker suit shade)
addPart(new THREE.CylinderGeometry(0.19, 0.24, 0.1, 16, 1, true).rotateX(1.25), "head", 3, [0, 0.08, 0.1]); // forward brim
addPart(new THREE.BoxGeometry(0.2, 0.045, 0.05), "head", 2, [0, -0.02, 0.14]); // visor
// Arms
cap("shL", 0.1, 0); limb("shL", 0.095, 0.072, 0.28, 0); cap("elbowL", 0.072, 0); limb("elbowL", 0.07, 0.055, 0.26, 0);
addPart(new THREE.SphereGeometry(0.082, 10, 8).scale(1, 1, 1.15), "elbowL", 1, [0, -0.3, 0]);
cap("shR", 0.1, 0); limb("shR", 0.095, 0.072, 0.28, 0); cap("elbowR", 0.072, 0); limb("elbowR", 0.07, 0.055, 0.26, 0);
addPart(new THREE.SphereGeometry(0.082, 10, 8).scale(1, 1, 1.15), "elbowR", 1, [0, -0.3, 0]);
// Legs
cap("hipL", 0.14, 0); limb("hipL", 0.145, 0.1, L1, 0); cap("kneeL", 0.1, 0); limb("kneeL", 0.098, 0.072, L2, 0);
addPart(new THREE.BoxGeometry(0.17, 0.14, 0.4), "kneeL", 1, [0, -0.42, 0.09]);
addPart(new THREE.BoxGeometry(0.19, 0.05, 0.44), "kneeL", 2, [0, -0.49, 0.1]);
cap("hipR", 0.14, 0); limb("hipR", 0.145, 0.1, L1, 0); cap("kneeR", 0.1, 0); limb("kneeR", 0.098, 0.072, L2, 0);
addPart(new THREE.BoxGeometry(0.17, 0.14, 0.4), "kneeR", 1, [0, -0.42, 0.09]);
addPart(new THREE.BoxGeometry(0.19, 0.05, 0.44), "kneeR", 2, [0, -0.49, 0.1]);

// Merge, grouped by material zone so one SkinnedMesh carries its materials.
const ZONES = 4; // 0 suit, 1 gear, 2 visor, 3 hood
const merged = [];
const groupsMeta = [];
for (let z = 0; z < ZONES; z++) {
  const zoneGeos = parts.filter((p) => p.zone === z).map((p) => p.geo);
  if (!zoneGeos.length) continue;
  const g = mergeGeometries(zoneGeos, false);
  groupsMeta.push({ geo: g, zone: z });
}
// mergeGeometries with useGroups across all parts, preserving a group per ZONE:
const allGeos = [], matIndexPerGeo = [];
for (const { geo, zone } of groupsMeta) { allGeos.push(geo); matIndexPerGeo.push(zone); }
const geometry = mergeGeometries(allGeos, true); // useGroups=true → one group per entry
// Remap group material indices to the zone id (entries are in push order = zone order).
geometry.groups.forEach((grp, i) => { grp.materialIndex = matIndexPerGeo[i]; });

const suit = new THREE.MeshStandardMaterial({ name: "suit", color: 0xff7a1a, roughness: 0.55, metalness: 0.15, emissive: 0x3a1c06, emissiveIntensity: 0.6 });
const gear = new THREE.MeshStandardMaterial({ name: "gear", color: 0x15181f, roughness: 0.55, metalness: 0.55 });
const visor = new THREE.MeshStandardMaterial({ name: "visor_core_accent", color: 0x0a0c12, emissive: 0x33e1ff, emissiveIntensity: 1.6, roughness: 0.25, metalness: 0.4 });
const hood = new THREE.MeshStandardMaterial({ name: "suit_hood", color: 0x6b3309, roughness: 0.68, metalness: 0.12 });

const skinned = new THREE.SkinnedMesh(geometry, [suit, gear, visor, hood]);
skinned.name = "SAT_courier";
const root = bones.hips;
const skeleton = new THREE.Skeleton(boneArr);
skinned.add(root);
skinned.bind(skeleton);

// Root group so the exporter writes the skeleton under one node.
const sceneRoot = new THREE.Group(); sceneRoot.name = "Hero"; sceneRoot.add(skinned);

// ---- Bake clips. Sample bone quaternions over time from the gait math. In-place (no root
//      translation — the game moves the character). Euler X on joints = pitch (matches rig). ----
function legIK(cyclePos) {
  const stance = 0.58, stride = 0.42, legLen = 0.7, lift = 0.26;
  let ty, tz;
  if (cyclePos < stance) { const t = cyclePos / stance; tz = -stride / 2 + stride * t; ty = -legLen; }
  else { const t = (cyclePos - stance) / (1 - stance); tz = stride / 2 - stride * t; ty = -legLen + lift * Math.sin(Math.PI * t); }
  const d = clamp(Math.hypot(ty, tz), Math.abs(L1 - L2) + 0.01, L1 + L2 - 0.004);
  const knee = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
  const hip = Math.atan2(tz, -ty) - Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  return { hip, knee };
}
const qx = (a) => new THREE.Quaternion().setFromEuler(new THREE.Euler(a, 0, 0));

// A clip samples a pose(fn t->{boneName:xAngle}) at N frames over `dur` seconds.
function buildClip(name, dur, frames, pose, loop = true) {
  const times = []; const tracks = {};
  for (const n of order) tracks[n] = [];
  for (let f = 0; f < frames; f++) {
    const u = f / (loop ? frames : frames - 1); // loop: last≈first (don't duplicate)
    const tt = u * dur; times.push(tt);
    const angles = pose(u);
    for (const n of order) {
      const q = qx(angles[n] || 0);
      tracks[n].push(q.x, q.y, q.z, q.w);
    }
  }
  const kt = order.map((n) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, tracks[n]));
  return new THREE.AnimationClip(name, dur, kt);
}

const runClip = buildClip("run", 0.6, 16, (u) => {
  const p = u * TAU; const s = Math.sin(p);
  const ikL = legIK(((u) % 1 + 1) % 1); const ikR = legIK((u + 0.5) % 1);
  return {
    hipL: ikL.hip, kneeL: ikL.knee, hipR: ikR.hip, kneeR: ikR.knee,
    shL: -s * 0.7, shR: s * 0.7, elbowL: -0.6, elbowR: -0.6,
    spine: 0.16, head: -Math.abs(Math.cos(p)) * 0.05,
  };
});
const idleClip = buildClip("idle", 2.0, 24, (u) => {
  const b = Math.sin(u * TAU) * 0.04;
  return { spine: 0.05 + b, head: -b, shL: -0.05, shR: -0.05, elbowL: -0.5, elbowR: -0.5, kneeL: 0.08, kneeR: 0.08 };
});
const jumpClip = buildClip("jump", 0.9, 14, (u) => {
  // rise (reach) → apex → fall (tuck)
  const rise = Math.max(0, 1 - u * 2); const tuck = clamp((u - 0.4) / 0.6, 0, 1);
  return {
    hipL: -0.4 - tuck * 0.8, hipR: -0.4 - tuck * 0.8,
    kneeL: 0.5 + tuck * 1.4, kneeR: 0.5 + tuck * 1.4,
    shL: -2.3 * rise - 0.5 * (1 - rise), shR: -2.3 * rise - 0.5 * (1 - rise),
    elbowL: -0.5, elbowR: -0.5, spine: -0.05 + tuck * 0.2,
  };
}, false);
const slideClip = buildClip("slide", 0.8, 12, (u) => {
  const g = clamp(u * 3, 0, 1); // ease into the dive
  return {
    spine: 1.15 * g, head: -0.2 * g,
    hipL: -1.45 * g, kneeL: 0.25 * g, hipR: -0.55 * g, kneeR: 1.5 * g,
    shL: 1.6 * g, shR: 0.6 * g, elbowL: -0.5, elbowR: -0.5,
  };
}, false);

const animations = [idleClip, runClip, jumpClip, slideClip];

// ---- Export GLB (binary, clips bundled). ----
mkdirSync(dirname(OUT), { recursive: true });
const exporter = new GLTFExporter();
const glb = await new Promise((res, rej) => {
  exporter.parse(sceneRoot, res, rej, { binary: true, animations, onlyVisible: false });
});
const buf = Buffer.from(glb);
writeFileSync(OUT, buf);
console.log(`wrote ${OUT} — ${(buf.length / 1024).toFixed(1)} KB, ${animations.length} clips, ${boneArr.length} bones, ${geometry.attributes.position.count} verts`);
