/**
 * The city around the corridor — depth + atmosphere without a perf hit. Buildings get
 * a procedural lit-window façade (one shared canvas texture as an emissive map, tiled),
 * varied heights, and recede into fog. Grounded Arch ARCHWAYS (half-torus + pillars)
 * span the road as the "Arch" identity — read as gateways you run through, not floating
 * rings. Everything recycles by scrolling with distance. Presentation only; reused by
 * gameplay and the menu's static backdrop (same Renderer).
 */
import * as THREE from "three";

const COL = { building: 0x0a0c14, windowGlow: 0xffa94d, arch: 0xa85f23 };

/** Procedural window grid: lit (orange) + dark cells, baked once, tiled across façades. */
function makeWindowTexture(): THREE.Texture {
  if (typeof document === "undefined") return new THREE.Texture();
  const c = document.createElement("canvas");
  c.width = 64; c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#06070c"; ctx.fillRect(0, 0, 64, 128);
  const cols = 4, rows = 8, pad = 5;
  const cw = (64 - pad * 2) / cols, rh = (128 - pad * 2) / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = (x * 7 + y * 13 + x * y) % 5 < 2;         // stable pseudo-random lit pattern
      ctx.fillStyle = lit ? "#ffb15a" : "#0e1019";
      ctx.fillRect(pad + x * cw + 1, pad + y * rh + 1, cw - 3, rh - 3);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 6);
  return t;
}

export class CityScape {
  readonly group = new THREE.Group();
  private items: { m: THREE.Mesh; baseZ: number }[] = [];
  private gates: THREE.Mesh[] = [];
  private readonly span: number;

  constructor(scene: THREE.Scene, count = 18) {
    const winTex = makeWindowTexture();
    const cityMat = new THREE.MeshStandardMaterial({ color: COL.building, emissive: COL.windowGlow, emissiveMap: winTex, emissiveIntensity: 0.9, roughness: 0.85, metalness: 0.25 });
    const spacing = 11;
    this.span = count * spacing;
    const rows = [7.6, 16];
    for (const side of [-1, 1]) {
      for (let r = 0; r < rows.length; r++) {
        for (let i = 0; i < count; i++) {
          const h = 7 + ((i * 37 + r * 13 + (side > 0 ? 5 : 0)) % 24);
          const w = 2.8 + ((i * 7) % 3);
          const d = 3 + ((i * 5) % 3);
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cityMat);
          m.position.set(side * (rows[r]! + ((i * 3) % 4)), h / 2 - 0.1, 0);
          this.group.add(m);
          this.items.push({ m, baseZ: i * spacing + r * 5 });
          // a few taller buildings get a glowing rooftop cap (landmarks for motion)
          if ((i + r) % 5 === 0) {
            const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 0.5, d * 0.5), new THREE.MeshStandardMaterial({ color: COL.windowGlow, emissive: COL.windowGlow, emissiveIntensity: 1.1 }));
            cap.position.y = h / 2 + 0.25; m.add(cap);
          }
        }
      }
    }

    // Half-torus = a semicircular ARCHWAY rising from the floor (not a full ring/circle).
    const gateGeo = new THREE.TorusGeometry(4.3, 0.3, 8, 22, Math.PI);
    const gateMat = new THREE.MeshStandardMaterial({ color: COL.arch, emissive: 0x4a2206, emissiveIntensity: 0.28, roughness: 0.75, metalness: 0.2 });
    const legGeo = new THREE.BoxGeometry(0.42, 4.2, 0.42);
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Mesh(gateGeo, gateMat);
      g.position.y = 0;
      for (const sx of [-4.3, 4.3]) { const leg = new THREE.Mesh(legGeo, gateMat); leg.position.set(sx, 2.1, 0); g.add(leg); }
      this.gates.push(g); this.group.add(g);
    }

    scene.add(this.group);
  }

  update(distance: number): void {
    const span = this.span;
    for (const it of this.items) {
      const localZ = -((((it.baseZ - distance) % span) + span) % span) + 12;
      it.m.position.z = localZ;
      it.m.visible = localZ > -150 && localZ < 18;
    }
    const gspan = 120; // spaced so only one gateway is in view at a time
    for (let i = 0; i < this.gates.length; i++) {
      this.gates[i]!.position.z = -((((i * 40 - distance) % gspan) + gspan) % gspan) + 12;
    }
  }
}
