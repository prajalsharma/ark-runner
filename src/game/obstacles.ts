/**
 * Authored hazard props — the obstacle family. Not recoloured cubes: each gameplay role
 * has its own silhouette, telegraph colour, and pulsing warning light so the player reads
 * the required action from a distance.
 *   WALL  (red)    — a heavy barrier gate blocking the lane  → SWITCH lanes
 *   LOW   (amber)  — a ground hurdle with hazard stripes      → JUMP over
 *   HIGH  (violet) — an overhead crusher gantry with teeth    → SLIDE under
 *   PIT   (red)    — a recessed gap with glowing edge rails    → JUMP the gap
 * Pure presentation: visuals match the sim's lane/height footprint; collision lives in the
 * deterministic sim. Pooled per type, no per-frame allocation.
 */
import * as THREE from "three";
import { LANE_WIDTH, OBSTACLE_H } from "./constants.ts";

export type ObType = "WALL" | "LOW" | "HIGH" | "PIT";

/** Diagonal hazard-stripe texture (amber/black, red/black …). Baked once. */
function hazardTexture(a: string, b: string): THREE.Texture {
  if (typeof document === "undefined") return new THREE.Texture();
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = b; ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = a; ctx.lineWidth = 22;
  for (let i = -128; i < 256; i += 44) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 128, 128); ctx.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export class ObstacleKit {
  private pools: Record<ObType, THREE.Group[]> = { WALL: [], LOW: [], HIGH: [], PIT: [] };
  private used: Record<ObType, number> = { WALL: 0, LOW: 0, HIGH: 0, PIT: 0 };
  private warnMats: THREE.MeshStandardMaterial[] = []; // pulsed beacons
  private edgeMats: THREE.MeshStandardMaterial[] = [];  // pit/telegraph edges (block-level boost)

  constructor(scene: THREE.Scene, perType = 9) {
    const amberTex = hazardTexture("#ffb020", "#1a1206");
    const redTex = hazardTexture("#ff3b3b", "#180404");

    for (let i = 0; i < perType; i++) {
      this.pools.WALL.push(this.buildWall(redTex));
      this.pools.LOW.push(this.buildLow(amberTex));
      this.pools.HIGH.push(this.buildHigh());
      this.pools.PIT.push(this.buildPit());
    }
    for (const type of Object.keys(this.pools) as ObType[])
      for (const g of this.pools[type]) { g.visible = false; scene.add(g); }
  }

  // WALL — barrier gate: two posts + a hazard-striped panel + a pulsing red beacon.
  private buildWall(tex: THREE.Texture): THREE.Group {
    const g = new THREE.Group();
    const h = OBSTACLE_H.WALL;
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d26, roughness: 0.6, metalness: 0.5 });
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, h + 0.2, 0.3), dark);
      post.position.set(sx * LANE_WIDTH * 0.42, (h + 0.2) / 2, 0); g.add(post);
    }
    const panelMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: 0x200000, emissiveIntensity: 0.4 });
    (tex as THREE.Texture).repeat?.set(2, 2);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 0.74, h * 0.82, 0.26), panelMat);
    panel.position.set(0, h * 0.5, 0); g.add(panel);
    const beaconMat = new THREE.MeshStandardMaterial({ color: 0x3a0000, emissive: 0xff2200, emissiveIntensity: 1.6, roughness: 0.4 });
    this.warnMats.push(beaconMat);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), beaconMat);
    beacon.position.set(0, h + 0.2, 0); g.add(beacon);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  // LOW — ground hurdle: an angled hazard-striped slab + amber warning strip. Jump it.
  private buildLow(tex: THREE.Texture): THREE.Group {
    const g = new THREE.Group();
    const h = OBSTACLE_H.LOW;
    const body = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 0.86, h, 0.7), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }));
    body.position.set(0, h / 2, 0); g.add(body);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x2a1c06, emissive: 0xffb020, emissiveIntensity: 1.2, roughness: 0.5 });
    this.warnMats.push(capMat);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 0.86, 0.08, 0.76), capMat);
    cap.position.set(0, h + 0.04, 0); g.add(cap);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  // HIGH — overhead crusher gantry: a beam at head height with teeth + side posts. Slide under.
  private buildHigh(): THREE.Group {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1430, roughness: 0.6, metalness: 0.5 });
    const barMat = new THREE.MeshStandardMaterial({ color: 0x5a3bb0, emissive: 0x9b6bff, emissiveIntensity: 1.0, roughness: 0.4 });
    this.warnMats.push(barMat);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.9, 0.3), dark);
      post.position.set(sx * LANE_WIDTH * 0.46, 1.45, 0); g.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 0.98, 0.5, 0.5), barMat);
    beam.position.set(0, 2.3, 0); g.add(beam);
    // Downward teeth telegraph "duck".
    for (let i = -2; i <= 2; i++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 4), dark);
      tooth.position.set(i * LANE_WIDTH * 0.2, 1.95, 0); tooth.rotation.x = Math.PI; g.add(tooth);
    }
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    return g;
  }

  // PIT — recessed gap: a dark void sunk below the floor with glowing edge rails. Jump it.
  private buildPit(): THREE.Group {
    const g = new THREE.Group();
    const void_ = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 0.94, 0.5, 2.8), new THREE.MeshStandardMaterial({ color: 0x050308, roughness: 1 }));
    void_.position.set(0, -0.26, 0); g.add(void_);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x2a0608, emissive: 0xff3322, emissiveIntensity: 1.4, roughness: 0.4 });
    this.edgeMats.push(railMat);
    for (const sz of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 0.96, 0.1, 0.22), railMat);
      rail.position.set(0, 0.02, sz * 1.35); g.add(rail);
    }
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.receiveShadow = true; });
    return g;
  }

  /** Start a frame: nothing used yet. */
  beginFrame(): void { this.used = { WALL: 0, LOW: 0, HIGH: 0, PIT: 0 }; }

  /** Place the next free prop of `type` at the lane/depth. Returns false if the pool is full. */
  show(type: ObType, lane: number, localZ: number): boolean {
    const pool = this.pools[type]; const i = this.used[type];
    if (i >= pool.length) return false;
    const g = pool[i]!; this.used[type]++;
    g.position.set(lane * LANE_WIDTH, 0, localZ);
    g.visible = true;
    return true;
  }

  /** Hide every prop not used this frame. */
  finish(): void {
    for (const type of Object.keys(this.pools) as ObType[])
      for (let i = this.used[type]; i < this.pools[type].length; i++) this.pools[type][i]!.visible = false;
  }

  /** Pulse warning lights (and lift edge glow during Block Run). */
  pulse(nowMs: number, blockLevel: number): void {
    const p = 1 + Math.sin(nowMs / 160) * 0.5 + blockLevel * 0.8;
    for (const m of this.warnMats) m.emissiveIntensity = p;
    for (const m of this.edgeMats) m.emissiveIntensity = 1.3 + Math.sin(nowMs / 130) * 0.4 + blockLevel * 0.9;
  }
}
