/**
 * Greybox renderer. Pure presentation — reads RunSim state and draws it; it never
 * decides gameplay. Pooled meshes (no per-frame allocation), flat Arch palette.
 */
import * as THREE from "three";
import type { RunSim } from "./sim.ts";
import { LANE_WIDTH, OBSTACLE_H } from "./constants.ts";

const COL = {
  bg: 0x07080c, ground: 0x12141c, lane: 0x1d2130,
  player: 0xff7a1a, wall: 0xff3b3b, low: 0xffaa33, high: 0x9b6bff, pit: 0x04040a,
  energy: 0xffd54a, tick: 0x2a2f42,
};

export class Renderer {
  readonly scene = new THREE.Scene();
  private cam: THREE.PerspectiveCamera;
  private gl: THREE.WebGLRenderer;
  private player: THREE.Mesh;
  private obPool: THREE.Mesh[] = [];
  private enPool: THREE.Mesh[] = [];
  private ticks: THREE.Mesh[] = [];
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scene.background = new THREE.Color(COL.bg);
    this.scene.fog = new THREE.Fog(COL.bg, 24, 62);

    this.cam = new THREE.PerspectiveCamera(62, 1, 0.1, 200);
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

  render(sim: RunSim, nowMs: number): void {
    const d = sim.distance;
    // Player: x follows laneX, y from jump; squash when sliding.
    this.player.position.x = sim.laneX;
    this.player.position.y = 0.8 + sim.y;
    this.player.scale.set(1, sim.sliding ? 0.5 : 1, 1);
    this.player.position.y = (sim.sliding ? 0.42 : 0.8) + sim.y;
    const flowGlow = Math.min(2, 0.6 + sim.flow * 0.12);
    (this.player.material as THREE.MeshStandardMaterial).emissiveIntensity = flowGlow;

    // Camera eases toward the player's lane.
    this.cam.position.x += (sim.laneX * 0.35 - this.cam.position.x) * 0.1;
    this.cam.lookAt(sim.laneX * 0.2, 1.4, -10);

    // Floor ticks scroll.
    const spacing = 4;
    for (let i = 0; i < this.ticks.length; i++) {
      const baseZ = i * spacing;
      const localZ = -(((baseZ - d) % (this.ticks.length * spacing) + this.ticks.length * spacing) % (this.ticks.length * spacing));
      this.ticks[i]!.position.set(0, 0.02, localZ + 8);
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
      mat.emissiveIntensity = 0.5;
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
