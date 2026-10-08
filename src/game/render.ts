/**
 * Greybox renderer. Pure presentation — reads RunSim state and draws it; it never
 * decides gameplay. Pooled meshes (no per-frame allocation), flat Arch palette.
 * Game feel lives here: FOV ramps with speed, camera shake on impact, Block Run
 * recolours the world and streaks past, Hyper Flow intensifies the glow.
 */
import * as THREE from "three";
import type { RunSim } from "./sim.ts";
import { LANE_WIDTH, OBSTACLE_H, START_SPEED, MAX_SPEED, BLOCK_SPEED_MULT, FOV_BASE, FOV_MAX, FOV_BLOCK } from "./constants.ts";

const COL = {
  bg: 0x07080c, bgBlock: 0x1a0a2e, ground: 0x12141c, lane: 0x1d2130,
  player: 0xff7a1a, playerBlock: 0xb86bff,
  wall: 0xff3b3b, low: 0xffaa33, high: 0x9b6bff, pit: 0x04040a,
  energy: 0xffd54a, tick: 0x2a2f42, streak: 0xffb24d,
};

export class Renderer {
  readonly scene = new THREE.Scene();
  private cam: THREE.PerspectiveCamera;
  private gl: THREE.WebGLRenderer;
  private player: THREE.Mesh;
  private obPool: THREE.Mesh[] = [];
  private enPool: THREE.Mesh[] = [];
  private ticks: THREE.Mesh[] = [];
  private streaks: THREE.Mesh[] = [];
  private fog: THREE.Fog;
  private canvas: HTMLCanvasElement;

  private camX = 0;          // eased camera x (shake is added on top)
  private shake = 0;         // decays every frame
  private blockLevel = 0;    // eased 0→1 Block Run intensity (smooth transitions)
  private readonly reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  private readonly cBg = new THREE.Color(COL.bg);
  private readonly cBgBlock = new THREE.Color(COL.bgBlock);
  private readonly cPlayer = new THREE.Color(COL.player);
  private readonly cPlayerBlock = new THREE.Color(COL.playerBlock);
  private readonly cTmp = new THREE.Color();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
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

    // Player.
    this.player = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 1.6, 1.0),
      new THREE.MeshStandardMaterial({ color: COL.player, emissive: 0x7a2a00, emissiveIntensity: 0.6, roughness: 0.4 }),
    );
    this.player.position.set(0, 0.8, 0);
    this.scene.add(this.player);

    // Pools.
    const obGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 28; i++) {
      const m = new THREE.Mesh(obGeo, new THREE.MeshStandardMaterial({ roughness: 0.5 }));
      m.visible = false; this.obPool.push(m); this.scene.add(m);
    }
    const enGeo = new THREE.IcosahedronGeometry(0.34, 0);
    const enMat = new THREE.MeshStandardMaterial({ color: COL.energy, emissive: 0xffb300, emissiveIntensity: 0.9, roughness: 0.2 });
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(enGeo, enMat);
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

  /** Called by the orchestrator on gameplay events (impact feedback). */
  addShake(v: number): void { if (!this.reduced) this.shake = Math.min(1.3, this.shake + v); }

  render(sim: RunSim, nowMs: number): void {
    const d = sim.distance;

    // Block Run intensity eases in/out so colour + FOV transitions are smooth.
    this.blockLevel += ((sim.blockRun ? 1 : 0) - this.blockLevel) * 0.08;

    // Player: x follows laneX, y from jump; squash when sliding; glow with flow.
    this.player.position.x = sim.laneX;
    this.player.scale.set(1, sim.sliding ? 0.5 : 1, 1);
    this.player.position.y = (sim.sliding ? 0.42 : 0.8) + sim.y;
    const pm = this.player.material as THREE.MeshStandardMaterial;
    pm.emissiveIntensity = Math.min(2.4, 0.6 + sim.flow * 0.12 + (sim.hyperFlow ? 0.6 : 0));
    pm.color.copy(this.cPlayer).lerp(this.cPlayerBlock, this.blockLevel);

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

    // Floor ticks scroll.
    const spacing = 4;
    const span = this.ticks.length * spacing;
    for (let i = 0; i < this.ticks.length; i++) {
      const localZ = -((((i * spacing - d) % span) + span) % span);
      this.ticks[i]!.position.set(0, 0.02, localZ + 8);
    }

    // Speed streaks (Block Run only): deterministic lateral lanes scrolling fast.
    const streaksOn = this.blockLevel > 0.15 && !this.reduced;
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
      else { m.scale.set(LANE_WIDTH * 0.88, 0.4, 2.4); m.position.set(o.lane * LANE_WIDTH, -0.25, localZ); mat.color.setHex(COL.pit); mat.emissive.setHex(0x000000); }
      mat.emissiveIntensity = 0.5 + this.blockLevel * 0.6;
      m.visible = localZ > -62 && localZ < 10;
    }
    for (; oi < this.obPool.length; oi++) this.obPool[oi]!.visible = false;

    // Energy orbs (spin for life).
    let ei = 0;
    for (const e of v.energy) {
      if (ei >= this.enPool.length) break;
      const m = this.enPool[ei++]!;
      m.position.set(e.lane * LANE_WIDTH, 0.6 + e.y, -(e.z - d));
      m.rotation.y = nowMs / 400;
      m.visible = true;
    }
    for (; ei < this.enPool.length; ei++) this.enPool[ei]!.visible = false;

    this.gl.render(this.scene, this.cam);
  }
}
