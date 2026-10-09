/**
 * Greybox renderer. Pure presentation — reads RunSim state and draws it; it never
 * decides gameplay. Pooled meshes (no per-frame allocation), flat Arch palette.
 * Game feel lives here: FOV ramps with speed, camera shake on impact, Block Run
 * recolours the world and streaks past, Hyper Flow intensifies the glow.
 */
import * as THREE from "three";
import type { RunSim } from "./sim.ts";
import { RunnerRig } from "./runner-rig.ts";
import { CityScape } from "./cityscape.ts";
import { reducedMotion, quality } from "./settings.ts";
import { LANE_WIDTH, OBSTACLE_H, START_SPEED, MAX_SPEED, BLOCK_SPEED_MULT, FOV_BASE, FOV_MAX, FOV_BLOCK } from "./constants.ts";

const COL = {
  bg: 0x07080c, bgBlock: 0x1a0a2e, ground: 0x12141c, lane: 0x1d2130,
  player: 0xff7a1a, playerBlock: 0xb86bff, playerFlip: 0xffd54a,
  wall: 0xff3b3b, low: 0xffaa33, high: 0x9b6bff, pit: 0x04040a,
  energy: 0xf7931a, tick: 0x2a2f42, streak: 0xffb24d, gate: 0xffd54a, // energy = Bitcoin orange
};

/** Scripted camera/actor state for one cinematic frame (the opening cutscene). */
export type CineState = {
  cam: [number, number, number];
  look: [number, number, number];
  distance: number;
  runnerX: number;
  runnerPhase: number;
  runnerY?: number;      // vertical (trip dip / small hop)
  runnerPitch?: number;  // forward lean, radians — the stumble/trip pose
  shake?: number;        // camera shake 0..1 (impact of the near-catch)
  fov?: number;          // override FOV (bolt widens for speed)
  drone: { x: number; y: number; z: number; eye: number } | null;
  donut: { x: number; y: number; z: number; scale: number } | null;
};

/** A Bitcoin coin face: orange disc with a white ₿. Baked once, used on the coin caps. */
function makeBitcoinTexture(): THREE.Texture {
  if (typeof document === "undefined") return new THREE.Texture();
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f7931a"; ctx.beginPath(); ctx.arc(64, 64, 62, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffffff"; ctx.font = "bold 86px Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("₿", 64, 70); // ₿
  const t = new THREE.CanvasTexture(c);
  return t;
}

export class Renderer {
  readonly scene = new THREE.Scene();
  private cam: THREE.PerspectiveCamera;
  private gl: THREE.WebGLRenderer;
  private rig: RunnerRig;
  private city: CityScape;
  private auditor: THREE.Group;
  private donut: THREE.Group;
  private obPool: THREE.Mesh[] = [];
  private enPool: THREE.Mesh[] = [];
  private ticks: THREE.Mesh[] = [];
  private streaks: THREE.Mesh[] = [];
  private gatePool: THREE.Group[] = [];
  private flipMat!: THREE.MeshStandardMaterial;
  private parts: { m: THREE.Mesh; vx: number; vy: number; vz: number; life: number; max: number }[] = [];
  private lastPlayerX = 0;
  private lastPlayerY = 0.8;
  private lastNow = 0;
  private deathT = -1; // >=0 while the death camera plays
  private perf = false; // runtime auto-downgrade when frames are slow
  private fog: THREE.Fog;
  private canvas: HTMLCanvasElement;

  private camX = 0;          // eased camera x (shake is added on top)
  private shake = 0;         // decays every frame
  private blockLevel = 0;    // eased 0→1 Block Run intensity (smooth transitions)
  private flipLevel = 0;     // eased 0→1 ARCH FLIP intensity
  private readonly reduced = reducedMotion();
  private readonly lowQ = quality() === "low";
  private readonly cBg = new THREE.Color(COL.bg);
  private readonly cBgBlock = new THREE.Color(COL.bgBlock);
  private readonly cPlayer: THREE.Color;
  private readonly cPlayerBlock = new THREE.Color(COL.playerBlock);
  private readonly cPlayerFlip = new THREE.Color(COL.playerFlip);
  private readonly cTmp = new THREE.Color();
  private readonly playerColor: number;

  constructor(canvas: HTMLCanvasElement, playerColor: number = COL.player) {
    this.canvas = canvas;
    this.playerColor = playerColor;
    this.cPlayer = new THREE.Color(playerColor);
    this.scene.background = new THREE.Color(COL.bg);
    this.fog = new THREE.Fog(COL.bg, 24, 62);
    this.scene.fog = this.fog;

    this.cam = new THREE.PerspectiveCamera(FOV_BASE, 1, 0.1, 200);
    this.cam.position.set(0, 5.4, 9);

    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.gl.setClearColor(COL.bg);

    this.scene.add(new THREE.AmbientLight(0x8899cc, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(4, 12, 6);
    this.scene.add(key);
    const rim = new THREE.PointLight(0xff7a1a, 0.8, 40);
    rim.position.set(0, 3, 2);
    this.scene.add(rim);

    // Corridor floor + lane dividers.
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_WIDTH * 3 + 1.2, 0.3, 400),
      new THREE.MeshStandardMaterial({ color: COL.ground, roughness: 0.95 }),
    );
    floor.position.set(0, -0.15, -160);
    this.scene.add(floor);
    for (const x of [-LANE_WIDTH / 2, LANE_WIDTH / 2]) {
      const div = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.32, 400),
        new THREE.MeshStandardMaterial({ color: COL.lane, emissive: 0x111827, roughness: 1 }),
      );
      div.position.set(x, -0.05, -160);
      this.scene.add(div);
    }

    // Scrolling floor ticks (motion cue).
    const tickGeo = new THREE.BoxGeometry(LANE_WIDTH * 3, 0.02, 0.25);
    const tickMat = new THREE.MeshBasicMaterial({ color: COL.tick });
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(tickGeo, tickMat);
      this.ticks.push(m); this.scene.add(m);
    }

    // Speed streaks — only shown during Block Run (presentation spectacle).
    const streakGeo = new THREE.BoxGeometry(0.05, 0.05, 6);
    const streakMat = new THREE.MeshBasicMaterial({ color: COL.streak, transparent: true, opacity: 0.6 });
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(streakGeo, streakMat);
      m.visible = false; this.streaks.push(m); this.scene.add(m);
    }

    // ARCH FLIP markers: a glowing GATEWAY FRAME (two posts + a top bar) in the flip
    // lane — not a ring, and sized to one lane so it doesn't obscure the view.
    this.flipMat = new THREE.MeshStandardMaterial({ color: COL.gate, emissive: COL.gate, emissiveIntensity: 1.2, roughness: 0.3 });
    const postGeo = new THREE.BoxGeometry(0.16, 2.3, 0.16);
    const barGeo = new THREE.BoxGeometry(1.9, 0.16, 0.16);
    for (let i = 0; i < 4; i++) {
      const grp = new THREE.Group();
      for (const px of [-0.9, 0.9]) { const p = new THREE.Mesh(postGeo, this.flipMat); p.position.set(px, 1.15, 0); grp.add(p); }
      const bar = new THREE.Mesh(barGeo, this.flipMat); bar.position.set(0, 2.3, 0); grp.add(bar);
      grp.visible = false; this.gatePool.push(grp); this.scene.add(grp);
    }

    // Particle pool (collect sparkles / death burst). Render-only.
    const pGeo = new THREE.BoxGeometry(0.13, 0.13, 0.13);
    const pcount = this.lowQ ? 16 : 48;
    for (let i = 0; i < pcount; i++) {
      const m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 1 }));
      m.visible = false; this.scene.add(m);
      this.parts.push({ m, vx: 0, vy: 0, vz: 0, life: 0, max: 1 });
    }

    // The city around the corridor (depth + atmosphere). Fewer towers on low quality.
    this.city = new CityScape(this.scene, this.lowQ ? 9 : 18);

    // THE AUDITOR — a surveillance drone looming in the distance ahead (context, not a hazard).
    this.auditor = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.25, 16, 12), new THREE.MeshStandardMaterial({ color: 0x15161e, roughness: 0.5, metalness: 0.5 }));
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5a00, emissiveIntensity: 1.4 }));
    eye.position.set(0, 0, 1.0);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.08, 6, 20), new THREE.MeshStandardMaterial({ color: 0x3a0a00, emissive: 0xff3b00, emissiveIntensity: 0.5 }));
    this.auditor.add(body, eye, ring);
    this.scene.add(this.auditor);

    // The Satoshi donut (cutscene prop) — glazed orange torus with sprinkles. Hidden in play.
    this.donut = new THREE.Group();
    const dough = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.26, 16, 28), new THREE.MeshStandardMaterial({ color: 0xc87f2a, roughness: 0.6 }));
    const glaze = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.2, 16, 28), new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff7a1a, emissiveIntensity: 0.6, roughness: 0.3 }));
    glaze.position.z = 0.08;
    this.donut.add(dough, glaze);
    const sprinkleColors = [0x33e1ff, 0xff5bd1, 0x5bff9b, 0xffffff];
    for (let i = 0; i < 10; i++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.14), new THREE.MeshStandardMaterial({ color: sprinkleColors[i % 4], emissive: sprinkleColors[i % 4], emissiveIntensity: 0.4 }));
      const a = (i / 10) * Math.PI * 2;
      sp.position.set(Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0.18);
      sp.rotation.z = a; this.donut.add(sp);
    }
    this.donut.visible = false;
    this.scene.add(this.donut);

    // Player — a procedural jointed runner, not a box.
    this.rig = new RunnerRig(this.playerColor);
    this.scene.add(this.rig.group);

    // Pools.
    const obGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 28; i++) {
      const m = new THREE.Mesh(obGeo, new THREE.MeshStandardMaterial({ roughness: 0.5 }));
      m.visible = false; this.obPool.push(m); this.scene.add(m);
    }
    // Bitcoin coins: orange disc with a ₿ face (texture on the caps), facing the camera.
    const coinGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.08, 24);
    const btcTex = makeBitcoinTexture();
    const coinSide = new THREE.MeshStandardMaterial({ color: 0xc9790f, emissive: 0xf7931a, emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.55 });
    const coinFace = new THREE.MeshStandardMaterial({ map: btcTex, emissiveMap: btcTex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.3 });
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(coinGeo, [coinSide, coinFace, coinFace]);
      m.rotation.x = Math.PI / 2; // caps face the camera
      m.visible = false; this.enPool.push(m); this.scene.add(m);
    }

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.gl.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.gl.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
  }

  /** Runtime perf downgrade (set by the loop when frames are consistently slow). */
  setPerfMode(on: boolean): void { this.perf = on; }

  /** Cinematic death camera: pulls up/back and orbits the fallen runner. */
  startDeathCam(): void { this.deathT = 0; }
  stopDeathCam(): void { this.deathT = -1; }

  /** Recolour the runner live (character selection preview). */
  setPlayerColor(hex: number): void {
    this.cPlayer.set(hex);
    this.rig.setColor(hex);
  }

  /** Render one scripted cinematic frame (the opening cutscene drives this). */
  cutsceneFrame(nowMs: number, st: CineState): void {
    (this.scene.background as THREE.Color).copy(this.cBg);
    this.fog.color.copy(this.cBg); this.fog.far = 72;
    this.city.update(st.distance);
    this.rig.setColorObj(this.cPlayer);
    const ry = st.runnerY ?? 0;
    this.rig.update({ x: st.runnerX, y: ry, sliding: false, grounded: true, phase: st.runnerPhase, emissive: 0.9 });
    // Trip/stumble: pitch the whole figure forward (gait still flails underneath).
    this.rig.group.rotation.x = st.runnerPitch ?? 0;
    // no sim → hide all gameplay pools
    for (const m of this.obPool) m.visible = false;
    for (const m of this.enPool) m.visible = false;
    for (const g of this.gatePool) g.visible = false;
    for (const p of this.parts) p.m.visible = false;
    for (const s of this.streaks) s.visible = false;
    if (st.drone) {
      this.auditor.visible = true;
      this.auditor.position.set(st.drone.x, st.drone.y, st.drone.z);
      this.auditor.children[2]!.rotation.z = nowMs / 280;
      const em = (this.auditor.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial;
      em.emissiveIntensity = st.drone.eye; em.emissive.setHex(st.drone.eye >= 2 ? 0xff2200 : 0xff5a00);
    } else this.auditor.visible = false;
    if (st.donut) {
      this.donut.visible = true;
      this.donut.position.set(st.donut.x, st.donut.y, st.donut.z);
      this.donut.scale.setScalar(st.donut.scale);
      this.donut.rotation.set(0.35, nowMs / 700, 0);
    } else this.donut.visible = false;
    this.cam.fov = st.fov ?? 52;
    const sk = st.shake ?? 0;
    const sx = sk ? (Math.random() - 0.5) * sk : 0;
    const sy = sk ? (Math.random() - 0.5) * sk * 0.6 : 0;
    this.cam.position.set(st.cam[0] + sx, st.cam[1] + sy, st.cam[2]);
    this.cam.lookAt(st.look[0], st.look[1], st.look[2]);
    this.cam.updateProjectionMatrix();
    this.gl.render(this.scene, this.cam);
  }

  /** Release the WebGL context (called when a game ends, so contexts don't leak
   *  across menu↔game cycles). */
  dispose(): void {
    this.gl.dispose();
    this.gl.forceContextLoss();
  }

  /** Called by the orchestrator on gameplay events (impact feedback). */
  addShake(v: number): void { if (!this.reduced && !this.perf) this.shake = Math.min(1.3, this.shake + v); }

  /** Spawn a particle burst at the player (presentation only). */
  burst(kind: "collect" | "perfect" | "death" | "flip"): void {
    if (this.reduced || this.perf) return;
    const n = kind === "death" ? 20 : kind === "collect" ? 10 : 12;
    const color = kind === "death" ? 0xff3b3b : kind === "flip" ? 0xffe9a8 : kind === "collect" ? 0xffb347 : 0xffd54a;
    const speed = kind === "death" ? 9 : kind === "collect" ? 6 : 5;
    let spawned = 0;
    for (const p of this.parts) {
      if (p.life > 0) continue;
      if (spawned >= n) break;
      spawned++;
      p.m.position.set(this.lastPlayerX, this.lastPlayerY, 0);
      const mat = p.m.material as THREE.MeshBasicMaterial;
      mat.color.setHex(color); mat.opacity = 1;
      const a = Math.random() * Math.PI * 2, sp = speed * (0.4 + Math.random() * 0.6);
      p.vx = Math.cos(a) * sp; p.vy = Math.random() * sp + 2; p.vz = Math.sin(a) * sp * 0.5;
      p.max = kind === "death" ? 0.8 : 0.5; p.life = p.max;
      p.m.visible = true;
    }
  }

  private updateParticles(dt: number): void {
    for (const p of this.parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.m.visible = false; continue; }
      p.vy -= 20 * dt;
      p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
      const t = p.life / p.max;
      (p.m.material as THREE.MeshBasicMaterial).opacity = t;
      p.m.scale.setScalar(0.5 + t);
    }
  }

  render(sim: RunSim, nowMs: number): void {
    const d = sim.distance;
    const dt = this.lastNow ? Math.min(0.05, (nowMs - this.lastNow) / 1000) : 0.016;
    this.lastNow = nowMs;

    // Block Run / ARCH FLIP intensity ease in/out so colour + FOV transitions are smooth.
    this.blockLevel += ((sim.blockRun ? 1 : 0) - this.blockLevel) * 0.08;
    this.flipLevel += ((sim.flipActive ? 1 : 0) - this.flipLevel) * 0.1;

    // Player: procedural runner. Colour lerps toward the Block/Flip tints; the rig
    // plays the run/jump/slide cycle from sim state (gait phase syncs with distance).
    const emissive = Math.min(2.6, 0.6 + sim.flow * 0.12 + (sim.hyperFlow ? 0.6 : 0) + this.flipLevel * 0.8);
    this.cTmp.copy(this.cPlayer).lerp(this.cPlayerBlock, this.blockLevel).lerp(this.cPlayerFlip, this.flipLevel);
    this.rig.setColorObj(this.cTmp);
    this.rig.group.rotation.x = 0; // clear any leftover cutscene stumble-lean
    this.rig.update({ x: sim.laneX, y: sim.y, sliding: sim.sliding, grounded: sim.grounded, phase: sim.distance * 1.15, emissive });
    this.lastPlayerX = sim.laneX;
    this.lastPlayerY = (sim.sliding ? 0.5 : 0.9) + sim.y;

    // FOV ramps with speed (and a kick during Block Run) — the sense of pace.
    const speedFrac = Math.min(1, Math.max(0, (sim.speed - START_SPEED) / (MAX_SPEED * BLOCK_SPEED_MULT - START_SPEED)));
    const targetFov = FOV_BASE + (FOV_MAX - FOV_BASE) * speedFrac + FOV_BLOCK * this.blockLevel;
    if (Math.abs(this.cam.fov - targetFov) > 0.05) { this.cam.fov += (targetFov - this.cam.fov) * 0.1; this.cam.updateProjectionMatrix(); }

    // World recolours toward the Block palette.
    this.cTmp.copy(this.cBg).lerp(this.cBgBlock, this.blockLevel);
    (this.scene.background as THREE.Color).copy(this.cTmp);
    this.fog.color.copy(this.cTmp);
    this.fog.far = 62 - 8 * this.blockLevel; // tighter tunnel = faster feel

    // Camera eases toward the player's lane; shake is a transient offset on top.
    this.camX += (sim.laneX * 0.35 - this.camX) * 0.1;
    const sx = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake ? (Math.random() - 0.5) * this.shake * 0.5 : 0;
    this.cam.position.set(this.camX + sx, 5.4 + sy, 9);
    this.cam.lookAt(sim.laneX * 0.2, 1.4, -10);
    this.shake *= 0.86;

    // Death camera overrides: ease up/back and orbit the fallen runner.
    if (this.deathT >= 0) {
      this.deathT = Math.min(1, this.deathT + dt * 0.9);
      const e = this.deathT;
      this.cam.position.set(this.camX * 0.4 + Math.sin(e * 3) * 0.7, 5.4 + e * 5, 9 + e * 9);
      this.cam.lookAt(this.lastPlayerX, Math.max(0.4, this.lastPlayerY), 0);
    }

    // City scrolls past (recycled).
    this.city.update(d);

    // The Auditor drone looms ~44 units ahead (you never catch it), bobbing + scanning;
    // its eye flares during Block Run / Hyper Flow. Eye faces the camera (local +z).
    this.auditor.visible = true;
    this.donut.visible = false; // donut is a cutscene-only prop
    this.auditor.position.set(Math.sin(nowMs / 1800) * 2.4, 8 + Math.sin(nowMs / 900) * 0.5, -44);
    this.auditor.rotation.set(0, 0, 0);
    this.auditor.children[2]!.rotation.z = nowMs / 500; // scanning ring
    const eyeMat = (this.auditor.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    eyeMat.emissiveIntensity = 1.2 + ((sim.hyperFlow || sim.blockRun) ? 1.0 : 0) + Math.sin(nowMs / 200) * 0.3;

    // Floor ticks scroll.
    const spacing = 4;
    const span = this.ticks.length * spacing;
    for (let i = 0; i < this.ticks.length; i++) {
      const localZ = -((((i * spacing - d) % span) + span) % span);
      this.ticks[i]!.position.set(0, 0.02, localZ + 8);
    }

    // Speed streaks (Block Run only): deterministic lateral lanes scrolling fast.
    const streaksOn = this.blockLevel > 0.15 && !this.reduced && !this.lowQ && !this.perf;
    const sspan = 90;
    for (let i = 0; i < this.streaks.length; i++) {
      const m = this.streaks[i]!;
      m.visible = streaksOn;
      if (!streaksOn) continue;
      const lane = ((i % 4) - 1.5) * LANE_WIDTH * 1.15;
      const base = (i * 37.7) % sspan;
      const localZ = -((((base - d * 1.4) % sspan) + sspan) % sspan);
      m.position.set(lane, 0.4 + ((i * 13) % 5) * 0.7, localZ + 10);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.5 * this.blockLevel;
    }

    // Obstacles.
    const v = sim.view();
    let oi = 0;
    for (const o of v.obstacles) {
      if (oi >= this.obPool.length) break;
      const m = this.obPool[oi++]!;
      const localZ = -(o.z - d);
      const h = OBSTACLE_H[o.type];
      const mat = m.material as THREE.MeshStandardMaterial;
      if (o.type === "WALL") { m.scale.set(LANE_WIDTH * 0.82, h, 1.2); m.position.set(o.lane * LANE_WIDTH, h / 2, localZ); mat.color.setHex(COL.wall); mat.emissive.setHex(0x3a0000); }
      else if (o.type === "LOW") { m.scale.set(LANE_WIDTH * 0.9, h, 1.0); m.position.set(o.lane * LANE_WIDTH, h / 2, localZ); mat.color.setHex(COL.low); mat.emissive.setHex(0x3a2200); }
      else if (o.type === "HIGH") { m.scale.set(LANE_WIDTH * 0.9, 0.5, 1.0); m.position.set(o.lane * LANE_WIDTH, 2.3, localZ); mat.color.setHex(COL.high); mat.emissive.setHex(0x2a1550); }
      else { // PIT — a GLOWING red hazard gap so it's unmistakable (was near-black = invisible). Jump it.
        m.scale.set(LANE_WIDTH * 0.92, 0.12, 2.8); m.position.set(o.lane * LANE_WIDTH, 0.06, localZ);
        mat.color.setHex(0x2a0608); mat.emissive.setHex(0xff3322);
      }
      mat.emissiveIntensity = (o.type === "PIT" ? 1.2 : 0.5) + this.blockLevel * 0.6;
      m.visible = localZ > -62 && localZ < 10;
    }
    for (; oi < this.obPool.length; oi++) this.obPool[oi]!.visible = false;

    // Energy orbs (spin for life).
    let ei = 0;
    for (const e of v.energy) {
      if (ei >= this.enPool.length) break;
      const m = this.enPool[ei++]!;
      const lz = -(e.z - d);
      const passed = lz > 0.6; // behind the player = a MISS: it tumbles away instead of just vanishing
      const bob = Math.sin(nowMs / 280 + e.id) * 0.08;
      m.position.set(e.lane * LANE_WIDTH, 0.65 + e.y + bob + (passed ? (lz * 0.12) : 0), lz);
      if (passed) m.rotation.set(Math.PI / 2 + lz * 0.25, nowMs / 300, nowMs / 450); // tumble as it flies past
      else m.rotation.set(Math.PI / 2, 0, nowMs / 450); // upright, ₿ facing camera
      m.visible = lz < 11; // cull only once behind the camera
    }
    for (; ei < this.enPool.length; ei++) this.enPool[ei]!.visible = false;

    // ARCH FLIP gateway frames (one shared pulsing material).
    const gates = sim.flipGatesInView();
    let gi = 0;
    this.flipMat.emissiveIntensity = 1.2 + Math.sin(nowMs / 160) * 0.5;
    for (const g of gates) {
      if (gi >= this.gatePool.length) break;
      const m = this.gatePool[gi++]!;
      const localZ = -(g.z - d);
      m.position.set(g.lane * LANE_WIDTH, 0, localZ);
      m.visible = localZ > -62 && localZ < 10;
    }
    for (; gi < this.gatePool.length; gi++) this.gatePool[gi]!.visible = false;

    this.updateParticles(dt);
    this.gl.render(this.scene, this.cam);
  }
}
