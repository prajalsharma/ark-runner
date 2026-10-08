/**
 * Procedural 3D runner — a jointed figure (head / torso / arms / legs) animated by
 * transforms, not a single block. Pure presentation: it reads sim state and plays a
 * run cycle, a jump tuck, and a slide crouch, blending smoothly between them. No
 * per-frame allocation. The brief's "stop looking like a primitive" pass.
 */
import * as THREE from "three";

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class RunnerRig {
  readonly group = new THREE.Group();
  private body = new THREE.Group();   // torso+head+arms (can lean)
  private hipL = new THREE.Group();
  private hipR = new THREE.Group();
  private shL = new THREE.Group();
  private shR = new THREE.Group();
  private limbMat: THREE.MeshStandardMaterial;
  private headMat: THREE.MeshStandardMaterial;
  private slideF = 0;  // eased 0..1 slide blend
  private airF = 0;    // eased 0..1 airborne blend

  constructor(color: number) {
    this.limbMat = new THREE.MeshStandardMaterial({ color, emissive: 0x7a2a00, emissiveIntensity: 0.6, roughness: 0.45 });
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xf4f1e6, emissive: 0x332a18, emissiveIntensity: 0.3, roughness: 0.5 });

    const box = (w: number, h: number, d: number, mat: THREE.Material, y: number, parent: THREE.Object3D): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.y = y; parent.add(m); return m;
    };

    // Legs: pivot at the hip, mesh hangs down.
    this.hipL.position.set(-0.18, 0.72, 0); box(0.22, 0.72, 0.26, this.limbMat, -0.36, this.hipL);
    this.hipR.position.set(0.18, 0.72, 0); box(0.22, 0.72, 0.26, this.limbMat, -0.36, this.hipR);
    box(0.3, 0.14, 0.42, this.limbMat, -0.72, this.hipL); // foot L
    box(0.3, 0.14, 0.42, this.limbMat, -0.72, this.hipR); // foot R
    this.group.add(this.hipL, this.hipR);

    // Body (leans): torso + head + arms, pivoting at the waist.
    this.body.position.set(0, 0.72, 0);
    box(0.62, 0.64, 0.38, this.limbMat, 0.32, this.body);      // torso
    box(0.44, 0.44, 0.44, this.headMat, 0.86, this.body);      // head
    // eyes (face +z, toward the camera)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a22 });
    const eye = (x: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.06), eyeMat);
      m.position.set(x, 0.9, 0.22); this.body.add(m);
    };
    eye(-0.1); eye(0.1);
    this.shL.position.set(-0.36, 0.56, 0); box(0.16, 0.5, 0.18, this.limbMat, -0.25, this.shL); // arm L
    this.shR.position.set(0.36, 0.56, 0); box(0.16, 0.5, 0.18, this.limbMat, -0.25, this.shR);  // arm R
    this.body.add(this.shL, this.shR);
    this.group.add(this.body);
  }

  setColor(hex: number): void { this.limbMat.color.set(hex); }
  setColorObj(c: THREE.Color): void { this.limbMat.color.copy(c); }

  /** Drive the pose. `phase` advances with distance so the gait matches speed. */
  update(st: { x: number; y: number; sliding: boolean; grounded: boolean; phase: number; emissive: number }): void {
    this.group.position.x = st.x;
    this.limbMat.emissiveIntensity = st.emissive;

    this.airF = lerp(this.airF, st.grounded ? 0 : 1, 0.25);
    this.slideF = lerp(this.slideF, st.sliding ? 1 : 0, 0.3);

    const s = Math.sin(st.phase);
    const swing = 0.7 * (1 - this.airF) * (1 - this.slideF);

    // Run cycle (legs/arms counter-swing); blended out when airborne/sliding.
    const runHipL = s * swing, runHipR = -s * swing;
    const runShL = -s * swing * 0.8, runShR = s * swing * 0.8;

    // Jump tuck: knees up, arms up.
    const jumpHip = -1.0 * this.airF, jumpSh = -1.6 * this.airF;
    // Slide: legs forward, arms back.
    const slideHip = -1.1 * this.slideF, slideSh = 1.2 * this.slideF;

    this.hipL.rotation.x = runHipL + jumpHip + slideHip;
    this.hipR.rotation.x = runHipR + jumpHip + slideHip;
    this.shL.rotation.x = runShL + jumpSh + slideSh;
    this.shR.rotation.x = runShR + jumpSh + slideSh;

    // Torso lean + bob; crouch flat when sliding.
    const bob = Math.abs(Math.sin(st.phase)) * 0.05 * (1 - this.airF) * (1 - this.slideF);
    this.body.rotation.x = lerp(0.12, 0, this.airF) + this.slideF * 1.1;
    this.group.position.y = st.y + bob;
    this.group.scale.y = lerp(1, 0.55, this.slideF);
  }
}
