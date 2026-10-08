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

  constructor(scene: THREE.Scene) {
    const plain = new THREE.MeshStandardMaterial({ color: COL.building, roughness: 0.9, metalness: 0.15 });
    const lit = new THREE.MeshStandardMaterial({ color: COL.windowLit, emissive: COL.windowGlow, emissiveIntensity: 0.22, roughness: 0.6 });
    const count = 18, spacing = 11;
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
    // Arch ring-gates spanning the corridor — the "Arch" identity, run straight through them.
    const gateGeo = new THREE.TorusGeometry(5.2, 0.34, 8, 28);
    const gateMat = new THREE.MeshStandardMaterial({ color: COL.arch, emissive: COL.arch, emissiveIntensity: 0.45, roughness: 0.4 });
    for (let i = 0; i < 4; i++) { const g = new THREE.Mesh(gateGeo, gateMat); g.position.y = 2.4; this.gates.push(g); this.group.add(g); }

    scene.add(this.group);
  }

  update(distance: number): void {
    const span = this.span;
    for (const it of this.items) {
      const localZ = -((((it.baseZ - distance) % span) + span) % span) + 12;
      it.m.position.z = localZ;
      it.m.visible = localZ > -150 && localZ < 18;
    }
    const gspan = 70;
    for (let i = 0; i < this.gates.length; i++) {
      this.gates[i]!.position.z = -((((i * 17.5 - distance) % gspan) + gspan) % gspan) + 12;
    }
  }
}
