/**
 * The city around the corridor — depth + atmosphere without a perf hit. Side towers
 * with lit windows and big Arch ring-gates the runner passes through, all recycled by
 * scrolling with distance (modulo wrap, like the floor ticks). Fixed per-item heights
 * so recycling never flickers. Presentation only; reused by gameplay and the menu's
 * attract scene (same Renderer).
 */
import * as THREE from "three";

const COL = { building: 0x0e1018, windowLit: 0x1a1d2a, windowGlow: 0xff7a1a, arch: 0xff9b4d };

export class CityScape {
  readonly group = new THREE.Group();
  private items: { m: THREE.Mesh; baseZ: number }[] = [];
  private gates: THREE.Mesh[] = [];
  private readonly span: number;

  constructor(scene: THREE.Scene, count = 18) {
    const plain = new THREE.MeshStandardMaterial({ color: COL.building, roughness: 0.9, metalness: 0.15 });
    const lit = new THREE.MeshStandardMaterial({ color: COL.windowLit, emissive: COL.windowGlow, emissiveIntensity: 0.22, roughness: 0.6 });
    const spacing = 11;
    this.span = count * spacing;
    const rows = [7.6, 16];
    for (const side of [-1, 1]) {
      for (let r = 0; r < rows.length; r++) {
        for (let i = 0; i < count; i++) {
          const h = 6 + ((i * 37 + r * 13 + (side > 0 ? 5 : 0)) % 20);
          const w = 2.6 + ((i * 7) % 3);
          const d = 3 + ((i * 5) % 3);
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), (i + r + (side > 0 ? 1 : 0)) % 3 === 0 ? lit : plain);
          m.position.set(side * (rows[r]! + ((i * 3) % 4)), h / 2 - 0.1, 0);
          this.group.add(m);
          this.items.push({ m, baseZ: i * spacing + r * 5 });
        }
      }
    }
    // Arch gateway structures spanning the road — the "Arch" identity. Grounded (bottom
    // at the floor) so they read as doorways you run THROUGH, not floating rings, and
    // dim/structural rather than glowing. Fewer + spaced so only one is in view at a time.
    // Half-torus = a semicircular ARCHWAY rising from the floor (not a full ring/circle).
    const gateGeo = new THREE.TorusGeometry(4.3, 0.3, 8, 22, Math.PI);
    const gateMat = new THREE.MeshStandardMaterial({ color: 0xa85f23, emissive: 0x4a2206, emissiveIntensity: 0.28, roughness: 0.75, metalness: 0.2 });
    const legGeo = new THREE.BoxGeometry(0.42, 4.2, 0.42); // pillars grounding the arch
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Mesh(gateGeo, gateMat);
      g.position.y = 0; // legs touch the road, peak overhead
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
