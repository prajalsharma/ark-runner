/**
 * The MEMPOOL DISTRICT — a coherent Bitcoin-dusk city around the run, not a dark room.
 * Layers: a gradient sky with a warm horizon (fog fades the towers INTO it, so the street
 * recedes to a glowing skyline instead of black); a near roadside building wall + mid + far
 * tower rows at varied heights with lit-window façades; street lamps with orange glow lining
 * the road; the grounded Arch gateways overhead; and an occasional ₿ landmark sign. Every
 * layer stays clear of the running lanes (±2.2) so hazards/coins read. Scrolls with distance;
 * presentation only. Shared by gameplay and the menu backdrop.
 */
import * as THREE from "three";

const COL = { building: 0x0a0c14, windowGlow: 0xffa94d, arch: 0xa85f23, lamp: 0xf7931a };

/** Procedural window grid: lit (orange) + dark cells, baked once, tiled across façades. */
function makeWindowTexture(): THREE.Texture {
  if (typeof document === "undefined") return new THREE.Texture();
  const S = 4; // supersample so the window cells have crisp edges (not blocky)
  const c = document.createElement("canvas");
  c.width = 64 * S; c.height = 128 * S;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#06070c"; ctx.fillRect(0, 0, c.width, c.height);
  const cols = 4, rows = 8, pad = 5 * S;
  const cw = (c.width - pad * 2) / cols, rh = (c.height - pad * 2) / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = (x * 7 + y * 13 + x * y) % 5 < 2;
      // slight warm variation on lit windows so the façade isn't a flat repeat
      ctx.fillStyle = lit ? ((x + y) % 3 === 0 ? "#ffd38a" : "#ffb15a") : "#0e1019";
      ctx.fillRect(pad + x * cw + 1 * S, pad + y * rh + 1 * S, cw - 3 * S, rh - 3 * S);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 6);
  t.anisotropy = 8; // crisp at the grazing angles the street buildings are seen from
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Vertical dusk gradient: deep indigo overhead → warm Bitcoin glow at the horizon. */
function makeSkyTexture(): THREE.Texture {
  if (typeof document === "undefined") return new THREE.Texture();
  const c = document.createElement("canvas");
  c.width = 16; c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, "#0a0d1c");   // zenith
  g.addColorStop(0.55, "#141026");  // upper sky
  g.addColorStop(0.78, "#3a2033");  // dusk band
  g.addColorStop(0.9, "#7a3c15");   // horizon glow (Bitcoin dusk)
  g.addColorStop(1.0, "#120d16");   // ground haze
  ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** A big ₿ sign for a landmark billboard, baked once. */
function makeSignTexture(): THREE.Texture {
  if (typeof document === "undefined") return new THREE.Texture();
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0a0c14"; ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = "#f7931a"; ctx.font = "bold 104px Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("₿", 64, 70);
  return new THREE.CanvasTexture(c);
}

export class CityScape {
  readonly group = new THREE.Group();
  // Everything repeated is an InstancedMesh (one draw call each) instead of 100s of meshes.
  private buildings!: THREE.InstancedMesh;
  private caps!: THREE.InstancedMesh;
  private posts!: THREE.InstancedMesh;
  private heads!: THREE.InstancedMesh;
  private signs!: THREE.InstancedMesh;
  private bData: { x: number; y: number; w: number; h: number; d: number; baseZ: number }[] = [];
  private capData: { x: number; y: number; w: number; d: number; baseZ: number }[] = [];
  private signData: { x: number; y: number; z: number; rotY: number; baseZ: number }[] = [];
  private lampData: { x: number; baseZ: number }[] = [];
  private gates: THREE.Mesh[] = [];
  private readonly span: number;
  private readonly dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene, count = 18) {
    // --- Sky dome: always behind everything (fog-exempt) so there's a real horizon. ---
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(320, 24, 16),
      new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }),
    );
    scene.add(sky);

    const winTex = makeWindowTexture();
    const cityMat = new THREE.MeshStandardMaterial({ color: COL.building, emissive: COL.windowGlow, emissiveMap: winTex, emissiveIntensity: 0.9, roughness: 0.85, metalness: 0.25 });
    const spacing = 11;
    this.span = count * spacing;
    // Three depth layers each side: a near street wall (fills the old dark gap beside the
    // road), a mid row, and a far skyline row. Near row's INNER edge clears the road
    // (lanes x∈[-3.45,3.45]). Layout is collected as data, then drawn as InstancedMeshes.
    const rows = [6.5, 10.5, 18];
    for (const side of [-1, 1]) {
      for (let r = 0; r < rows.length; r++) {
        for (let i = 0; i < count; i++) {
          const near = r === 0;
          const h = (near ? 5 : 8) + ((i * 37 + r * 13 + (side > 0 ? 5 : 0)) % (near ? 14 : 26));
          const w = 2.6 + ((i * 7) % 3) * 0.8;
          const d = 3 + ((i * 5) % 3);
          const x = side * (rows[r]! + ((i * 3) % 4)); // offset pushes OUTWARD only
          const baseZ = i * spacing + r * 5;
          this.bData.push({ x, y: h / 2 - 0.1, w, h, d, baseZ });
          if ((i + r) % 5 === 0) this.capData.push({ x, y: h + 0.15, w: w * 0.5, d: d * 0.5, baseZ });
          if (r === 2 && h > 24 && i % 4 === 0) this.signData.push({ x, y: (h / 2 - 0.1) + h * 0.2, z: d / 2 + 0.06, rotY: side < 0 ? 0.25 : -0.25, baseZ });
        }
      }
    }
    const unit = new THREE.BoxGeometry(1, 1, 1);
    this.buildings = new THREE.InstancedMesh(unit, cityMat, this.bData.length);
    this.buildings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.buildings.frustumCulled = false; this.buildings.receiveShadow = true;
    this.group.add(this.buildings);
    const capMat = new THREE.MeshStandardMaterial({ color: COL.windowGlow, emissive: COL.windowGlow, emissiveIntensity: 1.1 });
    this.caps = new THREE.InstancedMesh(unit, capMat, Math.max(1, this.capData.length));
    this.caps.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.caps.frustumCulled = false;
    this.group.add(this.caps);
    const signMat = new THREE.MeshStandardMaterial({ map: makeSignTexture(), emissive: 0xf7931a, emissiveIntensity: 0.8, transparent: true, side: THREE.DoubleSide });
    this.signs = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.2, 3.2), signMat, Math.max(1, this.signData.length));
    this.signs.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.signs.frustumCulled = false;
    this.group.add(this.signs);

    // --- Street lamps (Bitcoin-orange glow): instanced posts + instanced glowing heads. ---
    const postMat = new THREE.MeshStandardMaterial({ color: 0x1a1d27, roughness: 0.6, metalness: 0.5 });
    const headMat = new THREE.MeshStandardMaterial({ color: COL.lamp, emissive: COL.lamp, emissiveIntensity: 1.8, roughness: 0.4 });
    const lampSpacing = 9;
    const lampCount = Math.ceil(this.span / lampSpacing);
    for (let i = 0; i < lampCount; i++) for (const side of [-1, 1]) this.lampData.push({ x: side * 3.9, baseZ: i * lampSpacing + (side > 0 ? lampSpacing / 2 : 0) });
    this.posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 3.4, 6), postMat, this.lampData.length);
    this.posts.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.posts.frustumCulled = false; this.group.add(this.posts);
    this.heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 10, 8), headMat, this.lampData.length);
    this.heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.heads.frustumCulled = false; this.group.add(this.heads);

    // --- Grounded Arch gateways overhead (the "Arch" identity; clears all gameplay). ---
    const gateGeo = new THREE.TorusGeometry(5.5, 0.32, 8, 24, Math.PI);
    const gateMat = new THREE.MeshStandardMaterial({ color: COL.arch, emissive: 0x4a2206, emissiveIntensity: 0.28, roughness: 0.75, metalness: 0.2 });
    const legGeo = new THREE.BoxGeometry(0.44, 2.6, 0.44);
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Mesh(gateGeo, gateMat);
      g.position.y = 2.6;
      for (const sx of [-5.5, 5.5]) { const leg = new THREE.Mesh(legGeo, gateMat); leg.position.set(sx, -1.3, 0); g.add(leg); }
      this.gates.push(g); this.group.add(g);
    }

    scene.add(this.group);
  }

  update(distance: number): void {
    const span = this.span;
    const wrap = (baseZ: number): number => -((((baseZ - distance) % span) + span) % span) + 12;
    const dm = this.dummy;
    for (let i = 0; i < this.bData.length; i++) {
      const b = this.bData[i]!;
      dm.position.set(b.x, b.y, wrap(b.baseZ)); dm.rotation.set(0, 0, 0); dm.scale.set(b.w, b.h, b.d);
      dm.updateMatrix(); this.buildings.setMatrixAt(i, dm.matrix);
    }
    this.buildings.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.capData.length; i++) {
      const c = this.capData[i]!;
      dm.position.set(c.x, c.y, wrap(c.baseZ)); dm.rotation.set(0, 0, 0); dm.scale.set(c.w, 0.5, c.d);
      dm.updateMatrix(); this.caps.setMatrixAt(i, dm.matrix);
    }
    this.caps.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.signData.length; i++) {
      const s = this.signData[i]!;
      dm.position.set(s.x, s.y, wrap(s.baseZ) + s.z); dm.rotation.set(0, s.rotY, 0); dm.scale.set(1, 1, 1);
      dm.updateMatrix(); this.signs.setMatrixAt(i, dm.matrix);
    }
    this.signs.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.lampData.length; i++) {
      const l = this.lampData[i]!; const z = wrap(l.baseZ);
      dm.rotation.set(0, 0, 0); dm.scale.set(1, 1, 1);
      dm.position.set(l.x, 1.7, z); dm.updateMatrix(); this.posts.setMatrixAt(i, dm.matrix);
      dm.position.set(l.x, 3.5, z); dm.updateMatrix(); this.heads.setMatrixAt(i, dm.matrix);
    }
    this.posts.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
    const gspan = 120;
    for (let i = 0; i < this.gates.length; i++) {
      this.gates[i]!.position.z = -((((i * 40 - distance) % gspan) + gspan) % gspan) + 12;
    }
  }
}
