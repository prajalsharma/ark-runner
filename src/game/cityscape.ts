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
  private items: { m: THREE.Mesh; baseZ: number }[] = [];
  private lamps: { m: THREE.Group; baseZ: number }[] = [];
  private gates: THREE.Mesh[] = [];
  private readonly span: number;

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
    // road), a mid row, and a far skyline row — so the street has foreground/mid/background.
    // The near row's INNER edge must clear the road: lanes span x∈[-3.45,3.45], so with a
    // max half-width of ~2.4 the near base is 6.5 → inner edge ≥ 4.1 (on the sidewalk, never
    // on the running lanes). This fixes buildings poking onto the street.
    const rows = [6.5, 10.5, 18];
    for (const side of [-1, 1]) {
      for (let r = 0; r < rows.length; r++) {
        for (let i = 0; i < count; i++) {
          const near = r === 0;
          const h = (near ? 5 : 8) + ((i * 37 + r * 13 + (side > 0 ? 5 : 0)) % (near ? 14 : 26));
          const w = 2.6 + ((i * 7) % 3) * 0.8;
          const d = 3 + ((i * 5) % 3);
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cityMat);
          // offset pushes buildings OUTWARD only (never toward the road).
          m.position.set(side * (rows[r]! + ((i * 3) % 4)), h / 2 - 0.1, 0);
          this.group.add(m);
          this.items.push({ m, baseZ: i * spacing + r * 5 });
          if ((i + r) % 5 === 0) {
            const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 0.5, d * 0.5), new THREE.MeshStandardMaterial({ color: COL.windowGlow, emissive: COL.windowGlow, emissiveIntensity: 1.1 }));
            cap.position.y = h / 2 + 0.25; m.add(cap);
          }
          // Landmark ₿ billboard on a few tall far-row towers.
          if (r === 2 && h > 24 && i % 4 === 0) {
            const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshStandardMaterial({ map: makeSignTexture(), emissive: 0xf7931a, emissiveIntensity: 0.8, transparent: true }));
            sign.position.set(0, h * 0.2, d / 2 + 0.06);
            sign.rotation.y = side < 0 ? 0.25 : -0.25;
            m.add(sign);
          }
        }
      }
    }

    // --- Street lamps lining the road (Bitcoin-orange glow — street-level life + accent). ---
    const postGeo = new THREE.CylinderGeometry(0.08, 0.1, 3.4, 6);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x1a1d27, roughness: 0.6, metalness: 0.5 });
    const armGeo = new THREE.BoxGeometry(0.7, 0.1, 0.1);
    const headMat = new THREE.MeshStandardMaterial({ color: COL.lamp, emissive: COL.lamp, emissiveIntensity: 1.8, roughness: 0.4 });
    const lampSpacing = 9;
    const lampCount = Math.ceil(this.span / lampSpacing);
    for (let i = 0; i < lampCount; i++) {
      for (const side of [-1, 1]) {
        const g = new THREE.Group();
        const post = new THREE.Mesh(postGeo, postMat); post.position.y = 1.7; g.add(post);
        const arm = new THREE.Mesh(armGeo, postMat); arm.position.set(side * -0.35, 3.3, 0); g.add(arm);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), headMat); head.position.set(side * -0.7, 3.25, 0); g.add(head);
        g.position.set(side * 3.9, 0, 0);
        this.group.add(g);
        this.lamps.push({ m: g, baseZ: i * lampSpacing + (side > 0 ? lampSpacing / 2 : 0) });
      }
    }

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
    for (const it of this.items) {
      const localZ = -((((it.baseZ - distance) % span) + span) % span) + 12;
      it.m.position.z = localZ;
      it.m.visible = localZ > -200 && localZ < 18;
    }
    for (const lp of this.lamps) {
      const localZ = -((((lp.baseZ - distance) % span) + span) % span) + 12;
      lp.m.position.z = localZ;
      lp.m.visible = localZ > -90 && localZ < 16;
    }
    const gspan = 120;
    for (let i = 0; i < this.gates.length; i++) {
      this.gates[i]!.position.z = -((((i * 40 - distance) % gspan) + gspan) % gspan) + 12;
    }
  }
}
